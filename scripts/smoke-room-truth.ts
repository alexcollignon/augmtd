/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — A WITHDRAWN ARTIFACT TAKES ITS WORDS AND ITS BUTTON WITH IT (stabilization W13.5 —
 * docs/stabilization-plan.md; docs/laws-registry.md `a-claim-renders` · `no-mutation-and-address` ·
 * `staging-law`).
 *
 * ZERO-AI, ZERO-DB, deterministic. Owner live walk on prod after W13.3: THE ONE READER withdrew a
 * legacy doc-send draft (no draft card rendered) — yet the room served the LAST-GOOD brief "I've
 * drafted the reply … ready to review" with a MOVE "Review the reply draft" that did nothing, and the
 * requirement ask (attach / type / point the new slides) no longer rendered: nothing actionable.
 *   A · SERVE-TIME TRUTH — last-good is re-validated against the CURRENT board before the paint: a
 *       MOVE whose object is not live is dropped; a brief with a claim that no longer renders is not
 *       served (the honest fallback speaks); both doors serve through it
 *   B · THE SIG MOVES — the board digest carries each artifact's liveness WITH its reason
 *   C · THE RE-PREPARE TRIP ON WITHDRAWAL — any withdrawn artifact makes the trip due; the trip runs
 *       before the compose, is budgeted per item, and a lane that lands on an ask/base retires the
 *       withdrawn send
 *   D · THE ASK MUST STAND — an archived turn never holds its dedupe key hostage (the re-posted ask
 *       lands LIVE); the editor never archives the engine's own ask
 * Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-room-truth.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { serveTimeTruth, moveTargetLive, boardRefOf } from '../lib/room/serve-truth';
import { boardDigestOf, boardLivenessMark, editorMaySettle } from '../lib/room/brief';
import { preparedWordsOf } from '../lib/room/grounding';
import { writeRoomTurn, archivedKeyOf, isUniqueViolation } from '../lib/room/turns';
import { createSingleFlight } from '../lib/room/single-flight';
import type { PreparedArtifact, PreparedState } from '../lib/prepare/read';

const failures: string[] = [];
let pass = 0;
function gate(name: string, ok: boolean) { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { failures.push(name); console.log(`  ✗ ${name}`); } }
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// ── an in-memory room_turns table that ENFORCES the production unique index (user, room, key) —
// NOT partial on archived_at (supabase/migrations/20260725_room_turns.sql) ──
type Turn = { id: string; user_id: string; room_key: string; dedupe_key: string | null; archived_at: string | null; text: string; component: unknown };
function fakeTurns(seed: Turn[]) {
  const rows = [...seed];
  let seq = 0;
  const client = {
    from() {
      const f: Array<(r: Turn) => boolean> = [];
      let action: 'select' | 'insert' | 'update' = 'select';
      let payload: Record<string, unknown> = {};
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => { f.push((r) => (r as Record<string, unknown>)[c] === v); return q; };
      q.is = (c: string, v: unknown) => { f.push((r) => ((r as Record<string, unknown>)[c] ?? null) === v); return q; };
      q.not = (c: string, _op: string, v: unknown) => { f.push((r) => ((r as Record<string, unknown>)[c] ?? null) !== v); return q; };
      q.limit = () => q;
      const run = () => {
        const hit = rows.filter((r) => f.every((p) => p(r)));
        if (action === 'insert') {
          const p = payload as Partial<Turn>;
          if (p.dedupe_key && rows.some((r) => r.user_id === p.user_id && r.room_key === p.room_key && r.dedupe_key === p.dedupe_key)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_room_turns_dedupe"' } };
          }
          rows.push({ ...({ id: `t${++seq}`, archived_at: null, component: null, text: '', dedupe_key: null } as Turn), ...(p as Partial<Turn>) } as Turn);
          return { data: null, error: null };
        }
        if (action === 'update') { for (const r of hit) Object.assign(r, payload); return { data: null, error: null }; }
        return { data: hit, error: null };
      };
      q.insert = (p: Record<string, unknown>) => { action = 'insert'; payload = p; return q; };
      q.update = (p: Record<string, unknown>) => { action = 'update'; payload = p; return q; };
      q.maybeSingle = () => { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }); };
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
      return q;
    },
  };
  return { client: client as never, rows };
}

