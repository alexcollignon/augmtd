/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — ROOM SPEED (stabilization W3.7 — docs/stabilization-plan.md PART III; invariant 11
 * NO MUTATION AFTER PAINT; registry precedence #1: compose before paint → last-good → APPEND).
 * Owner requirement: opening an item "ideally would be instantly".
 *
 * ZERO-AI, zero-DB, deterministic: source floors + pure tests (fetch is stubbed in-process).
 * Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-room-speed.ts
 *
 *   A · THE BRIEF IS READY BEFORE THE CLICK — a bounded warm door; the paint budget ≤ 1500ms.
 *   B · THE VIEW DOOR — one preparedState (held into the machine), rail + machine in one wave,
 *       the perf watchdog, the anchor derived ONCE (shared with the warm).
 *   C · THE CLIENT — one view flight (hover warm joined by the open), one thread read, turns keyed
 *       once, the freshness floor kept for ACTION content.
 *   D · ONE AUTHOR — the plan's gap line never renders beside a composed brief.
 *   E · THE OUTCOME LEDGER — the three send surfaces carry what we prepared (W3.2 follow-up).
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { sanitizeWarmItems, WARM_MAX_ITEMS, WARM_DEDUPE_MS } from '../lib/room/warm-briefs';
import { anchorOf, linkKindOf, looseRoomKeyOf, looseTitleOf, activityAtOf } from '../lib/room/item-anchor';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A stubbed fetch that counts calls per URL and answers after a short delay.
type Call = { url: string; body?: string };
function stubFetch(answer: (url: string) => unknown, delayMs = 20): Call[] {
  const calls: Call[] = [];
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body });
    await sleep(delayMs);
    const body = answer(String(url));
    return { ok: true, json: async () => body } as unknown as Response;
  };
  return calls;
}

