// ════════════════════════════════════════════════════════════════════════════════════════════════
// KB RETRIEVAL QUALITY (labelled, zero-judge). A ~20-document corpus (scripts/lib/eval/retrieval-
// corpus.ts — EN/FR/DE/PT/ES, near-duplicates, an old + a new version, acronym-named files) is indexed
// on a PROBE account through the REAL ingestion door, then ~40 labelled queries run through the two
// readers every consumer uses:
//   kb     searchKnowledgeGrouped (lib/knowledge/search.ts — coworker KB tools, rooms, /drive search)
//   res    resolveFileUniversal   (lib/knowledge/resolve.ts — requirements, the preparation pass)
// Metrics (scripts/lib/eval/quality-metrics.ts): recall@1, recall@3, MRR, wrong-version rate, per
// query kind. Embeddings are the tenant's own (Bedrock Cohere multilingual, 1024-d), run ONE at a time;
// the run stops on a daily-quota error.
//
//   npx tsx scripts/eval-retrieval.ts --seed            # index the corpus on std probe #2 (≈ €0.05)
//   npx tsx scripts/eval-retrieval.ts                   # run the 55 labelled queries (41 tuned + 14 holdout) (embeddings only)
//   npx tsx scripts/eval-retrieval.ts --teardown        # remove every row the seed wrote
//   flags: --tier std|eu (default std) · --probe k (pool account #k, default 2) ·
//          --path upload|ingest (seed door: indexUploadedFile [default] or ingestFile) ·
//          --reader kb|res (one reader only) · --show (top-3 for every query, not only misses)
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never);
import type { SupabaseClient } from '@supabase/supabase-js';
import { indexUploadedFile } from '@/lib/knowledge/indexer';
import { ingestFile } from '@/lib/knowledge/ingest';
import { searchKnowledgeGrouped } from '@/lib/knowledge/search';
import { resolveFileUniversal } from '@/lib/knowledge/resolve';
import { CORPUS, QUERIES, type CorpusDoc } from './lib/eval/retrieval-corpus';
import { makeTextPdf, layoutTextPdf, makeDocx } from './lib/eval/fixture-files';
import { scoreRetrieval, pct, type RetrievalCase } from './lib/eval/quality-metrics';
import { adminClient } from './lib/eval/engine/live';
import { resolveProbePool } from './lib/eval/engine/probes';
import { isDailyQuota } from './lib/eval-surfaces/failures';

const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] ?? null : null; };
const TAG = 'eval-retrieval';

