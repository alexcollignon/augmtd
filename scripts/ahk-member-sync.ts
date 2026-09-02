// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MEMBER DIRECTORY SYNC (AHK tender matching, P1) — portal → profile docs + manifest.
//
// Pulls the public member directory, derives sector tags / CPV divisions / German link, writes one
// markdown profile doc per member into the "AHK Member companies" KB folder THROUGH THE REAL INDEXER
// (chunks + embeddings + Knowledge visibility + read_kb_folder-able — the seed-kit idiom), and
// replaces the deterministic manifest on item_plans.
//
// IDEMPOTENT AT ZERO AI COST: derivation is cached by the content hash of the member's own text,
// and the doc write is content-hash fast-skipped exactly like seedKnowledgeForUser. A second run
// on an unchanged directory classifies nothing and indexes nothing.
//
// DEPARTURES ARE PRUNED: a member who has left the chamber is gone from the portal, and their
// profile doc + manifest entry go with them — but ONLY off a full pull (`selectDepartures`' guard),
// because a short fetch looks exactly like a mass departure.
//
// Dry-run by default; --apply writes.
//   npx tsx --env-file=.env.local scripts/ahk-member-sync.ts [--apply] [--user <uuid>] [--limit N]
// The default target is THE SHARED PROBE HOST — never a real account unless --user says so.
//
// SCHEDULING (not wired — a deliberate choice, this script writes to a real knowledge base): run it
// weekly, before the matching workflow's own slot. Either as a cron on any box with the repo and
// .env.local (`0 6 * * 1  cd /path/to/augmtd && npx tsx --env-file=.env.local scripts/ahk-member-sync.ts
// --apply --user <uuid> --lanes 6`), or — the platform-native version when this stops being a
// script — a scheduled workflow whose first step re-syncs the folder. Re-running costs zero AI on
// an unchanged directory, so a too-frequent schedule is wasteful, never harmful.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import {
  fetchMemberDirectory, deriveMemberFacts, renderMemberProfileDoc, memberDocFilename,
  buildManifest, cacheFromManifest, readMemberManifest, writeMemberManifest,
  selectDepartures, memberDocPrefix, profileManifestFrom,
  MEMBER_FOLDER_NAME, type PortalMember,
} from '../lib/tenders/member-directory';
import { readEnrichmentStore, websiteNotesOf } from '../lib/tenders/enrich-members';
import { writeProfileDoc, KB_BUCKET } from '../lib/tenders/write-profile-doc';
import { writeProfileManifest } from '../lib/matching/manifest';
// The CLIENT accounts. This script never runs against them, at all, under any flag.
const FORBIDDEN = new Set(['9d3921b2', 'de4e8824']);
// The platform owner's own account: reachable, but only when the invocation SAYS SO. A real
// account is never something a stray --user typo can seed.
const OWNER_PREFIX = '08fe4449';

const APPLY = process.argv.includes('--apply');
const argOf = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const USER_ARG = argOf('--user');
const LIMIT = Number(argOf('--limit') ?? '0') || 0;
// Indexing is latency-bound (a summarize + an embed per chunk), not rate-limited — the pool width
// is the whole throughput knob. 3 is the polite default (the seed-kit idiom); a one-off bulk load
// of 1,002 profiles says --lanes and means it.
const LANES = Math.max(1, Math.min(Number(argOf('--lanes') ?? '3') || 3, 12));

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function ensureFolder(userId: string): Promise<string | null> {
  const { data: existing } = await sb.from('drive_folders').select('id, name').eq('user_id', userId);
  const hit = (existing ?? []).find((f: { name: string }) => f.name?.toLowerCase() === MEMBER_FOLDER_NAME.toLowerCase());
  if (hit) return (hit as { id: string }).id;
  if (!APPLY) return null;
  const { data, error } = await sb.from('drive_folders')
    .insert({ user_id: userId, name: MEMBER_FOLDER_NAME }).select('id').single();
  if (error || !data) throw new Error(`folder create failed: ${error?.message}`);
  return data.id as string;
}

// The doc writer (content-hash fast-skip + the rename and stuck-row heals) lives in
// lib/tenders/write-profile-doc.ts — ONE writer, shared with the website-enrichment pass.

