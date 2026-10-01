// ════════════════════════════════════════════════════════════════════════════════════════════════
// DEDUPE SINGLETON KNOWLEDGE SOURCES (Oct 1) — the repair half of W38's "THE SNOWBALL".
//
// `getOrCreateAugmtdSource` (and its sibling `getOrCreateUploadSource`) are meant to keep ONE source
// per user per provider. A race inserted two; from then on `.maybeSingle()` errored on the pair, the
// error read as "none", and every later index inserted ANOTHER source (one account carries 64 "AUGMTD
// Files" sources). The readers are fixed (oldest row = the one source, read errors surfaced); this
// sweep folds the existing duplicates into that same oldest row.
//
// PER USER × SINGLETON PROVIDER ('augmtd', 'upload'):
//   canonical = the OLDEST source (created_at, then id) — exactly the row the fixed reader returns.
//   1. repoint every knowledge_files row on a duplicate to the canonical source (ONE update statement
//      per user+provider — atomic in Postgres). Chunks hang off file_id, so they follow their file
//      untouched. (user_id, provider_file_id) is the files' unique key — repointing cannot collide.
//   2. delete each duplicate ONLY after re-counting zero files on it: knowledge_files.source_id is
//      ON DELETE CASCADE, so deleting a source that still holds a file would destroy that file. A
//      duplicate that gained a file between steps is left in place and reported (re-run folds it).
// IDEMPOTENT: a second run finds one source per provider and does nothing.
//
//   npx tsx --env-file=.env.local scripts/dedupe-augmtd-sources.ts                 # DRY RUN, all users
//   npx tsx --env-file=.env.local scripts/dedupe-augmtd-sources.ts --user <uuid>   # dry run, one user
//   ... --apply --user <uuid>    # owner-gated: fold one user
//   ... --apply --all            # owner-gated: fold every user (sequential, per-user)
//   --provider augmtd|upload     # limit to one provider (default both)
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] ?? null : null; };
const APPLY = argv.includes('--apply');
const USER = opt('user');
const PROVIDERS = opt('provider') ? [opt('provider')!] : ['augmtd', 'upload'];

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type Source = { id: string; user_id: string; provider: string; folder_name: string | null; created_at: string };

async function pageAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function filesOn(sourceIds: string[]): Promise<Array<{ id: string; source_id: string }>> {
  const out: Array<{ id: string; source_id: string }> = [];
  for (let i = 0; i < sourceIds.length; i += 100) {
    const ids = sourceIds.slice(i, i + 100);
    out.push(...await pageAll<{ id: string; source_id: string }>((a, b) =>
      admin.from('knowledge_files').select('id, source_id').in('source_id', ids).order('id').range(a, b)));
  }
  return out;
}

async function chunkCount(fileIds: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < fileIds.length; i += 100) {
    const { count, error } = await admin.from('knowledge_chunks').select('id', { count: 'exact', head: true }).in('file_id', fileIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    n += count ?? 0;
  }
  return n;
}

const byAge = (a: Source, b: Source) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);

async function foldOne(userId: string, provider: string): Promise<{ moved: number; deleted: number; kept: number }> {
  // Re-read at apply time — never act on the dry-run's snapshot.
  const { data, error } = await admin.from('knowledge_sources').select('id, user_id, provider, folder_name, created_at')
    .eq('user_id', userId).eq('provider', provider);
  if (error) throw new Error(error.message);
  const list = ((data ?? []) as Source[]).sort(byAge);
  if (list.length < 2) return { moved: 0, deleted: 0, kept: 0 };
  const canonical = list[0].id;
  const dups = list.slice(1).map((s) => s.id);
  let moved = 0;
  for (let i = 0; i < dups.length; i += 100) {
    const { count, error: ue } = await admin.from('knowledge_files').update({ source_id: canonical }, { count: 'exact' })
      .eq('user_id', userId).in('source_id', dups.slice(i, i + 100));
    if (ue) throw new Error(`repoint failed (${userId.slice(0, 8)}/${provider}): ${ue.message} — nothing deleted`);
    moved += count ?? 0;
  }
  let deleted = 0, kept = 0;
  for (const d of dups) {
    const { count, error: ce } = await admin.from('knowledge_files').select('id', { count: 'exact', head: true }).eq('source_id', d);
    if (ce || (count ?? 1) > 0) { kept++; console.warn(`  kept ${d.slice(0, 8)}: ${ce ? ce.message : `${count} file(s) arrived since the repoint`}`); continue; }
    const { error: de } = await admin.from('knowledge_sources').delete().eq('id', d).eq('user_id', userId).eq('provider', provider);
    if (de) { kept++; console.warn(`  delete ${d.slice(0, 8)} failed: ${de.message}`); continue; }
    deleted++;
  }
  return { moved, deleted, kept };
}

