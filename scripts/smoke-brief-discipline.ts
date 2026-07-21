// THE REASONED BRIEFING — discipline smoke (REAL AI, cross-user). The regression gate for the failure
// where the brief RESTATED raw registry names, narrated its own grouping ("both are the same X"), and
// fabricated urgency for automated mail. Composes a live brief per user over real actions + commitments and
// asserts the discipline the design demands:
//   • GROUNDED     — every {ref} the model wrote exists (law 5).
//   • NO AUTHORED IDENTITY — after stripping {refs}, NO registry identity token (entity-name / person word)
//                    appears in the prose: the model must express every name through a ref, never type one.
//   • NO GROUPING NARRATION — never "the same X", "all one Y", "both are/belong", "are the same".
//   • NO FABRICATED ESCALATION — never invents that someone will "escalate/chase/hound".
//   • VOICE        — zero exclamation marks.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { composeBriefing, type BriefingInputs } from '../lib/briefing/compose';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

// Generic business words that legitimately appear in prose — NOT treated as authored identities. (A test
// stoplist, not product logic — it only decides what the GATE ignores.)
const STOP = new Set(['account','project','program','engagement','integration','collaboration','meeting','review','research','service','platform','system','partnership','assessment','training','payment','subscription','management','setup','support','processing','operations','hire','role','team','contract','billing','security','compliance','pilot','proposal','refund','the','and','with','your','their','client','presentation','bootcamp','session','online','design','readiness','academy','admissions','lunch','learn','video','status','launch','cohort','cohorts','capstone','document','documents','data','sale','response','notice','notices','deadline','verification','sponsorship','requirements','tier','event','reports','report','framework','maturity','check','solution','detection','enrollment','vehicle','acquisition','sales','financial','property','condo','listing','repair','warranty','homebanking','banking','records','update','settings','access','configuration','domain','sync','call','apartment','strategy','journey','rollout','method','options','clearance','input','from','notion','docusign','via','page']);

async function usersWithMemory(): Promise<string[]> {
  const { data } = await sb.from('work_entities').select('user_id').eq('kind', 'initiative').limit(5000);
  return [...new Set((data ?? []).map((e: any) => e.user_id as string))];
}

async function buildInputs(uid: string): Promise<{ inp: BriefingInputs; identityTokens: Set<string> }> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: items } = await sb.from('inbox_items').select('id, work_title, rule_type, status, source_data').eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(150);
  const live = ((items ?? []) as any[]).filter((it) => it.status !== 'completed' && it.status !== 'dismissed' && (it.rule_type === 'needs_reply' || ['reply', 'action'].includes(it.source_data?.understanding?.relevance)));
  const { data: commitsRaw } = await sb.from('commitments').select('id, description, counterparty, direction, due_date, overdue, status').eq('user_id', uid).in('status', ['open', 'pending']).limit(20);
  const commits = (commitsRaw ?? []) as any[];
  const atomIds = [...live.map((l: any) => l.id), ...commits.map((c: any) => c.id)];
  const { data: links } = await sb.from('entity_links').select('item_id, entity_id').eq('user_id', uid).in('item_kind', ['inbox_item', 'commitment']).in('item_id', atomIds).not('entity_id', 'is', null);
  const { data: ents } = await sb.from('work_entities').select('id, name, status, state, next_move, priority, last_event_at').eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null);
  const entById = new Map((ents ?? []).map((e: any) => [e.id, e]));
  const linkByAtom = new Map((links ?? []).map((l: any) => [l.item_id, l.entity_id]));
  const deckEnts = new Set((links ?? []).map((l: any) => l.entity_id));

  const actions = [
    ...live.slice(0, 10).map((it: any) => {
      const eid = linkByAtom.get(it.id); const e = entById.get(eid);
      return { itemId: it.id, itemKind: 'inbox_item' as const, who: it.source_data?.from_name ?? null, ask: String(it.work_title || ''), move: e?.next_move?.title ?? null, entityId: eid ?? null, entityName: e?.name ?? null, weight: e?.priority?.weight ?? 20, overdue: false, dueDate: it.source_data?.understanding?.deadline ?? null, href: `/item/${it.id}?kind=email` };
    }),
    ...commits.slice(0, 8).map((c: any) => {
      const eid = linkByAtom.get(c.id); const e = entById.get(eid);
      return { itemId: c.id, itemKind: 'commitment' as const, who: c.counterparty ?? null, ask: String(c.description || ''), move: e?.next_move?.title ?? null, entityId: eid ?? null, entityName: e?.name ?? null, weight: e?.priority?.weight ?? 18, overdue: !!c.overdue, dueDate: c.due_date ?? null, href: `/item/${c.id}?kind=commitment` };
    }),
  ];
  const slipping = ((ents ?? []) as any[]).filter((e) => { const st = e.state ?? {}; return (st.momentum === 'gone_quiet' || st.momentum === 'stalled') && (st.whoOwes?.you?.length ?? 0) > 0 && st.category !== 'admin' && !deckEnts.has(e.id); })
    .sort((a, b) => (b.priority?.weight ?? 0) - (a.priority?.weight ?? 0)).slice(0, 3)
    .map((e) => ({ entityId: e.id, name: e.name, summary: e.state.summary, move: e.next_move?.title ?? null, quietDays: e.last_event_at ? Math.floor((Date.now() - new Date(e.last_event_at).getTime()) / 86400000) : null, weight: e.priority?.weight ?? 20 }));
  const moving = ((ents ?? []) as any[]).filter((e) => !deckEnts.has(e.id) && ['active', 'waiting'].includes(e.state?.momentum) && e.state?.summary && e.state?.category !== 'admin');
  const best = [...moving].sort((a, b) => (b.priority?.weight ?? 0) - (a.priority?.weight ?? 0))[0];
  const { data: sched } = await sb.from('calendar_events').select('title, start_time, is_all_day').eq('user_id', uid).eq('status', 'confirmed').gte('start_time', todayStr).order('start_time', { ascending: true }).limit(8);
  // The user's home timezone = the mode of their events' zones (matches the brief route).
  const { data: tzRows } = await sb.from('calendar_events').select('timezone').eq('user_id', uid).not('timezone', 'is', null).limit(300);
  const tzFreq = new Map<string, number>();
  for (const r of (tzRows ?? []) as any[]) { if (r.timezone) tzFreq.set(r.timezone, (tzFreq.get(r.timezone) ?? 0) + 1); }
  const userTz = [...tzFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UTC';
  const localHHMM = (iso: string, allDay: boolean): string => {
    if (allDay) return 'all day';
    try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTz }).format(new Date(iso)); } catch { return String(iso).slice(11, 16); }
  };
  const { data: prof } = await sb.from('profiles').select('full_name').eq('id', uid).maybeSingle();

  // The IDENTITY TOKENS the model must never author outside a ref: distinctive words from active entity
  // names + people first names (from action/commitment `who`). Length ≥4, not a generic business word.
  const identityTokens = new Set<string>();
  const addTokens = (s: string | null | undefined) => { for (const w of String(s || '').split(/[^A-Za-zÀ-ÿ0-9.]+/)) { const t = w.toLowerCase().replace(/[^a-zà-ÿ0-9]/g, ''); if (t.length >= 4 && !STOP.has(t)) identityTokens.add(t); } };
  for (const e of (ents ?? []) as any[]) addTokens(e.name);
  for (const a of actions) addTokens(a.who);
  // The brief is INSTRUCTED to reproduce today's NEXT meeting time+title verbatim (day-shape awareness) —
  // those calendar-title words are not an authored-identity leak, so remove them from the gate.
  for (const s of (sched ?? []) as any[]) for (const w of String(s.title || '').split(/[^A-Za-zÀ-ÿ0-9.]+/)) identityTokens.delete(w.toLowerCase().replace(/[^a-zà-ÿ0-9]/g, ''));

  return {
    inp: {
      todayStr, firstName: String(prof?.full_name || 'there').split(' ')[0],
      actions, watch: slipping,
      moving: { count: moving.length, closest: best ? { entityId: best.id, name: best.name, summary: best.state.summary } : null },
      schedule: (sched ?? []).map((s: any) => ({ time: localHHMM(s.start_time, !!s.is_all_day), title: String(s.title || '(untitled)') })),
      counts: { needYou: actions.length, cleared: 0, fromTeam: 0, followUps: 0, fyi: 0 }, prior: null,
    },
    identityTokens,
  };
}

