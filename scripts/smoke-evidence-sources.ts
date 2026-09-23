// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W8.1 EVIDENCE FROM EVERYWHERE (invariant 7 EVIDENCE SETTLES; docs/laws-registry.md
// `evidence-from-everywhere`). ZERO AI, ZERO network: every IO gate runs the REAL loaders against an
// in-memory Supabase double that applies the filters the loaders send (eq · in · gt/gte/lt/lte ·
// overlaps · not-null · order · limit · range), so a gate proves an OUTCOME, not a wording.
//
//   R · THE REGISTRY — shape; every adapter emits the one shape through its real loadPool; the
//       workspace feature map gates rows; a TEST-ONLY row nominates with no matcher edit.
//   A · THE ACTOR LADDER — user / teammate (members + corporate domain) / counterparty / public
//       domain never teammate.
//   N · NOMINATION OUTCOMES — a calendar meeting held with the counterparty nominates a "call X"
//       commitment (bare-name counterparty resolved through the person registry); a bare-name MEETING
//       counterparty resolves through the meeting's own attendee list (the one containing event); a
//       teammate's delivery nominates with role teammate, forward AND through the reverse door.
//   S · SOURCE FLOORS — zero AI in the family; the matcher names no source; the judge states the actor.
//   W · W8.7 THE REMAINING HOOKS — the sync's one mail door (user + TEAMMATE, one helper, one call
//       site); the commit door settles a recorded deed at once (after()); the judge + the room match
//       with SETTLE_MATCH and render teammate / deed lines; calendar + transcript gated on DATA.
// Fixtures: fake identities only (Acme / Sam / Jo).
// Run: npx tsx scripts/smoke-evidence-sources.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EVIDENCE_SOURCES, loadEvidenceEvents, sourceEnabled } from '../lib/evidence/sources';
import { actorRole, buildActorContext, loadActorContext } from '../lib/evidence/actor';
import { resolveCommitmentIdentities } from '../lib/evidence/identity';
import { EVIDENCE_DEEDS, type EvidenceEvent, type EvidenceSourceDef } from '../lib/evidence/types';
import { loadEvidencePool, matchEvidence, nominateForEvent, SETTLE_MATCH, keysOfWork, type OpenWork } from '../lib/work/evidence-nominator';
import { mailOpensReverseDoor } from '../lib/evidence/sources';
import { recordCommitResult } from '../lib/work/commit-door';
import { laterEvidenceBlock } from '../lib/work/judge';
import { evidenceLinesOf } from '../lib/room/grounding';
import { TOOL_FEATURE } from '../lib/workspace/tool-capabilities';
import { DEFAULT_FEATURES } from '../lib/workspace/types';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');