(async () => {
  const userId = USER_ARG ?? (await resolveProbeUser(sb));
  if ([...FORBIDDEN].some((p) => userId.startsWith(p))) {
    throw new Error(`refusing to touch a client account (${userId})`);
  }
  if (userId.startsWith(OWNER_PREFIX) && !process.argv.includes('--allow-owner')) {
    throw new Error(`that is the owner's own account (${userId}) — pass --allow-owner to mean it`);
  }
  console.log(`\n═══ AHK member sync ${APPLY ? '(APPLY)' : '(dry run)'} — user ${userId}${LIMIT ? ` · limit ${LIMIT}` : ''} · ${LANES} lanes`);

  // 1 — the pull. A --limit run pulls only the pages it needs (politeness), and skips the
  //     short-pull assertion by construction.
  const maxPages = LIMIT ? Math.ceil(LIMIT / 16) : undefined;
  const all = await fetchMemberDirectory(maxPages ? { maxPages } : undefined);
  const members: PortalMember[] = LIMIT ? all.slice(0, LIMIT) : all;
  console.log(`fetched:    ${members.length}${LIMIT ? ` of ${all.length} pulled` : ''}`);

  // 2 — derivation, cached by content hash off the previous manifest.
  const prior = await readMemberManifest(sb, userId);
  const { derived, stats } = await deriveMemberFacts(members, {
    userId, supabase: sb, cache: cacheFromManifest(prior), noAI: !APPLY,
  });
  console.log(
    `classified: ${stats.ai} by AI (${stats.calls} calls) · ${stats.deterministic} deterministic · ` +
    `${stats.cached} cached · ${stats.fallback} unplaced`,
  );

  if (!APPLY) {
    const sample = members[0];
    console.log('\n── sample profile doc ──\n');
    console.log(renderMemberProfileDoc(sample, derived[String(sample.id)]));
    console.log('── dry run: nothing written ──\n');
    return;
  }

  // 3 — the docs, through the real indexer.
  await sb.storage.createBucket(KB_BUCKET, { public: false }).catch(() => {});
  const folderId = await ensureFolder(userId);
  if (!folderId) throw new Error('no folder');
  const syncedAt = new Date().toISOString();

  // THE ENRICHMENT SURVIVES A RE-SYNC. The website paragraph is authored by a different pass and
  // lives in its own store; a directory re-sync re-renders every doc from scratch, so without this
  // it would silently delete work it did not write.
  const websiteNotes = websiteNotesOf(await readEnrichmentStore(sb, userId));
  console.log(`enrichment: ${Object.keys(websiteNotes).length} website sections carried over`);

  let wrote = 0, skipped = 0, failed = 0, done = 0;
  const queue = members.slice();
  await Promise.all(Array.from({ length: Math.min(LANES, queue.length) }, async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const doc = renderMemberProfileDoc(m, derived[String(m.id)], {
        syncedAt, website: websiteNotes[String(m.id)] ?? null,
      });
      const r = await writeProfileDoc(sb, userId, folderId, memberDocFilename(m), doc);
      if (r === 'wrote') wrote++; else if (r === 'skipped') skipped++; else failed++;
      if (++done % 20 === 0) process.stdout.write(`  …${done}/${members.length}\n`);
    }
  }));

  // 4 — DEPARTURES. Only off a full pull; the selection itself refuses otherwise.
  const { departed, refusedReason } = selectDepartures(prior, members, { full: LIMIT === 0 });
  let pruned = 0;
  for (const id of departed) {
    const { data: docs } = await sb.from('knowledge_files').select('id, filename')
      .eq('user_id', userId).eq('folder_id', folderId).like('filename', `${memberDocPrefix(id)}%`);
    for (const d of docs ?? []) {
      await sb.from('knowledge_files').delete().eq('id', (d as { id: string }).id);
      pruned++;
    }
  }

  // 5 — the manifests, replaced whole. The departed are gone by construction: the manifest is built
  //     from THIS pull, never merged into the old one.
  const manifest = buildManifest(members, derived, syncedAt);
  await writeMemberManifest(sb, userId, manifest);
  await writeProfileManifest(sb, userId, profileManifestFrom(manifest, MEMBER_FOLDER_NAME));

  console.log(
    `\ndocs:       ${wrote} written · ${skipped} unchanged${failed ? ` · ${failed} FAILED` : ''}\n` +
    `departures: ${departed.length} ausgeschieden · ${pruned} Profildokument(e) entfernt` +
    `${refusedReason ? ` (pruning skipped — ${refusedReason})` : ''}\n` +
    `manifest:   ${manifest.members.length} members (v${manifest.version}, ${manifest.syncedAt})\n`,
  );
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