async function main() {
  // ═══ A · THE BRIEF IS READY BEFORE THE CLICK ═══
  console.log('\nA · the brief is ready before the click (a bounded warm; a short paint budget)');
  {
    const brief = src('lib/room/brief.ts');
    const m = brief.match(/export const BRIEF_PAINT_BUDGET_MS = ([\d_]+);/);
    const budget = m ? Number(m[1].replace(/_/g, '')) : NaN;
    gate(`A1 BRIEF_PAINT_BUDGET_MS ≤ 1500ms (is ${budget}ms) and its WHY is stated beside it`,
      budget > 0 && budget <= 1_500 && /W3\.7 ROOM SPEED/.test(brief));
    gate('A2 joinCompose exists — the warm and the open never pay the model twice for one room',
      /export function joinCompose\(/.test(brief) && /_composeFlight\.get\(k\)/.test(brief)
      && /\.finally\(\(\) => \{ _composeFlight\.delete\(k\); \}\)/.test(brief));
    gate('A3 the action seam does NOT join (a deed recomposes from the post-deed world)',
      existsSync(join(ROOT, 'lib/entities/on-action.ts')) && !/joinCompose/.test(src('lib/entities/on-action.ts')));

    gate('A4 the warm door exists: POST /api/items/warm answers 202 and composes under after() with maxDuration',
      existsSync(join(ROOT, 'app/api/items/warm/route.ts'))
      && (() => {
        const r = src('app/api/items/warm/route.ts');
        return /export async function POST\(/.test(r) && /export const maxDuration = 300;/.test(r)
          && /after\(async \(\) => \{/.test(r) && /status: 202/.test(r) && /sanitizeWarmItems\(body\?\.items\)/.test(r)
          && /supabase\.auth\.getUser\(\)/.test(r);
      })());
    const wb = src('lib/room/warm-briefs.ts');
    gate('A5 the warm is BOUNDED: ≤ WARM_MAX_ITEMS rooms, per-user per-room dedupe window, sequential, same room once',
      WARM_MAX_ITEMS > 0 && WARM_MAX_ITEMS <= 10 && WARM_DEDUPE_MS >= 60_000
      && /items\.slice\(0, WARM_MAX_ITEMS\)/.test(wb) && /claimWarm\(userId, roomKey\)/.test(wb)
      && /doneRooms\.has\(roomKey\)/.test(wb) && !/Promise\.all\(items/.test(wb));
    gate('A6 the warm composes through the SAME sig-gated ensureLooseRoomBrief + joinCompose, with the SAME anchor derivation as the door',
      // ⟲ RE-POINTED (W7.2 ONE OBJECT, ONE DOOR): the item door's brief is item-first under its own
      // key whatever it is linked to, so the warm composes exactly that — its linked→entity branch
      // is gone (it warmed a page the door no longer serves).
      !/ensureRoomBrief\(client, userId, eid\)/.test(wb)
      && /const roomKey = looseRoomKeyOf\(linkKind, it\.id\);/.test(wb)
      && /joinCompose\(userId, roomKey, \(\) => ensureLooseRoomBrief\(client, userId, roomKey, anchorForBrief\)\)/.test(wb)
      && /anchorOf\(linkKind,/.test(wb) && /looseTitleOf\(linkKind,/.test(wb));

    // pure — the trust boundary
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: 'email', id: `0000000${i.toString(16)}-aaaa-bbbb-cccc-000000000000`.slice(0, 36) }));
    const capped = sanitizeWarmItems(many);
    const dedup = sanitizeWarmItems([
      { kind: 'email', id: 'aaaaaaaa-0000-0000-0000-000000000001' },
      { kind: 'awareness', id: 'aaaaaaaa-0000-0000-0000-000000000001' }, // same inbox room
      { kind: 'followup', id: 'aaaaaaaa-0000-0000-0000-000000000002' },
      { kind: 'commitment', id: 'aaaaaaaa-0000-0000-0000-000000000002' }, // same commitment room
    ]);
    const rejects = sanitizeWarmItems([
      { kind: 'entity', id: 'aaaaaaaa-0000-0000-0000-000000000001' },
      { kind: 'email', id: "x' or 1=1 --" },
      { kind: 'email' }, null, 'nope',
    ]);
    gate(`A7 pure: the list is capped at ${WARM_MAX_ITEMS}, same-room kinds dedupe, unknown kinds and malformed ids are dropped`,
      capped.length === WARM_MAX_ITEMS && dedup.length === 2 && rejects.length === 0 && sanitizeWarmItems('x').length === 0);

    const wc = src('lib/room/warm-client.ts');
    const row = src('components/work/work-row.tsx');
    gate('A8 the deck warms: every row-kit row queues its room on mount; one debounced POST carries ≤ the batch',
      /useEffect\(\(\) => \{ queueBriefWarm\(item\.href\); \}, \[item\.href\]\);/.test(row)
      && /if \(_briefBatch\.length >= BRIEF_WARM_BATCH\) return;/.test(wc)
      && /fetch\('\/api\/items\/warm'/.test(wc));

    // pure — the client batch really is one request for the top rows, and a re-render re-warms nothing
    const calls = stubFetch(() => ({ queued: 1 }), 1);
    const { queueBriefWarm, BRIEF_WARM_BATCH } = await import('../lib/room/warm-client');
    for (let i = 0; i < 12; i++) queueBriefWarm(`/item/bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}?kind=email`);
    await sleep(500);
    for (let i = 0; i < 3; i++) queueBriefWarm(`/item/bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}?kind=email`); // the 90s poll re-render
    await sleep(500);
    const warmCalls = calls.filter((c) => c.url === '/api/items/warm');
    const sent = warmCalls[0]?.body ? (JSON.parse(warmCalls[0].body) as { items: unknown[] }).items.length : 0;
    gate(`A9 pure: 12 mounted rows → ONE warm POST carrying ${BRIEF_WARM_BATCH}; a re-render of warmed rows sends nothing`,
      warmCalls.length === 1 && sent === BRIEF_WARM_BATCH, `posts=${warmCalls.length} items=${sent}`);
  }

  // ═══ B · THE VIEW DOOR ═══
  console.log('\nB · the view door — one preparedState, one wave for rail + machine, a watchdog, one anchor');
  {
    const view = src('app/api/items/view/route.ts');
    const preparedReads = (view.match(/preparedState\(supabase/g) ?? []).length + (view.match(/getPrepared\(/g) ?? []).length;
    gate('B1 ONE prepared read on the door (no second getPrepared/preparedState), and its STATE is held',
      preparedReads === 1 && /const preparedArts = prepState\?\.all \?\? \[\];/.test(view), `reads=${preparedReads}`);
    gate('B2 the machine takes the HELD row + prepared state (it re-reads neither)',
      /workStateOf\(supabase, user\.id, \{ kind: linkKind === 'inbox_item' \? 'inbox' : 'commitment', id \},\s*\{ row: itemRow, prepared: prepState \}\)/.test(view));
    const machine = src('lib/work/machine.ts');
    gate('B3 workStateOf honours `held` (row + prepared) and keeps its own reads for unheld callers',
      /held\?: \{/.test(machine) && /held\?\.row !== undefined/.test(machine) && /const st = held\?\.prepared\s*\?\? await preparedState\(/.test(machine)
      && /held \? asksRead\(\) : Promise\.resolve\(null\)/.test(machine));
    gate('B4 the rail, the machine and the door\'s own source object run in ONE flight (Promise.all), beside the already-running compose',
      // ⟲ RE-POINTED (W7.2): the flight gained the door's own source-object resolve (one small
      // read, zero AI) — same wave, no new round trip.
      // ⟲ RE-POINTED (W7.3): + the meeting source object (a meeting-born commitment's source) in the
      // SAME flight — one small read, zero AI, no new round trip.
      // ⟲ RE-POINTED (W16.2): + the source message's authorship (THE ONE SOURCE READER, for the
      // direction-true fallback) in the SAME flight — one small read, zero AI, no new round trip.
      // ⟲ RE-POINTED (W17 · no-waiting): + the cached judgment (the served verdict), STARTED beside wave 1
      // and awaited in the SAME flight — one indexed read, zero AI, no new round trip.
      /const \[room, machine, sourceItemId, sourceMeeting, sourceAuthor, verdict\] = await Promise\.all\(\[roomP, machineP, sourceItemIdP, sourceMeetingP, sourceAuthorP, judgmentP\]\)/.test(view)
      // ⟲ RE-POINTED (W8.4): no compose runs on the paint path any more — the last-good read is what
      // starts before the wave (the vacuous `indexOf('const paintP')` would have passed at -1).
      && view.indexOf('const lastGoodP = readRoomResponse(') > 0
      && view.indexOf('const lastGoodP = readRoomResponse(') < view.indexOf('const [room, machine, sourceItemId, sourceMeeting, sourceAuthor, verdict] = await Promise.all(['));
    gate('B5 the perf watchdog: phase marks + ONE `[items/view] slow` line past a threshold',
      /const VIEW_SLOW_MS = [\d_]+;/.test(view) && /\[items\/view\] slow \$\{totalMs\}ms/.test(view)
      && /mark\('wave1'\)/.test(view) && /mark\('wave2'\)/.test(view));
    gate('B6 the anchor is derived ONCE (lib/room/item-anchor), shared by the door and the warm — no private copy on the door',
      /anchorOf\(linkKind, itemRow, preparedArts\)/.test(view) && /looseTitleOf\(linkKind, itemRow\)/.test(view)
      && !/const replyArt = preparedArts\.find/.test(view) && !/String\(itemRow\?\.work_title \|\|/.test(view));
    const rv = src('lib/entities/room-view.ts');
    gate('B7 the routing chip stays OFF the critical path (cache-or-defer inside the rail\'s own wave; no AI on the read)',
      /suggestWorkerForMove\(supabase, userId, entityId, \{ next_move: ent\.next_move \}, \{ deferOnMiss: true \}\)/.test(rv));

    // pure — the anchor
    // ⟲ RE-POINTED (W15.2 · NO EMPTY READY): the fixture drafts carry words — an empty draft is not live.
    const prep = [{ kind: 'reply_draft', by: 'Sam Coworker', content: 'Thanks — confirming the date.' }] as never;
    const a1 = anchorOf('inbox_item', { source_data: { from_name: 'Acme Ops', understanding: { ask: 'confirm the date' } } }, prep);
    const a2 = anchorOf('commitment', { description: 'Send the deck', counterparty: 'Acme' }, []);
    const a3 = anchorOf('meeting', { title: 'Sync' }, []);
    gate('B8 pure: the anchor reads who/ask/prepared per kind; meetings carry none; a draft without a byline reads "draft"',
      a1.who === 'Acme Ops' && a1.ask === 'confirm the date' && a1.prepared === 'Sam Coworker'
      && a2.who === 'Acme' && a2.ask === 'Send the deck' && a2.prepared === null
      && a3.who === null && a3.ask === null
      && anchorOf('inbox_item', null, [{ kind: 'nudge_draft', by: null, content: 'A quick nudge.' }] as never).prepared === 'draft');
    gate('B9 pure: kinds map to one link kind + one loose key; the title and activity fall back honestly',
      linkKindOf('followup') === 'commitment' && linkKindOf('awareness') === 'inbox_item' && linkKindOf('meeting') === 'meeting'
      && looseRoomKeyOf('inbox_item', 'x') === 'inbox:x' && looseRoomKeyOf('commitment', 'y') === 'commitment:y'
      && looseTitleOf('inbox_item', { source_data: { subject: 'Hello' } }) === 'Hello' && looseTitleOf('meeting', null) === 'this meeting'
      && activityAtOf('inbox_item', { created_at: '2026-09-01' }) === '2026-09-01' && activityAtOf('commitment', { created_at: 'z' }) === null);
  }

  // ═══ C · THE CLIENT ═══
  console.log('\nC · the client — one view flight, one thread read, turns keyed once, freshness kept for action content');
  {
    const detail = src('components/home/item-detail.tsx');
    const wc = src('lib/room/warm-client.ts');
    const row = src('components/work/work-row.tsx');
    gate('C1 the deep-dive reads its view through THE ONE KEY + THE ONE FLIGHT (the open joins a hover warm; a user deed never does)',
      /const key = itemViewKey\(kind, id\);/.test(detail)
      && /const landing = reason === 'open'\s*\? fetchItemView\(kind, id\)/.test(detail)
      && /export const itemViewKey = \(kind: ItemViewKind, id: string\) => `aug-item-view-\$\{kind\}-\$\{id\}`;/.test(wc));
    gate('C2 hover/focus warms the view (prefetchItem → prefetchItemView: intent-delayed, serial, fresh-skip)',
      /prefetchItemView\(href\);/.test(row) && /setTimeout\(\(\) => \{\s*_viewWarmTimers\.delete\(key\);/.test(wc)
      // ⟲ RE-POINTED (W17 · no-waiting): a fresh view still skips its own warm, but the page's OBJECT read
      // may still be cold — the fresh-skip now warms the object once instead of returning bare.
      && /async function drainViewQueue\(\)/.test(wc) && /if \(loadLS\(key, \{ maxAgeMs: VIEW_WARM_TTL_MS \}\) != null\) \{ void warmItemObjectOnce\(t\.kind, t\.id\); return; \}/.test(wc));
    gate('C3 THE FRESHNESS FLOOR stays on the view (ACTION content never paints from a cache older than 15 min — the no-mutation pairing)',
      /loadLS<ItemViewData>\(key, \{ maxAgeMs: ROOM_CACHE_MAX_AGE_MS \}\)/.test(detail)
      && /export const ROOM_CACHE_MAX_AGE_MS = 15 \* 60_000;/.test(src('lib/room/no-mutation.ts')));
    const door = src('lib/inbox/thread-door.ts');
    gate('C4 ONE thread read: the email room joins THE ONE READER (loadThreadRaw) — no private fetch of /thread; the hover warm uses it too',
      /loadThreadRaw\(id, \{ maxAgeMs: THREAD_FRESH_MS \}\)/.test(detail)
      && !/fetch\(`\/api\/inbox\/\$\{id\}\/thread`\)/.test(detail)
      && /export function loadThreadRaw\(/.test(door) && /return loadThreadRaw\(itemId\)\.then\(\(\) => _cache\.get\(itemId\) \?\? EMPTY\);/.test(door)
      // ⟲ RE-POINTED (W17 · no-waiting): the hover warm's object read has ONE owner now — lib/room/
      // warm-client warmItemObject goes through THE ONE READER; the row only states intent.
      && /return loadThreadRaw\(id\)\.then\(/.test(src('lib/room/warm-client.ts')) && !/fetch\(`\/api\/inbox\/\$\{id\}\/thread`\)/.test(row));
    const rail = src('components/home/item-rail.tsx');
    gate('C5 turns keyed ONCE: the rail\'s turns fetch waits for the view-resolved room key (no loose-key fetch while pending)',
      /useEffect\(\(\) => \{\s*if \(pending\) return;\s*let alive = true;\s*fetch\(`\/api\/room\/turns\?key=\$\{encodeURIComponent\(roomKey\)\}`\)/.test(rail)
      && /\}, \[roomKey, turnsNonce, pending\]\);/.test(rail));
    gate('C6 the late brief re-check is timed to the new budget (one re-check; the append rule unchanged)',
      /const LATE_BRIEF_RECHECK_MS = [\d_]+;/.test(detail) && /\}, LATE_BRIEF_RECHECK_MS\);/.test(detail)
      // ⟲ RE-POINTED (W7.2): the item door's late brief rides its OWN field (never the entity's).
      && /lateBrief: \{ text, at: d2\.briefAt \?\? null \}/.test(detail));

    // pure — the thread door: two concurrent readers + the narrowed reader = ONE request
    const calls = stubFetch((url) => (url.includes('/thread') ? { subject: 'S', fromName: 'Acme', messages: [], attachments: [] } : null));
    const td = await import('../lib/inbox/thread-door');
    const id = 'cccccccc-0000-0000-0000-000000000001';
    const [r1, d1, r2] = await Promise.all([td.loadThreadRaw(id, { maxAgeMs: 20_000 }), td.loadThreadDoor(id), td.loadThreadRaw(id)]);
    const d2 = await td.loadThreadDoor(id);
    const again = await td.loadThreadRaw(id, { maxAgeMs: 20_000 });
    const threadCalls = calls.filter((c) => c.url.includes(`/api/inbox/${id}/thread`)).length;
    gate('C7 pure: the room\'s raw read, the object card\'s narrowed read and a hover warm share ONE request; a fresh re-open serves the cache',
      threadCalls === 1 && r1?.subject === 'S' && r2 === r1 && d1.subject === 'S' && d2 === d1 && again === r1, `requests=${threadCalls}`);
    await td.loadThreadRaw(id, { maxAgeMs: 0 }).then(() => null);
    await sleep(5);
    const stale = calls.filter((c) => c.url.includes(`/api/inbox/${id}/thread`)).length;
    gate('C8 pure: an ACTION surface\'s freshness demand re-reads an aged payload (never serves a thread older than it asked for)',
      stale === 2, `requests=${stale}`);

    // pure — the view flight: a hover warm and the open are one request
    const vcalls = stubFetch((url) => (url.includes('/api/items/view') ? { anchor: null, prepared: [] } : null), 30);
    const wcm = await import('../lib/room/warm-client');
    const vid = 'dddddddd-0000-0000-0000-000000000001';
    wcm.prefetchItemView(`/item/${vid}?kind=commitment`, { immediate: true });
    const opened = await wcm.fetchItemView('commitment', vid);
    const viewCalls = vcalls.filter((c) => c.url.includes(`/api/items/view?kind=commitment&id=${vid}`)).length;
    gate('C9 pure: a hover warm in flight + the open = ONE view request; hrefs map to the deep-dive\'s own view kind',
      viewCalls === 1 && !!opened
      && wcm.viewTargetOf(`/item/${vid}`)?.kind === 'email' && wcm.viewTargetOf(`/item/${vid}?kind=followup`)?.kind === 'followup'
      && wcm.viewTargetOf('/meetings/x') === null, `requests=${viewCalls}`);
  }

  // ═══ D · ONE AUTHOR PER OPENING ═══
  console.log('\nD · the plan\'s gap line never speaks beside a composed brief');
  {
    const rail = src('components/home/item-rail.tsx');
    gate('D1 the rail renders the gap ONLY when no composed brief speaks (gapLine), and nowhere else',
      /const gapLine = composed \? null : \(view\.gap \?\? null\);/.test(rail)
      && /\{gapLine && <p className="text-\[13px\] leading-\[1\.5\] text-neutral-800">\{gapLine\}<\/p>\}/.test(rail)
      && !/\{view\.gap && </.test(rail) && !/showShimmer \|\| view\.gap/.test(rail));
    const detail = src('components/home/item-detail.tsx');
    gate('D2 the deep-dive\'s GapLine never renders beside a mounted room (only when there is no rail view at all)',
      !/<GapLine text=\{view\?\.gap\} \/>/.test(detail.replace(/\{!railView && <GapLine text=\{view\?\.gap\} \/>\}/g, '')));
  }

  // ═══ E · THE OUTCOME LEDGER (W3.2 follow-up) ═══
  console.log('\nE · the send surfaces carry what we prepared');
  {
    const detail = src('components/home/item-detail.tsx');
    gate('E1 EmailDetail send carries the seeded draft as aiDraft (HTML, like customMessage)',
      /customMessage: html, attachments: atts\.attachments, \.\.\.\(draft \? \{ aiDraft: draftToHTML\(draft\) \} : \{\}\)/.test(detail));
    gate('E2 ComposePanel send carries `prepared` (itemKind mapped, the drafter\'s seed; a blank seed prepared nothing)',
      /prepared: initialHTML && initialHTML !== '<p><\/p>'\s*\? \{ itemKind: kind === 'email' \|\| kind === 'awareness' \? 'inbox' : kind, itemId: entityId, bodyHTML: initialHTML \}\s*: null,/.test(detail));
    gate('E3 the FollowUp nudge send carries the seeded nudge as aiDraft (plain text, like body)',
      /body: text, attachments: atts\.attachments, \.\.\.\(draft \? \{ aiDraft: draft \} : \{\}\)/.test(detail));
    const sr = src('app/api/inbox/[id]/send-reply/route.ts');
    const cs = src('app/api/compose/send/route.ts');
    const ng = src('app/api/commitments/[id]/nudge/route.ts');
    gate('E4 each door reads the field the surface now sends (aiDraft · prepared · aiDraft)',
      /aiDraft/.test(sr) && /raw\.prepared/.test(cs) && /aiDraft/.test(ng));
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAIL'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
  console.log('PASS');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
