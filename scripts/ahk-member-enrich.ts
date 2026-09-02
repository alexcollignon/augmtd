// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WEBSITE ENRICHMENT DRIVER (AHK tender matching, P4 — the enrichment ladder's v1 rung).
//
// For every member whose directory row names a website (~69% of 1,002): fetch the homepage, read
// its text, and write ONE factual paragraph into the member's profile document under
// "## Von der Website / From the website" — below the directory sections, above "## Chamber notes".
//
// WHY IT MATTERS (the bias audit, Sep 2): the evidence law only ever quotes the profile's own text,
// and the directory gives most members ~67 characters of it. Thin profiles are not selective, they
// are UNMATCHABLE — so the same handful of long-text members won every window. This gives the law
// something to read for the other 900.
//
//   npx tsx --env-file=.env.local scripts/ahk-member-enrich.ts \
//     [--apply] [--user <uuid>] [--allow-owner] [--limit N] [--lanes N] [--delay MS]
//
// Dry run by default: it FETCHES (so the ledger is real) and summarises nothing, writes nothing.
// Client accounts are forbidden outright; the owner's own account needs --allow-owner.
//
// IDEMPOTENT AT ZERO AI COST: the cache is keyed on a hash of the FETCHED PAGE TEXT. A second run
// over unchanged sites summarises nothing and rewrites no document. A page whose text changed is
// re-read; a page that yielded NOTHING is remembered as such and never re-billed.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import {
  fetchMemberDirectory, renderMemberProfileDoc, memberDocFilename, readMemberManifest,
  cacheFromManifest, MEMBER_FOLDER_NAME, type PortalMember, type MemberDerived,
} from '../lib/tenders/member-directory';
import {
  enrichMember, readEnrichmentStore, writeEnrichmentStore, websiteNoteOf, siteUrlOf,
  type EnrichOutcome, type MemberEnrichment,
} from '../lib/tenders/enrich-members';
import { writeProfileDoc } from '../lib/tenders/write-profile-doc';

// The CLIENT accounts. This script never runs against them, at all, under any flag.
const FORBIDDEN = new Set(['9d3921b2', 'de4e8824']);
const OWNER_PREFIX = '08fe4449';

const APPLY = process.argv.includes('--apply');
const argOf = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const USER_ARG = argOf('--user');
const LIMIT = Number(argOf('--limit') ?? '0') || 0;
// Network-bound, not rate-limited: the lane width is the throughput knob. 8 is polite against ~700
// DIFFERENT hosts (each lane hits a different domain almost every time).
const LANES = Math.max(1, Math.min(Number(argOf('--lanes') ?? '8') || 8, 16));
// Politeness delay per lane between requests.
const DELAY_MS = Math.max(0, Number(argOf('--delay') ?? '250') || 0);
// The store is flushed periodically so a long run that dies keeps what it already paid for.
const FLUSH_EVERY = 25;

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function folderIdOf(userId: string): Promise<string | null> {
  const { data } = await sb.from('drive_folders').select('id, name').eq('user_id', userId);
  const hit = (data ?? []).find((f: { name: string }) => f.name?.toLowerCase() === MEMBER_FOLDER_NAME.toLowerCase());
  return hit ? (hit as { id: string }).id : null;
}

