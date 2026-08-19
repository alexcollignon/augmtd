// ─── THE EMBEDDINGS PRIVACY GATE (Aug 19) ─────────────────────────────────────────────────────────
// THE LAW: on every tier AUGMTD operates itself, embeddings run INSIDE the Bedrock EU perimeter —
// no document, chunk, entity summary, or item body leaves to a third-party embedding host (Together
// AI was the last one). Client-endpoint tiers (private_client / on_prem / professional-Azure) embed
// where the client's own endpoint says.
//
// Three floors:
//   E1 SOURCE — the routing table and the call sites say what the law says (zero AI).
//   E2 LIVE   — the factory resolves embeddings to Bedrock for a real user AND the system client;
//               a real embed returns 1024-d vectors; query/document asymmetry is honoured.
//   E3 SPACE  — stored vectors ARE in the Cohere space: sampled rows re-embedded from their own source
//               text land on (near-)identical vectors. Vectors from a different model read as noise —
//               this is the floor that proves `scripts/reembed-bedrock.ts` ran (it FAILS until it has).
//
// Run: npx tsx --env-file=.env.local scripts/smoke-embeddings-privacy.ts            (whole DB)
//      npx tsx --env-file=.env.local scripts/smoke-embeddings-privacy.ts --probe    (E3 scoped to
//      the probe account — proves the sweep mechanics before the global run at release)

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { TIER_DEFAULTS } from '../lib/ai/defaults';
import { getAIClient, getSystemClient } from '../lib/ai/factory';
import { BEDROCK_EMBEDDING_MODEL, BEDROCK_EMBEDDING_DIMENSIONS } from '../lib/ai/bedrock-embeddings';
import { embedText } from '../lib/knowledge/indexer';
import { entityEmbedText } from '../lib/entities/recognize';
import { resolveProbeUser } from './probe-user';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const cos = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
};
const src = (p: string) => readFileSync(p, 'utf8');

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log('\nE1 — SOURCE FLOOR (the table and the call sites speak the law):');
  {
    const OURS = ['standard', 'private_shared', 'bedrock_private', 'bedrock_optimised'] as const;
    for (const tier of OURS) {
      const e = TIER_DEFAULTS[tier].embeddings;
      ok(`${tier}.embeddings → bedrock/${BEDROCK_EMBEDDING_MODEL} @${BEDROCK_EMBEDDING_DIMENSIONS}`,
        e.provider === 'bedrock' && e.model === BEDROCK_EMBEDDING_MODEL && e.dimensions === BEDROCK_EMBEDDING_DIMENSIONS,
        `${e.provider}/${e.model}/${e.dimensions}`);
    }
    const all = Object.entries(TIER_DEFAULTS);
    const leaks = all.filter(([, t]) => /together|e5-large/i.test(`${t.embeddings.provider} ${t.embeddings.model} ${t.embeddings.baseURL ?? ''}`)).map(([k]) => k);
    ok('NO tier routes embeddings to Together AI (or the retired e5 model)', leaks.length === 0, leaks.join(', '));
    const defaults = src('lib/ai/defaults.ts');
    ok('defaults.ts carries no Together baseURL on any embeddings line',
      !defaults.split('\n').some((l) => /embeddings:/.test(l) && /together\.xyz/.test(l))
      && !/embeddings:[^\n]*\n[^\n]*together\.xyz/.test(defaults));

    const adapter = src('lib/ai/bedrock-adapter.ts');
    ok('the Bedrock adapter mounts embeddings (provider=bedrock serves embeddings.create)',
      /embeddings:\s*createBedrockEmbeddings\(config\)/.test(adapter));

    const indexer = src('lib/knowledge/indexer.ts');
    ok('embedText passes input_type ONLY on bedrock endpoints (an OpenAI-compatible host would 400)',
      /endpoint\.provider === 'bedrock' \? \{ input_type:/.test(indexer));
    // The query sites — a probe against the index is a QUERY; a stored vector is a DOCUMENT.
    ok('searchKnowledge embeds its query as a QUERY', /const queryEmbedding = await embedText\(query, userId, adminClient, \{ purpose: 'query' \}\)/.test(indexer));
    ok('knowledge/search.ts embeds its query as a QUERY', /embedText\(query, userId, adminClient, \{ purpose: 'query' \}\)/.test(src('lib/knowledge/search.ts')));
    ok('recognition embeds the ITEM as a QUERY against the entity index', /embedText\(itemEmbedText\(item\), userId, supabase, \{ purpose: 'query' \}\)/.test(src('lib/entities/recognize.ts')));
    // Document writers never tag themselves as queries.
    for (const f of ['lib/entities/reflect.ts', 'lib/entities/reconcile-registry.ts', 'lib/knowledge/ingest.ts']) {
      ok(`${f} writes DOCUMENT vectors (no query purpose)`, !/purpose: 'query'/.test(src(f)));
    }
    ok('pricing knows the model (cost log never silently drifts)', new RegExp(`'${BEDROCK_EMBEDDING_MODEL.replace('.', '\\.')}'`).test(src('lib/ai/pricing.ts')));
    ok('the AWS runtime SDK is a DIRECT dependency', /"@aws-sdk\/client-bedrock-runtime"/.test(src('package.json')));
  }

  console.log('\nE2 — LIVE ROUTING (a real user and the system client resolve INSIDE the perimeter):');
  const probeId = await resolveProbeUser(admin);
  {
    const r = await getAIClient(probeId, 'embeddings', admin);
    ok(`probe user embeddings → bedrock/${BEDROCK_EMBEDDING_MODEL}`, r.endpoint.provider === 'bedrock' && r.model === BEDROCK_EMBEDDING_MODEL, `${r.endpoint.provider}/${r.model}`);
    const s = await getSystemClient('embeddings');
    ok('system client embeddings → bedrock', s.endpoint.provider === 'bedrock' && s.model === BEDROCK_EMBEDDING_MODEL, `${s.endpoint.provider}/${s.model}`);
    const q = await embedText('quarterly sales report for the client review', probeId, admin, { purpose: 'query' });
    const pt = await embedText('Relatório trimestral de vendas preparado para a reunião de revisão com o cliente.', probeId, admin);
    const x = await embedText('Docker container restart loop after a kernel upgrade on the staging host.', probeId, admin);
    ok(`a live embed returns ${BEDROCK_EMBEDDING_DIMENSIONS} dims`, q.length === BEDROCK_EMBEDDING_DIMENSIONS && pt.length === BEDROCK_EMBEDDING_DIMENSIONS, String(q.length));
    ok('cross-lingual retrieval works (EN query ~ PT document ≫ unrelated)', cos(q, pt) > 0.4 && cos(q, pt) - cos(q, x) > 0.25, `pt=${cos(q, pt).toFixed(3)} x=${cos(q, x).toFixed(3)}`);
    // Batch path (the indexer's embedTexts) — 100 inputs crosses Cohere's 96-per-call boundary.
    const { client, model } = await getAIClient(probeId, 'embeddings', admin);
    const many = Array.from({ length: 100 }, (_, i) => `document number ${i} about topic ${i % 7}`);
    const r2 = await (client.embeddings.create as (p: unknown) => Promise<{ data: Array<{ index: number; embedding: number[] }> }>)({ model, input: many, input_type: 'search_document' });
    const ordered = r2.data.every((d, i) => d.index === i && d.embedding.length === BEDROCK_EMBEDDING_DIMENSIONS);
    ok('a 100-text batch returns 100 ordered vectors (multi-call fan-out preserves order)', r2.data.length === 100 && ordered);
    // Same text ≠ same vector across purposes (asymmetry honoured), but still close.
    const asDoc = await embedText('quarterly sales report for the client review', probeId, admin);
    ok('query vs document embeddings of the same text differ but stay close (asymmetry is real)', cos(q, asDoc) > 0.8 && cos(q, asDoc) < 0.9999, cos(q, asDoc).toFixed(4));
  }

  const scopeProbe = process.argv.includes('--probe');
  console.log(`\nE3 — THE SPACE IS UNIFORM (stored vectors re-embed onto themselves)${scopeProbe ? ' [probe account]' : ''}:`);
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scoped = (q: any) => (scopeProbe ? q.eq('user_id', probeId) : q);
    const stride = scopeProbe ? 1 : 8;
    const { data: files } = await scoped(admin.from('knowledge_files').select('id, user_id, filename, extracted_text, embedding')
      .not('embedding', 'is', null).not('extracted_text', 'is', null)).order('indexed_at', { ascending: false }).limit(40);
    const sampleF = ((files ?? []) as Array<Record<string, unknown>>).filter((f) => (f.extracted_text as string).trim().length > 50).filter((_, i) => i % stride === 0).slice(0, 5);
    let fileOk = 0; const fileDetail: string[] = [];
    for (const f of sampleF) {
      const stored = typeof f.embedding === 'string' ? (JSON.parse(f.embedding as string) as number[]) : (f.embedding as number[]);
      const fresh = await embedText((f.extracted_text as string).replace(/\u0000/g, '').trim(), f.user_id as string, admin);
      const c = cos(stored, fresh);
      fileDetail.push(`${(f.filename as string).slice(0, 24)}=${c.toFixed(3)}`);
      if (c > 0.95) fileOk++;
    }
    ok(`knowledge_files: ${fileOk}/${sampleF.length} sampled vectors re-embed onto themselves (cos>0.95)`, sampleF.length > 0 && fileOk === sampleF.length, fileDetail.join(' '));

    const { data: ents } = await scoped(admin.from('work_entities').select('id, user_id, name, summary, people, embedding')
      .not('embedding', 'is', null)).order('updated_at', { ascending: false }).limit(40);
    const sampleE = ((ents ?? []) as Array<Record<string, unknown>>).filter((_, i) => i % stride === 0).slice(0, 5);
    let entOk = 0; const entDetail: string[] = [];
    for (const e of sampleE) {
      const stored = e.embedding as number[];
      const people = Array.isArray(e.people) ? (e.people as string[]) : [];
      const fresh = await embedText(entityEmbedText(e.name as string, e.summary as string | null, people), e.user_id as string, admin);
      const c = cos(stored, fresh);
      entDetail.push(`${(e.name as string).slice(0, 18)}=${c.toFixed(3)}`);
      if (c > 0.8) entOk++; // reflect.ts appends "aka:" aliases → near, not identical
    }
    ok(`work_entities: ${entOk}/${sampleE.length} sampled vectors sit in the live space (cos>0.8)`, sampleE.length > 0 && entOk === sampleE.length, entDetail.join(' '));

    const { data: chunks } = await scoped(admin.from('knowledge_chunks').select('id, user_id, content, embedding, file_id')
      .not('embedding', 'is', null)).order('created_at', { ascending: false }).limit(60);
    const sampleC = ((chunks ?? []) as Array<Record<string, unknown>>).filter((_, i) => i % (scopeProbe ? 1 : 12) === 0).slice(0, 5);
    let chunkOk = 0; const chunkDetail: string[] = [];
    for (const c of sampleC) {
      const stored = typeof c.embedding === 'string' ? (JSON.parse(c.embedding as string) as number[]) : (c.embedding as number[]);
      // A chunk's vector is its content OR its one-sentence summary — either way the chunk's own
      // content should land clearly related (>0.35) in the SAME space; a foreign-model vector reads ~0.
      const fresh = await embedText((c.content as string).slice(0, 2000), c.user_id as string, admin, { purpose: 'query' });
      const s = cos(stored, fresh);
      chunkDetail.push(s.toFixed(3));
      if (s > 0.35) chunkOk++;
    }
    ok(`knowledge_chunks: ${chunkOk}/${sampleC.length} sampled vectors relate to their own content (cos>0.35)`, sampleC.length > 0 && chunkOk === sampleC.length, chunkDetail.join(' '));
  }

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
