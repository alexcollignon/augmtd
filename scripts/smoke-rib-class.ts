/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — THE RIB CLASS (stabilization W19.A · owner walk Sep 28). ZERO-AI (every judge is stubbed),
 * ZERO-DB (an in-memory double). Registered under EVIDENCE SETTLES · ONE FACT, ONE HOME · TIME TRUTH.
 *
 * The walk: a "Send the RIB for the pilot payment" item was CLOSED by a reply that promised the RIB
 * "next week" with nothing attached; a commitment the COUNTERPARTY owed was judged against the user's
 * RIB mail (evidence gathered by person); the entity summary kept saying "your RIB blocks payment —
 * nine days overdue" beside a ledger that said handled.
 *   A · A REPLY IS NOT A DELIVERY — outcome: a promising reply keeps a deliverable open and records a
 *       you-owe commitment (through the one creation door, with the stated date and the verified
 *       quote); a delivering reply closes; an answer-only item closes on the reply with no judgment;
 *       a read path never judges; the fresh-judgment budget reports what it left.
 *   B · EVIDENCE IS ABOUT ITS OBJECT — outcome: a counterparty-owed commitment's evidence excludes an
 *       unrelated same-person message; the same conversation and a matter-sharing message stand.
 *   C · THE SUMMARY IS NOT A SECOND TRUTH — outcome: the serve floor drops a handled item named as
 *       owed/blocking and withholds an unprovable overdue count; the page leads with the ledger;
 *       a state older than its ledger is stale.
 *   D · SOURCE — every entity-state reader in the fence passes the floor; the rest are declared.
 *   E · THE REPAIR — the census filter finds a promise-only reply and leaves a delivery.
 * Exit 1 on any failure.   Run: npx tsx scripts/smoke-rib-class.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveThreadOnReply, recordPromiseCommitment, REPLY_DELIVERABLE_MAX_FRESH, type ReplyResolveDeps } from '../lib/inbox/resolve-on-reply';
