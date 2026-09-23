/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — ONE CONVERSATION, ONE LIVE ITEM (stabilization W8.2 — docs/laws-registry.md
 * `one-conversation-one-live-item`).
 *
 * Found live (owner account, read-only census, Sep 23): one client conversation held ~20 open
 * commitments accumulated message by message; one person under two name forms; a counterparty filed
 * as a bare address; a commitment due two days BEFORE the email it came from. The law: a new message
 * on a conversation that holds open work is read AGAINST that work (lib/work/conversation-delta.ts),
 * and the extraction writer floors the due date and folds the counterparty.
 *
 * W9.4 EXTRACTION IS REASONED, NOT KEYWORD-GATED (section K): the delta always runs when the
 * conversation holds open work; NEW extraction is gated by understanding / authorship / a meeting
 * source, the kind floor skips noise — an English keyword list is never the sole gate.
 *
 * ZERO AI, ZERO NETWORK: a stubbed judge + an in-memory table client. Exit 1 on any failure.
 *   npx tsx scripts/smoke-conversation-delta.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  quoteInText, validateDelta, judgeConversationDelta, applyDeltaPlan, conversationDelta, buildDeltaPrompt,
  type DeltaInput, type DeltaOpenItem, type ApplyDeps,
} from '../lib/work/conversation-delta';
import { dueFloorAgainstSource, foldCounterparty, nameFormsAgree, extractionGate, extractEmailCommitments, NOISE_MAIL_KINDS } from '../lib/commitments/extract';
import type { FulfillmentJudgment } from '../lib/commitments/fulfillment';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── an in-memory table client (select / update / insert with eq · in · neq filters) ──────────────
type Tables = Record<string, Array<Record<string, unknown>>>;
function fakeClient(tables: Tables) {
  const writes: Array<{ table: string; op: string; patch: unknown; ids: unknown[] }> = [];
  let seq = 0;
  const from = (table: string) => {
    const st = { op: 'select', patch: null as unknown, filters: [] as Array<[string, string, unknown]>, single: false };
    const run = () => {
      const rows = (tables[table] ??= []).filter((r) => st.filters.every(([op, c, v]) =>
        op === 'eq' ? r[c] === v : op === 'in' ? (v as unknown[]).includes(r[c]) : op === 'neq' ? r[c] !== v : true));
      if (st.op === 'update') {
        rows.forEach((r) => Object.assign(r, st.patch as object));
        writes.push({ table, op: 'update', patch: st.patch, ids: rows.map((r) => r.id) });
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }
      if (st.op === 'insert') {
        const list = (Array.isArray(st.patch) ? st.patch : [st.patch]) as Array<Record<string, unknown>>;
        const made = list.map((r) => ({ id: `new-${++seq}`, ...r }));
        tables[table].push(...made);
        writes.push({ table, op: 'insert', patch: st.patch, ids: made.map((r) => r.id) });
        return { data: made, error: null };
      }
      return { data: st.single ? rows[0] ?? null : rows, error: null };
    };
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q, order: () => q, limit: () => q, range: () => q, gt: () => q,
      update: (p: unknown) => { st.op = 'update'; st.patch = p; return q; },
      insert: (p: unknown) => { st.op = 'insert'; st.patch = p; return q; },
      upsert: () => q,
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return q; },
      in: (c: string, v: unknown) => { st.filters.push(['in', c, v]); return q; },
      neq: (c: string, v: unknown) => { st.filters.push(['neq', c, v]); return q; },
      maybeSingle: () => { st.single = true; return q; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
    });
    return q;
  };
  return { client: { from } as never, writes, tables };
}