// ── THE IN-MEMORY DOUBLE ─────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
/** Every `in()` read the double served, as `<table>.<column>` (W8.7: proves the reverse door ran). */
const DB_LOG: string[] = [];
function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    const preds: Array<(r: Row) => boolean> = [];
    let limit = Infinity; let range: [number, number] | null = null;
    let patch: Row | null = null;
    const cmp = (v: unknown) => String(v ?? '');
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    const run = () => {
      if (patch) { const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r))); for (const r of hit) Object.assign(r, patch); return hit.map((r) => ({ ...r })); }
      let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (limit !== Infinity) rows = rows.slice(0, limit);
      return rows;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select: () => q,
      update: (p: Row) => { patch = p; return q; },
      eq: (c: string, v: unknown) => { preds.push((r) => cmp(r[c]) === cmp(v)); return q; },
      neq: (c: string, v: unknown) => { preds.push((r) => cmp(r[c]) !== cmp(v)); return q; },
      in: (c: string, vs: unknown[]) => { DB_LOG.push(`${table}.${c}`); const s = new Set(vs.map(String)); preds.push((r) => s.has(cmp(r[c]))); return q; },
      gt: (c: string, v: unknown) => { preds.push((r) => r[c] != null && cmp(r[c]) > cmp(v)); return q; },
      gte: (c: string, v: unknown) => { preds.push((r) => r[c] != null && cmp(r[c]) >= cmp(v)); return q; },
      lt: (c: string, v: unknown) => { preds.push((r) => r[c] != null && cmp(r[c]) < cmp(v)); return q; },
      lte: (c: string, v: unknown) => { preds.push((r) => r[c] != null && cmp(r[c]) <= cmp(v)); return q; },
      overlaps: (c: string, vs: unknown[]) => { const s = new Set(vs.map(String)); preds.push((r) => arr(r[c]).some((x) => s.has(x))); return q; },
      not: (c: string, op: string, v: unknown) => { if (op === 'is' && v === null) preds.push((r) => r[c] != null); return q; },
      or: () => q, // the actionable-inbox OR filter — fixtures only hold actionable rows
      order: () => q,
      limit: (n: number) => { limit = n; return q; },
      range: (a: number, b: number) => { range = [a, b]; return q; },
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (res: (v: { data: Row[]; error: null }) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const U = 'user-1';
const NOW = new Date().toISOString();
/** `d` days ago, plus `m` minutes. */
const day = (d: number, m = 10) => new Date(Date.now() - d * 86_400_000 + m * 60_000).toISOString();
const CP = 'sam@acme-example.com';
const ME = 'me@augmtd-example.com';
const MATE = 'jo@augmtd-example.com';
const KL = 'kl.example@client-example.com';

const tables: Record<string, Row[]> = {
  profiles: [{ id: U, email: ME, full_name: 'Me User' }, { id: 'user-2', email: MATE, full_name: 'Jo Teammate' }],
  connections: [{ user_id: U, metadata: { email: ME }, provider_account_id: ME }],
  company_members: [{ company_id: 'co1', user_id: U, status: 'active' }, { company_id: 'co1', user_id: 'user-2', status: 'active' }],
  work_entities: [],
  emails: [
    // the user wrote to the counterparty on another thread
    { id: 'm-user', user_id: U, received_at: day(5), subject: 'Walkthrough times', from_address: ME, from_name: 'Me User', to_addresses: [CP], cc_addresses: [], thread_id: 'tX', metadata: {}, is_from_user: true, body: 'Here are times.' },
    // a TEAMMATE delivered on the client thread
    { id: 'm-mate', user_id: U, received_at: day(3), subject: 'Re: the changes', from_address: MATE, from_name: 'Jo Teammate', to_addresses: [CP], cc_addresses: [ME], thread_id: 'tClient', metadata: { attachments: [] }, is_from_user: false, body: 'We have implemented the changes.' },
    // the counterparty's inbound on the client thread (the origin)
    { id: 'm-cp', user_id: U, received_at: day(8), subject: 'the changes', from_address: CP, from_name: 'Sam Vendor', to_addresses: [ME], cc_addresses: [], thread_id: 'tClient', metadata: {}, is_from_user: false, body: 'Please make the changes.' },
  ],
  calendar_events: [
    { id: 'c-held', user_id: U, event_id: 'prov-1', provider: 'google', start_time: day(2), end_time: day(2, 60), title: 'Sam x Me // walkthrough', attendees: [{ email: CP, name: 'Sam Vendor', status: 'accepted' }, { email: ME }], organizer: ME, status: 'confirmed' },
    { id: 'c-declined', user_id: U, event_id: 'prov-2', provider: 'google', start_time: day(1), end_time: day(1, 60), title: 'Declined one', attendees: [{ email: CP, status: 'declined' }], organizer: ME, status: 'confirmed' },
    // the meeting a recording sat inside (no attendees on the recording itself)
    { id: 'c-room', user_id: U, event_id: 'prov-3', provider: 'google', start_time: day(9, 0), end_time: day(9, 90), title: 'Client review', attendees: [{ email: KL, name: 'Kim-Lee Example' }, { email: ME, name: 'Me User' }], organizer: ME, status: 'confirmed' },
  ],
  meeting_transcripts: [
    { id: 'tr-review', user_id: U, start_time: day(9, 5), created_at: day(9, 5), title: 'Client review (recording)', attendees: [], calendar_event_id: null },
  ],
  action_commits: [
    { id: 'a1', user_id: U, action_type: 'send_email', payload: { to: [CP], subject: 'deck' }, result: 'Sent.', created_at: day(4) },
    { id: 'a2', user_id: U, action_type: 'send_email', payload: { to: [CP] }, result: null, created_at: day(4) },
  ],
  entity_links: [],
  commitments: [
    { id: 'k-call', user_id: U, description: 'Call Sam to walk through the platform', counterparty: 'Sam Vendor', thread_id: 'tX', source: 'email', source_id: null, created_at: day(7), direction: 'you_owe', status: 'open' },
    { id: 'k-changes', user_id: U, description: 'Implement the requested changes', counterparty: `Sam Vendor <${CP}>`, thread_id: 'tClient', source: 'email', source_id: null, created_at: day(8, 30), direction: 'you_owe', status: 'open' },
    { id: 'k-bare', user_id: U, description: 'Send Kim-Lee the pricing', counterparty: 'Kim-Lee', thread_id: null, source: 'meeting', source_id: 'tr-review', created_at: day(9, 10), direction: 'you_owe', status: 'open' },
  ],
  inbox_items: [],
};
const REG = [{ id: 'p-sam', name: 'Sam Vendor', aliases: ['sam vendor', CP], state: null, nextTouch: null, lastEventAt: null, quietDays: null }];

async function main() {
  const db = fakeDb(tables);
  const actors = await loadActorContext(db, U);

  // ── R · THE REGISTRY ──
  console.log('R · THE REGISTRY');
  const keys = EVIDENCE_SOURCES.map((r) => r.source);
  ok('R1 rows: unique keys · distinct evidence-type letters (the sig is `<type[0]><id>`) · TOOL_FEATURE key or null · known deeds',
    new Set(keys).size === keys.length && new Set(EVIDENCE_SOURCES.map((r) => r.type[0])).size === EVIDENCE_SOURCES.length
    && EVIDENCE_SOURCES.every((r) => (r.feature === null || r.feature in TOOL_FEATURE) && r.deeds.length > 0 && r.deeds.every((d) => EVIDENCE_DEEDS.includes(d)) && typeof r.loadPool === 'function'),
    keys.join(','));
  ok('R2 the rows today are mail · calendar · transcript · deeds (our own commit-door ledger)', JSON.stringify(keys) === JSON.stringify(['mail', 'calendar', 'transcript', 'deeds']));
  const scope = { sinceISO: day(30), nowISO: NOW, addresses: [CP], threadIds: ['tClient', 'tX'], actors };
  const shapes: string[] = [];
  for (const r of EVIDENCE_SOURCES) {
    const res = await r.loadPool(db, U, scope);
    const bad = res.events.filter((e) => !(e.source === r.source && e.type === r.type && typeof e.id === 'string' && typeof e.at === 'string'
      && r.deeds.includes(e.deed) && ['user', 'teammate', 'counterparty', 'unknown'].includes(e.actor.role) && Array.isArray(e.participants) && e.objects && typeof e.title === 'string'));
    shapes.push(`${r.source}:${res.events.length}${bad.length ? `(bad ${bad.length})` : ''}`);
    ok(`R3 ${r.source}: its real loadPool emits the one shape (${res.events.length} event(s), each a declared deed)`, res.events.length > 0 && bad.length === 0, JSON.stringify(bad[0]));
  }
  // ⟲ RE-POINTED (W8.7, owner decision): evidence rows are gated on DATA, never on the `meetings` UI
  // module — the user's own synced calendar and stored recordings are evidence whatever modules show.
  // A feature gates a row only when it means "this source is not collected" (email off = no mailbox).
  const { stats: gatedStats } = await loadEvidenceEvents(db, U, scope, { features: { ...DEFAULT_FEATURES, meetings: false } });
  const { stats: mailOff } = await loadEvidenceEvents(db, U, scope, { features: { ...DEFAULT_FEATURES, email: false, meetings: false } });
  ok('R4 the feature map gates only a source it stops COLLECTING (meetings off → nothing gated, calendar + transcript READ; email off → mail gated, REPORTED; our ledger stays on)',
    gatedStats.gated.length === 0 && (gatedStats.bySource.calendar ?? 0) > 0 && (gatedStats.bySource.transcript ?? 0) > 0 && gatedStats.bySource.deeds === 1
    && JSON.stringify(mailOff.gated) === JSON.stringify(['mail']) && (mailOff.bySource.calendar ?? 0) > 0
    && EVIDENCE_SOURCES.every((r) => sourceEnabled(r, null)));
  ok('R5 an unrecorded / failed commit is not a deed (a2 has no result)', gatedStats.bySource.deeds === 1);
  // THE TEST-ONLY ROW — the whole contract of a new tool: one row, one adapter, no matcher edit.
  const chatRow: EvidenceSourceDef = {
    source: 'fixture_chat', type: 'message', label: 'Fixture chat', feature: null, deeds: ['message_sent'],
    loadPool: async (_c, _u, s) => ({ events: [{
      source: 'fixture_chat', type: 'message', id: 'chat-1', at: day(1), deed: 'message_sent',
      actor: { role: actorRole({ address: ME }, s.actors), address: ME }, participants: [{ address: CP }], objects: {}, title: 'the deck, as promised',
    } satisfies EvidenceEvent] }),
  };
  const { events: withChat } = await loadEvidenceEvents(db, U, scope, { sources: [...EVIDENCE_SOURCES, chatRow], registry: REG });
  const wChanges: OpenWork = { kind: 'commitment', id: 'k-changes', afterISO: day(8, 30), counterpartyEmail: CP, threadId: 'tClient', fulfiller: 'user', description: 'Implement the requested changes' };
  const chatEv = matchEvidence({ events: withChat }, wChanges, NOW, SETTLE_MATCH).filter((e) => e.source === 'fixture_chat');
  ok('R6 a TEST-ONLY source row nominates with NO matcher edit (the one shape is the whole contract)',
    chatEv.length === 1 && chatEv[0].by === 'user' && chatEv[0].key === 'person' && !/fixture_chat/.test(src('lib/evidence/match.ts')));

  // ── A · THE ACTOR LADDER ──
  console.log('\nA · THE ACTOR LADDER');
  ok('A1 the context: owned = login + mailbox; teammates = ACTIVE company members (never the user); team domain = corporate only',
    actors.own.includes(ME) && actors.teammates.includes(MATE) && !actors.teammates.includes(ME) && JSON.stringify(actors.teamDomains) === JSON.stringify(['augmtd-example.com']));
  const gm = buildActorContext({ profileEmail: 'me.personal@gmail.com', teammates: [] });
  ok('A2 user · teammate · counterparty · unknown — and a PUBLIC domain is never a teammate',
    actorRole({ address: ME }, actors) === 'user' && actorRole({ address: MATE }, actors) === 'teammate'
    && actorRole({ address: 'new.hire@augmtd-example.com' }, actors) === 'teammate'
    && actorRole({ address: CP }, actors, { addresses: [CP], personIds: [] }) === 'counterparty'
    && actorRole({ address: CP }, actors) === 'unknown'
    && gm.teamDomains.length === 0 && actorRole({ address: 'someone@gmail.com' }, gm) === 'unknown');
  ok('A3 precedence user > counterparty > teammate (a colleague who OWES the work is its counterparty)',
    actorRole({ address: MATE }, actors, { addresses: [MATE], personIds: [] }) === 'counterparty');

  // ── N · NOMINATION OUTCOMES (the real resolvers + the real pool) ──
  console.log('\nN · NOMINATION OUTCOMES');
  const rows = tables.commitments.map((c) => ({ id: String(c.id), counterparty: c.counterparty as string, thread_id: c.thread_id as string | null, source: c.source as string, source_id: c.source_id as string | null }));
  const ids = await resolveCommitmentIdentities(db, U, rows, REG);
  const pool = await loadEvidencePool(db, U, day(30), { addresses: [CP, KL], threadIds: ['tClient', 'tX'] }, { registry: REG, features: null, nowISO: NOW });
  const workOf = (id: string): OpenWork => {
    const c = tables.commitments.find((x) => x.id === id)!;
    const r = ids.get(id)!;
    return { kind: 'commitment', id, afterISO: String(c.created_at), counterpartyEmail: r.primary, threadId: (c.thread_id as string) ?? null, fulfiller: 'user', description: String(c.description), keys: r.keys };
  };
  const call = matchEvidence(pool, workOf('k-call'), NOW, SETTLE_MATCH);
  ok('N1 a calendar meeting HELD with the counterparty nominates the "call Sam" commitment (bare-name counterparty → the person registry → every address)',
    ids.get('k-call')?.via === 'registry' && call.some((e) => e.type === 'calendar' && e.id === 'c-held' && e.status === 'held') && !call.some((e) => e.id === 'c-declined'),
    JSON.stringify(call.map((e) => [e.type, e.id, e.status])));
  const bare = ids.get('k-bare');
  const bareEv = matchEvidence(pool, workOf('k-bare'), NOW, SETTLE_MATCH);
  ok('N2 a bare-name MEETING counterparty resolves through the meeting\'s own attendee list (the one event the recording sat inside)',
    bare?.via === 'meeting' && bare.primary === KL && bare.keys.eventIds.includes('c-room'), JSON.stringify(bare));
  ok('N3 …and the recording itself borrows that event\'s attendees (a transcript with none of its own is still WITH them)',
    pool.events.some((e) => e.source === 'transcript' && e.participants.some((p) => p.address === KL)) && Array.isArray(bareEv));
  const changes = matchEvidence(pool, workOf('k-changes'), NOW, SETTLE_MATCH);
  const mate = changes.find((e) => e.id === 'm-mate');
  ok('N4 a TEAMMATE\'s delivery on the client thread nominates you_owe work with role teammate (attributed by name)',
    !!mate && mate.by === 'teammate' && mate.actor?.role === 'teammate' && mate.actor?.name === 'Jo Teammate', JSON.stringify(changes.map((e) => [e.id, e.by])));
  ok('N5 the default (view) match never shows a teammate deed or an unrendered type — the settle path opts in',
    !matchEvidence(pool, workOf('k-changes'), NOW).some((e) => e.by === 'teammate' || e.type === 'deed'));
  ok('N6 our own commit-door deed nominates too (the user sent through AUGMTD before any sync)',
    changes.some((e) => e.source === 'deeds' && e.id === 'a1' && e.by === 'user'));
  const rev = await nominateForEvent(db, U, { type: 'email', id: 'm-mate' }, REG, NOW);
  ok('N7 THE REVERSE DOOR agrees: the teammate\'s mail nominates the same work (the same matcher decides what a trigger touches)',
    rev.some((n) => n.work.id === 'k-changes' && n.evidence.some((e) => e.id === 'm-mate' && e.by === 'teammate')), JSON.stringify(rev.map((n) => n.work.id)));
  const revCal = await nominateForEvent(db, U, { type: 'calendar', eventIds: ['prov-1'], provider: 'google' }, REG, NOW);
  ok('N8 the reverse door on a synced calendar batch nominates the "call Sam" commitment', revCal.some((n) => n.work.id === 'k-call'));
  ok('N9 object keys: every work carries its own house ref (a commit-door reply on THIS item is an object hit)',
    keysOfWork(workOf('k-call')).externalRefs.includes('commitment:k-call'));

  // ── S · SOURCE FLOORS ──
  console.log('\nS · SOURCE FLOORS');
  const fam = ['lib/evidence/types.ts', 'lib/evidence/sources.ts', 'lib/evidence/match.ts', 'lib/evidence/actor.ts', 'lib/evidence/identity.ts', 'lib/work/evidence-nominator.ts'].map(src).join('\n');
  ok('S1 zero AI in the nomination family (no aiCall / getAIClient / lib/ai import)', !/aiCall|getAIClient|from '@\/lib\/ai\//.test(fam));
  const match = src('lib/evidence/match.ts');
  ok('S2 the matcher names no source row and imports no loader (it reads the one shape only)',
    !/'mail'|'deeds'|EVIDENCE_SOURCES|from '\.\/sources'/.test(match) && /export function matchEvents/.test(match));
  ok('S3 no keyword / name-similarity guessing against free text in the matcher or the registry (sameAttendee only over a meeting\'s own attendees)',
    !/\.includes\(first\)|levenshtein|jaroWinkler|fuzzy\w*\(/i.test(fam) && !/sameAttendee/.test(match));
  const ful = src('lib/commitments/fulfillment.ts');
  ok('S4 the judge STATES the actor: a teammate line + the teammate clause only when a teammate piece is present; any other row renders as a DEED FACT',
    /a TEAMMATE of the user/.test(ful) && /THE TEAMMATE CLAUSE/.test(ful) && /candidates\.some\(\(c\) => c\.actor\?\.role === 'teammate'\)/.test(ful) && /DEED FACT/.test(ful));
  ok('S5 the disposition law is unchanged: only delivered closes (the settle\'s inbox door + applyFulfillmentVerdict)',
    src('lib/work/evidence-settle.ts').includes("if (verdict.verdict !== 'delivered') return { judged: true, closed: false") && /if \(verdict\.verdict === 'delivered'\) \{\s*const closed = await close\(\)/.test(ful));
  const settle = src('lib/work/evidence-settle.ts');
  ok('S6 a teammate close is stamped evidence:teammate and narrated with who did it (activity title + the drain line)',
    /role === 'teammate' \? 'evidence:teammate'/.test(settle) && /attribution\s*\?\s*`Resolved \(\$\{attribution\}\)/.test(settle) && /attribution \? `\$\{work\.description\} — \$\{attribution\}`/.test(settle));
  ok('S7 the forward doors + the sweep + the reverse door match with SETTLE_MATCH (every row, teammates)',
    (settle.match(/SETTLE_MATCH\)/g) ?? []).length >= 2 && /matchEvidence\(pool, p\.work, nowISO, SETTLE_MATCH\)/.test(src('lib/work/evidence-sweep.ts'))
    && /matchEvidence\(pool, work, nowISO, SETTLE_MATCH\)/.test(src('lib/work/evidence-nominator.ts')));
  ok('S8 no source list outside the registry (the nominator reaches rows only through evidenceSource / EVIDENCE_SOURCES)',
    !/from\('calendar_events'\)|from\('meeting_transcripts'\)|from\('action_commits'\)/.test(src('lib/work/evidence-nominator.ts')));

  // ── W · W8.7 THE REMAINING HOOKS ──
  console.log('\nW · W8.7 THE REMAINING HOOKS');
  const sync = src('lib/email-sync/sync-emails.ts');
  // ⟲ RE-POINTED (W9.2 WHAT YOU SEND ANYWHERE CLOSES): the door moved into lib/email-sync/authored-landed.ts
  // (awaited — no bare void a response can cut off). Still ONE helper, ONE settleForEvent; the sync keeps
  // ONE call site (INBOUND mail — the teammate ladder, in its drained tail) and the user's own mail reaches
  // the door through THE ONE authored-landed handler (its `door` step, after the resolve step) — so BOTH
  // authors still pass through the one helper, now whichever path stored the row.
  const landed = src('lib/email-sync/authored-landed.ts');
  const callSites = (sync.match(/\bopenMailEvidenceDoor\(adminSupabase/g) ?? []).length;
  ok('W1 ONE shared helper (authored-landed.ts), ONE call site on the sync path for INBOUND mail (drained tail) + ONE in the authored handler for the user\'s own mail (after its resolve step); the only settleForEvent in either file is inside the helper',
    /export async function openMailEvidenceDoor\(/.test(landed) && !/function openMailEvidenceDoor\(/.test(sync)
    && callSites === 1 && /if \(!storedEmail\.is_from_user\) \{\s*_tail\.add\('evidence-door', openMailEvidenceDoor\(adminSupabase/.test(sync)
    && (sync.match(/settleForEvent\(/g) ?? []).length === 0 && (landed.match(/settleForEvent\(/g) ?? []).length === 1
    && (landed.match(/openMailEvidenceDoor\(client/g) ?? []).length === 1
    && landed.indexOf('door: (client, userId, row) => openMailEvidenceDoor(client') > landed.indexOf('resolve: async (client, userId, row)'),
    `sync call sites ${callSites}`);
  ok('W2 the helper asks THE ONE ladder (mailOpensReverseDoor → mailEventOf → actorRole) — neither file re-derives a role; the actor context loads once per sync, lazily; the door is AWAITED end to end',
    /mailOpensReverseDoor\(storedEmail, ctx\)/.test(landed) && !/actorRole\(|teamDomains|\.teammates\b/.test(sync + landed)
    && /_actorsP \?\?= import\('@\/lib\/evidence\/actor'\)/.test(sync) && /const ctx = storedEmail\.is_from_user \? null : await actors\(\)/.test(landed)
    && /await settleForEvent\(client, userId, \{ type: 'email'/.test(landed) && !/\bvoid [A-Za-z_(]/.test(landed.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')));
  const inbound = (over: Record<string, unknown>) => ({ id: 'e-new', received_at: day(0, -5), subject: 'Re: the changes', from_address: MATE, to_addresses: [CP], cc_addresses: [ME], thread_id: 'tClient', metadata: {}, is_from_user: false, ...over });
  ok('W3 outcome: a recent TEAMMATE inbound opens the door; the counterparty\'s inbound, an unknown sender and old mail do not; user-authored mail does',
    mailOpensReverseDoor(inbound({}), actors) === 'teammate' && mailOpensReverseDoor(inbound({ from_address: CP }), actors) === null
    && mailOpensReverseDoor(inbound({ from_address: 'someone@gmail.com' }), actors) === null
    && mailOpensReverseDoor(inbound({ received_at: day(30) }), actors) === null
    && mailOpensReverseDoor(inbound({ from_address: ME, is_from_user: true }), null) === 'user');
  // …and the reverse door that helper fires agrees on the teammate's mail (the same matcher) — N7 above.

  const door = src('lib/work/commit-door.ts');
  ok('W4 the commit door: recordCommitResult selects the recorded row and hands a DEED to settleForEvent({ type: \'deed\' }) in after() (else floats) — only the scheduling is awaited, the registry\'s own mapper decides what is a deed',
    /\.select\('id, action_type, payload, result, created_at'\)/.test(door) && /if \(rows\.length\) await settleDeedsSoon\(/.test(door)
    && /const \{ after \} = await import\('next\/server'\);\s*after\(fire\);\s*\} catch \{ void fire\(\); \}/.test(door)
    && /settleForEvent\(client, userId, \{ type: 'deed', ids \}\)/.test(door) && /deedEventOf\(r\)/.test(door));
  {
    // OUTCOME: an empty house (no open work → the reverse door stops before any judgment — zero AI).
    const house: Record<string, Row[]> = {
      profiles: [{ id: U, email: ME, full_name: 'Me User' }], connections: [], company_members: [], work_entities: [], entity_links: [],
      commitments: [], inbox_items: [], emails: [], calendar_events: [], meeting_transcripts: [],
      action_commits: [
        { id: 'ac-send', user_id: U, idempotency_key: 'k-send', action_type: 'compose_send', payload: { to: [CP], subject: 'deck' }, result: null, created_at: day(0, -1) },
        { id: 'ac-fail', user_id: U, idempotency_key: 'k-fail', action_type: 'compose_send', payload: { to: [CP] }, result: null, created_at: day(0, -1) },
      ],
    };
    const hdb = fakeDb(house);
    const settled = () => DB_LOG.filter((l) => l === 'action_commits.id').length;
    const before = settled();
    await recordCommitResult(hdb, U, 'k-send', `Sent to ${CP}`);
    for (let i = 0; i < 50 && settled() === before; i++) await new Promise((r) => setTimeout(r, 20));
    const afterSend = settled();
    await recordCommitResult(hdb, U, 'k-fail', 'Failed to send');
    await new Promise((r) => setTimeout(r, 300));
    ok('W5 outcome: a recorded SEND fires the reverse door at once (the deeds row loads the new deed by id); a FAILED result records but fires nothing',
      house.action_commits[0].result === `Sent to ${CP}` && afterSend === before + 1 && settled() === afterSend && house.action_commits[1].result === 'Failed to send',
      `reads ${before}→${afterSend}→${settled()}`);
  }

  const judgeSrc = src('lib/work/judge.ts');
  const groundSrc = src('lib/room/grounding.ts');
  ok('W6 the judge and the room match with SETTLE_MATCH (they see the evidence the settle sees)',
    /matchEvidence\(\{ \.\.\.full, events: full\.events\.filter\(\(e\) => e\.at <= horizon\) \}, \{[\s\S]{0,400}\}, new Date\(\)\.toISOString\(\), SETTLE_MATCH\)/.test(judgeSrc)
    && (groundSrc.match(/\}, nowISO, SETTLE_MATCH\);/g) ?? []).length === 2 && !/matchEvidence\(bounded, \{[\s\S]{0,500}?\}, nowISO\);/.test(groundSrc));
  const changesEv = matchEvidence(pool, workOf('k-changes'), NOW, SETTLE_MATCH);
  const block = laterEvidenceBlock(changesEv, 'UTC');
  const lines = evidenceLinesOf(changesEv, 'UTC');
  ok('W7 outcome: the judge renders the teammate as theirs ("a teammate (Jo Teammate) sent …") and the commit-door deed as a deed — never as the user\'s mail',
    /- a teammate \(Jo Teammate\) sent "Re: the changes"/.test(block) && /DONE BY THE USER THROUGH AUGMTD[^\n]*\n- sent "deck"/.test(block)
    && !/SENT BY THE USER[^\n]*\n[^\n]*Re: the changes/.test(block), block);
  ok('W8 outcome: the room\'s evidence lines say the same (teammate SENT · the user SENT … through AUGMTD)',
    lines.some((l) => /^a teammate \(Jo Teammate\) SENT "Re: the changes"/.test(l)) && lines.some((l) => /^the user SENT "deck" through AUGMTD/.test(l)), lines.join(' | '));
  const legacy = laterEvidenceBlock([{ type: 'calendar', id: 'c', at: '2026-09-14T09:00:00Z', title: 'Walkthrough', status: 'held' }, { type: 'email', id: 'm', at: '2026-09-15T10:00:00Z', title: 'Times', by: 'user' }], 'UTC');
  ok('W9 the legacy sections are byte-identical (no new header without a teammate / deed piece)',
    legacy === 'LATER EVIDENCE — the user\'s own record AFTER this item, with this counterparty (dated facts, not a verdict):\nALREADY ON THE USER\'S CALENDAR with this counterparty:\n- "Walkthrough" at 2026-09-14 09:00 (held)\nSENT BY THE USER to this counterparty since (any thread):\n- "Times" on 2026-09-15 10:00\n', JSON.stringify(legacy));
  const reg = src('lib/evidence/sources.ts');
  ok('W10 calendar + transcript rows are DATA-gated (feature null, never the meetings flag); the header documents THE GATING RULE',
    EVIDENCE_SOURCES.find((r) => r.source === 'calendar')?.feature === null && EVIDENCE_SOURCES.find((r) => r.source === 'transcript')?.feature === null
    && EVIDENCE_SOURCES.find((r) => r.source === 'mail')?.feature === 'get_emails'
    && /THE GATING RULE/.test(reg) && /"this source is NOT COLLECTED"/.test(reg) && !/feature: 'get_calendar'|feature: 'get_meeting_context'/.test(reg));

  console.log(`\n${pass} passed, ${fail} failed  (pool: ${shapes.join(' ')})`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('smoke-evidence-sources failed:', e); process.exit(1); });
