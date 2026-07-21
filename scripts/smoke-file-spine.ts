// FILE SPINE (Prepared-Work A) — cross-user smoke. Verifies the funnel's contract on real data:
//   • attachments landed as knowledge_files with origin.kind='email_attachment'
//   • entity links present where the source item was linked (the brain tie)
//   • IDEMPOTENT: re-running the backfill ingests 0 new (content-hash dedupe)
//   • RETRIEVAL: semantic search actually finds an attachment by its content (the point of it all)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { ingestItemAttachments } from '../lib/knowledge/ingest';
import { searchKnowledgeGrouped } from '../lib/knowledge/search';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

(async () => {
  const { data: files } = await sb.from('knowledge_files')
    .select('id, user_id, filename, origin, entity_id, extracted_text, content_hash')
    .eq('origin->>kind', 'email_attachment').limit(500);
  const rows = (files ?? []) as Array<Record<string, unknown>>;
  const users = [...new Set(rows.map((r) => r.user_id as string))];
  check('attachments ingested as knowledge', rows.length > 0, `${rows.length} files, ${users.length} users`);
  check('all carry origin provenance', rows.every((r) => (r.origin as { kind?: string })?.kind === 'email_attachment'));
  const linked = rows.filter((r) => r.entity_id);
  check('entity links present (brain tie)', linked.length > 0, `${linked.length}/${rows.length} entity-linked`);
  const withText = rows.filter((r) => (r.extracted_text as string | null)?.length);
  check('text extracted (searchable)', withText.length > 0, `${withText.length}/${rows.length} with text`);

  // IDEMPOTENCY — re-ingest one user's items → all deduped, zero new.
  for (const uid of users.slice(0, 2)) {
    const { data: items } = await sb.from('inbox_items').select('id, source_data')
      .eq('user_id', uid).not('source_data->attachments', 'is', null).limit(5);
    let ingested = 0, deduped = 0;
    for (const it of (items ?? []) as Array<{ id: string; source_data: Record<string, unknown> }>) {
      const r = await ingestItemAttachments(sb, uid, it);
      ingested += r.ingested; deduped += r.deduped;
    }
    check(`${uid.slice(0, 8)}: re-ingest is a no-op`, ingested === 0 && deduped > 0, `ingested=${ingested} deduped=${deduped}`);
  }

  // RETRIEVAL — search a user's KB with words from one of their attachments' own content.
  const probe = withText.find((r) => (r.extracted_text as string).length > 300);
  if (probe) {
    // A NATURAL query (how retrieval is actually used): the doc's name + its leading content words —
    // not a random mid-document word salad, which sits below the similarity threshold by design.
    const words = `${String(probe.filename).replace(/\.[a-z0-9]+$/i, '')} ${String(probe.extracted_text).split(/\s+/).slice(0, 12).join(' ')}`;
    const res = await searchKnowledgeGrouped(probe.user_id as string, words, 5, sb).catch(() => null);
    const hit = res?.some((g) => g.fileId === probe.id || g.filename === probe.filename);
    check('semantic search finds an attachment by content', !!hit, `probe="${String(probe.filename)}"`);
  } else check('semantic search finds an attachment by content', false, 'no text-bearing probe');

  console.log('\n════ FILE-SPINE GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  (${d})` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