const baseOpen = (): Array<Record<string, unknown>> => [
  { id: 'a1', user_id: 'u', description: 'Send the interim report', direction: 'you_owe', counterparty: 'Sam Rivera', due_date: null, created_at: '2026-08-03T10:00:00Z', status: 'open', thread_id: null, source_id: 'e1' },
  { id: 'a2', user_id: 'u', description: 'Confirm pricing for the pilot', direction: 'you_owe', counterparty: 'Sam Rivera', due_date: null, created_at: '2026-08-05T10:00:00Z', status: 'open', thread_id: null, source_id: 'e2' },
  { id: 'a3', user_id: 'u', description: 'Prepare the kickoff agenda', direction: 'you_owe', counterparty: 'Sam Rivera', due_date: null, created_at: '2026-08-06T10:00:00Z', status: 'open', thread_id: null, source_id: 'e3' },
];
const asOpen = (rows: Array<Record<string, unknown>>): DeltaOpenItem[] => rows.map((r) => ({
  id: String(r.id), description: String(r.description), direction: r.direction as string, counterparty: r.counterparty as string,
  due_date: (r.due_date as string | null) ?? null, created_at: r.created_at as string, status: String(r.status),
}));
const MSG = { kind: 'email' as const, id: 'e9', text: 'Hi Sam — attached is the interim report. We decided to drop the pilot, so no need to confirm pricing. The kickoff agenda will now be replaced by a workshop plan.', at: '2026-09-15T09:00:00Z', authoredByUser: true, subject: 'Update' };
const activity: Array<{ type: string; entityId?: string | null; metadata?: Record<string, unknown> }> = [];
const deps = (verdict: FulfillmentJudgment['verdict'] | 'throw'): ApplyDeps & { judged: number } => {
  const d = {
    judged: 0,
    judgeFulfillment: (async () => {
      d.judged++;
      if (verdict === 'throw') throw new Error('outage');
      return { verdict, reason: 'stub', cached: false, fresh: true, ...(verdict === 'delivered' ? { by: { type: 'email', id: 'e9', at: MSG.at } } : {}) };
    }) as unknown as ApplyDeps['judgeFulfillment'],
    afterSettle: async () => {},
    logActivity: (async (_c: unknown, _u: string, i: { type: string; entityId?: string | null; metadata?: Record<string, unknown> }) => { activity.push(i); return true; }) as unknown as ApplyDeps['logActivity'],
  };
  return d;
};

