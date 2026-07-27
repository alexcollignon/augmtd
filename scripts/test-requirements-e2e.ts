// E2E outcome probe for the deliverable resolution — run against a real multi-deliverable ask item.
// Usage: npx tsx scripts/test-requirements-e2e.ts <inbox_item_id>
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { judgeWork } from '../lib/work/judge';
import { prepareOneItem } from '../lib/prepare/pass';
import { roomKeyForItem } from '../lib/room/turns';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const id = process.argv[2];

(async () => {
  const { data: it } = await sb.from('inbox_items').select('id, user_id, work_title, source_data').eq('id', id).maybeSingle();
  if (!it) { console.error('item not found'); process.exit(1); }
  const uid = it.user_id as string;
  // Make the draft stale so the pass re-drafts under the new truth.
  const sd = (it.source_data ?? {}) as Record<string, unknown>;
  const dr = sd.draft as Record<string, unknown> | undefined;
  if (dr?.generated_at) await sb.from('inbox_items').update({ source_data: { ...sd, draft: { ...dr, generated_at: undefined } } }).eq('id', id);

  const v = await judgeWork(sb, uid, { kind: 'inbox', id });
  console.log('VERDICT:', v.work, '| requires:', JSON.stringify(v.requires ?? []));

  const r = await prepareOneItem(sb, uid, {
    id: `inbox:${id}`, entityId: id, kind: 'reply', title: String(it.work_title), who: null, actor: 'you', state: 'todo',
    when: { explicit: null, bucket: 'today' }, source: 'email', href: `/item/${id}`,
    at: new Date().toISOString(), startAt: new Date().toISOString().slice(0, 10),
    projectId: null, automated: false, initiative: null, effort: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  console.log('PREPARE:', JSON.stringify(r));

  const roomKey = await roomKeyForItem(sb, uid, 'inbox', id);
  const { data: turns } = await sb.from('room_turns').select('text, component, dedupe_key').eq('user_id', uid).eq('room_key', roomKey).order('created_at');
  for (const t of turns ?? []) console.log('TURN', t.dedupe_key, '|', (t.component as { key?: string } | null)?.key ?? '-', '|', String(t.text).slice(0, 140).replace(/\n/g, ' '));

  const { data: after } = await sb.from('inbox_items').select('source_data').eq('id', id).maybeSingle();
  const asd = (after?.source_data ?? {}) as Record<string, unknown>;
  const adr = asd.draft as { body?: string; attachment?: unknown } | undefined;
  console.log('DRAFT attachment:', JSON.stringify(adr?.attachment ?? null));
  console.log('DRAFT body:\n', String(adr?.body ?? '').slice(0, 900));
  const { data: pool } = await sb.from('item_deliverables').select('task_id, type, title, metadata').eq('entity_id', id);
  console.log('POOL:', JSON.stringify((pool ?? []).map((p) => `${p.task_id}:${p.type}:${p.title}`)));
})();
