/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — A PROMISE IS QUOTED OR IT ISN'T A PROMISE (stabilization W15.4 — docs/laws-registry.md
 * `a-promise-is-quoted`).
 *
 * Found live (owner, Sep 24): "why items on my sent emails?" — a you_owe was minted from the user's
 * own sent reply whose words read as a pitch ("Want me to send over a concrete example?"), and the item
 * never said WHY it existed. The law: every extracted commitment carries the exact words of its
 * source that make it, code-checked against the message's OWN words (the conversation delta's
 * `quoteInText`); no verifiable quote → no commitment; a user-authored you_owe must be judged an
 * explicit first-person commitment; the quote is served by the one source reader.
 *
 * ZERO AI, ZERO NETWORK: an in-memory table client. Exit 1 on any failure.
 *   npx tsx scripts/smoke-promise-quotes.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import {
  promiseQuoteFloor, missingQuoteColumn, writeCommitments, writeMeetingCommitments,
  COMMITMENT_EXTRACTION_VERSION, QUOTE_MAX_CHARS,
} from '../lib/commitments/extract';
import { sourceQuoteFrom, sourceQuoteOf, emailSourceFromRow } from '../lib/commitments/source';
import { topMessageOf } from '../lib/inbox/top-message';
import {
  firstPersonPromiseProxy, judgeVerdict, guardClient, buildPromiseJudgePrompt, UNQUOTED_PROMISE_REASON,
} from './repair-unquoted-promises';

const ROOT = process.cwd();
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── a permissive in-memory table client (eq · in · neq honoured; every other filter a no-op) ──────
type Tables = Record<string, Array<Record<string, unknown>>>;
function fakeClient(tables: Tables, opts: { quoteColumn?: boolean; failSelect?: string } = {}) {
  const inserts: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];
  let seq = 0;
  const from = (table: string) => {
    const st = { op: 'select', patch: null as unknown, filters: [] as Array<[string, string, unknown]>, single: false, cols: '' };
    const run = () => {
      if (st.op === 'select' && opts.failSelect && table === opts.failSelect && /source_quote/.test(st.cols)) {
        return { data: null, error: { message: 'column commitments.source_quote does not exist', code: '42703' } };
      }
      const rows = (tables[table] ??= []).filter((r) => st.filters.every(([op, c, v]) =>
        op === 'eq' ? r[c] === v : op === 'in' ? (v as unknown[]).includes(r[c]) : op === 'neq' ? r[c] !== v : true));
      if (st.op === 'insert') {
        const list = (Array.isArray(st.patch) ? st.patch : [st.patch]) as Array<Record<string, unknown>>;
        if (opts.quoteColumn === false && list.some((r) => 'source_quote' in r)) {
          return { data: null, error: { message: "Could not find the 'source_quote' column of 'commitments' in the schema cache", code: 'PGRST204' } };
        }
        const made = list.map((r) => ({ id: `new-${++seq}`, ...r }));
        tables[table].push(...made);
        inserts.push({ table, rows: made });
        return { data: made, error: null };
      }
      if (st.op === 'update') { rows.forEach((r) => Object.assign(r, st.patch as object)); return { data: rows.map((r) => ({ id: r.id })), error: null }; }
      return { data: st.single ? rows[0] ?? null : rows, error: null };
    };
    const q: Record<string, unknown> = {};
    const self = () => q;
    Object.assign(q, {
      select: (c?: string) => { if (typeof c === 'string') st.cols = c; return q; },
      order: self, limit: self, range: self, gt: self, gte: self, lt: self, lte: self, ilike: self, or: self, not: self, is: self, contains: self, filter: self, match: self,
      update: (p: unknown) => { st.op = 'update'; st.patch = p; return q; },
      insert: (p: unknown) => { st.op = 'insert'; st.patch = p; return q; },
      upsert: () => q, delete: () => q,
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return q; },
      in: (c: string, v: unknown) => { st.filters.push(['in', c, v]); return q; },
      neq: (c: string, v: unknown) => { st.filters.push(['neq', c, v]); return q; },
      maybeSingle: () => { st.single = true; return q; },
      single: () => { st.single = true; return q; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
    });
    return q;
  };
  return { client: { from } as never, inserts, tables };
}