(async () => {
  const userId = USER_ARG ?? (await resolveProbeUser(sb));
  if ([...FORBIDDEN].some((p) => userId.startsWith(p))) {
    throw new Error(`refusing to touch a client account (${userId})`);
  }
  if (userId.startsWith(OWNER_PREFIX) && !process.argv.includes('--allow-owner')) {
    throw new Error(`that is the owner's own account (${userId}) — pass --allow-owner to mean it`);
  }

  console.log(`\n═══ AHK member website enrichment ${APPLY ? '(APPLY)' : '(dry run — fetch only)'} — ` +
    `user ${userId.slice(0, 8)}${LIMIT ? ` · limit ${LIMIT}` : ''} · ${LANES} lanes · ${DELAY_MS}ms delay`);

  const maxPages = LIMIT ? Math.ceil(LIMIT / 16) : undefined;
  const all = await fetchMemberDirectory(maxPages ? { maxPages } : undefined);
  const members: PortalMember[] = LIMIT ? all.slice(0, LIMIT) : all;
  const withSite = members.filter((m) => !!siteUrlOf(m));
  console.log(`members:    ${members.length} · ${withSite.length} name a website ` +
    `(${Math.round((withSite.length / Math.max(1, members.length)) * 100)}%)`);

  const store = await readEnrichmentStore(sb, userId);
  console.log(`cache:      ${Object.keys(store.members).length} members already read` +
    `${store.updatedAt ? ` (last ${store.updatedAt.slice(0, 10)})` : ''}`);

  // Derived facts + folder — needed to RE-RENDER the doc with its new section. The doc is always
  // rendered whole from the source row, never patched textually: one renderer, one shape.
  const memberManifest = await readMemberManifest(sb, userId);
  const derivedCache = cacheFromManifest(memberManifest);
  const folderId = APPLY ? await folderIdOf(userId) : null;
  if (APPLY && !folderId) throw new Error(`no "${MEMBER_FOLDER_NAME}" folder on this account — run the sync first`);

  const tally: Record<EnrichOutcome, number> = {
    'no-site': 0, unchanged: 0, fetchable: 0, unreachable: 0, thin: 0, enriched: 0, nothing: 0, failed: 0,
  };
  let calls = 0, promptTokens = 0, completionTokens = 0;
  let docsWritten = 0, docsSkipped = 0, docsFailed = 0, processed = 0;
  const pending: Record<string, MemberEnrichment> = {};

  const flush = async () => {
    if (!APPLY || !Object.keys(pending).length) return;
    for (const [id, e] of Object.entries(pending)) store.members[id] = e;
    for (const id of Object.keys(pending)) delete pending[id];
    await writeEnrichmentStore(sb, userId, store);
  };

  const queue = members.slice();
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(LANES, queue.length) }, async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const id = String(m.id);
      const res = await enrichMember(m, {
        admin: sb, userId, prior: store.members[id], noAI: !APPLY,
      });
      tally[res.outcome]++;
      calls += res.calls; promptTokens += res.promptTokens; completionTokens += res.completionTokens;

      if (APPLY && res.entry) {
        pending[id] = res.entry;
        // The doc is rewritten only when a real section changes — a NOTHING verdict leaves the
        // document exactly as it was (an empty section would be a claim of its own).
        const note = websiteNoteOf(res.entry);
        if (note && folderId) {
          const derived: MemberDerived = derivedCache[id]?.derived
            ?? { sectorTags: ['Sonstiges'], cpvDivisions: [], germanLink: false, via: 'cached' };
          const doc = renderMemberProfileDoc(m, derived, { website: note });
          const w = await writeProfileDoc(sb, userId, folderId, memberDocFilename(m), doc);
          if (w === 'wrote') docsWritten++; else if (w === 'skipped') docsSkipped++; else docsFailed++;
        }
      }

      if (++processed % FLUSH_EVERY === 0) {
        await flush();
        process.stdout.write(
          `  …${processed}/${members.length} · ${tally.enriched} enriched · ` +
          `${tally.unchanged + tally.fetchable} unchanged · ` +
          `${tally.unreachable + tally.thin} dead · ${calls} AI calls\n`);
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }
  }));
  await flush();

  // Cost estimate off the real token counts — the same table the usage ledger uses.
  const { estimateCostEur } = await import('../lib/ai/pricing');
  const { getAIClient } = await import('../lib/ai/factory');
  let cost = 0;
  try {
    const { model } = await getAIClient(userId, 'classification', sb);
    cost = estimateCostEur(model, promptTokens, completionTokens);
  } catch { /* the estimate is a courtesy, never the point */ }

  const mins = Math.round((Date.now() - t0) / 600) / 100;
  console.log(
    `\n── ledger (${mins} min) ────────────────────────────────\n` +
    `  no website in the row:   ${tally['no-site']}\n` +
    `  fetched, unchanged:      ${tally.unchanged}   (zero AI, zero writes)\n` +
    (tally.fetchable ? `  fetched, summarisable:   ${tally.fetchable}   (dry run — would cost 1 call each)\n` : '') +
    `  dead / parked / blocked: ${tally.unreachable}\n` +
    `  reachable but too thin:  ${tally.thin}\n` +
    `  ENRICHED:                ${tally.enriched}\n` +
    `  read, said NOTHING:      ${tally.nothing}\n` +
    `  AI call failed (retries next run): ${tally.failed}\n` +
    `  AI calls: ${calls} · tokens ${promptTokens}+${completionTokens} · ~€${cost.toFixed(2)}\n` +
    `  docs: ${docsWritten} rewritten · ${docsSkipped} already current${docsFailed ? ` · ${docsFailed} FAILED` : ''}\n` +
    `  store: ${Object.keys(store.members).length} members cached\n` +
    (APPLY ? '' : '\n  (dry run — nothing summarised, nothing written)\n'),
  );
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