(async () => {
  console.log('\nA · SERVE-TIME TRUTH');
  const ref = boardRefOf('commitment', 'c1');
  const lying = { text: "I've drafted the reply to Sam. The draft is ready to review, but it needs one thing from you.", move: { label: 'Review the reply draft', ref }, offers: [], at: '2026-09-24T09:00:00Z' };
  const withdrawnBoard = [{ ref, prepared: [] as string[] }];
  const liveBoard = [{ ref, prepared: ['reply draft'] }];
  const v1 = serveTimeTruth(lying, { board: withdrawnBoard, hasDecision: false, hasAsk: true });
  gate('A1 a last-good brief claiming a draft the CURRENT board does not render is NOT served (the honest fallback speaks)',
    v1.response === null && v1.withheld && v1.dropped.some((d) => /drafted the reply/.test(d)));
  const v2 = serveTimeTruth(lying, { board: liveBoard, hasDecision: false, hasAsk: true });
  gate('A2 the same brief against a board where the draft is LIVE is served whole, move and all',
    v2.response?.text === lying.text && v2.response?.move?.ref === ref && !v2.withheld && !v2.moveDropped);
  const plain = { text: 'Sam is waiting on the slides 7 and 8 details; nothing is staged yet.', move: { label: 'Review the reply draft', ref }, offers: [{ label: 'Draft it', say: 'Draft the reply to Sam.' }], at: null };
  const v3 = serveTimeTruth(plain, { board: withdrawnBoard, hasDecision: false, hasAsk: true });
  gate('A3 a stale MOVE target is dropped at serve (its object is not live) — the words stand, the dead button goes, the offers stay',
    v3.response?.text === plain.text && v3.response?.move === null && v3.moveDropped && v3.response?.offers.length === 1);
  gate('A4 the move-target predicate: a live ref stands · a withdrawn/absent ref falls · an offer is words (passes) · an unbound move binds only to a SOLE live entry',
    moveTargetLive({ ref, offer: false }, liveBoard) && !moveTargetLive({ ref, offer: false }, withdrawnBoard)
    && !moveTargetLive({ ref: 'inbox:ghost' }, liveBoard) && moveTargetLive({ ref, offer: true }, withdrawnBoard)
    && moveTargetLive({ ref: null }, liveBoard) && !moveTargetLive({ ref: null }, withdrawnBoard)
    && !moveTargetLive({ ref: null }, [...liveBoard, { ref: 'inbox:i2', prepared: ['reply draft'] }]));
  const decisionPointer = { text: 'The choice is laid out below.', move: null, offers: [], at: null };
  gate('A5 unknown decision/ask facts never withhold (a doubt keeps the brief); a disproven one does',
    serveTimeTruth(decisionPointer, { board: [], hasDecision: true, hasAsk: true }).response !== null
    && serveTimeTruth(decisionPointer, { board: [], hasDecision: false, hasAsk: false }).response === null);
  const view = src('app/api/items/view/route.ts');
  gate('A6 the ITEM door re-validates last-good against THE ONE READER\'s live words BEFORE the paint, and paints only what the net lets through',
    /serveTimeTruth\(lastGood, \{/.test(view) && /preparedWordsOf\(prepState\)\.list/.test(view)
    && /const r = serve\.response \?/.test(view) && /hasAsk: machine\?\.liveAsk \?\? true/.test(view)
    && /serve\.withheld \|\| tripDue/.test(view));
  const ent = src('app/api/entities/[id]/room/route.ts');
  gate('A7 the ENTITY door does the same over its current board, and never lets the builder\'s own last-good slip past the net',
    /entityServeBoard\(supabase, uid, id\)/.test(ent) && /serveTimeTruth\(lastGood, \{ board,/.test(ent)
    && /\{ \.\.\.entity, brief: null, move: null, offers: \[\], briefAt: null \}/.test(ent));
  const machine = src('lib/work/machine.ts');
  gate('A8 the machine states whether a live (code-read) ask stands — the serve seam\'s hasAsk', /liveAsk\?: boolean;/.test(machine) && /\n\s+liveAsk,\n/.test(machine));

  console.log('\nB · THE SIG MOVES');
  const artOf = (over: Partial<PreparedArtifact>): PreparedArtifact => ({ kind: 'reply_draft', title: 'Send report', content: 'x', by: null, at: '2026-09-24T00:00:00Z', ...over } as PreparedArtifact);
  const stOf = (arts: PreparedArtifact[]): Pick<PreparedState, 'live' | 'expired' | 'all' | 'badge'> => ({
    all: arts, live: arts.filter((a) => !a.falseClaim && !a.stale && !a.expired), expired: arts.filter((a) => a.expired), badge: null,
  });
  const live = preparedWordsOf(stOf([artOf({})]));
  const stale = preparedWordsOf(stOf([artOf({ falseClaim: true, stagingStale: true })]));
  const based = preparedWordsOf(stOf([artOf({ falseClaim: true, baseAsAnswer: true })]));
  const e = (w: ReturnType<typeof preparedWordsOf>) => ({ ref, judgedWork: 'send_file', prepared: w.list, expired: w.expired, withdrawn: w.withdrawn, evidence: [] as string[] });
  gate('B1 a withdrawal moves the board digest (live → withdrawn)', boardDigestOf([e(live)]) !== boardDigestOf([e(stale)]));
  gate('B2 the liveness mark carries the READER\'s reason, so a change of withdrawal reason (same count) moves the sig too',
    boardLivenessMark(e(stale)) !== boardLivenessMark(e(based)) && boardDigestOf([e(stale)]) !== boardDigestOf([e(based)])
    && /older rule/.test(boardLivenessMark(e(stale))) && boardLivenessMark(e(live)) === '');
  gate('B3 the room sig hashes the whole board digest (the liveness rides it)', /const boardDigest = boardDigestOf\(g\.board\);/.test(src('lib/room/brief.ts')));

  console.log('\nC · THE RE-PREPARE TRIP ON WITHDRAWAL');
  const { needsReprepareTrip, REPREPARE_TRIP_WINDOW_MS } = await import('../lib/room/open-kicks');
  gate('C1 any withdrawal (stagingStale · baseAsAnswer · wrongIdentity · falseClaim) makes the trip due; all-live does not',
    needsReprepareTrip([artOf({ falseClaim: true, stagingStale: true })]) && needsReprepareTrip([artOf({ falseClaim: true, baseAsAnswer: true })])
    && needsReprepareTrip([artOf({ falseClaim: true, wrongIdentity: true })]) && !needsReprepareTrip([artOf({})]) && !needsReprepareTrip([]));
  const kicks = src('lib/room/open-kicks.ts');
  gate('C2 the view door schedules the trip on a real open and runs the compose AFTER it (the opening reads the corrected board)',
    /const tripDue = needsReprepareTrip\(preparedArts\)/.test(view)
    && /if \(tripDue\) \{ const \{ reprepareTrip \} = await import\('@\/lib\/room\/open-kicks'\); await reprepareTrip\(supabase, uid, linkKind, id, staleRow, eid\); \}\s*\n\s*await joinCompose\(/.test(view)
    && /if \(trip\) await reprepareTrip\([^)]*\)[^;]*;\s*\n\s*return joinCompose\(/.test(kicks));
  let runs = 0; let t = 0;
  const flight = createSingleFlight<void>({ now: () => t });
  const trip = () => flight.run('u|commitment|c1', async () => { runs++; return { value: undefined, memoMs: REPREPARE_TRIP_WINDOW_MS }; });
  await Promise.all([trip(), trip()]); await trip();
  t = REPREPARE_TRIP_WINDOW_MS + 1; await trip();
  gate('C3 the trip is BUDGETED: one per item per window (a burst of opens joins it; the window re-opens it)',
    runs === 2 && /await _tripFlight\.run\(`\$\{uid\}\|\$\{linkKind\}\|\$\{id\}`/.test(kicks));
  const passSrc = src('lib/prepare/pass.ts');
  gate('C4 a lane that re-runs a WITHDRAWN send and lands on an ask or the base RETIRES the withdrawn draft (the one superseding writer), so the trip is not due forever',
    /const retireWithdrawn = async/.test(passSrc) && /supersedeDraftsRiding\(admin, userId, 'commitment', w\.entityId, \[fid\], reason\)/.test(passSrc)
    && /await retireWithdrawn\('withdrawn send — the file is the base of new work, not the deliverable'\); return await offerBase\(/.test(passSrc)
    && /await retireWithdrawn\('withdrawn send — its file is not proven to be the deliverable'\); await askForFile\(/.test(passSrc));

  console.log('\nD · THE ASK MUST STAND');
  const U = 'u1', ROOM = 'commitment:c1', KEY = 'requires:c1';
  const db = fakeTurns([{ id: 'old', user_id: U, room_key: ROOM, dedupe_key: KEY, archived_at: '2026-09-24T10:16:13Z', text: 'the old ask', component: null }]);
  await writeRoomTurn(db.client, U, ROOM, { role: 'system', text: 'I need the updated slides 7 and 8 — attach them or point me to them.', component: { key: 'input_checklist', state: { items: ['the updated version of "report.pptx"'], taskId: null } }, dedupeKey: KEY } as never);
  const liveAsk = db.rows.find((r) => r.dedupe_key === KEY && !r.archived_at);
  const history = db.rows.find((r) => r.id === 'old');
  gate('D1 outcome: an ARCHIVED ask no longer holds its key hostage — the re-posted ask lands LIVE (with its checklist), the archived one stays in its session under a released key',
    !!liveAsk && (liveAsk.component as { key?: string } | null)?.key === 'input_checklist'
    && history?.dedupe_key === archivedKeyOf(KEY, '2026-09-24T10:16:13Z') && !!history?.archived_at && db.rows.length === 2);
  const db2 = fakeTurns([{ id: 'live', user_id: U, room_key: ROOM, dedupe_key: KEY, archived_at: null, text: 'standing ask', component: { key: 'input_checklist' } }]);
  await writeRoomTurn(db2.client, U, ROOM, { role: 'system', text: 'restated', component: { key: 'input_checklist', state: { items: ['x'] } }, dedupeKey: KEY } as never);
  gate('D2 a LIVE keyed turn is still updated in place (the keyed-turn idiom holds; no second row)',
    db2.rows.length === 1 && db2.rows[0].text === 'restated' && db2.rows[0].dedupe_key === KEY);
  gate('D3 the unique-violation predicate reads PostgREST\'s 23505', isUniqueViolation({ code: '23505' }) && isUniqueViolation({ message: 'duplicate key value violates unique constraint' }) && !isUniqueViolation({ code: '42703' }) && !isUniqueViolation(null));
  const brief = src('lib/room/brief.ts');
  gate('D4 the editor never archives the ENGINE\'s own ask (its life is the resolver\'s, the code predicate\'s and the verdict\'s); a coworker\'s ask it may',
    !editorMaySettle('requires:c1') && editorMaySettle('delegate:c1:t1') && editorMaySettle(null)
    && /if \(!editorMaySettle\(ask\.key\)\) \{/.test(brief));
  const reqSrc = src('lib/prepare/requirements.ts');
  gate('D5 an unstaged new-work requirement still posts its ask through the ONE turn writer (the resolver\'s missing branch + the lane\'s base offer)',
    /component: \{ key: 'input_checklist', state: \{ items: uncovered\.map\(\(m2\) => m2\.label\), taskId: null \} \}/.test(reqSrc)
    && /await askForFile\(admin, userId, w, label\);\s*\n\s*return \{ did: 'none', reason: 'the file found is the version to update/.test(passSrc));

  console.log(`\n${failures.length ? '✗' : '✓'} smoke-room-truth: ${pass} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
})();
