// READ-ONLY experience audit: for a spread of items per user, print exactly what the ROOM would
// show — the judged verdict (cached only, what the user actually sees), prepared work + language,
// the conversation turns, membership — so the CONTENT can be judged for sense, not mechanics.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildWorkItems } from '../lib/work-items/model';
import { roomKeyForItem, readRoomTurns } from '../lib/room/turns';
import { getPrepared } from '../lib/prepare/read';
import { resolveKind } from '../lib/inbox/rules/write-back';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const A = '08fe4449-e5eb-431d-9156-02e9324e5903';
const B = 'c723c2f2-e069-4ab8-980e-ac3585028fec';
(async () => {
  const { data: uidRows } = await sb.from('work_entities').select('user_id').limit(2000);
  const rene = [...new Set(((uidRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))].find((u) => u.startsWith('ae306f38'))!;
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const [uid, label] of [[A, 'USER A'], [B, 'USER B'], [rene, 'USER C']] as const) {
    console.log(`\n════════════ ${label} ════════════`);
    const items = await buildWorkItems(sb, uid, { todayStr, skipReconcile: true });
    const todos = items.filter((w) => w.state === 'todo' && !w.automated).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const sample = [
      ...todos.filter((w) => w.id.startsWith('inbox:')).slice(0, 4),
      ...todos.filter((w) => w.id.startsWith('commit:')).slice(0, 2),
      ...items.filter((w) => w.state === 'waiting' && w.id.startsWith('commit:')).slice(0, 1),
    ];
    for (const w of sample) {
      const isCommit = w.id.startsWith('commit:');
      const kindKey = isCommit ? 'commitment' : 'inbox';
      console.log(`\n── [${isCommit ? 'COMMIT' : 'EMAIL'}·${w.kind}] "${w.title.slice(0, 70)}"`);
      console.log(`   who: ${w.who ?? '—'} · due: ${w.when.explicit ?? '—'} · bucket: ${w.when.bucket}`);
      if (!isCommit) {
        const { data: it } = await sb.from('inbox_items').select('rule_type, source_data').eq('id', w.entityId).maybeSingle();
        const sd = (it?.source_data ?? {}) as Record<string, unknown>;
        const u = (sd.understanding ?? {}) as Record<string, unknown>;
        console.log(`   from: ${sd.from_address} · mailKind: ${u.mailKind ?? 'NONE'} · rule: ${it?.rule_type ?? '—'} · lang: ${u.language ?? '—'} · ownership: ${u.ownership ?? '—'}`);
        console.log(`   kindResolved: ${resolveKind(sd, (it?.rule_type as string) ?? null) ?? 'none'} · ask: ${(u.ask as string)?.slice(0, 60) ?? '—'}`);
      }
      const { data: j } = await sb.from('item_plans').select('tasks').eq('user_id', uid).eq('kind', 'judgment').eq('entity_id', `${kindKey}:${w.entityId}`).maybeSingle();
      const v = (j?.tasks as { verdict?: { work: string; component: string; executor: { kind: string; name?: string }; reason: string; options?: Array<{ label: string }> } } | null)?.verdict;
      if (v) {
        console.log(`   JUDGED: ${v.work}/${v.component} → ${v.executor.kind}${v.executor.name ? `(${v.executor.name})` : ''}`);
        console.log(`   reason: ${v.reason.slice(0, 110)}`);
        if (v.options?.length) console.log(`   options: ${v.options.map((o) => o.label).join(' | ')}`);
      } else console.log('   JUDGED: (not yet — opens cold, judges on first open)');
      const prep = await getPrepared(sb, uid, { kind: isCommit ? 'commitment' : 'inbox_item', id: w.entityId });
      for (const p of prep.slice(0, 2)) {
        console.log(`   PREPARED[${p.kind}${p.by ? ` by ${p.by}` : ''}]: "${p.content.replace(/\s+/g, ' ').slice(0, 110)}"`);
      }
      const rk = await roomKeyForItem(sb, uid, isCommit ? 'commitment' : 'inbox', w.entityId);
      const isEntity = !rk.includes(':');
      let entName = '';
      if (isEntity) {
        const { data: e } = await sb.from('work_entities').select('name, tracked').eq('id', rk).maybeSingle();
        entName = `${e?.name}${e?.tracked ? ' [TRACKED]' : ' [untracked]'}`;
      }
      console.log(`   ROOM: ${isEntity ? entName : 'own room (loose)'}`);
      const turns = await readRoomTurns(sb, uid, rk, 6);
      for (const t of turns.slice(-4)) {
        console.log(`     ${t.role === 'user' ? 'YOU' : (t.author?.name ?? 'CoS')}: ${t.text.replace(/\s+/g, ' ').slice(0, 100)}${t.refs?.length ? ` [→ ${t.refs[0].label.slice(0, 40)}]` : ''}`);
      }
    }
  }
  process.exit(0);
})();
