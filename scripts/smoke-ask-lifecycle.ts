/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — ASKS AND NARRATION LIVE AND DIE WITH THEIR WORK (stabilization W14.2 —
 * docs/stabilization-plan.md; docs/laws-registry.md `asks-live-and-die-with-their-work` ·
 * `narration-follows-its-artifact` · `a-claim-renders`).
 *
 * ZERO-AI, ZERO-DB (an in-memory PostgREST fixture — tests/fixtures/fake-postgrest.ts), deterministic.
 * A read-only census (Sep 24, 4 live accounts) found the durable room record outliving its truth:
 *   A · 24 live asks whose stored words claim readiness → the sweep RE-SPEAKS them with the
 *       deterministic floor (zero AI), bounded + reported; the floor never trips the net
 *   B ·  3 live asks HIDDEN as moot → archived on every verdict write AND by the sweep (never deleted)
 *   C ·  9 live asks on closed items → every resolution door settles them (reversibly); the ONE
 *       reopen (the Undo) restores them; the sweep is the net for any door
 *   D · 16 live prep narrations over nothing live → never served (read-time floor at the turn door),
 *       and settled durably by the send doors, apply-verdict's strip and the sweep (archive, never delete)
 *   E · the lane rides the judgment sweep, and the cron reports its tally
 * Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-ask-lifecycle.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { fakePostgrest } from '../tests/fixtures/fake-postgrest';

const failures: string[] = [];
let pass = 0;
function gate(name: string, ok: boolean) { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { failures.push(name); console.log(`  ✗ ${name}`); } }
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// ZERO AI / ZERO NETWORK: any fetch is a failure.
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error('SMOKE: network refused'); }) as typeof fetch;

const U = 'user-1';
const ITEM = '11111111-1111-4111-8111-111111111111';
const ITEM2 = '22222222-2222-4222-8222-222222222222';
const COMMIT = '33333333-3333-4333-8333-333333333333';
const COMMIT2 = '44444444-4444-4444-8444-444444444444';
const ask = (over: Record<string, unknown>) => ({
  id: `t-${Math.random().toString(36).slice(2, 8)}`, user_id: U, role: 'system', archived_at: null, author: null, refs: null,
  created_at: '2026-09-20T10:00:00Z', ...over,
});
const checklist = (items: string[], extra: Record<string, unknown> = {}) => ({ key: 'input_checklist', state: { items, ...extra } });
const judgment = (key: string, verdict: Record<string, unknown>) => ({ id: `j-${key}`, user_id: U, kind: 'judgment', entity_id: key, tasks: { verdict }, updated_at: '2026-09-24T08:00:00Z', created_at: '2026-09-24T08:00:00Z' });