import { isDeliverableAsk, promiseCommitmentOf } from '../lib/commitments/deliverable-ask';
import { promiseQuoteFloor } from '../lib/commitments/extract';
import { aboutWork, workMatterTokens } from '../lib/evidence/relevance';
import { gateEvidenceAboutWork } from '../lib/work/evidence-nominator';
import { matchEvents, SETTLE_MATCH } from '../lib/evidence/match';
import { serveEntityState, entityStateStale, settledIndexOf, namesSettledWork, isClosedLedgerLine } from '../lib/entities/state';
import { replyLooksPromised } from './repair-reply-closed-deliverables';
import type { FulfillmentJudgment } from '../lib/commitments/fulfillment';
import type { EvidenceEvent } from '../lib/evidence/types';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── an in-memory Supabase double: chainable (any unknown method returns the builder), awaited = run ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
function fakeDb(tables: Record<string, Row[]>) {
  let seq = 0;
  const val = (r: Row, c: string) => {
    const m = c.match(/^(\w+)->>(\w+)$/);
    if (m) { const v = r[m[1]]?.[m[2]]; return v == null ? null : String(v); }
    return r[c] ?? null;
  };
  const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));
  const orMatch = (r: Row, expr: string) => {
    const parts: string[] = []; let depth = 0; let cur = '';
    for (const ch of expr) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; }
    if (cur) parts.push(cur);
    return parts.some((p) => {
      const m = /^([\w>-]+)\.(in|eq)\.(.+)$/.exec(p);
      if (!m) return false;
      if (m[2] === 'eq') return same(val(r, m[1]), m[3]);
      return m[3].replace(/^\(|\)$/g, '').split(',').includes(String(val(r, m[1])));
    });
  };
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select';
    let patch: Row | null = null; let rows: Row[] = []; let single = false; let returning = false;
    let order: { c: string; asc: boolean } | null = null; let limit = Infinity;
    const run = () => {
      const tbl = (tables[table] ??= []);
      if (op === 'insert' || op === 'upsert') {
        const ins = rows.map((r) => ({ id: r.id ?? `${table}-${++seq}`, created_at: new Date().toISOString(), ...r }));
        tbl.push(...ins);
        return { data: single ? ins[0] : ins, error: null };
      }
      let hit = tbl.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') { for (const r of hit) Object.assign(r, JSON.parse(JSON.stringify(patch))); return { data: returning ? hit : null, error: null, count: hit.length }; }
      if (op === 'delete') return { data: null, error: null };
      if (order) { const { c, asc } = order; hit = [...hit].sort((x, y) => (String(val(x, c) ?? '') < String(val(y, c) ?? '') ? -1 : 1) * (asc ? 1 : -1)); }
      hit = hit.slice(0, limit === Infinity ? undefined : limit).map((r) => JSON.parse(JSON.stringify(r)));
      return { data: single ? (hit[0] ?? null) : hit, error: null, count: hit.length };
    };
    const b: Row = new Proxy({}, {
      get(_t, prop: string) {
        switch (prop) {
          case 'select': return () => { if (op !== 'select') returning = true; return b; };
          case 'update': return (p: Row) => { op = 'update'; patch = p; return b; };
          case 'insert': return (p: Row | Row[]) => { op = 'insert'; rows = Array.isArray(p) ? p : [p]; return b; };
          case 'upsert': return (p: Row | Row[]) => { op = 'upsert'; rows = Array.isArray(p) ? p : [p]; return b; };
          case 'delete': return () => { op = 'delete'; return b; };
          case 'eq': return (c: string, v: unknown) => { filters.push((r) => same(val(r, c), v)); return b; };
          case 'neq': return (c: string, v: unknown) => { filters.push((r) => !same(val(r, c), v)); return b; };
          case 'in': return (c: string, vs: unknown[]) => { filters.push((r) => vs.map(String).includes(String(val(r, c)))); return b; };
          case 'is': return (c: string, v: unknown) => { filters.push((r) => (val(r, c) ?? null) === v); return b; };
          case 'gt': return (c: string, v: string) => { filters.push((r) => String(val(r, c) ?? '') > v); return b; };
          case 'gte': return (c: string, v: string) => { filters.push((r) => String(val(r, c) ?? '') >= v); return b; };
          case 'lt': return (c: string, v: string) => { filters.push((r) => String(val(r, c) ?? '') < v); return b; };
          case 'lte': return (c: string, v: string) => { filters.push((r) => String(val(r, c) ?? '') <= v); return b; };
          case 'or': return (expr: string) => { filters.push((r) => orMatch(r, expr)); return b; };
          case 'order': return (c: string, o?: { ascending?: boolean }) => { order ??= { c, asc: o?.ascending !== false }; return b; };
          case 'limit': return (n: number) => { limit = n; return b; };
          case 'maybeSingle': case 'single': return () => { single = true; return b; };
          case 'then': return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej);
          default: return () => b;
        }
      },
    });
    return b;
  };
  return { from, rpc: async () => ({ data: null, error: null }), tables };
}

const U = 'user-rib-smoke';
const T = 'thread-rib-smoke';
const CP = 'sam@acme.test';
const ASKED = '2026-09-09T16:04:15.000Z';
const REPLIED = '2026-09-18T18:35:21.000Z';
const PROMISE = 'Je t’envoie les informations de paiement début de semaine prochaine.';
const promiseBody = `Bonjour Sam, un point d’avancement sur le pilote. ${PROMISE} Bonne soirée`;

