/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — ONE READER, ONE ANSWER (stabilization W14.1 — docs/stabilization-plan.md; invariants
 * 5 ONE READER PER OBJECT · 8 A CLAIM RENDERS; laws `one-reader-per-object` · `a-claim-renders` ·
 * `staging-law` · `the-machine`).
 *
 * ZERO-AI, ZERO-DB (an in-memory PostgREST fake), deterministic. A read-only census (Sep 24) found
 * reader/state gaps, each fixed as a class and gated here by OUTCOME over fixtures:
 *   A · the inbox reader hard-wired `obligationOpen:false` — the completion/chase vets were off for
 *       inbox items the user owes (understanding.ownership === 'you_owe').
 *   B · an inbox reply draft's attachment made by the machine carried no staging-law stamp and was
 *       never re-proven (W13.3 covered commitment doc-sends only).
 *   G · the file a withdrawn/unstaged draft carried was invisible to the resolver's standing-file
 *       lookup, so the new-work BASE was never offered.
 *   H · the Home row and the room disagreed: the batched reader never judged commitment staleness and
 *       never ran the notice law; and the receipt KIND came from `leadKindOf`'s own ranking instead of
 *       the machine's ladder ("decision laid out" beside "ready to review").
 *
 *   npx tsx scripts/smoke-reader-parity.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  inboxTruthFacts, preparedFromSourceData, proveStagingByPool, draftStagingStale, stampTruth, isLiveArtifact,
  withdrawnReasonOf, preparedState, preparedStatesFor, groundFromNewest, leadKindOf, badgeOf,
  type PreparedArtifact, type PreparedState,
} from '../lib/prepare/read';
import { STAGING_LAW_VERSION } from '../lib/prepare/staging-law';
import {
  carriedDraftFileRows, carriedFileCandidateOf, labelForCarriedFile, standingAsBase, standingCandidateOf, stagingStamp,
} from '../lib/prepare/requirements';
import { deriveState, STATE_WORDS, type DeriveInputs } from '../lib/work/machine';
import { receiptWordOf, ladderReceiptKind } from '../lib/home/calm';
import { handStamp } from '../lib/prepare/hand';
import { leanSelect, foldLeanRows, PREPARED_KEYS } from '../lib/home/lean-source';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── THE IN-MEMORY POSTGREST FAKE (select paths, eq/in/is/gte, order, range/limit, maybeSingle) ──
type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  const pick = (row: Row, cols: string): Row => {
    const out: Row = {};
    for (const raw of cols.split(',').map((c) => c.trim()).filter(Boolean)) {
      const [alias, path] = raw.includes(':') ? raw.split(':') : [null, raw];
      if (path.includes('->')) {
        const [col, key] = path.split(/->>?/);
        out[alias ?? key] = ((row[col] ?? {}) as Row)[key] ?? null;
      } else out[alias ?? path] = row[path] ?? null;
    }
    return out;
  };
  return {
    reads,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let cols = '*'; let orderBy: { col: string; asc: boolean } | null = null;
      let from = 0; let to = Infinity; let single = false;
      const b: Record<string, unknown> = {
        select(c: string) { cols = c; reads.push(`${table}:${c}`); return b; },
        eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b; },
        in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return b; },
        is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return b; },
        gte(c: string, v: string) { filters.push((r) => String(r[c] ?? '') >= v); return b; },
        not() { return b; },
        like() { return b; },
        filter() { return b; },
        order(c: string, o?: { ascending?: boolean }) { orderBy = { col: c, asc: o?.ascending !== false }; return b; },
        range(f: number, t: number) { from = f; to = t; return b; },
        limit(n: number) { to = from + n - 1; return b; },
        maybeSingle() { single = true; return b; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          try {
            let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
            if (orderBy) { const { col, asc } = orderBy; rows = [...rows].sort((x, y) => (String(x[col] ?? '') < String(y[col] ?? '') ? -1 : 1) * (asc ? 1 : -1)); }
            rows = rows.slice(from, to === Infinity ? undefined : to + 1).map((r) => (cols === '*' ? { ...r } : pick(r, cols)));
            return Promise.resolve(res({ data: single ? rows[0] ?? null : rows, error: null }));
          } catch (e) { return rej ? Promise.resolve(rej(e)) : Promise.reject(e); }
        },
      };
      return b;
    },
  };
}