(async () => {
  const L = await import('../lib/room/ask-lifecycle');
  const N = await import('../lib/prepare/narration');
  const { askSpeechIsFalse } = await import('../lib/room/legacy-ask-speech');
  const T = await import('../lib/room/turns');

  // ═══ A · THE SWEEP RE-SPEAKS FALSE ASKS WITH THE FLOOR ═══
  console.log('\nA · FALSE ASKS ARE RE-SPOKEN WHERE THE PLATFORM ALREADY WRITES');
  {
    const falseText = 'I have the details on the quarterly pack ready to go, but I need the signed cover page.';
    const db = fakePostgrest({
      room_turns: [
        ask({ id: 'a1', room_key: `commitment:${COMMIT}`, dedupe_key: `requires:${COMMIT}`, text: falseText,
          refs: [{ label: 'Share the quarterly pack', href: null }], component: checklist(['signed cover page'], { base: ['pack_v1.pptx'] }) }),
        ask({ id: 'a2', room_key: `inbox:${ITEM}`, dedupe_key: `requires:${ITEM}`, text: "All set — I've got the invoice ready to send, I only need the PO number.",
          refs: [{ label: 'Invoice for Acme', href: null }], component: checklist(['PO number']) }),
      ],
      inbox_items: [{ id: ITEM, user_id: U, status: 'pending', source: 'gmail', source_data: { subject: 'Invoice for Acme' } }],
      commitments: [{ id: COMMIT, user_id: U, status: 'open', description: 'Share the quarterly pack' }],
      item_plans: [judgment(`commitment:${COMMIT}`, { work: 'send_file', requires: ['signed cover page'] }), judgment(`inbox:${ITEM}`, { work: 'reply', requires: ['PO number'] })],
      item_deliverables: [],
    });
    gate('A1 · the ONE decision: an open item\'s ask whose words claim readiness is re-spoken (not kept, not archived)',
      L.decideAsk({ ask: db.tables.room_turns[0], closed: false, open: true, facts: { itemTitle: 'x', itemKind: 'commitment' }, verdict: { work: 'send_file', requires: ['signed cover page'] }, speechFalse: true, itemless: false }) === 'respeak_false');
    const dry = await L.runAskLifecycleLane(db.client, U, { apply: false });
    gate('A2 · dry run (the census\'s mode) counts what it WOULD re-speak and writes nothing', dry.falseRespoken === 2 && db.writes.length === 0);
    const capped = await L.runAskLifecycleLane(db.client, U, { respeakCap: 1 });
    gate('A3 · bounded + REPORTED: a cap of 1 re-speaks one and counts the other as left behind (never silent)', capped.falseRespoken === 1 && capped.leftBehind === 1);
    const r = await L.runAskLifecycleLane(db.client, U, {});
    const a1 = db.tables.room_turns.find((t) => t.id === 'a1')!; const a2 = db.tables.room_turns.find((t) => t.id === 'a2')!;
    gate('A4 · the lane re-speaks the rest: both stored asks now pass the claim net (true by construction)',
      capped.falseRespoken + r.falseRespoken === 2 && !(await askSpeechIsFalse(a1.text)) && !(await askSpeechIsFalse(a2.text)));
    gate('A5 · the floor speaks the ask\'s own labels + work, and the base sentence rides as the tail (never dropped)',
      /signed cover page/.test(a1.text) && /pack_v1\.pptx/.test(a1.text) && /not the new work itself/.test(a1.text) && /PO number/.test(a2.text));
    gate('A6 · the turns stay LIVE, keyed and componented (a re-speak changes words, never the ask)',
      a1.archived_at === null && a1.component.key === 'input_checklist' && a1.dedupe_key === `requires:${COMMIT}`);
    const again = await L.runAskLifecycleLane(db.client, U, {});
    gate('A7 · idempotent: a second run finds nothing false', again.falseRespoken === 0 && again.falseUnfixable === 0);
    gate('A8 · the write is a CONDITIONAL claim on the words judged false (a concurrent re-speak wins)',
      /update\(\{ text: floor \}\)[\s\S]{0,160}\.eq\('text', String\(a\.text \?\? ''\)\)/.test(src('lib/room/ask-lifecycle.ts')));
    gate('A9 · a floor that would itself trip the net is never written (counted as unfixable)',
      (await L.falseAskFloor({ labels: ['x'], itemTitle: 'Get the deck ready to send', bases: [] })) === null);
  }

  // ═══ B · A HIDDEN ASK IS NOT A LIVE ONE ═══
  console.log('\nB · MOOT ASKS ARCHIVE ON EVERY VERDICT WRITE AND IN THE SWEEP');
  {
    const facts = { itemTitle: 'Budget review', itemKind: 'inbox' as const };
    const draftAsk = { dedupe_key: `requires:${ITEM}`, component: checklist(['reply draft']) };
    gate('B1 · the machine\'s condition exactly: a draft-shaped engine ask under an actionable verdict is hidden-moot',
      L.askHiddenAsMoot(draftAsk, facts, { work: 'reply' }) === true);
    gate('B2 · …never under a none verdict, never a coworker\'s delegate ask, never a proceeded ask, never a live label',
      !L.askHiddenAsMoot(draftAsk, facts, { work: 'none' })
      && !L.askHiddenAsMoot({ ...draftAsk, dedupe_key: `delegate:${ITEM}:x` }, facts, { work: 'reply' })
      && !L.askHiddenAsMoot({ ...draftAsk, component: checklist(['reply draft'], { proceeded: true }) }, facts, { work: 'reply' })
      && !L.askHiddenAsMoot({ ...draftAsk, component: checklist(['signed PO']) }, facts, { work: 'reply' }));
    gate('B3 · rule 3 (labels outlived the verdict) counts: the verdict now requires something else',
      L.askHiddenAsMoot({ dedupe_key: `requires:${ITEM}`, component: checklist(['vendor tax certificate']) }, facts, { work: 'send_file', requires: ['board minutes'] }));
    const db = fakePostgrest({
      room_turns: [
        ask({ id: 'm1', room_key: `inbox:${ITEM}`, dedupe_key: `requires:${ITEM}`, text: 'I need the reply draft.', component: checklist(['reply draft']) }),
        ask({ id: 'm2', room_key: `inbox:${ITEM2}`, dedupe_key: `requires:${ITEM2}`, text: 'I need the vendor tax certificate.', component: checklist(['vendor tax certificate']) }),
      ],
      inbox_items: [
        { id: ITEM, user_id: U, status: 'pending', source: 'gmail', source_data: { subject: 'Budget review' } },
        { id: ITEM2, user_id: U, status: 'pending', source: 'gmail', source_data: { subject: 'Supplier onboarding' } },
      ],
      commitments: [], item_deliverables: [],
      item_plans: [judgment(`inbox:${ITEM2}`, { work: 'send_file', requires: ['board minutes'] })],
    });
    const { applyVerdictConsequences } = await import('../lib/work/apply-verdict');
    await applyVerdictConsequences(db.client, U, { kind: 'inbox', id: ITEM }, { work: 'reply', reason: 'reply owed', requires: [] } as never);
    const m1 = db.tables.room_turns.find((t) => t.id === 'm1')!;
    gate('B4 · THE VERDICT WRITE archives the hidden ask — archived, never deleted, component kept + stamped `mooted`',
      !!m1.archived_at && m1.component?.key === 'input_checklist' && !!m1.component?.state?.mooted && db.tables.room_turns.length === 2);
    const r = await L.runAskLifecycleLane(db.client, U, {});
    const m2 = db.tables.room_turns.find((t) => t.id === 'm2')!;
    gate('B5 · THE SWEEP archives what no verdict write reached (rule 3 — the label outlived the verdict)',
      r.mootArchived === 1 && !!m2.archived_at && m2.component?.state?.mooted?.by === 'sweep');
    gate('B6 · apply-verdict calls the archive on EVERY non-failed verdict (after the failure-honesty return, before resolution)',
      /if \(verdict\.failed\) return out;[\s\S]{0,2600}archiveMootAsksForItem[\s\S]{0,400}\/\/ ── 1\. RESOLUTION/.test(src('lib/work/apply-verdict.ts')));
    gate('B7 · the machine and the archive read ONE predicate (askIsMoot + verdictRequireLabels, lib/room/ask-mootness)',
      /import \{ askIsMoot, verdictRequireLabels, isEngineAskKey \} from '@\/lib\/room\/ask-mootness'/.test(src('lib/room/ask-lifecycle.ts'))
      && /askIsMoot/.test(src('lib/work/machine.ts')));
  }

  // ═══ C · A RESOLUTION TAKES ITS ASKS; THE UNDO BRINGS THEM BACK ═══
  console.log('\nC · DISMISS/RESOLVE SETTLES THE ITEM\'S ASKS · UNDO RESTORES THEM');
  {
    const db = fakePostgrest({
      room_turns: [
        ask({ id: 'c1', room_key: `inbox:${ITEM}`, dedupe_key: `requires:${ITEM}`, text: 'I need the signed PO to finish the reply.', component: checklist(['signed PO']) }),
        ask({ id: 'c2', room_key: `inbox:${ITEM}`, dedupe_key: `delegate:${ITEM}:run1`, text: 'Could you point me to last year\'s figures?', author: { kind: 'coworker', name: 'Max' }, component: checklist(['last year figures']) }),
        ask({ id: 'c3', room_key: `inbox:${ITEM2}`, dedupe_key: `requires:${ITEM2}`, text: 'I need the shared deck for both.', component: checklist(['shared deck'], { covers: [`inbox:${ITEM2}`, `inbox:${ITEM}`] }) }),
      ],
      inbox_items: [
        { id: ITEM, user_id: U, status: 'pending', source: 'gmail', work_title: 'Reply to Acme', source_data: { subject: 'PO for Acme' } },
        { id: ITEM2, user_id: U, status: 'pending', source: 'gmail', work_title: 'Deck for Acme', source_data: { subject: 'Deck' } },
      ],
      commitments: [], item_deliverables: [], item_plans: [], activity_events: [], learning_signals: [],
    });
    const { executeResolveInboxItem } = await import('../lib/tools/item-actions');
    await executeResolveInboxItem({ client: db.client, userId: U } as never, { itemId: ITEM, resolution: 'dismiss' });
    const c1 = db.tables.room_turns.find((t) => t.id === 'c1')!; const c2 = db.tables.room_turns.find((t) => t.id === 'c2')!; const c3 = db.tables.room_turns.find((t) => t.id === 'c3')!;
    gate('C1 · the ONE manual resolver settles the engine ask: archived WHOLE, never deleted, re-keyed + stamped (ref, why=resolved)',
      !!c1.archived_at && c1.component?.key === L.SETTLED_ASK_KEY && c1.component?.state?.settled?.ref === `inbox:${ITEM}` && c1.component?.state?.settled?.why === 'resolved');
    gate('C2 · a coworker\'s ask keeps its words live (conversation history) — only the affordance goes',
      c2.archived_at === null && c2.component?.key === L.SETTLED_ASK_KEY && c2.text.includes("last year"));
    gate('C3 · a MERGED ask stays for its sibling, minus this beneficiary (kept in coversSettled for the undo)',
      c3.archived_at === null && c3.component.key === 'input_checklist' && JSON.stringify(c3.component.state.covers) === JSON.stringify([`inbox:${ITEM2}`])
      && JSON.stringify(c3.component.state.coversSettled) === JSON.stringify([`inbox:${ITEM}`]));
    const { reopenInboxItem } = await import('../lib/activity/reopen');
    await reopenInboxItem(db.client, U, ITEM);
    gate('C4 · THE UNDO IS SYMMETRIC: the engine ask is live again under its own key, as it stood',
      c1.archived_at === null && c1.component?.key === 'input_checklist' && !c1.component?.state?.settled && c1.dedupe_key === `requires:${ITEM}`
      && JSON.stringify(c1.component.state.items) === '["signed PO"]');
    gate('C5 · …the coworker\'s checklist is back, and the merged ask covers this item again',
      c2.component?.key === 'input_checklist' && c3.component.state.covers.includes(`inbox:${ITEM}`) && !c3.component.state.coversSettled.includes(`inbox:${ITEM}`));
    // a live re-post wins over the restore
    await executeResolveInboxItem({ client: db.client, userId: U } as never, { itemId: ITEM, resolution: 'dismiss' });
    await T.writeRoomTurn(db.client, U, `inbox:${ITEM}`, { role: 'system', text: 'I need the countersigned PO.', component: { key: 'input_checklist', state: { items: ['countersigned PO'] } }, dedupeKey: `requires:${ITEM}` });
    await reopenInboxItem(db.client, U, ITEM);
    const liveKeyed = db.tables.room_turns.filter((t) => t.dedupe_key === `requires:${ITEM}` && t.archived_at === null);
    gate('C6 · a LIVE re-post of the key wins: the restore never makes two live asks on one key (the settled row stays record)',
      liveKeyed.length === 1 && /countersigned/.test(liveKeyed[0].text));
    // why ≠ resolved never comes back
    const db2 = fakePostgrest({ room_turns: [
      ask({ id: 'w1', room_key: `inbox:${ITEM}`, dedupe_key: `requires:${ITEM}`, text: 'I need X.', component: checklist(['X']) }),
    ], inbox_items: [{ id: ITEM, user_id: U, status: 'dismissed', source_data: {} }], activity_events: [] });
    await T.settleAsksForItem(db2.client, U, 'inbox_item', ITEM, { why: 'answered' });
    await T.restoreAsksForItem(db2.client, U, 'inbox_item', ITEM);
    gate('C7 · an ask the user ANSWERED (or a verdict retired) is never revived by an undo',
      !!db2.tables.room_turns[0].archived_at && db2.tables.room_turns[0].component.key === L.SETTLED_ASK_KEY);
    // the batch undo
    const db3 = fakePostgrest({ room_turns: [
      ask({ id: 'b1', room_key: `inbox:${ITEM}`, dedupe_key: `requires:${ITEM}`, text: 'I need Y.', component: checklist(['Y']) }),
    ], inbox_items: [{ id: ITEM, user_id: U, status: 'pending', source_data: {} }], activity_events: [] });
    await T.settleAsksForItem(db3.client, U, 'inbox_item', ITEM);
    db3.tables.inbox_items[0].status = 'dismissed';
    const { reopenInboxItems } = await import('../lib/activity/reopen');
    await reopenInboxItems(db3.client, U, [ITEM, ITEM2]);
    gate('C8 · the BATCH undo (a bulk deed) restores its members\' asks too', db3.tables.room_turns[0].archived_at === null && db3.tables.room_turns[0].component.key === 'input_checklist');
    // the sweep is the net for any door
    const db4 = fakePostgrest({ room_turns: [
      ask({ id: 'n1', room_key: `inbox:${ITEM}`, dedupe_key: `requires:${ITEM}`, text: 'I need Z.', component: checklist(['Z']) }),
      ask({ id: 'n2', room_key: `inbox:${ITEM2}`, dedupe_key: `requires:${ITEM2}`, text: 'I need W.', component: checklist(['W']) }),
    ], inbox_items: [
      { id: ITEM, user_id: U, status: 'dismissed', source: 'commitment', source_data: { subject: 'mirror' } },
      { id: ITEM2, user_id: U, status: 'pending', source: 'gmail', source_data: { subject: 'open' } },
    ], commitments: [], item_plans: [], item_deliverables: [] });
    const net = await L.runAskLifecycleLane(db4.client, U, {});
    gate('C9 · THE SWEEP IS THE NET: an ask on an item some other door closed (a retired mirror) settles within one cycle; an open item\'s stays',
      net.closedSettled === 1 && !!db4.tables.room_turns[0].archived_at && db4.tables.room_turns[1].archived_at === null);
    await T.restoreAsksForItem(db4.client, U, 'inbox_item', ITEM);
    gate('C10 · …and even the net\'s settle is reversible by the ONE reopen', db4.tables.room_turns[0].archived_at === null);
    // every door
    const doors: Array<[string, RegExp]> = [
      ['lib/tools/item-actions.ts', /await import\('@\/lib\/room\/turns'\)\.then\(\(\{ settleAsksForItem \}\)[\s\S]*await import\('@\/lib\/room\/turns'\)\.then\(\(\{ settleAsksForItem \}\)/],
      ['lib/work/apply-verdict.ts', /status: expired \? 'dismissed' : 'completed'[\s\S]{0,1400}await import\('@\/lib\/room\/turns'\)\.then\(\(\{ settleAsksForItem \}\)/],
      ['app/api/commitments/[id]/route.ts', /settleAsksForItem/],
      ['app/api/inbox/dismiss-sender/route.ts', /settleAsksForItem/],
      ['app/api/inbox/[id]/delete-source/route.ts', /settleAsksForItem/],
      ['app/api/inbox/[id]/archive-source/route.ts', /settleAsksForItem/],
      ['app/api/inbox/[id]/move-to-folder/route.ts', /settleAsksForItem/],
      ['app/api/inbox/[id]/confirm/route.ts', /not_my_task'\) await import\('@\/lib\/room\/turns'\)/],
      ['app/api/inbox/[id]/send-reply/route.ts', /settleAsksForItem/],
      ['app/api/commitments/[id]/nudge/route.ts', /settleAsksForItem/],
      ['app/api/meetings/[id]/rsvp/route.ts', /settleAsksForItem/],
      ['app/api/workflows/[id]/route.ts', /settleAsksForItem[\s\S]*settleAsksForItem/],
      ['lib/inbox/rules/execute.ts', /settleAsksForItem/],
      ['lib/inbox/commitment-mirrors.ts', /settleAsksForItem/],
      ['lib/workflows/standing.ts', /(settleAsksForItem[\s\S]*){4}/],
      ['lib/workflows/handoffs.ts', /settleAsksForItem/],
      ['lib/inbox/resolve-on-reply.ts', /(await import\('@\/lib\/room\/turns'\)\.then\(\(\{ settleAsksForItem \}\)[\s\S]*){2}/],
      ['lib/commitments/expiry.ts', /await import\('@\/lib\/room\/turns'\)\.then\(\(\{ settleAsksForItem \}\)/],
      ['lib/work/evidence-settle.ts', /await import\('@\/lib\/room\/turns'\)\.then\(\(\{ settleAsksForItem \}\)/],
      ['lib/work/conversation-delta.ts', /await import\('@\/lib\/room\/turns'\)\.then\(\(\{ settleAsksForItem \}\)/],
      ['lib/inbox/conversation-identity.ts', /await import\('@\/lib\/room\/turns'\)\.then\(\(\{ settleAsksForItem \}\)/],
    ];
    const missing = doors.filter(([f, re]) => !re.test(src(f))).map(([f]) => f);
    gate(`C11 · EVERY resolution door settles the item's asks, AWAITED (no fire-and-forget)${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`, missing.length === 0);
    const noFireAndForget = ['lib/tools/item-actions.ts', 'lib/work/apply-verdict.ts', 'lib/inbox/resolve-on-reply.ts', 'lib/commitments/expiry.ts', 'lib/work/evidence-settle.ts', 'lib/work/conversation-delta.ts', 'lib/inbox/conversation-identity.ts']
      .filter((f) => /^\s*import\('@\/lib\/room\/turns'\)\.then\(\(\{ settleAsksForItem \}\)/m.test(src(f)));
    gate('C12 · no resolution door fires its settle and forgets it (the census\'s verdict-dismiss leak)', noFireAndForget.length === 0);
    const reopen = src('lib/activity/reopen.ts');
    gate('C13 · THE ONE reopen restores (single inbox · single commitment · the batch)',
      (reopen.match(/restoreAsksForItem\(/g) ?? []).length >= 2 && /restoreAsksForItems\(/.test(reopen));
  }

  // ═══ D · THE NARRATION FOLLOWS ITS ARTIFACT — AT READ TIME AND DURABLY ═══
  console.log('\nD · ORPHANED PREP NARRATION NEVER RENDERS AND IS SETTLED BY SEND / STRIP / SWEEP');
  {
    gate('D1 · the prep key names its item (all three spellings); other prep-ish keys are not item narrations',
      JSON.stringify(N.prepItemOfKey(`prep:commit:${COMMIT}`)) === JSON.stringify({ kind: 'commitment', id: COMMIT })
      && N.prepItemOfKey(`prep:inbox:${ITEM}`)?.kind === 'inbox' && N.prepItemOfKey(`prep:commitment:${COMMIT}`)?.id === COMMIT
      && N.prepItemOfKey('meeting-prep:abc') === null && N.prepItemOfKey('prep:handoff-reassigned-away:r1:r2') === null);
    const turns = [
      { role: 'system', key: `prep:inbox:${ITEM}`, text: 'Clara drafted the reply — ready to review.' },
      { role: 'system', key: `prep:commit:${COMMIT}`, text: 'Clara found the file and drafted the send.' },
      { role: 'user', key: undefined, text: 'thanks' },
      { role: 'system', key: `prep:inbox:${ITEM2}`, text: 'unknown item' },
    ];
    const kept = N.withholdOrphanNarrations(turns, new Map([[`inbox:${ITEM}`, false], [`commitment:${COMMIT}`, true]]));
    gate('D2 · THE RENDER RULE: orphaned → withheld; live → served; unreadable → served (a doubt never withholds)',
      kept.length === 3 && !kept.some((t) => t.key === `prep:inbox:${ITEM}`) && kept.some((t) => t.key === `prep:inbox:${ITEM2}`));
    const db = fakePostgrest({
      room_turns: [], item_deliverables: [], commitments: [],
      inbox_items: [{ id: ITEM, user_id: U, status: 'pending', source: 'gmail', source_data: { subject: 'Hello', nudge_draft: { body: 'Just checking in on the invoice.', sent_at: '2026-09-23T10:00:00Z' } } }],
    });
    const served = await N.servedNarrationTurns(db.client, U, turns.slice(0, 1));
    gate('D3 · THE TURN DOOR: a narration over an item whose ONE READER holds nothing live is not served (decided before the paint)',
      served.length === 0 && db.writes.length === 0);
    const dbLive = fakePostgrest({
      room_turns: [], item_deliverables: [], commitments: [],
      inbox_items: [{ id: ITEM, user_id: U, status: 'pending', source: 'gmail', source_data: { subject: 'Hello', from: 'sam@acme-example.com', draft: { body: 'Hi Sam, Tuesday at 10 works for me. Best', generated_at: '2026-09-23T10:00:00Z' } } }],
    });
    gate('D3b · …and a narration whose item holds a LIVE draft is served (the floor never hides true words)',
      (await N.servedNarrationTurns(dbLive.client, U, turns.slice(0, 1))).length === 1);
    const route = src('app/api/room/turns/route.ts');
    gate('D4 · the room\'s turn door serves through the floor, before the ask-truth floor, with no write',
      /servedNarrationTurns\(supabase, user\.id, turns\)[\s\S]{0,120}truthfulAskTurns\(served/.test(route));
    gate('D5 · a SENT artifact is a positive finding (the reader holds nothing unsent)',
      N.narrationOrphaned({ live: [], all: [], sentStamp: true }) === true && N.narrationOrphaned({ live: [], all: [] }) === false);
    // the sweep settles durably
    const db2 = fakePostgrest({
      room_turns: [
        { id: 'p1', user_id: U, room_key: `inbox:${ITEM}`, role: 'system', dedupe_key: `prep:inbox:${ITEM}`, text: 'Clara drafted the nudge.', archived_at: null },
        { id: 'p2', user_id: U, room_key: `inbox:${ITEM2}`, role: 'system', dedupe_key: `prep:inbox:${ITEM2}`, text: 'Max is on it.', archived_at: null },
        { id: 'p3', user_id: U, room_key: `commitment:${COMMIT}`, role: 'system', dedupe_key: `prep:commit:${COMMIT}`, text: 'Clara drafted the send.', archived_at: null },
        { id: 'p4', user_id: U, room_key: `commitment:${COMMIT2}`, role: 'system', dedupe_key: `prep:commit:${COMMIT2}`, text: 'Clara wrote the words.', archived_at: null },
      ],
      inbox_items: [
        { id: ITEM, user_id: U, status: 'pending', source: 'gmail', source_data: { subject: 'Hello', nudge_draft: { body: 'Just checking in.', sent_at: '2026-09-23T10:00:00Z' } } },
        { id: ITEM2, user_id: U, status: 'pending', source: 'gmail', source_data: { subject: 'Other' } },
      ],
      commitments: [{ id: COMMIT, user_id: U, status: 'done', description: 'Send the deck' }, { id: COMMIT2, user_id: U, status: 'open', description: 'Write the update' }],
      item_deliverables: [{ id: 'f1', user_id: U, kind: 'commitment', entity_id: COMMIT2, type: 'document', task_id: 'paste-pack', title: 'Words', content: 'x', metadata: { version_of: 'superseded:false-claim' }, created_at: '2026-09-23T10:00:00Z' }],
      item_plans: [],
    });
    const r = await L.runAskLifecycleLane(db2.client, U, {});
    const p = (id: string) => db2.tables.room_turns.find((t) => t.id === id)!;
    gate('D6 · THE SWEEP archives an open item\'s orphaned narration (its work went out) — never deletes; a closed item\'s record is its resolution\'s',
      !!p('p1').archived_at && p('p3').archived_at === null && db2.tables.room_turns.length === 4);
    gate('D6b · …and one over work the reader HID (filed into the version chain as superseded) — stored-but-unserved is withdrawn',
      !!p('p4').archived_at && r.narrationsSettled === 2);
    gate('D7 · …but an item with NOTHING in its reader is not a positive finding — the durable record waits (the render floor already hides it)',
      p('p2').archived_at === null);
    gate('D8 · THE SEND DOORS settle the narration (reply · nudge · invite/forward execute)',
      /settlePrepNarration\(supabase, user\.id, \{ kind: 'inbox', id \}, \{ retired: 1 \}\)/.test(src('app/api/inbox/[id]/send-reply/route.ts'))
      && /settlePrepNarration\(supabase, user\.id, \{ kind: 'commitment', id \}, \{ retired: 1 \}\)/.test(src('app/api/commitments/[id]/nudge/route.ts'))
      && /settlePrepNarration\(supabase, userId, \{ kind: itemKind, id: entityId \}, \{ retired: 1 \}\)/.test(src('app/api/items/execute/route.ts')));
    const av = src('lib/work/apply-verdict.ts');
    gate('D9 · APPLY-VERDICT\'S STRIP archives the narration, never deletes it',
      !/room_turns'\)\.delete\(\)\.eq\('user_id', userId\)\.eq\('dedupe_key', `prep:/.test(av) && /if \(!narrationBacked\) \{[\s\S]{0,500}update\(\{ archived_at/.test(av));
    const db3 = fakePostgrest({
      room_turns: [{ id: 'v1', user_id: U, room_key: `inbox:${ITEM}`, role: 'system', dedupe_key: `prep:inbox:${ITEM}`, text: 'Clara drafted the reply — ready to review.', archived_at: null }],
      inbox_items: [{ id: ITEM, user_id: U, status: 'pending', source: 'gmail', source_data: { subject: 'Hello' } }],
      commitments: [], item_deliverables: [], item_plans: [],
    });
    const { applyVerdictConsequences } = await import('../lib/work/apply-verdict');
    await applyVerdictConsequences(db3.client, U, { kind: 'inbox', id: ITEM }, { work: 'decide', reason: 'a choice is owed' } as never);
    gate('D10 · …run: a decide verdict with no brief in the pool archives the reply narration (the row survives as record)',
      db3.tables.room_turns.length === 1 && !!db3.tables.room_turns[0].archived_at);
  }

  // ═══ E · THE LANE RIDES THE SWEEP ═══
  console.log('\nE · THE LANE RIDES THE JUDGMENT SWEEP (fanned per user) AND IS REPORTED');
  {
    const js = src('lib/work/judgment-sweep.ts');
    gate('E1 · runJudgmentSweep runs the ask lane under its own slice, before the judgments, and carries its tally',
      /await graduate\(\);[\s\S]{0,1600}runAskLifecycleLane\(admin, userId/.test(js) && /asks: AskLifecycleResult/.test(js) && /asks: emptyAskLifecycle\(\)/.test(js));
    gate('E2 · a skipped or failed lane SAYS so (never an empty-looking tally)', /skipped: 'budget too small this run'/.test(js) && /skipped: 'the lane failed this run — nothing moved'/.test(js));
    gate('E3 · the cron reports the lane beside the judgments', /notJudged, asks \}/.test(src('app/api/cron/judgment-sweep/route.ts')));
    gate('E4 · ZERO AI: the lane imports no AI door, and nothing in this suite reached the network',
      !/getAIClient|aiCreate|aiCall\(/.test(src('lib/room/ask-lifecycle.ts')) && fetches === 0);
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