const MIME: Record<CorpusDoc['format'], string> = {
  txt: 'text/plain', md: 'text/markdown', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function wrap(line: string, width = 95): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of line.split(/\s+/)) {
    if (cur && cur.length + w.length + 1 > width) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

async function buildFile(d: CorpusDoc): Promise<Buffer> {
  if (d.format === 'pdf') return makeTextPdf(layoutTextPdf(d.text.split(/\n+/).map((l) => ({ lines: wrap(l) }))));
  if (d.format === 'docx') return makeDocx([{ paras: d.text.split(/\n+/) }]);
  return Buffer.from(d.text, 'utf8');
}

async function seededRows(admin: SupabaseClient, userId: string): Promise<Array<{ id: string; filename: string; provider_file_id: string }>> {
  const { data, error } = await admin.from('knowledge_files').select('id, filename, provider_file_id')
    .eq('user_id', userId).like('provider_file_id', `%${TAG}/%`);
  if (error) throw new Error(`knowledge_files read: ${error.message}`);
  return (data ?? []) as Array<{ id: string; filename: string; provider_file_id: string }>;
}

const keyOf = (providerFileId: string) => new RegExp(`${TAG}/([a-z0-9_]+)`).exec(providerFileId)?.[1] ?? null;

async function seed(admin: SupabaseClient, userId: string, door: 'upload' | 'ingest') {
  const have = new Set((await seededRows(admin, userId)).map((r) => keyOf(r.provider_file_id)));
  for (const d of CORPUS) {
    if (have.has(d.key)) { console.log(`  = ${d.key} already seeded`); continue; }
    const buffer = await buildFile(d);
    const ref = `${TAG}/${d.key}/${d.filename}`;
    let fileId: string | null = null;
    try {
      if (door === 'upload') {
        fileId = await indexUploadedFile({ buffer, filename: d.filename, mimeType: MIME[d.format], userId, storagePathInBucket: ref }, admin);
      } else {
        fileId = (await ingestFile(admin, { userId, filename: d.filename, mimeType: MIME[d.format], sizeBytes: buffer.length, origin: { kind: 'upload', ref }, buffer })).fileId;
      }
    } catch (e) {
      const m = (e as Error).message;
      if (isDailyQuota(m)) { console.error(`✗ daily quota hit while seeding ${d.key} — stopping: ${m}`); process.exit(3); }
      throw e;
    }
    if (!fileId) throw new Error(`seed ${d.key}: no file id`);
    const at = new Date(Date.now() - d.ageDays * 86400_000).toISOString();
    const { error } = await admin.from('knowledge_files').update({ last_modified_at: at }).eq('id', fileId);
    if (error) throw new Error(`date stamp ${d.key}: ${error.message}`);
    const { count } = await admin.from('knowledge_chunks').select('id', { count: 'exact', head: true }).eq('file_id', fileId);
    console.log(`  + ${d.key.padEnd(14)} ${d.filename}  (${count ?? 0} chunk(s))`);
  }
}

async function teardown(admin: SupabaseClient, userId: string) {
  const rows = await seededRows(admin, userId);
  const ids = rows.map((r) => r.id);
  if (!ids.length) { console.log('nothing to remove'); return; }
  const c = await admin.from('knowledge_chunks').delete().in('file_id', ids);
  if (c.error) throw new Error(`chunks delete: ${c.error.message}`);
  const f = await admin.from('knowledge_files').delete().in('id', ids).eq('user_id', userId);
  if (f.error) throw new Error(`files delete: ${f.error.message}`);
  // The upload source the seed may have minted — removed only when nothing else uses it.
  const { data: srcs } = await admin.from('knowledge_sources').select('id').eq('user_id', userId).eq('provider', 'upload');
  for (const s of srcs ?? []) {
    const { count } = await admin.from('knowledge_files').select('id', { count: 'exact', head: true }).eq('source_id', s.id);
    if (!count) await admin.from('knowledge_sources').delete().eq('id', s.id);
  }
  console.log(`removed ${ids.length} file(s) and their chunks`);
}

async function run(admin: SupabaseClient, userId: string) {
  const rows = await seededRows(admin, userId);
  const keyById = new Map(rows.map((r) => [r.id, keyOf(r.provider_file_id) ?? '?']));
  if (rows.length < CORPUS.length) console.warn(`! only ${rows.length}/${CORPUS.length} corpus files seeded`);
  const show = argv.includes('--show');
  const ALL_READERS = ['kb', 'res'] as const;
  const only = opt('reader');
  const readers = ALL_READERS.filter((r) => !only || r === only);
  const cases: Record<(typeof ALL_READERS)[number], Array<RetrievalCase & { kind: string; q: string; holdout?: boolean }>> = { kb: [], res: [] };
  const t0 = Date.now();
  for (const q of QUERIES) {
    for (const reader of readers) {
      let ranked: string[] = [];
      try {
        if (reader === 'kb') ranked = (await searchKnowledgeGrouped(userId, q.q, 5, admin)).map((g) => keyById.get(g.fileId) ?? `other:${g.filename}`);
        else ranked = (await resolveFileUniversal(admin, { userId }, q.q, 5)).filter((c) => c.source === 'kb').map((c) => keyById.get(c.id) ?? `other:${c.filename}`);
      } catch (e) {
        const m = (e as Error).message;
        if (isDailyQuota(m)) { console.error(`✗ daily quota hit — stopping: ${m}`); process.exit(3); }
        throw e;
      }
      cases[reader].push({ ranked, relevant: q.relevant, wrongVersion: q.wrongVersion, kind: q.kind, q: q.q, holdout: q.holdout });
    }
  }
  const ms = Date.now() - t0;
  for (const reader of readers) {
    const all = scoreRetrieval(cases[reader]);
    console.log(`\n### reader: ${reader === 'kb' ? 'searchKnowledgeGrouped' : 'resolveFileUniversal'} — ${all.n} queries`);
    console.log('| kind | n | recall@1 | recall@3 | MRR | wrong-version |');
    console.log('|---|---|---|---|---|---|');
    const kinds = [...new Set(cases[reader].map((c) => c.kind))];
    for (const k of kinds) {
      const s = scoreRetrieval(cases[reader].filter((c) => c.kind === k));
      console.log(`| ${k} | ${s.n} | ${pct(s.recall1)} | ${pct(s.recall3)} | ${s.mrr.toFixed(3)} | ${s.versionCases ? pct(s.wrongVersionRate) : '—'} |`);
    }
    for (const [label, sub] of [['tuned set', cases[reader].filter((c) => !c.holdout)], ['holdout', cases[reader].filter((c) => c.holdout)]] as const) {
      const t = scoreRetrieval(sub);
      if (t.n) console.log(`| _${label}_ | ${t.n} | ${pct(t.recall1)} | ${pct(t.recall3)} | ${t.mrr.toFixed(3)} | ${t.versionCases ? pct(t.wrongVersionRate) : '—'} |`);
    }
    console.log(`| **all** | ${all.n} | **${pct(all.recall1)}** | **${pct(all.recall3)}** | **${all.mrr.toFixed(3)}** | ${pct(all.wrongVersionRate)} |`);
    const misses = cases[reader].filter((c) => show || !c.relevant.includes(c.ranked[0] ?? ''));
    if (misses.length) {
      console.log(show ? '\nall queries (top 3):' : '\nmisses at #1 (top 3):');
      for (const c of misses) console.log(`  - [${c.kind}] "${c.q}" → want ${c.relevant.join('|')} · got ${c.ranked.slice(0, 3).join(', ') || '(nothing)'}`);
    }
  }
  console.log(`\n${QUERIES.length * readers.length} searches in ${(ms / 1000).toFixed(1)}s (${Math.round(ms / (QUERIES.length * readers.length))} ms/search)`);
}

async function main() {
  const tier = (opt('tier') ?? 'std') === 'eu' ? 'eu' : 'standard';
  const k = Number(opt('probe') ?? '2');
  if (k < 2) throw new Error('pool account #1 is the tier reference — use --probe 2+');
  const admin = adminClient();
  const pool = await resolveProbePool(admin, { spec: { [tier]: [k] }, create: false });
  if (!pool.accounts.length) throw new Error(`probe ${tier}#${k} missing: ${[...pool.problems, ...pool.missing].join('; ')}`);
  const { userId, label, email } = pool.accounts[0];
  console.log(`probe ${label} (${email})`);
  if (argv.includes('--teardown')) return teardown(admin, userId);
  if (argv.includes('--seed')) { await seed(admin, userId, opt('path') === 'ingest' ? 'ingest' : 'upload'); if (!argv.includes('--run')) return; }
  await run(admin, userId);
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