const U = 'user-parity';
const T0 = '2026-09-20T10:00:00.000Z';
const T1 = '2026-09-22T09:00:00.000Z';   // a NEWER inbound (the ground moved)
const FILE = { fileId: 'file-interim', filename: 'Interim_Report_20260910.pptx', source: 'kb' };
const claimWords = "I've finished the group redistribution. Here's the updated allocation breakdown. Everything is balanced now.";
const plainWords = 'Thanks for the note — I will look at the numbers this week and come back to you.';
const owe = { role: 'addressed', relevance: 'reply', ownership: 'you_owe' };

async function main() {
  // ═══ A · INBOX YOU_OWE VETS ON ═══
  console.log('\nA — the inbox reader\'s obligation is the understanding\'s');
  gate('A1 inboxTruthFacts: you_owe → obligationOpen; awaiting · none · no understanding → closed (fail-safe)',
    inboxTruthFacts({ subject: 's', understanding: owe })?.obligationOpen === true
    && inboxTruthFacts({ subject: 's', understanding: { ...owe, ownership: 'awaiting' } })?.obligationOpen === false
    && inboxTruthFacts({ subject: 's', understanding: { ...owe, ownership: 'none' } })?.obligationOpen === false
    && inboxTruthFacts({ subject: 's' })?.obligationOpen === false);
  {
    const arts = (sd: Row) => stampTruth(preparedFromSourceData(sd as never), inboxTruthFacts(sd));
    const oweArt = arts({ subject: 's', understanding: owe, draft: { body: claimWords, generated_at: T0 } })[0];
    const awaitArt = arts({ subject: 's', understanding: { ...owe, ownership: 'awaiting' }, draft: { body: claimWords, generated_at: T0 } })[0];
    const handSd = { body: claimWords, generated_at: T0, ...handStamp('reply_draft', { body: claimWords }, T0) };
    const handArt = arts({ subject: 's', understanding: owe, draft: handSd })[0];
    gate('A2 a machine reply claiming undone work on inbox mail the user OWES is withdrawn; the same words on mail they await stay live; the user\'s own edit is never judged',
      oweArt.falseClaim === true && !isLiveArtifact(oweArt) && withdrawnReasonOf(oweArt) === 'its words claimed work that is not done'
      && isLiveArtifact(awaitArt) && !!handArt.hand && isLiveArtifact(handArt),
      JSON.stringify({ owe: oweArt.falseClaim, await: awaitArt.falseClaim, hand: !!handArt.hand }));
  }

  // ═══ B · INBOX DOC-SEND: STAMPED LIVE · UNSTAMPED WITHDRAWN ═══
  console.log('\nB — the inbox lane\'s file match is re-proven');
  {
    const run = (draft: Row, pool: Row[] = []) => stampTruth(proveStagingByPool(preparedFromSourceData({ draft } as never), pool), inboxTruthFacts({ subject: 's' }))[0];
    const unstamped = run({ body: plainWords, attachment: FILE, prepared: 'pass', generated_at: T0 });
    const stamped = run({ body: plainWords, attachment: FILE, prepared: 'pass', generated_at: T0, stagingLaw: STAGING_LAW_VERSION });
    const reqRow = (law: number | null, extra: Row = {}) => ({ id: 'rq', task_id: 'require:the interim report', type: 'file', content: 'x', created_at: T0,
      metadata: { source: 'requirement_resolution', attachment: FILE, ...(law === null ? {} : { stagingLaw: law }), ...extra } });
    const proven = run({ body: plainWords, attachment: FILE, generated_at: T0 }, [reqRow(STAGING_LAW_VERSION)]);
    const staleReq = run({ body: plainWords, attachment: FILE, generated_at: T0 }, [reqRow(1)]);
    const typedSupply = run({ body: plainWords, attachment: FILE, generated_at: T0 }, [reqRow(STAGING_LAW_VERSION, { via: 'typed' })]);
    const handDraft = { body: plainWords, attachment: FILE, generated_at: T0, ...handStamp('reply_draft', { body: plainWords, attachment: FILE }, T0) };
    const hand = run(handDraft);
    const noFile = run({ body: plainWords, generated_at: T0 });
    gate('B1 an UNSTAMPED machine attachment reads stagingStale → withdrawn, worded "matched under an older rule"',
      unstamped.stagingStale === true && unstamped.falseClaim === true && !isLiveArtifact(unstamped)
      && withdrawnReasonOf(unstamped) === 'its file was matched under an older rule — re-checking it');
    gate('B2 a draft stamped with the CURRENT staging law is live; draftStagingStale reads the stamp',
      !stamped.stagingStale && isLiveArtifact(stamped) && draftStagingStale({}) && draftStagingStale({ stagingLaw: STAGING_LAW_VERSION - 1 })
      && !draftStagingStale({ stagingLaw: STAGING_LAW_VERSION }));
    gate('B3 the POOL proves it: a current-law resolver row for the same file → live; a stale-law row or a typed supply proves nothing',
      !proven.stagingStale && isLiveArtifact(proven) && staleReq.stagingStale === true && typedSupply.stagingStale === true);
    gate('B4 the user\'s edited draft is never judged; a draft with no file has nothing to re-prove',
      !!hand.hand && isLiveArtifact(hand) && !noFile.stagingStale && isLiveArtifact(noFile));
    const pass = src('lib/prepare/pass.ts');
    const docsend = pass.slice(pass.indexOf('async function prepareDocSend('), pass.indexOf('// THE CANDIDATE DERIVATION'));
    const inboxHalf = docsend.slice(docsend.indexOf("if (!w.id.startsWith('inbox:'))"));
    gate('B5 BOTH inbox doc-send writers stamp the attachment with stagingStamp() (source)',
      (inboxHalf.match(/attachment: \{ fileId: [^}]+\}, \.\.\.\(await import\('@\/lib\/prepare\/requirements'\)\)\.stagingStamp\(\)/g) ?? []).length === 2
      && Number(stagingStamp().stagingLaw) === STAGING_LAW_VERSION);
    gate('B6 the reader wires it: preparedFromSourceData marks, the one reader proves by the pool, stampTruth withdraws',
      /const stagingStale = !!sd\.draft\.attachment && !isHandHeld\('reply_draft', sd\.draft\) && draftStagingStale\(sd\.draft\);/.test(src('lib/prepare/read.ts'))
      && /artsOf\.set\(keyOf\(item\), proveStagingByPool\(arts, pool\)\);/.test(src('lib/prepare/read.ts')));
  }

  // ═══ G · THE BASE IS OFFERED FROM AN UNSTAGED DRAFT'S FILE ═══
  console.log('\nG — the carried file is a standing file');
  {
    const REQUEST_AT = '2026-09-12T08:00:00Z';
    const LBL = 'slides 7&8 details for remaining functions in interim report';
    const docsend = (vof: string | null, extra: Row = {}) => ({ task_id: 'prepare-pass-docsend', type: 'draft', content: claimWords,
      metadata: { source: 'preparation_pass', attachment: FILE, ...(vof ? { version_of: vof } : {}), ...extra } });
    const rows = carriedDraftFileRows([
      docsend('superseded:unstaged'),
      docsend('superseded:withdrawn'),                                                            // same file → one entry
      { task_id: 'base:x', type: 'file', content: 'b', metadata: { role: 'base', version_of: 'superseded:unstaged', attachment: { fileId: 'f-base' } } },
      { task_id: 'require:x', type: 'file', content: 'r', metadata: { version_of: 'superseded:unstaged', attachment: { fileId: 'f-req' } } },
      { task_id: 'prepare-pass-docsend', type: 'draft', content: 'live', metadata: { attachment: { fileId: 'f-live' } } },  // unfiled → not carried
      { task_id: 'prepare-pass-docsend', type: 'draft', content: 's', metadata: { version_of: 'superseded:unstaged', sent_at: T0, attachment: { fileId: 'f-sent' } } },
    ]);
    gate('G1 carriedDraftFileRows: an unstaged/withdrawn MACHINE draft\'s file, once — never a base, a requirement row, a live draft or a sent one',
      rows.length === 1 && (rows[0].metadata.attachment as { fileId: string }).fileId === FILE.fileId && rows[0].content === null,
      JSON.stringify(rows.map((r) => (r.metadata.attachment as { fileId: string }).fileId)));
    const inboxProven = carriedDraftFileRows([], { body: plainWords, attachment: FILE }, false);
    const inboxUnproven = carriedDraftFileRows([], { body: plainWords, attachment: FILE }, true);
    gate('G2 an inbox item\'s stored reply draft counts only while its file match is unproven (the reader would withdraw it)',
      inboxProven.length === 0 && inboxUnproven.length === 1);
    const cand = carriedFileCandidateOf(rows[0], null);
    gate('G3 the carried candidate is the FILE (its real id, its name\'s own date), carrying no draft words',
      !!cand && cand.id === FILE.fileId && cand.filename === FILE.filename && cand.snippet === '' && String(cand.fileAt ?? '').startsWith('2026-09-10')
      && standingCandidateOf(rows[0], null) === null);
    const text = `Provide details on slides 7&8 for remaining functions in the interim report\n${LBL}`;
    gate('G4 THE SAME RULES make it the base: new work + predates the request + the request names it — and nothing else does',
      standingAsBase({ kind: 'new_work', standing: cand, requestAt: REQUEST_AT, requestText: text })
      && !standingAsBase({ kind: null, standing: cand, requestAt: REQUEST_AT, requestText: text })
      && !standingAsBase({ kind: 'existing', standing: cand, requestAt: REQUEST_AT, requestText: text })
      && !standingAsBase({ kind: 'new_work', standing: { ...cand!, filename: 'Board_Minutes_20260901.docx' }, requestAt: REQUEST_AT, requestText: text })
      && !standingAsBase({ kind: 'new_work', standing: { ...cand!, fileAt: '2026-09-15T00:00:00Z', filename: 'Interim_Report.pptx' }, requestAt: REQUEST_AT, requestText: text }));
    gate('G5 one label per carried file: the only label, else the one label naming it; ambiguous → none',
      labelForCarriedFile(FILE.filename, [LBL]) === LBL
      && labelForCarriedFile(FILE.filename, [LBL, 'the signed engagement letter']) === LBL
      && labelForCarriedFile(FILE.filename, ['the budget', 'the engagement letter']) === null);
    const reqs = src('lib/prepare/requirements.ts');
    gate('G6 the resolver reads it for labels with no require/base row, puts it in the SAME pick, and stages the base through THE ONE unstage writer',
      /const openLabels = requires\.map\(\(r\) => r\.label\)\s*\.filter\(\(l\) => !standingByTask\.has\(requireTaskId\(l\)\) && !standingBases\.has\(baseTaskId\(l\)\)\);/.test(reqs)
      && /standing: row \? standingCandidateOf\(row, standingDates\.get\(fid\) \?\? null\) : \(carriedByLabel\.get\(r\.label\) \?\? null\),/.test(reqs)
      && /const carriedBase = !labelBase && !standingBase && carriedCand && standingAsBase\(\{/.test(reqs)
      && /if \(pick\.demoted \|\| carriedBase\) await unstageRequirement\(/.test(reqs));
  }

  // ═══ H · SINGLE vs BATCHED READER — ONE ANSWER over fixtures ═══
  console.log('\nH — the single and the batched reader agree (staleness · notice strip · staging · vets)');
  {
    const inbox = (id: string, sd: Row, extra: Row = {}) => ({ id, user_id: U, status: 'pending', work_state: null, connection_id: null, last_activity_at: T0, source_data: sd, ...extra });
    const tables: Record<string, Row[]> = {
      inbox_items: [
        // a notice nobody replies to, carrying a stale-era reply draft → stripped by the notice law
        inbox('i-notice', { subject: 'Your weekly digest', from_address: 'no-reply@acme.example', from_name: 'Acme Notifications', thread_id: 't-notice', received_at: T0,
          understanding: { role: 'one_of_many', relevance: 'awareness', ownership: 'none', mailKind: 'notification' },
          draft: { body: plainWords, generated_at: T0, prepared_from: { emailId: 'e0', receivedAt: T0 } } }),
        // mail the user owes, a machine reply claiming undone work → withdrawn (A)
        inbox('i-owe', { subject: 'The allocation', from_address: 'sam@acme.example', from_name: 'Sam', thread_id: 't-owe', received_at: T0, understanding: owe,
          draft: { body: claimWords, generated_at: T0, prepared_from: { emailId: 'e1', receivedAt: T0 } } }),
        // a legacy doc-send with an unstamped attachment → withdrawn (B)
        inbox('i-docsend', { subject: 'The report', from_address: 'sam@acme.example', thread_id: 't-doc', received_at: T0, understanding: owe,
          draft: { body: plainWords, attachment: FILE, prepared: 'pass', generated_at: T0 } }),
        // a reply whose ground moved (a newer inbound on the thread) → superseded
        inbox('i-moved', { subject: 'Next week', from_address: 'sam@acme.example', thread_id: 't-moved', received_at: T0, understanding: { ...owe, ownership: 'awaiting' },
          draft: { body: plainWords, generated_at: T0, prepared_from: { emailId: 'e2', receivedAt: T0 } } }, { last_activity_at: T0 }),
        // a live, current reply → live in both
        inbox('i-live', { subject: 'Lunch', from_address: 'sam@acme.example', thread_id: 't-live', received_at: T0, understanding: { ...owe, ownership: 'awaiting' },
          draft: { body: plainWords, generated_at: T0, prepared_from: { emailId: 'e3', receivedAt: T0 } } }),
      ],
      commitments: [
        // a commitment whose chase was prepared before a newer inbound landed → superseded (census H(1))
        { id: 'c-moved', user_id: U, description: 'Send the revised budget', created_at: T0, status: 'open', direction: 'awaiting', counterparty: 'Sam', thread_id: 't-cm' },
        { id: 'c-live', user_id: U, description: 'Send the deck', created_at: T0, status: 'open', direction: 'awaiting', counterparty: 'Sam', thread_id: 't-cl' },
      ],
      item_deliverables: [
        { id: 'p1', user_id: U, kind: 'commitment', entity_id: 'c-moved', task_id: 'prepare-pass-nudge', type: 'draft', title: 'Nudge — Sam', content: plainWords, created_at: T0, metadata: { prepared_from: { emailId: 'e4', receivedAt: T0 } } },
        { id: 'p2', user_id: U, kind: 'commitment', entity_id: 'c-live', task_id: 'prepare-pass-nudge', type: 'draft', title: 'Nudge — Sam', content: plainWords, created_at: T0, metadata: { prepared_from: { emailId: 'e5', receivedAt: T0 } } },
        // an inbox pool nudge on the notice → stripped too (both lanes, one law)
        { id: 'p3', user_id: U, kind: 'email', entity_id: 'i-notice', task_id: 'x', type: 'document', title: 'Summary', content: 'A summary of the digest.', created_at: T0, metadata: {} },
      ],
      emails: [
        { id: 'e0', user_id: U, thread_id: 't-notice', is_from_user: false, received_at: T0 },
        { id: 'e1', user_id: U, thread_id: 't-owe', is_from_user: false, received_at: T0 },
        { id: 'e2', user_id: U, thread_id: 't-moved', is_from_user: false, received_at: T0 },
        { id: 'e2b', user_id: U, thread_id: 't-moved', is_from_user: false, received_at: T1 },
        { id: 'e3', user_id: U, thread_id: 't-live', is_from_user: false, received_at: T0 },
        { id: 'e3b', user_id: U, thread_id: 't-live', is_from_user: true, received_at: T1 },    // the user's own reply never moves the ground
        { id: 'e4', user_id: U, thread_id: 't-cm', is_from_user: false, received_at: T0 },
        { id: 'e4b', user_id: U, thread_id: 't-cm', is_from_user: false, received_at: T1 },
        { id: 'e5', user_id: U, thread_id: 't-cl', is_from_user: false, received_at: T0 },
      ],
      connections: [],
    };
    const sb = fakeClient(tables) as never;
    const items = [
      ...tables.inbox_items.map((r) => ({ kind: 'inbox' as const, id: String(r.id) })),
      ...tables.commitments.map((r) => ({ kind: 'commitment' as const, id: String(r.id) })),
    ];
    const shape = (st: PreparedState | undefined) => JSON.stringify((st?.all ?? []).map((a: PreparedArtifact) => ({
      k: a.kind, live: isLiveArtifact(a), why: withdrawnReasonOf(a), p: a.payload?.store === 'pool' ? a.payload.rowId : a.payload?.field,
    })).sort((x, y) => String(x.p).localeCompare(String(y.p)))) + `|${st?.badge}|${st?.leadKind}|${st?.sentStamp}`;
    const batch = await preparedStatesFor(sb, U, items);
    // The Home's way: rows prefetched by the caller in a NARROWER projection (PREPARED_KEYS only).
    const leanRows = foldLeanRows(tables.inbox_items.map((r) => {
      const sd = r.source_data as Row;
      return { id: r.id, last_activity_at: r.last_activity_at, ...Object.fromEntries(PREPARED_KEYS.map((k) => [k, sd[k] ?? null])) };
    }), { keys: PREPARED_KEYS });
    const batchLean = await preparedStatesFor(sb, U, items.map((i) => {
      const row = leanRows.find((r) => r.id === i.id);
      return row ? { ...i, row: { source_data: row.source_data, last_activity_at: row.last_activity_at as string } } : i;
    }));
    const disagree: string[] = [];
    for (const i of items) {
      const single = await preparedState(sb, U, { kind: i.kind === 'inbox' ? 'inbox_item' : 'commitment', id: i.id });
      const k = `${i.kind}:${i.id}`;
      if (shape(single) !== shape(batch.get(k)) || shape(single) !== shape(batchLean.get(k))) disagree.push(`${k}: single=${shape(single)} batch=${shape(batch.get(k))} lean=${shape(batchLean.get(k))}`);
    }
    gate('H1 single == batched == batched-over-lean-prefetched rows, for every fixture (no second derivation)', disagree.length === 0, disagree.join(' ;; '));
    const st = (k: string) => batch.get(k)!;
    gate('H2 the batched reader judges COMMITMENT staleness exactly: a nudge prepared before a newer inbound is superseded; a current one stays live',
      st('commitment:c-moved').live.length === 0 && withdrawnReasonOf(st('commitment:c-moved').all[0]) === 'superseded by a newer message'
      && st('commitment:c-live').live.length === 1);
    gate('H3 the notice law strips reply drafts in the batch too (both lanes), and the user\'s own outbound never moves the ground',
      !st('inbox:i-notice').all.some((a) => a.kind === 'reply_draft' || a.kind === 'nudge_draft')
      && st('inbox:i-notice').all.some((a) => a.kind === 'deliverable')
      && st('inbox:i-live').live.length === 1 && st('inbox:i-moved').stale.length === 1);
    gate('H4 the vets and the staging proof land identically through the batch (A + B)',
      withdrawnReasonOf(st('inbox:i-owe').all[0]) === 'its words claimed work that is not done'
      && withdrawnReasonOf(st('inbox:i-docsend').all[0]) === 'its file was matched under an older rule — re-checking it');
    gate('H5 groundFromNewest is groundOf\'s rule: newest inbound, else the row\'s own date, else none; a failed read is exempt',
      JSON.stringify(groundFromNewest({ key: 'k', threadId: 't', fallbackAt: T0 }, new Map([['t', { id: 'e', receivedAt: T1 }]]))) === JSON.stringify({ emailId: 'e', receivedAt: T1 })
      && groundFromNewest({ key: 'k', threadId: 't', fallbackAt: T0 }, new Map()).receivedAt === T0
      && groundFromNewest({ key: 'k', threadId: null, fallbackAt: null }, new Map()).receivedAt === null
      && groundFromNewest({ key: 'k', threadId: 't', fallbackAt: T0 }, null).receivedAt === null);
    const rd = src('lib/prepare/read.ts');
    gate('H6 one path by construction: preparedState IS preparedStatesFor over one item; no approximation, no pool cap',
      /const states = await preparedStatesFor\(client, userId, \[\{ kind, id: item\.id \}\]\);/.test(rd)
      && !/lastAct > pAt \+ 5000\) markGroundMoved\(a\);\n\s+\}\n\s+const itemFacts/.test(rd)
      && !/\.limit\(8\)/.test(rd) && /const grounds = await groundsFor\(client, userId, reqs\);/.test(rd)
      && leanSelect('id', { keys: ['thread_id'] }) === 'id, source_data->thread_id');
  }

  // ═══ H · THE ROW'S RECEIPT KIND IS THE MACHINE LADDER'S ═══
  console.log('\nH — the receipt kind follows the ladder');
  {
    const art = (over: Partial<PreparedArtifact>): PreparedArtifact => ({ kind: 'deliverable', title: 't', content: 'c', by: 'Clara', at: T0, attachment: null, provenance: null, ...over });
    const decision = art({ kind: 'deliverable', decision: { options: [{ label: 'A' }, { label: 'B' }], recommendation: null, why: null } });
    const cases: Array<{ name: string; input: Partial<DeriveInputs>; arts: PreparedArtifact[]; source: 'reply' | 'commitment' }> = [
      { name: 'census H(3): a live decision brief + a document on a NON-decide verdict', input: { verdict: { work: 'produce' } }, arts: [decision, art({})], source: 'commitment' },
      { name: 'decide verdict + brief', input: { verdict: { work: 'decide' } }, arts: [decision], source: 'commitment' },
      { name: 'a reply draft', input: { verdict: { work: 'reply' } }, arts: [art({ kind: 'reply_draft' })], source: 'reply' },
      { name: 'an invite', input: { verdict: { work: 'schedule' } }, arts: [art({ kind: 'invite' })], source: 'reply' },
      { name: 'a paste pack', input: { verdict: { work: 'produce' } }, arts: [art({ kind: 'paste_pack' })], source: 'commitment' },
      { name: 'a decision brief alone on a reply verdict (the ladder counts nothing live)', input: { verdict: { work: 'reply' } }, arts: [decision], source: 'reply' },
      { name: 'sent', input: { verdict: { work: 'reply' }, sentStamp: true }, arts: [art({ kind: 'reply_draft' })], source: 'reply' },
    ];
    const bad: string[] = [];
    for (const c of cases) {
      const m = deriveState({ open: true, verdict: null, judgedAt: new Date().toISOString(), prepared: c.arts, liveAsk: false, sentStamp: false, ...c.input });
      const word = STATE_WORDS[m.state];
      const row = receiptWordOf(badgeOf(c.arts), leadKindOf(c.arts), c.source, word);
      const ladder = m.leadKind ? receiptWordOf(badgeOf(c.arts), m.leadKind, c.source) : null;
      if (row !== ladder) bad.push(`${c.name}: state=${m.state} row=${row} ladder=${ladder}`);
    }
    gate('H7 over every rung: the row\'s receipt == the word of the kind the ladder rests on (none when it rests on nothing)', bad.length === 0, bad.join(' ;; '));
    {
      const m = deriveState({ open: true, verdict: { work: 'produce' }, judgedAt: new Date().toISOString(), prepared: [decision, art({})], liveAsk: false, sentStamp: false });
      gate('H8 the census case: the room says "ready to review" and the row no longer says "decision laid out"',
        STATE_WORDS[m.state] === 'ready to review' && leadKindOf([decision, art({})]) === 'decision'
        && receiptWordOf('Clara', 'decision', 'commitment', STATE_WORDS[m.state]) === 'ready to review');
    }
    const calm = src('lib/home/calm.ts');
    gate('H9 calm spells the machine\'s words exactly (client-safe literals, gated) and no served word keeps the reader\'s kind',
      calm.includes(`const LADDER_DECISION_WORD = '${STATE_WORDS.awaiting_decision}'`) && calm.includes(`const LADDER_REVIEW_WORD = '${STATE_WORDS.ready}'`)
      && calm.includes(`const LADDER_SEND_WORD = '${STATE_WORDS.awaiting_approval}'`)
      && calm.includes(`new Set(['${STATE_WORDS.preparing}', '${STATE_WORDS.committed}'])`)
      && ladderReceiptKind('decision', null) === 'decision' && ladderReceiptKind('reply_draft', STATE_WORDS.preparing) === false);
  }

  console.log(`\n${failures.length ? '✗' : '✓'} smoke-reader-parity: ${pass} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