async function main() {
  if (APPLY && !USER && !argv.includes('--all')) throw new Error('--apply needs --user <uuid> or an explicit --all');
  console.log(`dedupe singleton knowledge sources — ${APPLY ? 'APPLY' : 'DRY RUN'} · providers ${PROVIDERS.join(', ')}${USER ? ` · user ${USER.slice(0, 8)}` : ' · all users'}`);
  const sources = await pageAll<Source>((a, b) => {
    let q = admin.from('knowledge_sources').select('id, user_id, provider, folder_name, created_at').in('provider', PROVIDERS).order('id').range(a, b);
    if (USER) q = q.eq('user_id', USER);
    return q;
  });
  const groups = new Map<string, Source[]>();
  for (const s of sources) { const k = `${s.user_id}|${s.provider}`; groups.set(k, [...(groups.get(k) ?? []), s]); }
  const dupGroups = [...groups.entries()].filter(([, l]) => l.length > 1);
  console.log(`${sources.length} singleton-provider source(s) across ${groups.size} user×provider pair(s) · ${dupGroups.length} pair(s) with duplicates\n`);

  const rows: string[] = [];
  let totDup = 0, totFiles = 0, totChunks = 0, totEmpty = 0;
  for (const [k, list0] of dupGroups) {
    const [userId, provider] = k.split('|');
    const list = list0.sort(byAge);
    const dups = list.slice(1);
    const files = await filesOn(dups.map((d) => d.id));
    const holding = new Set(files.map((f) => f.source_id));
    const chunks = await chunkCount(files.map((f) => f.id));
    const canonFiles = (await filesOn([list[0].id])).length;
    const empty = dups.filter((d) => !holding.has(d.id)).length;
    totDup += dups.length; totFiles += files.length; totChunks += chunks; totEmpty += empty;
    rows.push(`| ${userId.slice(0, 8)} | ${provider} | ${list.length} | ${list[0].id.slice(0, 8)} (${list[0].created_at.slice(0, 10)}, ${canonFiles} files) | ${dups.length} | ${holding.size} | ${files.length} | ${chunks} | ${empty} |`);
  }
  if (rows.length) {
    console.log('| user | provider | sources | canonical (oldest) | duplicates | dups holding files | files to repoint | chunks (follow their file) | empty dups |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) console.log(r);
  }
  console.log(`\nPLAN: delete ${totDup} duplicate source(s) (${totEmpty} already empty) after repointing ${totFiles} file(s) / ${totChunks} chunk(s) to the oldest source`);

  if (!APPLY) { console.log('\n(dry run — no writes; --apply --user <uuid> | --apply --all, owner-gated)'); return; }
  let moved = 0, deleted = 0, kept = 0;
  for (const [k] of dupGroups) {
    const [userId, provider] = k.split('|');
    const r = await foldOne(userId, provider);
    console.log(`  ${userId.slice(0, 8)}/${provider}: repointed ${r.moved} file(s) · deleted ${r.deleted} source(s)${r.kept ? ` · kept ${r.kept}` : ''}`);
    moved += r.moved; deleted += r.deleted; kept += r.kept;
  }
  console.log(`\nAPPLIED: repointed ${moved} file(s) · deleted ${deleted} duplicate source(s)${kept ? ` · ${kept} left in place (re-run folds them)` : ''}`);
}

main().then(() => process.exit(0), (e) => { console.error(String((e as Error)?.message ?? e)); process.exit(1); });