const stripRefs = (s: string) => s.replace(/\{[AWPG]\d+\}/g, ' ');
// The disaster pattern was NAMING the grouping mechanic ("X/Y/Z are all one Jean-Marie conversation",
// "both are the same Galp setup") — not legitimate synthesis ("both feed the same design"). Target the
// bookkeeping-exposure phrasing precisely, so real chief-of-staff connective reasoning still passes.
const GROUPING = /\b(are all one|is all one|all one \w+|are the same (deal|project|conversation|thread|matter|engagement|account|client|initiative|thing|item)|both are the same|belong to the same (deal|project|conversation|thread|matter|engagement|initiative))\b/i;
const ESCALATE = /\b(escalat|will chase|keeps? chasing|hound|before .* (chases|escalates|follows up))\b/i;

(async () => {
  const users = await usersWithMemory();
  for (const uid of users) {
    const { inp, identityTokens } = await buildInputs(uid);
    if (!inp.actions.length && !inp.watch.length && !inp.moving.count) { check(`${uid.slice(0, 8)}: has material`, true, 'skipped — nothing active'); continue; }
    const b = await composeBriefing(sb, uid, inp);
    if (!b) { check(`${uid.slice(0, 8)}: composed`, false); continue; }
    const segs = [b.lead.text, b.action.text, b.watchlist?.text ?? '', b.pulse?.text ?? ''];
    const rawAll = segs.join('\n');
    const strippedAll = segs.map(stripRefs).join('\n');
    // Render for the eye.
    const named = rawAll.replace(/\{([AWPG]\d+)\}/g, (_, id) => `[${b.refs.find((r) => r.id === id)?.who ?? id}]`);
    console.log(`\n════ ${inp.firstName} (${uid.slice(0, 8)}) ════\n${named}`);

    check(`${uid.slice(0, 8)}: composed`, true);
    check(`${uid.slice(0, 8)}: grounded (no invented refs)`, !/\{[AWPG]\d+\}/.test(rawAll.replace(/\{([AWPG]\d+)\}/g, (m, id) => (b.refs.some((r) => r.id === id) ? '' : m))));
    // THE key gate: no authored identity token in the stripped prose.
    const low = strippedAll.toLowerCase();
    const leaked = [...identityTokens].filter((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(low));
    check(`${uid.slice(0, 8)}: authors NO identity (refs only)`, leaked.length === 0, leaked.length ? `leaked: ${leaked.slice(0, 6).join(', ')}` : '');
    check(`${uid.slice(0, 8)}: no grouping narration`, !GROUPING.test(strippedAll), (strippedAll.match(GROUPING) ?? [])[0] ?? '');
    check(`${uid.slice(0, 8)}: no fabricated escalation`, !ESCALATE.test(rawAll), (rawAll.match(ESCALATE) ?? [])[0] ?? '');
    check(`${uid.slice(0, 8)}: voice (no exclamation)`, !rawAll.includes('!'));
  }

  console.log('\n════ DISCIPLINE GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  (${d})` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