function world(opts: { work?: string | null; requires?: string[]; understanding?: Row; attachments?: number; body?: string; items?: number } = {}) {
  const n = opts.items ?? 1;
  const items: Row[] = []; const plans: Row[] = [];
  for (let i = 1; i <= n; i++) {
    items.push({
      id: `item-${i}`, user_id: U, source: 'email', status: 'pending', work_state: 'work_prepared', rule_type: 'needs_reply',
      created_at: ASKED, work_title: 'Send the RIB for the Acme pilot payment',
      source_data: { thread_id: T, subject: 'RE: Acme pilot', from_address: CP, understanding: opts.understanding ?? { ask: 'Send your bank details (RIB) for payment', relevance: 'action', ownership: 'you_owe', initiative: 'Acme pilot' } },
    });
    if (opts.work !== null) plans.push({ user_id: U, kind: 'judgment', entity_id: `inbox:item-${i}`, tasks: { sig: 's', ev: '', verdict: { work: opts.work ?? 'send_file', requires: opts.requires ?? [{ label: 'RIB' }] } } });
  }
  const db = fakeDb({
    inbox_items: items,
    item_plans: plans,
    commitments: [],
    activity_events: [],
    emails: [
      { id: 'mail-ask', user_id: U, thread_id: T, is_from_user: false, received_at: ASKED, from_address: CP, to_addresses: ['me@augmtd.test'], subject: 'RE: Acme pilot', body: 'Merci de m’envoyer ton RIB pour paiement.', metadata: {} },
      { id: 'mail-reply', user_id: U, thread_id: T, is_from_user: true, received_at: REPLIED, from_address: 'me@augmtd.test', to_addresses: [CP], subject: 'Re: Acme pilot', body: opts.body ?? promiseBody, metadata: opts.attachments != null ? { attachments: Array.from({ length: opts.attachments }, (_, k) => ({ filename: `f${k}.pdf` })) } : {} },
    ],
  });
  const threadEmails = [
    { is_from_user: false, received_at: ASKED, from: CP, to: ['me@augmtd.test'] },
    { is_from_user: true, received_at: REPLIED, from: 'me@augmtd.test', to: [CP] },
  ];
  return { db, threadEmails };
}

/** A French Outlook reply in its stored shape (a space before each header colon, trailing blanks). */
const FR_REPLY = 'Bonjour, merci pour ton contrat. Merci de m’envoyer ton RIB pour paiement stp.\nSam\nMobile : 00 00 00 00\n\n \n\nDe : Me <me@augmtd.test> \nEnvoyé : lundi 7 septembre 2026 14:31\nÀ : Sam <sam@acme.test>\nObjet : Re: Agent AI - Acme\n\nBonjour Sam, voici la presentation et la agent documentation promises.';

const stubJudge = (verdict: FulfillmentJudgment['verdict'], extra: Partial<FulfillmentJudgment> = {}) => {
  const calls: Array<{ obligation: Row; candidates: Row[] }> = [];
  const judge = (async (_c: unknown, _u: unknown, obligation: Row, candidates: Row[]) => {
    calls.push({ obligation, candidates });
    return { verdict, reason: `stub ${verdict}`, cached: false, fresh: true, ...extra } as FulfillmentJudgment;
  }) as unknown as NonNullable<ReplyResolveDeps['judge']>;
  return { judge, calls };
};