(async () => {
  // ── A · THE QUOTE LAW ─────────────────────────────────────────────────────────────────────────
  console.log('A · the quote law');
  ok('A1 a verbatim span passes (accent/case/space-folded)', quoteInText('ATTACHED is the interim  report', MSG.text));
  ok('A2 a paraphrase is refused', !quoteInText('the report is attached', MSG.text));
  ok('A3 a fragment under 6 chars proves nothing', !quoteInText('the', MSG.text));
  const input = (): DeltaInput => ({ open: asOpen(baseOpen()), candidates: [{ description: 'Draft the workshop plan', direction: 'you_owe', counterparty: 'Sam Rivera' }], message: MSG, todayIso: '2026-09-23' });
  const noQuote = validateDelta({ open: [{ id: 'C2', verdict: 'moot', quote: 'pricing is irrelevant now' }] }, input());
  ok('A4 a disposition whose quote is not in the message → keep', noQuote.items[1].action === 'keep' && noQuote.downgraded.length === 1);

  // ── B · DELIVERED NEVER CLOSES WITHOUT THE FULFILLMENT JUDGE ──────────────────────────────────
  console.log('B · delivered is a nomination');
  const delivPlan = validateDelta({ open: [{ id: 'C1', verdict: 'delivered', quote: 'attached is the interim report' }] }, input());
  ok('B1 a quoted delivered survives validation as a NOMINATION', delivPlan.items[0].action === 'delivered');
  for (const v of ['promised', 'unclear', 'throw'] as const) {
    const t = fakeClient({ commitments: baseOpen() });
    const d = deps(v);
    const rep = await applyDeltaPlan(t.client, 'u', { plan: delivPlan, open: asOpen(baseOpen()), candidates: [], message: MSG }, d);
    ok(`B2 judge says ${v} → the row stays open (judge consulted ${d.judged}×)`, d.judged === 1 && t.tables.commitments[0].status === 'open' && rep.deliveredClosed === 0);
  }
  {
    const t = fakeClient({ commitments: baseOpen() });
    const d = deps('delivered');
    const rep = await applyDeltaPlan(t.client, 'u', { plan: delivPlan, open: asOpen(baseOpen()), candidates: [], message: MSG }, d);
    const row = t.tables.commitments[0];
    ok('B3 only a JUDGED delivery closes — stamped evidence:email at the message time', rep.deliveredClosed === 1 && row.status === 'done' && row.resolved_reason === 'evidence:email' && row.resolved_at === new Date(MSG.at).toISOString());
    const again = await applyDeltaPlan(t.client, 'u', { plan: delivPlan, open: asOpen(baseOpen()), candidates: [], message: MSG }, deps('delivered'));
    ok('B4 exactly once — a second apply finds no live row and closes nothing', again.deliveredClosed === 0);
  }
  const byOther = validateDelta({ open: [{ id: 'C1', verdict: 'delivered', quote: 'attached is the interim report' }] }, { ...input(), message: { ...MSG, authoredByUser: false } });
  ok('B5 a message not written by the debtor never nominates delivery', byOther.items[0].action === 'keep');

  // ── C · SUPERSEDE / MOOT SETTLE THROUGH THE ONE FLIP, LOGGED + UNDOABLE ────────────────────────
  console.log('C · supersede + moot');
  {
    const plan = validateDelta({ open: [
      { id: 'C2', verdict: 'moot', quote: 'no need to confirm pricing' },
      { id: 'C3', verdict: 'superseded', by: 'N1', quote: 'replaced by a workshop plan' },
    ] }, input());
    const t = fakeClient({ commitments: baseOpen() });
    activity.length = 0;
    const rep = await applyDeltaPlan(t.client, 'u', { plan, open: asOpen(baseOpen()), candidates: input().candidates, message: MSG, insertedIds: ['new-77'] }, deps('unclear'));
    const [, r2, r3] = t.tables.commitments;
    ok('C1 moot → dismissed, resolved_reason moot', r2.status === 'dismissed' && r2.resolved_reason === 'moot' && rep.moot === 1);
    ok('C2 superseded by the new candidate → resolved_reason superseded:<its id>', r3.status === 'dismissed' && r3.resolved_reason === 'superseded:new-77' && rep.superseded === 1);
    ok('C3 each settle logs the REVERSIBLE commitment_dismissed type (Undo reopens it)', activity.filter((a) => a.type === 'commitment_dismissed').length === 2);
    const plan2 = validateDelta({ open: [{ id: 'C3', verdict: 'superseded', by: 'N1', quote: 'replaced by a workshop plan' }] }, input());
    const t2 = fakeClient({ commitments: baseOpen() });
    const rep2 = await applyDeltaPlan(t2.client, 'u', { plan: plan2, open: asOpen(baseOpen()), candidates: input().candidates, message: MSG, insertedIds: [null] }, deps('unclear'));
    ok('C4 a replacement that never landed keeps the row', t2.tables.commitments[2].status === 'open' && rep2.superseded === 0);
  }

  // ── D · FAILURE KEEPS EVERYTHING ──────────────────────────────────────────────────────────────
  console.log('D · failure keeps everything');
  const thrown = await judgeConversationDelta(input(), async () => { throw new Error('outage'); });
  ok('D1 a thrown pass → every item kept, every candidate new', thrown.failed && thrown.items.every((i) => i.action === 'keep') && thrown.candidates.every((c) => c.action === 'new'));
  const garbage = await judgeConversationDelta(input(), async () => 'I think C1 is done');
  ok('D2 no JSON → keep everything', garbage.failed && garbage.items.every((i) => i.action === 'keep'));
  let calls = 0;
  await judgeConversationDelta({ ...input(), open: [] }, async () => { calls++; return '{}'; });
  ok('D3 no open work on the conversation → no call', calls === 0);

  // ── E · DUPLICATE_OF FOLDING + THE ONE ENTRY (write mode) ──────────────────────────────────────
  console.log('E · duplicate folding through the one entry');
  {
    const rows = baseOpen().map((r) => ({ ...r, thread_id: 't1' }));
    const t = fakeClient({ commitments: rows, inbox_items: [] });
    const stub = async () => JSON.stringify({ open: [{ id: 'C2', verdict: 'moot', quote: 'no need to confirm pricing' }], new: [{ id: 'N1', verdict: 'duplicate', of: 'C1' }, { id: 'N2', verdict: 'new' }] });
    const d = await conversationDelta(t.client, 'u', {
      key: { kind: 'thread', threadId: 't1', excludeSourceId: 'e9' },
      candidates: [{ description: 'Send over the interim report', direction: 'you_owe' }, { description: 'Draft the workshop plan', direction: 'you_owe' }],
      message: MSG, judge: stub, deps: deps('unclear'),
    });
    ok('E1 a duplicate candidate is not written; the new one is', JSON.stringify(d.writeIndices) === '[1]');
    const rep = await d.settle(['new-5']);
    ok('E2 the settle applies the open-item dispositions', rep.moot === 1 && t.tables.commitments[1].status === 'dismissed');
    const t0 = fakeClient({ commitments: [], inbox_items: [] });
    let called = 0;
    const d0 = await conversationDelta(t0.client, 'u', { key: { kind: 'thread', threadId: 't1' }, candidates: [{ description: 'x y z' }], message: MSG, judge: async () => { called++; return '{}'; } });
    ok('E3 an empty conversation passes every candidate through with no call', called === 0 && d0.writeIndices.length === 1);
    const cross = validateDelta({ new: [{ id: 'N1', verdict: 'duplicate', of: 'C1' }] }, { ...input(), candidates: [{ description: 'Send the interim report', direction: 'awaiting' }] });
    ok('E4 never a duplicate across directions', cross.candidates[0].action === 'new');
  }

  // ── F · THE PROMPT ────────────────────────────────────────────────────────────────────────────
  console.log('F · the prompt');
  const prompt = buildDeltaPrompt(input());
  ok('F1 today is injected by code; the excerpt rule rides; labels, never row ids', prompt.includes('Today is 2026-09-23') && /clipped BY THIS SYSTEM/.test(prompt) && prompt.includes('[C1]') && !prompt.includes('a1'));
  const dm = code('lib/work/conversation-delta.ts');
  ok('F2 the pass rides the factory on the classification tier + aiCreate', /getAIClient\(userId, 'classification', client\)/.test(dm) && /aiCreate\(/.test(dm) && !/new OpenAI|new Anthropic/.test(dm));
  ok('F3 the message excerpt goes through the one clipper', /clipForPrompt\(message\.text/.test(dm));

  // ── G · THE ONE CALL SITE ─────────────────────────────────────────────────────────────────────
  console.log('G · one call site');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (!/node_modules|^\./.test(f)) walk(p, out); } else if (/\.(ts|tsx)$/.test(f)) out.push(p);
    }
    return out;
  };
  const callers = ['lib', 'app', 'components'].flatMap((d) => walk(join(ROOT, d)))
    .filter((f) => !f.endsWith('lib/work/conversation-delta.ts'))
    .filter((f) => /\bconversationDelta\(/.test(readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')))
    .map((f) => f.slice(ROOT.length + 1));
  ok('G1 conversationDelta( is called from lib/commitments/extract.ts only', JSON.stringify(callers) === JSON.stringify(['lib/commitments/extract.ts']), callers.join(', '));
  const ex = code('lib/commitments/extract.ts');
  ok('G2 …exactly once, inside writeCommitments', (ex.match(/\bconversationDelta\(/g) ?? []).length === 1
    && ex.indexOf('conversationDelta(') > ex.indexOf('export async function writeCommitments') && ex.indexOf('conversationDelta(') < ex.indexOf('export function soleCounterpartOf'));
  ok('G3 both the mail and the meeting path land at writeCommitments', (ex.match(/await writeCommitments\(/g) ?? []).length === 2);
  ok('G4 the mail path hands the message\'s OWN words (topMessageOf) + its author', /message: \{ text: topMessageOf\(text\), authoredByUser: isFromUser/.test(ex));
  ok('G5 an empty extraction still reaches the delta (no early return on an empty list)', !/if \(!list\.length\) return 0;/.test(ex) && !/if \(!clean0\.length\) return;/.test(ex));
  ok('G6 delivered routes through the fulfillment judge (fulfillment.ts), never a direct close', /judgeFulfillmentFromEvidence/.test(dm) && /applyFulfillmentVerdict/.test(dm)
    && (dm.match(/status: 'done'/g) ?? []).length === 1 && dm.indexOf("status: 'done'") > dm.indexOf('applyV('));
  ok('G7 every write is a conditional claim on a live status', (dm.match(/\.in\('status', \[\.\.\.LIVE\]\)/g) ?? []).length >= 5);

  // ── H · EXTRACTION TRUTH FLOORS ───────────────────────────────────────────────────────────────
  console.log('H · extraction truth');
  ok('H1 a due before its own source (Aug 8 from an Aug 10 mail) → null', dueFloorAgainstSource('2026-08-08', '2026-08-10T09:00:00Z', 'Share updated report').due === null);
  ok('H2 a title naming that past date → no commitment', dueFloorAgainstSource('2026-08-08', '2026-08-10T09:00:00Z', 'Attend the August 8 review').drop);
  ok('H3 a due on/after its source stands', dueFloorAgainstSource('2026-08-12', '2026-08-10T09:00:00Z', 'x').due === '2026-08-12');
  ok('H4 the writer floors every row it writes', /dueFloorAgainstSource\(due, meta\.anchorAt/.test(ex) && /filter\(\(d\) => !d\.drop\)/.test(ex));
  ok('H5 accent + short-surname forms fold to one human', nameFormsAgree('Zoe Costa', 'Zoé Maria Costa') && foldCounterparty('Zoe Costa', [{ name: 'Zoé Maria Costa', aliases: [] }]) === 'Zoé Maria Costa');
  ok('H6 a bare address resolves to its person\'s name', foldCounterparty('sam.rivera@acme.test', [], ['Sam Rivera']) === 'Sam Rivera');
  ok('H7 ambiguity stays raw (two people share the short form)', foldCounterparty('Dana', [], ['Dana Lee', 'Dana Park']) === 'Dana');
  ok('H8 the writer folds through the registry + the conversation', /foldCounterparty\(rawCp, persons, convForms\)/.test(ex));

  // ── I · THE REPAIR IS GUARDED ─────────────────────────────────────────────────────────────────
  console.log('I · the repair');
  const rp = code('scripts/repair-conversation-hoard.ts');
  ok('I1 dry-run by default; --apply needs --yes', /const APPLY = flag\('--apply'\)/.test(rp) && /if \(APPLY && !YES\)/.test(rp));
  ok('I2 the AI part runs only with --judge (default = census + estimate)', /if \(!JUDGE\) continue;/.test(rp) && /Estimated cost/.test(rp));
  ok('I3 the SAME law: foldCounterparty · dueFloorAgainstSource · judgeConversationDelta · applyDeltaPlan', ['foldCounterparty(', 'dueFloorAgainstSource(', 'judgeConversationDelta(', 'applyDeltaPlan('].every((s) => rp.includes(s)));
  ok('I4 every repair write is conditional on a live status and the value as read', (rp.match(/\.in\('status', \['open', 'suggested'\]\)/g) ?? []).length >= 3 && /\.eq\('counterparty', r\.counterparty\)/.test(rp) && /\.eq\('due_date', r\.due_date\)/.test(rp));
  ok('I5 the repair pages the listing (no silent cap)', /fetchAllRows/.test(rp));

  // ── K · W9.4 EXTRACTION IS REASONED, NOT KEYWORD-GATED ────────────────────────────────────────
  console.log('K · the gate is reasoned, not a keyword list');
  {
    const G = extractionGate;
    const done = G({ source: 'email', text: 'Done, attached.', isFromUser: true });
    ok('K1 "Done, attached." (no keyword, 15 chars) reaches the delta; too short to mint', done.delta && !done.extract && done.basis === 'too-short');
    const de = G({ source: 'email', text: 'Erledigt — anbei der unterschriebene Vertrag, wie besprochen.', isFromUser: false });
    ok('K2 a German delivery with no keyword, understanding not yet landed, user addressed → delta + extraction', de.delta && de.extract && de.basis === 'addressed-unjudged');
    const pt = G({ source: 'email', text: 'Cancelámos a reunião de quinta — já não é preciso preparar a proposta.', isFromUser: false, understanding: { role: 'addressed', relevance: 'awareness', ownership: 'none' } });
    ok('K3 a Portuguese cancellation the understanding calls no-obligation → delta runs, no new extraction', pt.delta && !pt.extract && pt.basis === 'understanding-no-obligation');
    const long = 'Following our conversation earlier, here is where things stand on the pilot.';
    const obligations: Array<[string, Record<string, unknown>]> = [
      ['ownership you_owe', { role: 'addressed', relevance: 'awareness', ownership: 'you_owe' }],
      ['ownership awaiting', { role: 'addressed', relevance: 'awareness', ownership: 'awaiting' }],
      ['relevance action', { role: 'addressed', relevance: 'action', ownership: 'none' }],
      ['relevance reply', { role: 'addressed', relevance: 'reply' }],
      ['an ask', { role: 'addressed', relevance: 'awareness', ask: 'Confirm the slot' }],
      ['a deadline', { role: 'addressed', relevance: 'awareness', deadline: '2026-10-01' }],
    ];
    ok('K4 the understanding (ownership · relevance · ask · deadline) opens extraction', obligations.every(([, u]) => { const g = G({ source: 'email', text: long, isFromUser: false, understanding: u as never }); return g.extract && g.basis === 'understanding'; }));
    const noise = [...NOISE_MAIL_KINDS].map((k) => G({ source: 'email', text: long, isFromUser: false, understanding: { role: 'addressed', relevance: 'action', ownership: 'you_owe', mailKind: k as never } }));
    const bulk = G({ source: 'email', text: long, isFromUser: false, understanding: { role: 'addressed', relevance: 'action', bulk: true } });
    const footer = G({ source: 'email', text: long, isFromUser: false, bulkFooter: true });
    ok('K5 the kind floor: newsletter · receipt · notification · cold outreach · bulk · a broadcast footer never mint (the delta still reads them)', [...noise, bulk, footer].every((g) => !g.extract && g.delta && g.basis === 'noise-kind'));
    ok('K6 a meeting always extracts; a user-authored message extracts with no keyword', G({ source: 'meeting', text: 'Kickoff summary', isFromUser: false }).extract && G({ source: 'email', text: 'Merci Sam, c’est noté de mon côté pour la suite.', isFromUser: true }).basis === 'user-authored');
    ok('K7 our own coworker\'s mail neither mints nor settles', (() => { const g = G({ source: 'email', text: long, isFromUser: false, coworkerSender: true }); return !g.delta && !g.extract; })());
    ok('K8 a campaign echo never mints, but still reaches the delta', (() => { const g = G({ source: 'email', text: long, isFromUser: false, campaignEcho: true }); return g.delta && !g.extract; })());
    const ccNo = G({ source: 'email', text: long, isFromUser: false, ccOnly: true });
    const ccHint = G({ source: 'email', text: 'I will send you the deck by Friday, as agreed.', isFromUser: false, ccOnly: true });
    ok('K9 the keyword list survives only as a SECONDARY hint (CC-only, no understanding) — and even then the delta runs', ccNo.delta && !ccNo.extract && ccHint.extract && ccHint.basis === 'cc-hint');
    const off = [G({ source: 'email', text: long, isFromUser: true, mintNew: false }), G({ source: 'email', text: long, isFromUser: false, understanding: { role: 'addressed', relevance: 'action', ownership: 'you_owe' }, mintNew: false })];
    ok('K18 to-do capture off (mintNew=false) never mints — the delta still runs', off.every((g) => g.delta && !g.extract && g.basis === 'mint-off'));
    const tri = (['noise', 'fyi_only'] as const).map((c) => G({ source: 'email', text: long, isFromUser: false, triage: c }));
    ok('K19 the sync triage class noise / fyi_only never mints (no understanding lands for them) — delta only; process falls through', tri.every((g) => g.delta && !g.extract && g.basis === 'triage-noise') && G({ source: 'email', text: long, isFromUser: false, triage: 'process' }).basis === 'addressed-unjudged');
    const sy = code('lib/email-sync/sync-emails.ts');
    const site = sy.slice(sy.indexOf("_tail.add('extract-inbound'"), sy.indexOf("_tail.add('extract-inbound'") + 1600);
    ok('K20 the sync inbound call site always calls the entry, handing todo_auto as mintNew and the triage class', !/if \(emailSettings\.todo_auto\) \{\s*for \(const \{ storedEmail: _em/.test(sy) && /mintNew: !!emailSettings\.todo_auto/.test(site) && /triage: _cls/.test(site) && /_inboundExtract\.push\(\{ storedEmail, recipientRole: _recipientRole, emailClass \}\)/.test(sy));
    ok('K10 an empty message reaches nothing', (() => { const g = G({ source: 'email', text: '   ', isFromUser: true }); return !g.delta && !g.extract; })());

    // structure: no keyword-only gate remains anywhere on the entry
    const ex2 = code('lib/commitments/extract.ts');
    const entry = ex2.slice(ex2.indexOf('export async function extractEmailCommitments'));
    const gateFn = ex2.slice(ex2.indexOf('export function extractionGate'), ex2.indexOf('export async function understandingForEmail'));
    ok('K11 COMMITMENT_HINT is read ONLY inside extractionGate (declaration + one secondary test)', (ex2.match(/COMMITMENT_HINT/g) ?? []).length === 2 && (gateFn.match(/COMMITMENT_HINT\.test\(/g) ?? []).length === 1);
    ok('K12 the entry asks the gate BEFORE any AI call, and never returns on a keyword', entry.indexOf('extractionGate(') > 0 && entry.indexOf('extractionGate(') < entry.indexOf('getAIClient(') && !/COMMITMENT_HINT/.test(entry));
    ok('K13 writeCommitments is reached for every gated message (not inside the extract branch)', /const list = gate\.extract \? await extractCandidates\(\) : \[\];/.test(entry) && entry.indexOf('await writeCommitments(') < entry.indexOf('async function extractCandidates'));
    ok('K14 the understanding lookup is a JSON-path select (never the body), fresh only for THIS email id', /select\('understanding:source_data->understanding, email_id:source_data->>email_id'\)/.test(ex2) && /r\.email_id === emailId/.test(ex2));

    // end to end through the ONE entry — zero AI: the delta judge is stubbed, extraction is gated off
    const thread = (dir: 'you_owe' | 'awaiting', desc: string) => [{ id: 'k1', user_id: 'u', description: desc, direction: dir, counterparty: 'Sam Rivera', due_date: null, created_at: '2026-09-01T10:00:00Z', status: 'open', thread_id: 'tk', source_id: 'ek0' }];
    {
      const t = fakeClient({ commitments: thread('you_owe', 'Send the interim report'), inbox_items: [] });
      let judged = 0;
      const d = deps('delivered');
      const n = await extractEmailCommitments({
        userId: 'u', subject: 'Re: interim report', body: 'Done, attached.', isFromUser: true, userName: null, counterparty: 'sam@acme.test',
        sourceId: 'ek1', threadId: 'tk', receivedAt: '2026-09-15T09:00:00Z', client: t.client,
        delta: { judge: async () => { judged++; return JSON.stringify({ open: [{ id: 'C1', verdict: 'delivered', quote: 'Done, attached' }] }); }, deps: d },
      });
      ok('K15 "Done, attached." from the user → the delta reads it, the judged delivery closes the open item, nothing new minted', n === 0 && judged === 1 && d.judged === 1 && t.tables.commitments[0].status === 'done' && t.tables.commitments.length === 1);
    }
    {
      const t = fakeClient({ commitments: thread('awaiting', 'Share the signed contract'), inbox_items: [] });
      let judged = 0;
      const d = deps('delivered');
      const n = await extractEmailCommitments({
        userId: 'u', subject: 'Vertrag', body: 'Erledigt — anbei der unterschriebene Vertrag, wie besprochen.', isFromUser: false, userName: null, counterparty: 'sam@acme.test',
        sourceId: 'ek2', threadId: 'tk', receivedAt: '2026-09-15T09:00:00Z', client: t.client,
        understanding: { role: 'addressed', relevance: 'awareness', ownership: 'none' },
        delta: { judge: async () => { judged++; return JSON.stringify({ open: [{ id: 'C1', verdict: 'delivered', quote: 'anbei der unterschriebene Vertrag' }] }); }, deps: d },
      });
      ok('K16 a non-English, keyword-free delivery by the counterparty reaches the delta and settles the awaiting item', n === 0 && judged === 1 && t.tables.commitments[0].status === 'done');
    }
    {
      const t = fakeClient({ commitments: thread('awaiting', 'Share the signed contract'), inbox_items: [] });
      let judged = 0;
      const d = deps('delivered');
      const n = await extractEmailCommitments({
        userId: 'u', subject: 'Vertrag', body: 'Erledigt — anbei der unterschriebene Vertrag, wie besprochen.', isFromUser: false, userName: null, counterparty: 'sam@acme.test',
        sourceId: 'ek4', threadId: 'tk', receivedAt: '2026-09-15T09:00:00Z', client: t.client, triage: 'fyi_only', mintNew: false,
        delta: { judge: async () => { judged++; return JSON.stringify({ open: [{ id: 'C1', verdict: 'delivered', quote: 'anbei der unterschriebene Vertrag' }] }); }, deps: d },
      });
      ok('K21 an FYI-triaged delivery with to-do capture OFF still reaches the delta and settles (no understanding lookup, no AI mint)', n === 0 && judged === 1 && t.tables.commitments[0].status === 'done');
    }
    {
      const t = fakeClient({ commitments: [], inbox_items: [] });
      let judged = 0;
      await extractEmailCommitments({
        userId: 'u', subject: 'Re: x', body: 'Done, attached.', isFromUser: true, userName: null, counterparty: 'sam@acme.test',
        sourceId: 'ek3', threadId: 'tk', client: t.client, delta: { judge: async () => { judged++; return '{}'; } },
      });
      ok('K17 no open work on the conversation → the always-on delta makes no call', judged === 0);
    }
  }

  // ── J · THE LAW IS REGISTERED ─────────────────────────────────────────────────────────────────
  console.log('J · the registry');
  const reg = JSON.parse(src('docs/laws-registry.json')) as { laws: Array<{ id: string; gates: Array<{ suite: string }> }> };
  const law = reg.laws.find((l) => l.id === 'one-conversation-one-live-item');
  ok('J1 one-conversation-one-live-item is registered and gated by this suite', !!law && law.gates.some((g) => g.suite === 'smoke-conversation-delta'));
  ok('J2 the rendered registry carries it', src('docs/laws-registry.md').includes('`one-conversation-one-live-item`'));

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
