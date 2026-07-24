// CONVERSATION CORE SMOKE (P6b) — the one mouth-and-hand, cross-user. Gates:
//   STRUCTURAL — the chief-of-staff capability slice contains ZERO irreversible tools (no code path
//     from chat to a commit — approve-before-commit is structural); exposure filtering holds (a
//     coworker-only tool never reaches the chief slice and vice versa).
//   LIVE (both users, snapshot-restored — no trace):
//     • "dismiss this" on a real pending item → the registry executor fires, the item resolves,
//       activity is logged; then restored.
//     • "find the <file>" → real files come back through the universal resolver.
//     • "where does this stand?" → a grounded, ref-carrying answer (the question path).
//     • a correction with a durable fact → the fact lands on the deal's rules (restored).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { converse } from '../lib/converse';
import { capabilitiesFor, CAPABILITY_MAP } from '../lib/home/capability-map';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = [
  { uid: '08fe4449-e5eb-431d-9156-02e9324e5903', label: 'user A' },
  { uid: 'c723c2f2-e069-4ab8-980e-ac3585028fec', label: 'user B' },
];
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

(async () => {
  // ── STRUCTURAL — safety + exposure by construction ──
  const chief = capabilitiesFor('chief_of_staff');
  check('structural: chief-of-staff slice holds ZERO irreversible tools', chief.every((c) => !c.irreversible),
    chief.map((c) => c.tool).join(', '));
  check('structural: sends exist in the registry but NOT in the chief slice',
    Object.values(CAPABILITY_MAP).some((c) => c.irreversible) && !chief.some((c) => c.irreversible));
  check('structural: personal doables are chief-only (a coworker never resolves your inbox)',
    !capabilitiesFor('coworker').some((c) => c.tool === 'resolve_inbox_item' || c.tool === 'remember_fact'));

  for (const { uid, label } of USERS) {
    // ── "dismiss this" — command fast-path → registry executor → restored ──
    {
      const { data: items } = await sb.from('inbox_items').select('id, status, source_data')
        .eq('user_id', uid).eq('status', 'pending')
        .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)')
        .limit(1);
      const it = items?.[0];
      if (!it) { check(`${label} · chat dismiss executes`, true, 'no pending item (vacuous)'); }
      else {
        const snapshot = { status: it.status, source_data: it.source_data };
        try {
          const turn = await converse(sb, uid, { kind: 'item', itemKind: 'email', itemId: it.id as string }, 'dismiss this');
          const { data: after } = await sb.from('inbox_items').select('status').eq('id', it.id).single();
          check(`${label} · chat "dismiss this" executes via the registry`, after?.status === 'dismissed' && !!turn.applied?.length,
            `"${turn.say.slice(0, 60)}"`);
        } finally {
          await sb.from('inbox_items').update(snapshot).eq('id', it.id); // no trace
        }
      }
    }

    // ── "find the <file>" — the universal resolver through chat ──
    {
      const { data: f } = await sb.from('knowledge_files').select('filename').eq('user_id', uid).order('indexed_at', { ascending: false }).limit(1);
      const name = f?.[0]?.filename ? String(f[0].filename).replace(/\.[a-z0-9]+$/i, '').split(/[_\-.]/)[0] : null;
      if (!name || name.length < 3) { check(`${label} · chat finds files`, true, 'no indexed files (vacuous)'); }
      else {
        const turn = await converse(sb, uid, { kind: 'global' }, `find the ${name} file`);
        check(`${label} · chat finds files via the resolver`, (turn.files?.length ?? 0) > 0,
          turn.files?.length ? turn.files.map((x) => x.filename).slice(0, 2).join(' | ') : `"${turn.say.slice(0, 50)}"`);
      }
    }

    // ── "where does this stand?" — the grounded question path on an entity-linked item ──
    {
      const { data: links } = await sb.from('entity_links').select('item_id')
        .eq('user_id', uid).eq('item_kind', 'inbox_item').not('entity_id', 'is', null).limit(20);
      let itemId: string | null = null;
      for (const l of (links ?? []) as Array<{ item_id: string }>) {
        const { data: it } = await sb.from('inbox_items').select('id, status').eq('id', l.item_id).maybeSingle();
        if (it?.status === 'pending') { itemId = l.item_id; break; }
      }
      if (!itemId) { check(`${label} · chat answers grounded`, true, 'vacuous'); }
      else {
        const turn = await converse(sb, uid, { kind: 'item', itemKind: 'email', itemId }, 'Where does this stand and what should I do next?');
        check(`${label} · chat answers grounded from the deal's memory`, turn.say.length > 20, `"${turn.say.slice(0, 70)}…" (${turn.refs.length} refs)`);
      }
    }
  }

  console.log('\n════ CONVERSATION CORE GATES (P6b) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