async function main() {
  // ═══ A · A REPLY IS NOT A DELIVERY ═══
  console.log('\nA · a reply is not a delivery — only a judged delivery closes a deliverable ask');
  gate('A0 the deliverable predicate: send_file / produce / a reply that must carry an artifact; an answer-only verb is not; unjudged → the understanding',
    isDeliverableAsk({ work: 'send_file' }) && isDeliverableAsk({ work: 'produce' }) && isDeliverableAsk({ work: 'reply', requires: [{ label: 'deck' }] })
    && !isDeliverableAsk({ work: 'reply', requires: [] }) && !isDeliverableAsk({ work: 'decide' }) && !isDeliverableAsk({ work: 'schedule' })
    && isDeliverableAsk({ understanding: { relevance: 'action', ownership: 'you_owe' } })
    && !isDeliverableAsk({ understanding: { relevance: 'reply', ownership: 'you_owe' } }));
  {
    // A1 — the walk's case: a promise ("next week"), nothing attached → OPEN + a you-owe commitment.
    const { db, threadEmails } = world();
    const { judge, calls } = stubJudge('promised', { quote: PROMISE, newDue: '2026-09-22' });
    const recorded: Row[] = [];
    const r = await resolveThreadOnReply({
      userId: U, threadId: T, threadEmails, client: db, skipLabelReconcile: true, readPath: false,
      deps: { judge, recordPromise: async (c, u, a) => { recorded.push(a); return recordPromiseCommitment(c, u, a); } },
    });
    const item = db.tables.inbox_items[0];
    const c = db.tables.commitments[0];
    gate('A1 a PROMISING reply keeps the deliverable item open (never completed on the reply)',
      item.status === 'pending' && r.resolvedItems === 0 && r.deliverablesKeptOpen === 1, JSON.stringify({ status: item.status, r }));
    gate('A1 …the one judge read THE REPLY (the user\'s own message on the thread, attachment count passed) and was asked for the promise words',
      calls.length === 1 && calls[0].candidates[0]?.id === 'mail-reply' && calls[0].obligation.kind === 'inbox' && calls[0].obligation.wantsPromiseQuote === true
      && /RIB/.test(String(calls[0].obligation.description)));
    gate('A1 …and the promise is RECORDED as a you-owe commitment through the one creation door (writeCommitments): the ask, the stated date, the thread, the quote',
      r.promisesRecorded === 1 && !!c && c.direction === 'you_owe' && c.status === 'open' && /RIB/.test(String(c.description))
      && c.due_date === '2026-09-22' && c.thread_id === T && c.source === 'email' && c.source_id === 'mail-reply' && String(c.source_quote ?? '').includes('semaine prochaine'),
      JSON.stringify(c ?? null));
    gate('A1 …no "Resolved (you replied)" activity was written for it', !db.tables.activity_events.some((a) => /Resolved \(you replied\)/.test(String(a.title))));
    // Idempotent: the same reply read again records nothing new.
    await resolveThreadOnReply({ userId: U, threadId: T, threadEmails, client: db, readPath: false, skipLabelReconcile: true, deps: { judge } });
    gate('A1 …idempotent: the same reply re-read writes no second commitment', db.tables.commitments.length === 1, String(db.tables.commitments.length));
    gate('A1 …the recorded candidate passes THE QUOTE FLOOR against the reply\'s own words (a user-authored you_owe with an explicit promise)',
      recorded.length >= 1 && promiseQuoteFloor(promiseCommitmentOf(recorded[0].item, recorded[0].verdict, CP)!, { ownWords: promiseBody, authoredByUser: true }).keep === true);
  }
  {
    // A2 — a delivering reply (the file attached) closes.
    const { db, threadEmails } = world({ attachments: 1, body: 'Bonjour Sam, voici le RIB en pièce jointe.' });
    const { judge, calls } = stubJudge('delivered');
    const r = await resolveThreadOnReply({ userId: U, threadId: T, threadEmails, client: db, skipLabelReconcile: true, readPath: false, deps: { judge } });
    const item = db.tables.inbox_items[0];
    gate('A2 a DELIVERING reply (attachment present, judged delivered) closes the item — reason replied, judged delivered on the log',
      item.status === 'completed' && item.source_data.resolved_reason === 'replied' && r.resolvedItems === 1
      && calls[0]?.candidates[0]?.attachmentCount === 1
      && db.tables.activity_events.some((a) => a.metadata?.judged === 'delivered'), JSON.stringify({ status: item.status, r }));
    gate('A2 …and records no commitment', db.tables.commitments.length === 0);
  }
  {
    // A3 — an answer-only item (judged reply, nothing to attach) closes on the reply, no judgment spent.
    const { db, threadEmails } = world({ work: 'reply', requires: [], understanding: { ask: 'Confirm the Thursday slot', relevance: 'reply', ownership: 'you_owe' } });
    const { judge, calls } = stubJudge('promised');
    const r = await resolveThreadOnReply({ userId: U, threadId: T, threadEmails, client: db, skipLabelReconcile: true, readPath: false, deps: { judge } });
    gate('A3 an ANSWER-ONLY item still closes on the reply (the reply IS the answer) — the judge is never asked',
      db.tables.inbox_items[0].status === 'completed' && r.resolvedItems === 1 && calls.length === 0);
  }
  {
    // A4 — unclear keeps it open, records nothing.
    const { db, threadEmails } = world();
    const { judge } = stubJudge('unclear');
    const r = await resolveThreadOnReply({ userId: U, threadId: T, threadEmails, client: db, skipLabelReconcile: true, readPath: false, deps: { judge } });
    gate('A4 an UNCLEAR verdict (or an outage) keeps the item open and records nothing (failure is never fulfillment)',
      db.tables.inbox_items[0].status === 'pending' && r.deliverablesKeptOpen === 1 && db.tables.commitments.length === 0);
  }
  {
    // A5 — the read path (the read-time reconcile) never judges.
    const { db, threadEmails } = world();
    const { judge, calls } = stubJudge('delivered');
    const r = await resolveThreadOnReply({ userId: U, threadId: T, threadEmails, client: db, skipLabelReconcile: true, deps: { judge } });
    gate('A5 a hot READ path (skipLabelReconcile) never judges a deliverable — it stays open and is COUNTED left behind',
      calls.length === 0 && db.tables.inbox_items[0].status === 'pending' && r.leftBehind === 1 && r.deliverablesKeptOpen === 1);
  }
  {
    // A6 — bounded: more deliverables than the fresh budget → the rest reported.
    const n = REPLY_DELIVERABLE_MAX_FRESH + 2;
    const { db, threadEmails } = world({ items: n });
    const { judge, calls } = stubJudge('unclear');
    const r = await resolveThreadOnReply({ userId: U, threadId: T, threadEmails, client: db, skipLabelReconcile: true, readPath: false, deps: { judge } });
    gate(`A6 bounded: at most ${REPLY_DELIVERABLE_MAX_FRESH} FRESH judgments per call; the rest are reported left behind (no silent caps)`,
      calls.length === REPLY_DELIVERABLE_MAX_FRESH && r.leftBehind === 2, JSON.stringify({ calls: calls.length, r }));
  }
  {
    const s = code('lib/inbox/resolve-on-reply.ts');
    gate('A7 SOURCE: one judge, not a second — the inbox lane calls judgeFulfillmentFromEvidence (lib/commitments/fulfillment) and the recorder writes through writeCommitments',
      /\(await import\('@\/lib\/commitments\/fulfillment'\)\)\.judgeFulfillmentFromEvidence/.test(s) && /await writeCommitments\(userId, \[cand\]/.test(s)
      && !/aiCall|aiCreate|getAIClient/.test(s));
    const ff = src('lib/commitments/fulfillment.ts');
    gate('A8 the promise quote is CODE-verified (quoteInText against the email\'s own words) and the quote lane never serves a quote-less cached promise',
      /quoteClause && q && quoteInText\(q, body\)/.test(ff) && /const quoteMissing = obligation\.wantsPromiseQuote === true/.test(ff));
  }

  // ═══ B · EVIDENCE IS ABOUT ITS OBJECT ═══
  console.log('\nB · evidence for a commitment is about THAT commitment');
  {
    const desc = 'Send presentation and agent documentation to Sam for team review';
    gate('B0 the matter words drop the imperative verb', !workMatterTokens(desc).includes('send') && workMatterTokens(desc).includes('documentation'));
    // The counterparty (Sam) owes the docs; Sam's later mail on ANOTHER thread asks for the user's RIB.
    const ev = (id: string, threadId: string, title: string): EvidenceEvent => ({
      source: 'mail', type: 'email', id, at: '2026-09-09T16:00:00.000Z', deed: 'message_sent',
      actor: { address: CP, role: 'unknown' }, participants: [{ address: 'me@augmtd.test' }], objects: { threadId }, title, loadBody: true,
    });
    const keys = { addresses: [CP], personIds: [], threadIds: ['thread-docs'], eventIds: [], fileIds: [], entityIds: [], externalRefs: [] };
    const matched = matchEvents([ev('m-rib', 'thread-other', 'RE: Agent AI - Acme'), ev('m-same', 'thread-docs', 'Hello'), ev('m-docs', 'thread-third', 'RE: Agent AI - Acme')],
      { afterISO: '2026-07-07T00:00:00.000Z', fulfiller: 'counterparty', keys }, '2026-09-28T00:00:00.000Z', SETTLE_MATCH);
    const db = fakeDb({ emails: [
      { id: 'm-rib', user_id: U, body: FR_REPLY },
      { id: 'm-same', user_id: U, body: 'Quick hello.' },
      { id: 'm-docs', user_id: U, body: 'Here is the agent documentation we discussed.' },
    ] });
    const g = await gateEvidenceAboutWork(db as never, U, matched, desc);
    const ids = g.evidence.map((e) => e.id).sort();
    gate('B1 a counterparty-owed commitment\'s evidence EXCLUDES an unrelated same-person message (asking for a different thing — its quoted chain is not its words)',
      matched.some((e) => e.id === 'm-rib') && !ids.includes('m-rib') && g.vetoed === 1, JSON.stringify(ids));
    gate('B2 …keeps the SAME conversation (W18 — the object key needs no matter test) and a person-keyed message ABOUT the matter',
      ids.includes('m-same') && ids.includes('m-docs'));
    gate('B3 a meeting and a no-matter work are never vetoed (the meeting clause stays the judge\'s)',
      aboutWork({ key: 'person', deed: 'meeting_held', status: 'held', title: 'Sync' }, desc) && aboutWork({ key: 'person', title: 'x', body: 'y' }, 'Do it'));
    const { topMessageOf } = await import('../lib/inbox/top-message');
    const top = topMessageOf(FR_REPLY);
    gate('B5 THE ONE PARSER cuts the French Outlook header block ("De : … Envoyé : …") — the quoted chain is not the sender\'s words',
      /RIB pour paiement/.test(top) && !/Envoy/.test(top) && !/documentation/.test(top), JSON.stringify(top));
    gate('B6 no second quoted-chain parser: relevance reads own words through topMessageOf only',
      !/Envoy|HEADER_BLOCK|Gesendet/.test(code('lib/evidence/relevance.ts')) && /topMessageOf\(/.test(code('lib/evidence/relevance.ts')));
    const settle = code('lib/work/evidence-settle.ts'); const judge = code('lib/work/judge.ts');
    gate('B4 SOURCE: the settle (every door) and the item judge both gate their nominated evidence before judging',
      /const gated = await gateEvidenceAboutWork\(client, userId, evidence, work\.description\);/.test(settle)
      && settle.indexOf('gateEvidenceAboutWork(client') < settle.indexOf('judgeFulfillmentFromEvidence(client')
      && /evidence = \(await gateEvidenceAboutWork\(client, userId, evidence, title\)\)\.evidence;/.test(judge));
  }

  // ═══ C · THE SUMMARY IS NOT A SECOND TRUTH ═══
  console.log('\nC · the stored summary yields to the ledger, and to the clock');
  {
    const ledger = [
      { text: 'team prepared: Nudge — Sam' },
      { text: 'Email examples received from Zoé (handled) — "Bonjour, merci"' },
      { text: 'Meeting: Acme Workflow' },
      { text: 'Send RIB for Acme pilot payment (handled) — "Merci de m’envoyer ton RIB"' },
      { text: 'you owe: Identify repetitive task for automation pilot' },
      { text: 'you owe: Send AI agent platform presentation deck' },
    ];
    const state = {
      summary: 'Sam signed Sep 9; you promised your RIB by Sep 18 to unblock payment. Nine days overdue. The kickoff is booked.',
      blocking: 'Your RIB stops Acme pilot payment processing.',
      whoOwes: { you: ['send them your RIB', 'identify the repetitive task'], them: [] },
    };
    const s = serveEntityState(state, { ledger, entityName: 'Acme', now: new Date('2026-09-28T10:00:00Z'), tz: 'UTC' });
    gate('C1 a HANDLED item named as blocking / owed is DROPPED (the acronym that IS the matter counts)',
      s.blocking === null && !s.whoOwesYou.some((x) => /RIB/.test(x)) && s.whoOwesYou.includes('identify the repetitive task'), JSON.stringify(s));
    gate('C2 …the summary loses the owed clause about it and the unprovable overdue count (no composition anchor → withheld), and keeps the rest',
      !/RIB/.test(String(s.summary)) && !/overdue/i.test(String(s.summary)) && /Sam signed Sep 9/.test(String(s.summary)) && /kickoff is booked/.test(String(s.summary)), String(s.summary));
    const reopened = ledger.map((l) => ({ text: l.text.replace(' (handled)', '') }));
    const s2 = serveEntityState(state, { ledger: reopened, entityName: 'Acme', now: new Date('2026-09-28T10:00:00Z'), tz: 'UTC' });
    gate('C3 …and when the RIB row is OPEN again, the same claims STAND (the floor never silences open work)',
      /RIB/.test(String(s2.blocking)) && s2.whoOwesYou.some((x) => /RIB/.test(x)) && /RIB/.test(String(s2.summary)));
    const s3 = serveEntityState({ ...state, composedAt: '2026-09-25T06:00:00Z' }, { ledger: reopened, now: new Date('2026-09-28T10:00:00Z'), tz: 'UTC' });
    gate('C4 an overdue count with a KNOWN composition day is rewritten to the deadline\'s date ("overdue since Sep 16"), never served as a stale count',
      /Overdue since Sep 16/.test(String(s3.summary)) && !/Nine days/.test(String(s3.summary)), String(s3.summary));
    gate('C5 the settled index is closed-status only (a watermark "the user spoke last" is no longer proof — a promise leaves the row open)',
      isClosedLedgerLine('X (handled)') && !isClosedLedgerLine('Send the RIB — NOW (2026-09-18, the user spoke last): "next week"')
      && !namesSettledWork('send your RIB', settledIndexOf([{ text: 'Send the RIB — NOW (2026-09-18, the user spoke last): "x"' }])));
    gate('C6 a stored state older than its ledger is STALE (marked for its one sig-gated recompose)',
      entityStateStale('v9:21:-676:ev5:j1', '21:-128') && !entityStateStale('v9:21:-128:ev5:j1', '21:-128'));
    const g = code('lib/room/grounding.ts');
    const order = ['THE LEDGER NOW — SETTLED', 'THE LIVE BOARD', 'renderGroundEvidence(groundEvidence)', 'THE SYNTHESIS (a derived summary', 'HISTORY (newest first'].map((m) => g.indexOf(m));
    gate('C7 the context page LEADS with the ledger (settled rows → live board → the world\'s record), the synthesis after them (a head-clip keeps the rows)',
      order.every((i) => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), JSON.stringify(order));
    gate('C8 the WATCH-OUT rides inside the synthesis block (never ahead of the rows)',
      g.indexOf('WATCH-OUT (what is blocking this work right now)') > g.indexOf('const synthesis = [') && g.indexOf('const synthesis = [') < g.indexOf('const body = ['));
    gate('C9 the grounding marks a stale state through the existing coalesced path (mark only, never a synthesis on the read)',
      /entityStateStale\(ent\.sig as string \| null, ledgerSig\)/.test(g) && /scheduleEntityRefresh\(client, userId, \[entityId\], \{ maxRun: 0 \}\)/.test(g));
    const ask = code('lib/home/ask.ts');
    gate('C10 the Home focused answer reads the SAME page (one grounding) under a declared clip — its head is now the ledger',
      /assembleRoomGrounding\(supabase, userId, \{ kind: 'entity', entityId: focus\.id \}\)/.test(ask) && /clipWithRule\(g\.text/.test(ask));
  }

  // ═══ D · EVERY ENTITY-STATE READER PASSES THE FLOOR ═══
  console.log('\nD · every entity-state reader passes the floor (in-fence) or is declared');
  {
    const st = code('lib/entities/state.ts'); const g = code('lib/room/grounding.ts'); const j = code('lib/work/judge.ts');
    gate('D1 the WRITE path floors before storing (settled claims + the compose-time time belt + the composedAt anchor)',
      /const floored = serveEntityState\(\{ \.\.\.state, composedAt \}/.test(st) && /absolutizeTimeWords\(x, \{\}\)/.test(st) && /state\.composedAt = composedAt;/.test(st)
      && st.indexOf('const floored = serveEntityState(') < st.indexOf("await supabase.from('work_entities').update({\n      state, next_move"));
    gate('D2 the ONE GROUNDING serves the state only through serveEntityState over the live ledger (summary · blocking · whoOwes · next move)',
      /const served = ent \? serveEntityState\(st, \{/.test(g) && /summary: served\.summary/.test(g) && /blocking: served\.blocking/.test(g)
      && /whoOwesYou: served\.whoOwesYou/.test(g) && !/summary: st\.summary \?\?/.test(g));
    gate('D3 the item judge\'s deal block serves the summary through the time floor', /serveStateProse\(st\.summary, \{ composedAt: st\.composedAt \?\? null \}\)/.test(j));
    // THE INVERSE GATE (floored-only): every file that reads the stored state prose serves it through the
    // one floor — floorEntityRows (settled claims against the entity's ledger heads + the time floor) or
    // serveEntityState over a ledger it already holds. There is NO declared escape: a new reader fails
    // until it floors. (absorbEntity in lib/entities/reflect.ts selects `state` but never reads its prose;
    // the file is covered because its reflection loop floors.)
    const { execSync } = await import('child_process');
    const files = execSync(`grep -rln "work_entities" app lib components --include='*.ts' --include='*.tsx' || true`, { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean)
      .filter((f) => /select\([^)]*\bstate\b/.test(src(f)) && /(st|state|State)\)?\??\.(summary|blocking|whoOwes)|\.state\??\.(summary|blocking|whoOwes)/.test(src(f)));
    const unfloored = files.filter((f) => f !== 'lib/entities/state.ts' && !/floorEntityRows\(|serveEntityState\(/.test(code(f)));
    gate(`D4 every reader of the stored state prose passes the floor — ${files.length} readers, none unfloored`, files.length >= 15 && unfloored.length === 0, unfloored.join(', '));
    const heads = code('lib/entities/state.ts');
    gate('D5 the many-entity floor reads the ledger heads batched + paged (entity_links → items → closed/open lines), never a per-entity assembleLedger',
      /export async function loadLedgerHeads\(/.test(heads) && /fetchAllRows<Link>/.test(heads) && /export async function floorEntityRows</.test(heads));
    {
      const { floorEntityRowWith } = await import('../lib/entities/state');
      const row = { id: 'e1', name: 'Acme', state: { summary: 'You promised your RIB by Sep 18. Nine days overdue.', blocking: 'Your RIB stops the Acme payment.', stage: 'payment blocked, awaiting RIB', whoOwes: { you: ['send your RIB'], them: [] } }, next_move: { title: 'Send the RIB to Sam' } };
      const f = floorEntityRowWith(row, [{ text: 'Send RIB for Acme pilot payment (handled)' }, { text: 'you owe: Identify repetitive task' }]) as typeof row & { state: Record<string, unknown> };
      gate('D6 a floored ROW (the shape every reader consumes): the settled RIB claim leaves summary · blocking · stage · whoOwes · next move',
        !/RIB/.test(String(f.state.summary ?? '')) && f.state.blocking === null && f.state.stage === null
        && (f.state.whoOwes as { you: string[] }).you.length === 0 && f.next_move === null, JSON.stringify(f));
    }
  }

  // ═══ E · THE REPAIR'S CENSUS FILTER ═══
  console.log('\nE · the repair census (dry-run heuristic)');
  gate('E1 a promise-only reply (no attachment, a later-marker + a first-person send) is listed — FR, EN, PT, DE',
    replyLooksPromised(PROMISE, null) && replyLooksPromised('I\'ll send the deck next week.', 0)
    && replyLooksPromised('Vou enviar o relatório na próxima semana.', null) && replyLooksPromised('Ich schicke dir die Unterlagen nächste Woche.', null));
  gate('E2 a delivery (an attachment) or a plain answer is not', !replyLooksPromised('I\'ll send more next week, here it is.', 2) && !replyLooksPromised('Thursday works for me.', null));
  const rep = src('scripts/repair-reply-closed-deliverables.ts');
  gate('E3 the repair is dry-run by default; --apply needs --yes and restores through THE ONE restore flip + records through the resolver\'s recorder',
    /const APPLY = argv\.includes\('--apply'\);/.test(rep) && /--apply requires --yes/.test(rep) && /reopenInboxItem\(sb, userId, item\.id/.test(rep)
    && /recordPromiseCommitment\(sb, userId/.test(rep) && /KNOWN_CASE_PREFIX = 'c24e47ed'/.test(rep));

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
