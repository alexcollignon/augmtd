// P6d GATE — briefing ref voice: a ref's display handle is a PERSON or the DEAL's registry name,
// never a meeting/channel label. Structural (the exported law) + live (stored briefings' refs).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { displayWho, channelish, composeBriefing } from '../lib/briefing/compose';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = [
  { uid: '08fe4449-e5eb-431d-9156-02e9324e5903', label: 'user A' },
  { uid: 'c723c2f2-e069-4ab8-980e-ac3585028fec', label: 'user B' },
];
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

(async () => {
  // ── STRUCTURAL — the law itself (generic fixtures only). ──
  check('law: a "from <meeting>" label yields to the deal name', displayWho('from Acme x Beta - AI Chat', 'Acme Deal') === 'Acme Deal');
  check('law: an " x " join title yields to the deal name', displayWho('Acme x Beta weekly', 'Acme Deal') === 'Acme Deal');
  check('law: a real person passes through untouched', displayWho('Sam Carter', 'Acme Deal') === 'Sam Carter');
  check('law: null who resolves to the deal name', displayWho(null, 'Acme Deal') === 'Acme Deal');

  // ── END-TO-END — a synthetic compose with a channel-labeled commitment: the composed refs must
  // carry the deal name, never the label. (Generic fixture names only — no real data.) ──
  {
    const b = await composeBriefing(sb, USERS[0].uid, {
      todayStr: new Date().toISOString().slice(0, 10), firstName: 'Sam',
      actions: [
        { itemId: 'fx-1', itemKind: 'commitment', who: 'from Sam x Chloe - AI Chat', ask: 'send the revised pricing', move: null, entityId: 'fx-e1', entityName: 'Acme Rollout', weight: 40, overdue: false, dueDate: null, href: '/item/fx-1?kind=commitment' },
        { itemId: 'fx-2', itemKind: 'inbox_item', who: 'Chloe Martin', ask: 'confirm the workshop date', move: null, entityId: null, entityName: null, weight: 30, overdue: false, dueDate: null, href: '/item/fx-2?kind=email' },
      ],
      watch: [], moving: { count: 0, closest: null }, schedule: [],
      counts: { needYou: 2, cleared: 0, fromTeam: 0, followUps: 0, fyi: 0 }, prior: null,
    });
    const a1 = b?.refs.find((r) => r.id === 'A1');
    check('e2e: composed A-ref swaps a channel label for the deal name', a1?.who === 'Acme Rollout', `A1.who="${a1?.who}"`);
    const anyBad = (b?.refs ?? []).filter((r) => r.who && channelish(r.who));
    check('e2e: no composed ref carries a channel-ish handle', anyBad.length === 0, anyBad.map((r) => r.who).join(' | '));
  }

  // ── STORED — legacy briefings composed pre-v8 may still hold a channel-ish ref; that's fine ONLY
  // because the law would fix each on recompose (the v8 daySig bump forces it on next load). ──
  for (const { uid, label } of USERS) {
    const { data: prof } = await sb.from('profiles').select('home_brief').eq('id', uid).maybeSingle();
    const b = (prof?.home_brief as { briefing?: { refs?: Array<{ id: string; who: string | null }> } } | null)?.briefing;
    if (!b?.refs?.length) { check(`${label} · stored briefing refs clean or self-healing`, true, 'no briefing (vacuous)'); continue; }
    const bad = b.refs.filter((r) => r.who && channelish(r.who));
    const healable = bad.every((r) => displayWho(r.who, 'Any Deal') !== r.who);
    check(`${label} · stored briefing refs clean or self-healing`, bad.length === 0 || healable,
      bad.length ? `${bad.length} legacy channel-ish — recomposes on next load (v8)` : `${b.refs.length} refs ok`);
  }

  console.log('\n════ BRIEFING REF VOICE GATES (P6d) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