const INBOUND = 'Hi — could you send the signed contract by Friday? We will share the onboarding checklist next week.\n\nOn Mon, Sep 14, 2026, Sam <sam@acme.test> wrote:\n> Please also review the pricing annex.';
const PITCH = 'Hi Sam,\n\nThat is exactly the gap our workspace is built for — each client keeps its own context.\n\nWant me to send over a concrete example?\n\nBest regards,\nJordan';
const PROMISE = 'Hi Sam,\n\nThanks for the call. I’ll send the revised proposal by Thursday. Could you share the usage figures?\n\nBest,\nJordan';

(async () => {
  // ── Q · THE QUOTE FLOOR (pure) ────────────────────────────────────────────────────────────────
  console.log('Q · the quote floor');
  const own = topMessageOf(INBOUND);
  ok('Q1 no quote → no commitment', !promiseQuoteFloor({ direction: 'you_owe' }, { ownWords: own, authoredByUser: false }).keep);
  const q2 = promiseQuoteFloor({ direction: 'you_owe', quote: 'the contract is needed soon' }, { ownWords: own, authoredByUser: false });
  ok('Q2 a paraphrase is not the message\'s words → no commitment', !q2.keep && q2.reason === 'quote-not-in-own-words');
  const q3 = promiseQuoteFloor({ direction: 'you_owe', quote: 'Please also review the pricing annex' }, { ownWords: own, authoredByUser: false });
  ok('Q3 a quote found only in the QUOTED CHAIN is not this message\'s own words → no commitment', !q3.keep && q3.reason === 'quote-not-in-own-words');
  const q4 = promiseQuoteFloor({ direction: 'you_owe', quote: '“COULD YOU send the  signed contract by Friday?”' }, { ownWords: own, authoredByUser: false });
  ok('Q4 case / curly-quote / whitespace insensitive; wrapping marks trimmed', q4.keep && q4.quote === 'COULD YOU send the  signed contract by Friday?');
  const q5 = promiseQuoteFloor({ direction: 'you_owe', quote: 'vou enviar a proposta amanha' }, { ownWords: 'Olá Sam, vou enviar a proposta amanhã sem falta.', authoredByUser: true }).keep === false;
  ok('Q5 USER-AUTHORED you_owe without the explicit-promise judgment → no commitment (even when the quote is found)', q5);
  ok('Q6 USER-AUTHORED you_owe judged an explicit first-person promise, accent-insensitive quote → kept',
    promiseQuoteFloor({ direction: 'you_owe', quote: 'vou enviar a proposta amanha', explicit_promise: true }, { ownWords: 'Olá Sam, vou enviar a proposta amanhã sem falta.', authoredByUser: true }).keep);
  ok('Q7 USER-AUTHORED awaiting (the user\'s own ask) needs its quote, not a first-person promise',
    promiseQuoteFloor({ direction: 'awaiting', quote: 'Could you share the usage figures?' }, { ownWords: topMessageOf(PROMISE), authoredByUser: true }).keep);
  ok('Q8 an inbound ask (you_owe) needs its quote only — the first-person rule is the user\'s own mail',
    promiseQuoteFloor({ direction: 'you_owe', quote: 'could you send the signed contract by Friday' }, { ownWords: own, authoredByUser: false }).keep);
  ok('Q9 a quote under 6 characters proves nothing', !promiseQuoteFloor({ direction: 'you_owe', quote: 'send' }, { ownWords: own, authoredByUser: false }).keep);
  ok('Q10 the kept quote never exceeds the stored budget', (() => { const long = 'a'.repeat(390); const v = promiseQuoteFloor({ direction: 'awaiting', quote: long }, { ownWords: long, authoredByUser: false }); return v.keep && v.quote.length <= QUOTE_MAX_CHARS; })());

  // ── W · THE WRITE DOOR (writeCommitments) ─────────────────────────────────────────────────────
  console.log('W · the write door');
  {
    const t = fakeClient({ commitments: [], inbox_items: [] });
    await writeCommitments('u', [
      { direction: 'you_owe', doer: 'user', description: 'Send the signed contract', counterparty: 'Sam Rivera', quote: 'could you send the signed contract by Friday?' },
      { direction: 'awaiting', doer: 'Dana Lee', description: 'Share the onboarding checklist', counterparty: 'Dana Lee' },
      { direction: 'you_owe', doer: 'user', description: 'Review the pricing annex', counterparty: 'Kim Park', quote: 'Please also review the pricing annex' },
    ], { source: 'email', sourceId: 'e1', threadId: 't1', counterparty: 'sam@acme.test', sourceText: INBOUND, message: { text: topMessageOf(INBOUND), authoredByUser: false } }, t.client);
    const rows = t.tables.commitments;
    ok('W1 inbound: only the quoted candidate is written; the unquoted one and the quoted-chain one are not', rows.length === 1 && rows[0].description === 'Send the signed contract', `${rows.length} rows`);
    ok('W2 the written row carries its verified quote (source_quote)', rows[0]?.source_quote === 'could you send the signed contract by Friday?');
  }
  {
    const t = fakeClient({ commitments: [], inbox_items: [] });
    await writeCommitments('u', [
      { direction: 'you_owe', doer: 'user', description: 'Send a concrete example of the workspace setup', counterparty: 'Sam Rivera', quote: 'Want me to send over a concrete example?', explicit_promise: false },
    ], { source: 'email', sourceId: 'e2', threadId: 't2', counterparty: 'sam@acme.test', sourceText: PITCH, message: { text: topMessageOf(PITCH), authoredByUser: true } }, t.client);
    ok('W3 THE OWNER\'S CASE: a pitch in the user\'s own sent reply ("Want me to send over…?") mints nothing', t.tables.commitments.length === 0);
  }
  {
    const t = fakeClient({ commitments: [], inbox_items: [] });
    await writeCommitments('u', [
      { direction: 'you_owe', doer: 'user', description: 'Send the revised proposal', counterparty: 'Sam Rivera', quote: 'I’ll send the revised proposal by Thursday.', explicit_promise: true },
      { direction: 'awaiting', doer: 'Sam Rivera', description: 'Share the usage figures', counterparty: 'Sam Rivera', quote: 'Could you share the usage figures?' },
    ], { source: 'email', sourceId: 'e3', threadId: 't3', counterparty: 'sam@acme.test', sourceText: PROMISE, message: { text: topMessageOf(PROMISE), authoredByUser: true } }, t.client);
    const rows = t.tables.commitments;
    ok('W4 the user\'s explicit first-person promise AND their own quoted ask both land, each with its quote',
      rows.length === 2 && rows.some((r) => r.direction === 'you_owe' && r.source_quote === 'I’ll send the revised proposal by Thursday.') && rows.some((r) => r.direction === 'awaiting' && r.source_quote === 'Could you share the usage figures?'), JSON.stringify(rows.map((r) => [r.direction, r.source_quote])));
  }
  {
    const t = fakeClient({ commitments: [], inbox_items: [] }, { quoteColumn: false });
    await writeCommitments('u', [
      { direction: 'you_owe', doer: 'user', description: 'Send the signed contract', counterparty: 'Sam Rivera', quote: 'could you send the signed contract by Friday?' },
    ], { source: 'email', sourceId: 'e4', threadId: 't4', counterparty: 'sam@acme.test', sourceText: INBOUND, message: { text: topMessageOf(INBOUND), authoredByUser: false } }, t.client);
    ok('W5 BEFORE THE MIGRATION: the missing source_quote column → the same row lands without it (the floor already ran)',
      t.tables.commitments.length === 1 && !('source_quote' in t.tables.commitments[0]));
    ok('W6 the column-missing detector knows both PostgREST and Postgres shapes, and nothing else',
      missingQuoteColumn({ message: "Could not find the 'source_quote' column of 'commitments' in the schema cache", code: 'PGRST204' })
      && missingQuoteColumn({ message: 'column "source_quote" of relation "commitments" does not exist', code: '42703' })
      && !missingQuoteColumn({ message: 'duplicate key value violates unique constraint', code: '23505' }) && !missingQuoteColumn(null));
  }
  {
    const t = fakeClient({ commitments: [], inbox_items: [], meeting_transcripts: [] });
    const transcript = '[Sam]: I can take the security questionnaire and get it back to you by Friday.\n[Jordan]: Great, and we will book the follow-up workshop.';
    await writeMeetingCommitments('u', [
      { action: 'Book the follow-up workshop', isUserTask: true, quote: 'we will book the follow-up workshop' },
      { action: 'Return the security questionnaire', assignee: 'Sam Rivera', isUserTask: false, quote: 'Sam will send the questionnaire soon' },
    ], { transcriptId: 'm1', transcriptText: transcript }, t.client);
    const rows = t.tables.commitments;
    ok('W7 MEETING with its transcript: a quoted meeting line lands (suggested, with its quote); a paraphrased "quote" does not',
      rows.length === 1 && rows[0].description === 'Book the follow-up workshop' && rows[0].status === 'suggested' && rows[0].source_quote === 'we will book the follow-up workshop', JSON.stringify(rows.map((r) => r.description)));
  }
  {
    const t = fakeClient({ commitments: [], inbox_items: [], meeting_transcripts: [] });
    await writeMeetingCommitments('u', [
      { action: 'Book the follow-up workshop', isUserTask: true },
    ], { transcriptId: 'm2' }, t.client);
    ok('W8 MEETING legacy caller (no transcript handed): lands SUGGESTED (the review gate), unquoted — counted, never passed off as quoted',
      t.tables.commitments.length === 1 && t.tables.commitments[0].status === 'suggested' && t.tables.commitments[0].source_quote === null);
  }

  // ── P · THE PROMPT + THE DOOR (source) ────────────────────────────────────────────────────────
  console.log('P · the prompt and the door');
  const ex = code('lib/commitments/extract.ts');
  const wc = ex.slice(ex.indexOf('export async function writeCommitments'), ex.indexOf('export function soleCounterpartOf'));
  const entry = ex.slice(ex.indexOf('export async function extractEmailCommitments'));
  ok('P1 the quote floor runs INSIDE the one write door, after the direction floor and before any dedup/insert',
    wc.indexOf('promiseQuoteFloor(') > wc.indexOf('directionFloor(') && wc.indexOf('promiseQuoteFloor(') < wc.indexOf("from('commitments')"));
  ok('P2 mail is checked against the message\'s OWN words (topMessageOf), never the quoted chain', /meta\.message\?\.text \?\? \(meta\.sourceText \? topMessageOf\(meta\.sourceText\)/.test(wc));
  ok('P3 the floor reuses the conversation delta\'s quote checker (one checker, no second copy)',
    /import \{[^}]*\bquoteInText\b[^}]*\} from '@\/lib\/work\/conversation-delta'/.test(ex) && /quoteInText\(quote,/.test(ex) && !/function quoteInText/.test(ex));
  ok('P4 the extraction prompt asks for a verbatim quote + explicit_promise, states THE PROMISE LAW for user-authored mail, and its output shape carries both',
    /quote — THE QUOTE LAW/.test(entry) && /THE PROMISE LAW/.test(entry) && /"quote":"the exact words from this message","explicit_promise":true/.test(entry) && /A pitch, a description of what a product/.test(entry));
  ok('P5 the dropped candidates are LOGGED and COUNTED by reason', /\[commitments\] quote floor v\$\{COMMITMENT_EXTRACTION_VERSION\}/.test(wc) && /quoteFloor\[v\.reason\]\+\+/.test(wc));
  ok('P6 the writer retries WITHOUT the quote only on the missing-column error (code works before the migration)', /if \(error && missingQuoteColumn\(error\)\)/.test(wc));
  ok('P7 the prompt version is registered (lib/core/versions.ts) and is ≥ 2', COMMITMENT_EXTRACTION_VERSION >= 2 && /export \{ COMMITMENT_EXTRACTION_VERSION \} from '@\/lib\/commitments\/extract'/.test(src('lib/core/versions.ts')));
  ok('P8 the migration exists, additive and idempotent', existsSync(join(ROOT, 'supabase/migrations/20260924_commitment_source_quote.sql'))
    && /ALTER TABLE commitments ADD COLUMN IF NOT EXISTS source_quote TEXT;/.test(src('supabase/migrations/20260924_commitment_source_quote.sql')));

  // ── S · THE SOURCE READER SERVES WHY ─────────────────────────────────────────────────────────
  console.log('S · the source reader');
  const s1 = sourceQuoteFrom({ quote: 'I’ll send the revised proposal by Thursday.', source: 'email', direction: 'you_owe', authoredByUser: true, from: 'Jordan' });
  ok('S1 the user\'s own mail → "You wrote"', s1?.by === 'user' && s1.lead === 'You wrote' && s1.line === 'You wrote: “I’ll send the revised proposal by Thursday.”');
  const s2 = sourceQuoteFrom({ quote: 'could you send the signed contract by Friday?', source: 'email', direction: 'you_owe', authoredByUser: false, from: 'Sam Rivera' });
  ok('S2 an inbound ask → "<Name> asked"', s2?.by === 'other' && s2.lead === 'Sam Rivera asked' && s2.name === 'Sam Rivera');
  const s3 = sourceQuoteFrom({ quote: 'We will share the onboarding checklist', source: 'email', direction: 'awaiting', authoredByUser: false, from: null, counterparty: 'Dana Lee <dana@acme.test>' });
  ok('S3 an inbound promise (awaiting) → "<Name> wrote" (the address stripped)', s3?.lead === 'Dana Lee wrote');
  ok('S4 a meeting line → "Said in the meeting"; no quote → null (a pre-W15.4 row renders nothing)',
    sourceQuoteFrom({ quote: 'we will book the workshop', source: 'meeting', direction: 'you_owe' })?.lead === 'Said in the meeting' && sourceQuoteFrom({ quote: '  ', source: 'email', direction: 'you_owe' }) === null);
  {
    const t = fakeClient({
      commitments: [{ id: 'c1', user_id: 'u', source_quote: 'could you send the signed contract by Friday?', source: 'email', source_id: 'e1', direction: 'you_owe', counterparty: 'Sam Rivera' }],
      emails: [{ id: 'e1', user_id: 'u', is_from_user: false, from_name: 'Sam Rivera', from_address: 'sam@acme.test' }],
    });
    const q = await sourceQuoteOf(t.client as never, 'u', 'c1');
    ok('S5 sourceQuoteOf reads the row + its source message\'s author (user-scoped) and serves the line', q?.line === 'Sam Rivera asked: “could you send the signed contract by Friday?”', JSON.stringify(q));
    const other = await sourceQuoteOf(t.client as never, 'someone-else', 'c1');
    ok('S6 another user\'s commitment serves nothing', other === null);
  }
  {
    const t = fakeClient({ commitments: [{ id: 'c1', user_id: 'u', source: 'email', direction: 'you_owe' }] }, { failSelect: 'commitments' });
    ok('S7 BEFORE THE MIGRATION the reader answers null (an error is no quote, never a broken read)', (await sourceQuoteOf(t.client as never, 'u', 'c1')) === null);
  }
  ok('S8 the email source carries its authorship (the quote\'s lead reads it)',
    emailSourceFromRow({ id: 'e1', body: 'x', is_from_user: true }, (b) => b)?.authoredByUser === true && emailSourceFromRow({ id: 'e1', body: 'x' }, (b) => b)?.authoredByUser === false);
  const so = code('lib/commitments/source.ts');
  ok('S9 the reader is an explicit, user-scoped select with its error checked', /select\('id, source_quote, source, source_id, direction, counterparty'\)[\s\S]{0,80}\.eq\('id', commitmentId\)\.eq\('user_id', userId\)/.test(so) && /if \(error \|\| !c \|\| !c\.source_quote\) return null;/.test(so));

  // ── R · THE REPAIR IS GUARDED ─────────────────────────────────────────────────────────────────
  console.log('R · the repair');
  const rp = code('scripts/repair-unquoted-promises.ts');
  ok('R1 dry run by default: every non-apply run reads through the write-refusing guard', /const sb = APPLY \? raw : guardClient\(raw, refused\);/.test(rp));
  ok('R2 --apply needs --judge (never dismissed by the zero-AI proxy) and --yes (owner-gated)', /if \(APPLY && !JUDGE\)/.test(rp) && /if \(APPLY && !YES\)/.test(rp));
  ok('R3 a dismissal is a conditional flip (still open, still you_owe) stamped unquoted_promise + a REVERSIBLE activity row',
    UNQUOTED_PROMISE_REASON === 'unquoted_promise' && /resolved_reason: UNQUOTED_PROMISE_REASON[\s\S]{0,200}\.eq\('status', 'open'\)\.eq\('direction', 'you_owe'\)/.test(rp) && /type: 'commitment_dismissed'/.test(rp));
  ok('R4 the judge runs THE SAME floor the write door runs; an unparseable answer keeps the row',
    judgeVerdict('{"quote":"I’ll send the revised proposal by Thursday.","explicit_promise":true}', topMessageOf(PROMISE))?.keep === true
    && judgeVerdict('{"quote":"Want me to send over a concrete example?","explicit_promise":false}', topMessageOf(PITCH))?.keep === false
    && judgeVerdict('{"quote":null,"explicit_promise":false}', topMessageOf(PITCH))?.keep === false
    && judgeVerdict('not json', topMessageOf(PITCH)) === null);
  ok('R5 the judge goes through the factory (classification tier) with the cut declared', /getAIClient\(uid, 'classification'/.test(rp) && /EXCERPT_RULE/.test(rp) && /clipForPrompt\(ownWords, JUDGE_MESSAGE_CHARS\)/.test(rp) && !/\.slice\(0, \d+\)\}"""/.test(rp));
  ok('R6 the listing pages (NO SILENT CAPS) and --limit reports what it left behind', /fetchAllRows<Row>/.test(rp) && /leftByLimit/.test(rp));
  {
    const refused: string[] = [];
    const g = guardClient({ from: () => ({ update: () => 'wrote', select: () => 'read' }) } as never, refused) as unknown as { from: (t: string) => { update: () => unknown; select: () => unknown } };
    let threw = false; try { g.from('commitments').update(); } catch { threw = true; }
    ok('R7 the guard refuses a write and records it; a read passes', threw && refused[0] === 'update:commitments' && g.from('commitments').select() === 'read');
  }
  ok('R8 the zero-AI proxy is a CENSUS signal only — no production module imports it', (() => {
    const hits = execSync("grep -rl 'firstPersonPromiseProxy' lib app components || true", { cwd: ROOT }).toString().trim();
    return hits === '' && firstPersonPromiseProxy(PROMISE) && !firstPersonPromiseProxy(PITCH);
  })());
  ok('R9 the judge prompt carries the law and the title', /THE PROMISE LAW/.test(buildPromiseJudgePrompt('Send the deck', 'x', null)) && /you owe: Send the deck/.test(buildPromiseJudgePrompt('Send the deck', 'x', null)));

  // ── J · THE LAW IS REGISTERED ─────────────────────────────────────────────────────────────────
  console.log('J · the registry');
  const reg = JSON.parse(src('docs/laws-registry.json')) as { laws: Array<{ id: string; gates: Array<{ suite: string }> }> };
  const law = reg.laws.find((l) => l.id === 'a-promise-is-quoted');
  ok('J1 a-promise-is-quoted is registered and gated by this suite', !!law && law.gates.some((g) => g.suite === 'smoke-promise-quotes'));
  ok('J2 the rendered registry carries it', src('docs/laws-registry.md').includes('`a-promise-is-quoted`'));
  ok('J3 the gate rides the board before smoke-laws', (() => { const b = src('package.json'); const i = b.indexOf('scripts/smoke-promise-quotes.ts'); const j = b.indexOf('scripts/smoke-laws.ts'); return i > 0 && j > i; })());

  console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
