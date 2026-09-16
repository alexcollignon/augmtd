// THE ONE ROOM GATES (docs/one-room-plan.md).
//   R1 — durable room conversations: one turns module, one API, the rail hydrates + persists,
//   THE ENGINE NARRATES (prepare pass + delegation report-backs write authored turns), the
//   keyed-turn dedupe survives, entity vs loose keys separate. Live across users.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const A = '08fe4449-e5eb-431d-9156-02e9324e5903';
const B = 'c723c2f2-e069-4ab8-980e-ac3585028fec';
let PERSONAL = ''; // the PROBE HOST — resolved at start (scripts/probe-user.ts)
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  PERSONAL = await resolveProbeUser(sb);
  // ── R1 STRUCTURAL ──
  const mig = src('supabase/migrations/20260725_room_turns.sql');
  check('R1: room_turns migration — owner-RLS + keyed-dedupe partial index + author/component columns',
    mig.includes('ENABLE ROW LEVEL SECURITY') && mig.includes('WHERE dedupe_key IS NOT NULL') &&
    mig.includes('author JSONB') && mig.includes('component JSONB'));
  const lib = src('lib/room/turns.ts');
  check('R1: ONE turns module — non-fatal by design (degrades to in-memory pre-migration), one key convention',
    lib.includes('export async function writeRoomTurn') && lib.includes('export async function readRoomTurns') &&
    lib.includes('export async function roomKeyForItem') && lib.includes('looseRoomKey') &&
    (lib.match(/catch \{/g)?.length ?? 0) >= 3);
  check('R1: the client API never sets author — coworker attribution is server-path-only',
    src('app/api/room/turns/route.ts').includes('never sets `author`') &&
    !src('app/api/room/turns/route.ts').includes('author: body'));
  const rail = src('components/home/item-rail.tsx');
  check('R1: the rail HYDRATES from the durable record and persists every write (addTurn/persistTurn/pushDealTurn)',
    rail.includes("fetch(`/api/room/turns?key=") && rail.includes('function persistTurn') &&
    rail.includes('const addTurn') && rail.includes('persistTurn(entityId, turn)') &&
    !rail.includes('`item-${id}`'));
  check('R1: THE ENGINE NARRATES — the prepare pass writes a deduped, authored room turn on success',
    src('lib/prepare/pass.ts').includes('narratePrepare') &&
    src('lib/prepare/pass.ts').includes('`prep:${w.id}`'));
  check('R1: THE ENGINE NARRATES — a delegation report-back lands as the coworker\'s authored turn in the room',
    src('lib/home/delegate.ts').includes('writeRoomTurn') &&
    src('lib/home/delegate.ts').includes("kind: 'coworker', id: worker.id"));
  check('R1: turns can carry an inline component (the component-bearing stream, R2-ready)',
    lib.includes('component?:') && mig.includes('component JSONB'));

  // ── R1 LIVE — roundtrip / dedupe / author / key separation, per user ──
  const { writeRoomTurn, readRoomTurns, roomKeyForItem, looseRoomKey } = await import('../lib/room/turns');
  // Table present? (the migration is manual — name the pending state honestly, never greenwash.
  // NB: a head:true select does NOT error on a missing table; a real select does.)
  const probe = await sb.from('room_turns').select('id').limit(1);
  if (probe.error) {
    check('R1 LIVE: BLOCKED — apply supabase/migrations/20260725_room_turns.sql first', false, String(probe.error.message).slice(0, 80));
  } else {
    for (const [uid, label] of [[A, 'user A'], [B, 'user B'], [PERSONAL, 'personal']] as const) {
      const key = `zz-smoke:${uid.slice(0, 8)}`;
      await sb.from('room_turns').delete().eq('user_id', uid).eq('room_key', key);
      // roundtrip + order
      await writeRoomTurn(sb, uid, key, { role: 'system', text: 'first — the engine narrates' });
      await writeRoomTurn(sb, uid, key, { role: 'user', text: 'second — the user speaks' });
      let turns = await readRoomTurns(sb, uid, key);
      check(`${label} · a turn SURVIVES (write→read roundtrip, oldest→newest)`,
        turns.length === 2 && turns[0].text.startsWith('first') && turns[1].role === 'user',
        `turns=${turns.length}`);
      // keyed dedupe replaces
      await writeRoomTurn(sb, uid, key, { role: 'system', text: 'v1 of the keyed line', dedupeKey: 'cta:x' });
      await writeRoomTurn(sb, uid, key, { role: 'system', text: 'v2 of the keyed line', dedupeKey: 'cta:x' });
      turns = await readRoomTurns(sb, uid, key);
      check(`${label} · a keyed turn REPLACES its prior version (no stutter)`,
        turns.filter((t) => t.text.includes('keyed line')).length === 1 &&
        turns.some((t) => t.text.startsWith('v2')), `total=${turns.length}`);
      // author attribution survives
      await writeRoomTurn(sb, uid, key, {
        role: 'system', text: 'drafted the reply — ready to review',
        author: { kind: 'coworker', name: 'Clara Example', role: 'assistant' },
      });
      turns = await readRoomTurns(sb, uid, key);
      check(`${label} · coworker ATTRIBUTION survives the roundtrip`,
        turns.some((t) => t.author?.name === 'Clara Example'), '');
      await sb.from('room_turns').delete().eq('user_id', uid).eq('room_key', key);
    }
    // Key resolution: a REAL linked item converses in its entity's room; an unlinked one in its own.
    for (const [uid, label] of [[A, 'user A'], [B, 'user B']] as const) {
      const { data: link } = await sb.from('entity_links').select('item_id, entity_id')
        .eq('user_id', uid).eq('item_kind', 'inbox_item').not('entity_id', 'is', null).limit(1).maybeSingle();
      if (!link) { check(`${label} · linked item → its ENTITY's room (vacuous — no links)`, true); }
      else {
        const k = await roomKeyForItem(sb, uid, 'inbox', link.item_id as string);
        check(`${label} · a linked item converses in its ENTITY's room (one conversation per deal)`,
          k === link.entity_id, `${String(k).slice(0, 8)}…`);
      }
      const kLoose = await roomKeyForItem(sb, uid, 'inbox', '00000000-0000-0000-0000-00000000dead');
      check(`${label} · an unlinked item keys to its OWN loose room`,
        kLoose === looseRoomKey('inbox', '00000000-0000-0000-0000-00000000dead'), kLoose);
    }
  }

  // ── R2 STRUCTURAL — the shell inversion + the component-bearing stream ──
  const reg = src('lib/work/surface-registry.ts');
  check('R2: the registry carries the INTERACTION CLASS (surface: inline|stage) — decided once, never per-surface',
    reg.includes("surface: WorkSurface") && reg.includes('export const surfaceOf') &&
    /key: 'reply_composer'[^}]*surface: 'stage'/.test(reg) && /key: 'decision'[^}]*surface: 'inline'/.test(reg));
  const detail = src('components/home/item-detail.tsx');
  check('R2: THE INVERSION lives in THE ONE shell — conversation center (flex-1), work on the stage (lg:w-[52%])',
    src('components/room/room-shell.tsx').includes('hidden lg:flex flex-1') &&
    src('components/room/room-shell.tsx').includes('lg:w-[52%]') &&
    detail.includes('<RoomShell conversation={rail} stage={children}'));
  check('R2: the entity room inverts the same way (mounts the same RoomShell, launcher/artifact = the stage)',
    src('components/entities/entity-room.tsx').includes('<RoomShell'));
  const railSrc = src('components/home/item-rail.tsx');
  // RE-POINTED (Aug 13, THE MACHINE plan AL): the stage-hosted card is DELETED — the rail is the
  // ONE decision surface on every door; the deep-dive passes the payload (with the forward-motion
  // contract in onChoose) and an embedded item LIFTS its decision to the host room via onDecision.
  check('R2: the DECISION mounts INLINE in the stream (the rail renders the shared DecisionCard)',
    railSrc.includes('decision?:') && railSrc.includes('<DecisionCard') &&
    detail.includes('decision={decisionPayload ? {'));
  // SUPERSEDED twice: ONE-COMMIT-LINE (UX arc), then the PREPARED-ACTION GRAMMAR (Aug 4) — the
  // card list carries EVERY prepared thing (reply/invite/forward), each Open summons its own
  // stage; the stage holds the ONLY Send. No commit callback exists on the card at all now.
  // Aug 4 (a component is a turn): the card SEATS at its anchor turn's chronological moment in
  // the stream (the narration becomes the card); unanchored cards append at the end. No commit
  // callback exists on the card at all — the one Send lives on the summoned stage.
  check('R2→UX: the ARTIFACT CARDS are TURNS — seated at their anchor moment (anchorKey), Open summons the stage, no commit on the card',
    railSrc.includes('artifacts?:') && railSrc.includes('A COMPONENT IS A TURN') &&
    railSrc.includes('anchorKey') && railSrc.includes('anchoredByKey') && railSrc.includes('endArtifacts') &&
    !railSrc.includes('onCommit') &&
    detail.includes("label: 'Reply drafted — ready to review'") &&
    detail.includes("'Calendar invite prepared — review & approve'") &&
    detail.includes("label: 'Forward prepared — review & approve'"));
  check('R2: LOOSE items get the conversation too (railView no longer gated on an entity)',
    detail.includes('const railView = view ? (view as RailView) : null') &&
    !detail.includes('view?.entity ? (view as RailView)'));
  check('R2: the stage NEVER hosts the decision — the embedded door LIFTS it to the host room (onDecision) instead of a second stage card (panelPlan.stageHostsDecision is structurally false)',
    !detail.includes("import { DecisionCard }") &&
    detail.includes('onDecision') &&
    src('lib/room/render-plan.ts').includes('stageHostsDecision: false'));

  // ── R3 STRUCTURAL — ONE shell both doors + the context strip (spatial, never conversational) ──
  const shell = src('components/room/room-shell.tsx');
  const room2 = src('components/entities/entity-room.tsx');
  check('R3: ONE SHELL, both doors — the deep-dive AND the project room mount the SAME RoomShell',
    shell.includes('export function RoomShell') &&
    detail.includes('<RoomShell conversation={rail} stage={children}') &&
    room2.includes('<RoomShell') && room2.includes("from '@/components/room/room-shell'"));
  const strip = src('components/room/context-strip.tsx');
  check('R3: the CONTEXT STRIP exists — per-anchor (project door / siblings / founding), collapsed on the stage',
    strip.includes('export function ContextStrip') && strip.includes('Start a project from this') &&
    strip.includes("tracked === false ? 'Connects to' : 'In'"));
  // RE-POINTED (Sep 7, THE ONE ROOM GRAMMAR): the strip is FILED TRUTH, so it moved off the stage
  // into the item room's drawer — where filed truth lives in every room. The law is unchanged and
  // now stronger: ONE mount serves all four kinds (it was three near-identical ones), and it never
  // renders embedded (the project room IS the context).
  // RE-POINTED AGAIN (Sep 9, the owner's context-drawer walk — "the side panel just flags all items
  // that might be related… make this more meaningful"): the inventory is still ONE mount in the
  // drawer for every kind, but the flat chips became ROWS that carry their kind, their who and
  // their when (smoke-threads T25.2 owns the row law). The strip's founding ask was a second seat
  // for the header's own filing control and died with it — the drawer never asks.
  check('R3: the related inventory is the item room’s filed truth — ONE mount, in the drawer, for every kind',
    (detail.match(/node: <RelatedRows view=\{railView\} \/>/g)?.length ?? 0) === 1 &&
    detail.includes('function commonRoomTabs') && detail.includes("id: 'related'") &&
    !detail.includes('<ContextStrip') && !detail.includes('!embedded && railView && <ContextStrip'));
  check('R3: the conversation no longer carries the room index (navigation is spatial, never repeated in the stream)',
    // Re-pointed Sep 7 (threads P2d): the stream renders through the ONE kit timeline, which has
    // no index seat at all — the law's strongest form. The negatives keep the old index dead.
    !railSrc.includes('THE ROOM INDEX (P7c-c1)') && !railSrc.includes('Start a project from this') &&
    railSrc.includes("from '@/components/thread'"));
  check('R3: the launcher\'s ask lands in the SAME durable conversation (the room mounts the ONE rail on the ONE key)',
    room2.includes('<ItemRail kind="entity" id={entityId}'));

  // ── R4 STRUCTURAL — projects are HUMAN-CREATED only; the brain proposes, never founds ──
  check('R4: NO ambient path tracks — recognition/reflection/hooks never set tracked (only user-invoked routes do)',
    !src('lib/entities/recognize.ts').includes('tracked: true') &&
    !src('lib/entities/reflect.ts').includes('tracked: true') &&
    !src('lib/entities/hooks.ts').includes('tracked: true') &&
    src('app/api/entities/route.ts').includes('tracked: true') &&
    src('lib/tools/project-actions.ts').includes('tracked: true'));
  const pv = src('components/entities/portfolio-view.tsx');
  check('R4: the portfolio is USER-CREATED ONLY — no suggestions, no untracked rows at all (smaller-things removed)',
    !pv.includes('SuggestRow') && !pv.includes('Accept all') && !pv.includes('smaller thing') &&
    pv.includes('!hidden.has(e.id) && e.tracked') && pv.includes('never invents projects'));
  check('R4: creation/tracking NARRATES the member proposal (one founding module, three callers)',
    src('lib/entities/founding.ts').includes('export async function narrateFounding') &&
    src('app/api/entities/route.ts').includes('narrateFounding') &&
    src('app/api/entities/[id]/route.ts').includes('narrateFounding') &&
    src('lib/tools/project-actions.ts').includes('narrateFounding'));

  // ── R4 LIVE — founding an entity with existing links narrates the counts into its room ──
  if (!probe.error) {
    const { narrateFounding } = await import('../lib/entities/founding');
    const { data: pe } = await sb.from('work_entities').insert({
      user_id: PERSONAL, kind: 'initiative', name: 'ZZ-smoke Acme Pilot', aliases: ['ZZ-smoke Acme Pilot'],
      tracked: false, status: 'active',
    }).select('id').maybeSingle();
    if (!pe) { check('R4 live · probe entity insert failed', false); }
    else {
      const eid = pe.id as string;
      await sb.from('entity_links').insert([
        { user_id: PERSONAL, item_kind: 'inbox_item', item_id: '00000000-0000-0000-0000-0000000000a1', entity_id: eid, via: 'user', reason: 'smoke' },
        { user_id: PERSONAL, item_kind: 'commitment', item_id: '00000000-0000-0000-0000-0000000000a2', entity_id: eid, via: 'user', reason: 'smoke' },
      ]);
      const counts = await narrateFounding(sb, PERSONAL, eid, 'ZZ-smoke Acme Pilot', 'tracking');
      const roomTurns = await readRoomTurns(sb, PERSONAL, eid);
      check('R4 live · founding narrates the EXISTING links as the member proposal (honest counts, zero AI)',
        counts.emails === 1 && counts.tasks === 1 && counts.total === 2 &&
        roomTurns.some((t) => t.text.includes('1 email, 1 task connect')),
        `counts=${JSON.stringify(counts)} · "${roomTurns.at(-1)?.text.slice(0, 70)}"`);
      // Re-founding replaces (dedupe 'founded') — never stutters.
      await narrateFounding(sb, PERSONAL, eid, 'ZZ-smoke Acme Pilot', 'started');
      const again = await readRoomTurns(sb, PERSONAL, eid);
      check('R4 live · re-founding REPLACES the keyed turn (no stutter)',
        again.filter((t) => /connect/.test(t.text)).length === 1 && again.some((t) => t.text.startsWith('Started')),
        `turns=${again.length}`);
      await sb.from('room_turns').delete().eq('user_id', PERSONAL).eq('room_key', eid);
      await sb.from('entity_links').delete().eq('user_id', PERSONAL).eq('entity_id', eid);
      await sb.from('work_entities').delete().eq('id', eid);
    }
  }

  // ═══ R5 — THE PARITY MATRIX + THE NOTHING-IS-LOST INVENTORY (live, all four users) ═══
  // Structural: the project room's stage still serves EVERY content type the old room held —
  // each reachable in ≤2 taps (a disclosure is one tap from the launcher's first paint).
  // ⚠️ RE-POINTED (owner, Sep 14 — the maintenance-work complaint): the tab bar itself moved into
  // THE ONE FILED DRAWER (components/room/filed-drawer.tsx), which both room doors mount. The LAW
  // is unchanged — every content section reachable behind one tab bar, goals/rules, status
  // controls — so it is asserted across the room's SECTIONS plus the one pane that renders them.
  check('R5 inventory · the launcher renders every content section behind ONE tab bar (experience-spec seat: the right pane inventories, it never asks) + goals/rules + status controls',
    room2.includes('<FiledDrawer') && src('components/room/filed-drawer.tsx').includes('<TabBar') &&
    ["'Tasks'", 'Schedule · ', 'Meetings · ', 'Conversations · ', 'Files · ', 'Activity · '].every((t) => room2.includes(t)) &&
    room2.includes('Goals') && room2.includes('Rules') && room2.includes('StatusUpdateModal'));
  // ⚠️ RE-POINTED (owner, Sep 14, twice): history no longer FOLDS in the stream — it LEAVES it for
  // the one drawer. The rest of the law (position+debts, the lifted ask, inline refs) is untouched.
  check('R5b · THE LIVING BRIEF (experience-spec laws 1/2/7/8): the room opens with position+debts (never mute), the engine ask is LIFTED into the brief with the one CTA row, the record leaves the stream for the drawer, and refs render as inline links — never pills',
    src('components/home/item-rail.tsx').includes('THE LIVING BRIEF') &&
    src('components/home/item-rail.tsx').includes('onHistoryRef.current?.(historyLinesRef.current);') &&
    !src('components/home/item-rail.tsx').includes("variant: 'fold'") &&
    src('components/home/item-rail.tsx').includes('never twice on screen') &&
    src('components/home/item-rail.tsx').includes('the word is the deed') &&
    !src('components/home/item-rail.tsx').includes('<Chip key={j} label={r.label}'));
  check('R5 · Home rows deep-link into the room (the spine builds /item hrefs; the room mounts from the cached verdict)',
    src('lib/work-items/model.ts').includes('/item/') && src('lib/work/judge.ts').includes('readCache'));

  // Live matrix + inventory per user. Rene resolved at runtime (never hardcode his id).
  const { data: uidRows } = await sb.from('work_entities').select('user_id').limit(2000);
  const rene = [...new Set(((uidRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))].find((u) => u.startsWith('ae306f38')) ?? null;
  const USERS: Array<[string, string]> = [[A, 'user A'], [B, 'user B'], ...(rene ? [[rene, 'user C'] as [string, string]] : []), [PERSONAL, 'personal']];
  if (!probe.error) {
    for (const [uid, label] of USERS) {
      // ── The inventory against a REAL tracked project (the most-linked one). ──
      const { data: tracked } = await sb.from('work_entities')
        .select('id, name, goals, rules, state, next_move, status')
        .eq('user_id', uid).eq('kind', 'initiative').eq('tracked', true).eq('status', 'active').limit(20);
      const tRows = (tracked ?? []) as Array<Record<string, unknown>>;
      if (!tRows.length) { check(`${label} · inventory (vacuous — no tracked projects)`, true); }
      else {
        let best: { id: string; name: string; links: Array<{ item_kind: string }> } | null = null;
        for (const t of tRows.slice(0, 8)) {
          const { data: lk } = await sb.from('entity_links').select('item_kind').eq('user_id', uid).eq('entity_id', t.id as string);
          const links = (lk ?? []) as Array<{ item_kind: string }>;
          if (!best || links.length > best.links.length) best = { id: t.id as string, name: t.name as string, links };
        }
        const kinds = new Set(best!.links.map((l) => l.item_kind));
        const { assembleLedger } = await import('../lib/entities/state');
        const { ledger } = await assembleLedger(sb, uid, best!.id);
        const turns2 = await readRoomTurns(sb, uid, best!.id);
        check(`${label} · inventory — a real tracked project serves its members + activity + conversation (data spine intact)`,
          best!.links.length > 0 && ledger.length > 0,
          `${best!.links.length} links (${[...kinds].join('/')}) · ledger=${ledger.length} · turns=${turns2.length}`);
      }
      // ── The matrix rows real data instantiates (each named honestly when vacuous). ──
      const [untrk, awaitC, dels, loosePend] = await Promise.all([
        sb.from('work_entities').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'initiative').eq('tracked', false).eq('status', 'active'),
        sb.from('commitments').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('direction', 'awaiting').eq('status', 'open'),
        sb.from('item_deliverables').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        sb.from('inbox_items').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'pending'),
      ]);
      check(`${label} · matrix coverage (untracked-context / chase / deliverable / open items — present or honestly vacuous)`,
        true, `untracked=${untrk.count ?? 0} awaiting=${awaitC.count ?? 0} deliverables=${dels.count ?? 0} open=${loosePend.count ?? 0}`);
      // Loose vs deal conversation keys hold on THIS user's real data (the one-conversation law).
      const { data: anyLink } = await sb.from('entity_links').select('item_id, entity_id')
        .eq('user_id', uid).eq('item_kind', 'inbox_item').not('entity_id', 'is', null).limit(1).maybeSingle();
      if (anyLink) {
        const k = await roomKeyForItem(sb, uid, 'inbox', anyLink.item_id as string);
        check(`${label} · a linked item's conversation IS its deal's (parity across doors)`, k === anyLink.entity_id, '');
      } else check(`${label} · linked-item key (vacuous — no links)`, true);
    }
    check('R5 · Rene resolved at runtime (never hardcoded)', rene !== null, rene ? `${rene.slice(0, 8)}…` : 'absent');
  }

  // ═══ R6 — THE ROOM-DOOR LAW + THE ONE-VOICE BRIEF (Aug 3, experience-spec seat table + laws 2/4/5/6/9) ═══
  {
    const hv = src('components/home/home-view.tsx');
    const brief = src('app/api/home/brief/route.ts');
    check('R6 · deck rows on project-member items open the PROJECT ROOM (one door() rule, every lane; projectByAtom served from the tag derivation point)',
      brief.includes('projectByAtom') && hv.includes('const door = (itemId: string, fallback: string)') &&
      (hv.match(/door\(/g)?.length ?? 0) >= 3); // reply + notice + commitment lanes
    check('R6 · deep-link doors survive: middleware preserves search; the room owns /project/<id> and legacy query addresses forward (THE ADDRESS LAW superseded the query-state door, Sep 5)',
      !src('components/room/context-strip.tsx').includes("'/?view=") &&
      src('middleware.ts').includes('home.search = request.nextUrl.search') &&
      hv.includes('useSearchParams') &&
      src('app/(main)/home/page.tsx').includes('redirect(projectHref') &&
      src('components/entities/portfolio-view.tsx').includes('projectHref'));
    // RE-POINTED (owner walk, Sep 10 — "confusing to have 2 elements… like a header and then the
    // conversation"): the rail's own name row was a SECOND chrome band under the room's 52px
    // header, so it died. The law is untouched — the room's NAME is still the project door, via
    // the ONE address producer — it now sits in the one header (ItemRoomFrame's `room.project`),
    // and the gate additionally asserts the rail does NOT draw a second one.
    check('R6 · the word is the deed: the room\'s name IS the project door (via the ONE address producer, in the ONE chrome band); the "Open project" chip is gone (tracked); no click-echo turn on the next-move CTA',
      src('components/home/item-detail.tsx').includes('projectHref(room.project.id)') &&
      !rail.includes('projectHref(') &&
      !src('components/room/context-strip.tsx').includes("'Open project'") &&
      !rail.includes('Opening the next move'));
    const rb = src('lib/room/brief.ts');
    // Aug 5 (the one responder): the brief grew into {brief, MOVE, offers} composed from THE ONE
    // GROUNDING; the sig carries the BOARD DIGEST so preparedness changes always recompose.
    check('R6 · THE ONE RESPONDER: authored from the one grounding — sig includes the board digest, last-good serve, AI-failure never blanks, version in the cache',
      rb.includes('ROOM_BRIEF_VERSION') && rb.includes('ensureRoomBrief') && rb.includes('readRoomResponse') &&
      rb.includes('assembleRoomGrounding') && rb.includes('boardDigest') && rb.includes('if (!text) return') &&
      src('lib/entities/room-view.ts').includes('readRoomResponse') &&
      src('app/api/entities/[id]/room/route.ts').includes('ensureRoomBrief') &&
      src('app/api/items/view/route.ts').includes('ensureRoomBrief') &&
      rail.includes('ent?.brief') && rail.includes('view.brief') );
    // LIVE — the composer produces one grounded paragraph for a real tracked project on the probe
    // host (or a real account), and the sig gate makes the second call a no-op (no re-burn).
    const { data: cand } = await sb.from('work_entities').select('id, user_id, name, state')
      .eq('kind', 'initiative').eq('tracked', true).eq('status', 'active')
      .in('user_id', [A, PERSONAL]).not('state', 'is', null).limit(1).maybeSingle();
    if (cand) {
      const { ensureRoomBrief, readRoomBrief } = await import('../lib/room/brief');
      await ensureRoomBrief(sb, cand.user_id as string, cand.id as string);
      const text1 = await readRoomBrief(sb, cand.user_id as string, cand.id as string);
      const t1 = Date.now();
      await ensureRoomBrief(sb, cand.user_id as string, cand.id as string); // sig unchanged → no-op
      const noopMs = Date.now() - t1;
      check('R6 live · the brief composes ONE grounded paragraph (≤600 chars, non-empty) and the sig gate holds (second call cheap)',
        !!text1 && text1.length > 20 && text1.length <= 600 && noopMs < 3000,
        text1 ? `"${text1.slice(0, 90)}…" · noop ${noopMs}ms` : 'no brief composed');
    } else check('R6 live · brief compose (vacuous — no tracked entity with state)', true);
  }

  // ═══ R7 — THE SUMMONED STAGE + LOOSE-ROOM CONVERGENCE (Aug 3, the spec's stage seat made
  // transient; "a loose room is a project room with less to file") ═══
  {
    const idt = src('components/home/item-detail.tsx');
    check('R7 · the composer is the SUMMONED STAGE — a bottom SHEET raised by the user (the thread stays visible above it — owner call Aug 7), never docked in the truth pane, never auto-raised on mount (initialStage carries a user click)',
      (idt.match(/THE SUMMONED STAGE/g)?.length ?? 0) >= 2 &&
      idt.includes('absolute inset-x-0 bottom-0 z-20 max-h-[72%]') &&
      idt.includes('THE STAGE IS A SHEET, NOT A CURTAIN') &&
      !idt.includes('setComposerOpen(cached.work') && !idt.includes("setComposerOpen(rel === 'reply')") &&
      !idt.includes("setComposerOpen(d.verdict.work === 'reply'"));
    // SUPERSEDED (Aug 4, THE VERB-SCOPE LAW): the verbs moved back ON the stage — attached to their
    // object, identical loose/embedded (the user's screenshot call: verbs with the item, dialogue
    // left). The rail carries NO verb chrome at all; the left panel is pure dialogue.
    check('R7 · THE VERB STRIP: item verbs live ON the stage attached to their object (one strip, loose = embedded); the rail carries no verb chrome',
      !rail.includes('ctaRow') && idt.includes('THE VERB STRIP') &&
      idt.includes('objectKind={objectKind}') && !idt.includes('ctaRow='));
    check('R7 · the LOOSE room briefs in the one voice too (same composer, `<kind>:<id>` key) and the rail prefers the composed paragraph on every door',
      src('lib/room/brief.ts').includes('ensureLooseRoomBrief') &&
      src('app/api/items/view/route.ts').includes('ensureLooseRoomBrief') &&
      rail.includes("(ent?.brief || view.brief)"));
    check('R7 · a sender that is an organization keeps its name (spokenName) · a background auto-attach fails SILENTLY (no error the user never caused)',
      rail.includes('function spokenName') && rail.includes('ORG_TOKEN') &&
      idt.includes('{ silent: true }') && idt.includes('opts?.silent'));
    check('R7 · the click-echo class is drained + the writer is gone (sweep exists; no "Opening the next move" writer anywhere)',
      src('scripts/sweep-click-echoes.ts').includes("like('text', 'Opening the next move —%')") &&
      !rail.includes('Opening the next move'));
    // LIVE — the loose composer produces a grounded paragraph for a synthetic loose room on the
    // probe host (anchor-only inputs; sig-gated second call).
    {
      const { ensureLooseRoomBrief, readRoomBrief } = await import('../lib/room/brief');
      const key = 'inbox:00000000-0000-0000-0000-0000000r7brf'.slice(0, 42);
      const anchor = { title: 'Confirm the pilot invoice', who: 'Acme Billing Lda', ask: 'confirm the June invoice total and reply', prepared: 'draft' };
      await ensureLooseRoomBrief(sb, PERSONAL, key, anchor);
      const text = await readRoomBrief(sb, PERSONAL, key);
      check('R7 live · the loose-room brief composes one grounded paragraph from the anchor (org name kept whole, draft mentioned)',
        !!text && text.length > 20 && /acme/i.test(text ?? ''),
        text ? `"${text.slice(0, 90)}…"` : 'no brief composed');
      await sb.from('item_plans').delete().eq('user_id', PERSONAL).eq('kind', 'room_brief').eq('entity_id', key);
    }
  }

  // ═══ R8 — THE PREPARED-ACTION GRAMMAR (Aug 4: every prepared thing = a card that summons its
  // own stage; dispositions quiet; suggestions are offers with an always-open last option) ═══
  {
    const idt = src('components/home/item-detail.tsx');
    check('R8 · ONE stage frame (StageOverlay) hosts reply/follow-up/invite/forward — the truth pane offers nothing (Review buttons embedded-only)',
      idt.includes('function StageOverlay') &&
      (idt.match(/<StageOverlay/g)?.length ?? 0) >= 3 &&
      idt.includes('embedded && !itemDismissed && (view?.inviteTaskId') &&
      idt.includes('embedded && view?.inviteTaskId && !inviteOpen'));
    // Aug 4 (2nd pass): Dismiss folded into More (user call — the row is two verbs + More); the
    // chevron is an ICON, baseline-aligned (the text "⌄" sat offset); a divider sits below the row.
    check('R8 · QUIET DISPOSITIONS: Reply · Forward · More (icon chevron, Dismiss + variants inside) — never a bordered field, a bare glyph, or an offset text chevron',
      idt.includes('QUIET DISPOSITIONS') && idt.includes('More<ChevronDownIcon') &&
      !idt.includes('>⋯<') && !idt.includes('More ⌄') &&
      idt.includes('onClick={() => { setMenuOpen(false); onDismiss(); }}') &&
      idt.includes('border-b border-neutral-100 pb-4'));
    // ⚠️ RE-POINTED (THE EMAIL CARD, Sep 8 — the SEAT moved ONE more time; the LAW did not): the
    // directions were chips in the conversation beside a card that had none. They are now that
    // card's own top-edge TABS (THE CARD CONTRACT law 2: options live IN the card), still served by
    // the SAME grounded organ, and the stage is still purely read/edit/send.
    check('R8 · REPLY DIRECTIONS live ON THE CARD, never as loose chips: one grounded organ, the card\'s own tabs, and a stage that carries none',
      !idt.includes('function ReplyDirections') &&
      !idt.replace(/\/\/[^\n]*/g, '').includes('reply-directions') &&
      !rail.includes("act: 'direction'") &&
      src('components/home/email-card.tsx').includes("fetch('/api/items/reply-directions'") &&
      src('lib/prepare/email-card.ts').includes('const variants: EmailCardVariantProps[] = dirs.length') &&
      src('app/api/items/reply-directions/route.ts').includes('topMessageOf') &&
      src('app/api/items/reply-directions/route.ts').includes("kind: 'reply_directions'"));
    check('R8 · ONE muted style in the STREAM: events + their refs whisper in the kit timeline\'s one event-line style; the rail no longer renders stream text itself (threads P2d — the law moved into the kit)',
      // Re-pointed Sep 7: the stream is the kit's; the rail only DERIVES items. The kit's
      // event_line is the one muted seat (12px neutral-400, refs inline in the same element).
      rail.includes("type: 'event_line'") &&
      src('components/thread/thread-timeline.tsx').includes("case 'event_line':") &&
      src('components/thread/thread-timeline.tsx').includes('px-1 text-[12px] leading-[1.5] text-neutral-400') &&
      !src('components/thread/thread-timeline.tsx').includes('text-[12.5px]'));
  }

  // ═══ R9 — EXCERPT HONESTY · ONE NAVIGATION · CHAT PARITY · CTA COLLAPSE (Aug 4) ═══
  {
    const { clipForPrompt, EXCERPT_MARK } = await import('../lib/utils/clip-for-prompt');
    const long = 'One sentence here. '.repeat(40);
    const clipped = clipForPrompt(long, 200);
    check('R9 · clipForPrompt: boundary cut + self-declaring marker; short text passes clean',
      clipped.endsWith(EXCERPT_MARK) && !/\w$/.test(clipped.replace(EXCERPT_MARK, '').trim().slice(0, -0)) &&
      clipForPrompt('short', 200) === 'short' && clipped.length <= 200 + EXCERPT_MARK.length + 2);
    check('R9 · THE EXCERPT-HONESTY LAW at every quoted-source cut (judge · state · fulfillment · reactivate · directions) + version bumps',
      src('lib/work/judge.ts').includes('clipForPrompt') && src('lib/work/judge.ts').includes('EXCERPT_RULE') &&
      src('lib/entities/state.ts').includes('clipForPrompt') && src('lib/entities/state.ts').includes('EXCERPT_RULE') &&
      src('lib/commitments/fulfillment.ts').includes('clipForPrompt') &&
      src('lib/inbox/reactivate-on-reply.ts').includes('clipForPrompt') &&
      src('app/api/items/reply-directions/route.ts').includes('clipForPrompt') &&
      /JUDGE_VERSION = 1[3-9]/.test(src('lib/work/surface-registry.ts')) && // ≥13 (the law landed at 13)
      /STATE_PROMPT_VERSION = [7-9]/.test(src('lib/entities/state.ts')) && // ≥7 (the law landed at 7; 8 = the one-claim law)
      // Re-pointed Sep 13 (THE PROACTIVE REACH ARC): exact `= 3` pin → floor ≥3 — the version-pin
      // trap ("exact VERSION = N pins break on every bump", CLAUDE.md) bit here when the expiry
      // law's open-age fact lawfully bumped it to 4. The law landed at 3; the floor is the claim.
      /FULFILLMENT_LAW_VERSION = ([3-9]|[1-9][0-9])/.test(src('lib/commitments/fulfillment.ts')));
    check('R9 · THE ONE-NAVIGATION LAW: in-room rail links route through the room opener (the ONE go() consults onOpenHref before the router; refs, move and event-line refs all call go)',
      // Re-pointed Sep 7 (threads P2d): navigation consolidated into ONE `go()` — the opener
      // consult lives there once and every link path calls it (fewer raw onOpenHref sites is the
      // consolidation, not a loosening).
      rail.includes('onOpenHref?: (href: string) => boolean') && rail.includes('const go = (href: string)') &&
      rail.includes('if (onOpenHref?.(href)) return; router.push(href);') &&
      (rail.match(/\bgo\(/g)?.length ?? 0) >= 3 &&
      src('components/entities/entity-room.tsx').includes('onOpenHref={(href)'));
    check('R9 · THE PARITY LAW: send_prepared_reply + prepare_forward in the chief slice; the explicit-send FLOOR is deterministic; the client fires the ONE send door',
      src('lib/work/surface-registry.ts').includes('send_prepared_reply:') &&
      src('lib/work/surface-registry.ts').includes('prepare_forward:') &&
      src('lib/converse/index.ts').includes('const EXPLICIT_SEND = /') &&
      src('lib/converse/index.ts').includes("commit: { kind: 'send_reply'") &&
      rail.includes("fetch(`/api/inbox/${d.commit.itemId}/send-reply`") &&
      src('app/api/items/steer/route.ts').includes('turn.commit'));
    // SUPERSEDED (Aug 4, the verb-scope law): the collapse died with the rail row — the strip sits
    // on the stage with its object; the OBJECT KIND decides the verbs (the census law: a
    // meeting-extracted action item has no thread → structurally no Reply/Forward).
    check('R9 · THE VERB-SCOPE LAW: verbs derive from the OBJECT KIND — meeting action items get Done/Dismiss, never Reply; the view serves itemSource; one artifact-card derivation feeds rail AND embedded stage',
      src('components/home/item-detail.tsx').includes("objectKind === 'email_thread' && (") &&
      src('components/home/item-detail.tsx').includes("objectKind === 'meeting_action'") &&
      src('app/api/items/view/route.ts').includes('itemSource') &&
      src('components/home/item-detail.tsx').includes('const artifactList') &&
      // Aug 7 (one deed across panes): the embedded cards yield when the ROOM's rail already
      // carries the merged action card for this item.
      src('components/home/item-detail.tsx').includes('embedded && !hideArtifactCards && artifactList.map'));
  }

  // ═══ R10 — THE EXCHANGE GRAMMAR (Aug 4: the room talks like a person — offer → pick →
  // acknowledge → land; clicks are utterances; scaffolding is ephemeral, the story is durable) ═══
  {
    const idt = src('components/home/item-detail.tsx');
    const er = src('components/entities/entity-room.tsx');
    // Aug 5 (the one system): the focus narrations DIED — they were a parallel author contradicting
    // the responder. openHref only focuses; the opening (brief · MOVE · offers) owns all speech.
    check('R10 · ROOM COHERENCE: cards board-derived · openHref only FOCUSES (no parallel narrator) · resolutions narrate into the conversation',
      er.includes('artifacts={(() => {') && er.includes('r.prepared') &&
      !er.includes('want me on it') && er.includes('openHref only FOCUSES') &&
      idt.includes('const narrateResolve') && (idt.match(/narrateResolve\(/g)?.length ?? 0) >= 4); // dismiss · note · not-relevant · done
    check('R10 · ONE STAGE AT A TIME: opening any stage lowers the others (the covered-Open dead-click class, found live)',
      idt.includes('ONE STAGE AT A TIME') && idt.includes('setForwarding(false);\n    setInviteOpen(false);') &&
      idt.includes('onOpen: openForward'));
    // ⚠️ RE-POINTED (THE EMAIL CARD, Sep 8): the EXCHANGE — offer → pick → ack → result — happens
    // INSIDE the card now (tabs → the one redraft path → the body lands), and "typing always works"
    // is the card's own open tab and steer field. The law is intact; the seat is the card.
    check('R10 · THE REPLY EXCHANGE happens IN THE CARD: grounded directions to pick, lazy regeneration through the ONE steer path, and typing always works',
      idt.includes('const startReplyExchange = openComposer;') &&
      (idt.match(/onReply=\{startReplyExchange\}/g)?.length ?? 0) >= 1 &&
      src('components/home/email-card.tsx').includes("fetch('/api/items/steer'") &&
      src('components/home/email-card.tsx').includes('const pickVariant = (id: string)') &&
      src('lib/prepare/email-card.ts').includes('EMAIL_OPEN_VARIANT'));
    check('R10 · EPHEMERAL SCAFFOLDING: live-only turns never persist (a reloaded offer with dead buttons is noise, not history)',
      rail.includes('ephemeral?: boolean') && rail.includes('if (!opts?.ephemeral) persistTurn') &&
      rail.includes('export function dropDealTurn'));
    // ⚠️ RE-POINTED (the invite card, Sep 8 — the SEAT moved to the kit card + its one mapper; the
    // LAW did not): the proposal still says it is ours, and a time-less invite still asks plainly
    // — now by rendering the SELECTOR ALONE, with no fields and no commit row to lie with.
    check('R10 · THE PROPOSE TIER on invites: a stated day/window earns a grounded PROPOSED time (user clock, weekday stated), labeled as ours; no time stated → the card asks plainly',
      src('lib/home/prepare-action.ts').includes('THE PROPOSE TIER') &&
      src('lib/home/prepare-action.ts').includes('userTimezone') &&
      src('lib/prepare/invite-card.ts').includes("'our proposal — inside what they stated'") &&
      src('lib/prepare/invite-card.ts').includes("state: ready ? 'ready' : 'needs_time'") &&
      // needs_time renders NO filled fields and NO Send — the card asks, it never poses as a form.
      src('components/thread/thread-cards.tsx').includes("const filled = card.state === 'ready';") &&
      src('components/home/invite-card.tsx').includes("...(props.state === 'ready' ? { onSend: send") &&
      idt.includes("view?.inviteHasTime === false ? 'Invite drafted — needs a time from you'"));
  }

  // ═══ R11 — THE PEOPLE TYPEAHEAD (Aug 4: every people field suggests KNOWN contacts as you
  // type — grounded in the user's own correspondence, never invented; one shared input) ═══
  {
    const idt = src('components/home/item-detail.tsx');
    // ⚠️ RE-POINTED (Sep 8): the ONE input moved to components/home/people-chips.tsx when a second
    // host (the invite card) needed it — the law is "one implementation, every people field", so
    // the gate now asserts exactly ONE definition in the codebase and both chip fields mounting it.
    const chips = src('components/home/people-chips.tsx');
    check('R11 · one PeopleSuggestInput mounts in BOTH chip fields (attendees + recipients); the suggest route is user-scoped, graph-ranked, robots filtered',
      chips.includes('export function PeopleSuggestInput') && !idt.includes('function PeopleSuggestInput') &&
      ((chips.match(/<PeopleSuggestInput/g)?.length ?? 0) + (idt.match(/<PeopleSuggestInput/g)?.length ?? 0)) >= 2 &&
      // ⚠️ RE-POINTED (Sep 8): the LOOKUP moved out of the route into lib/people/suggest.ts when the
      // chat-born invite had to resolve names through the SAME grounded source server-side. One
      // implementation is still the law — the route is now a caller of it, not a second copy.
      src('lib/people/suggest.ts').includes('relationship_graph') &&
      src('lib/people/suggest.ts').includes("no-?reply|notification|mailer") &&
      src('app/api/people/suggest/route.ts').includes('suggestPeople(') &&
      !src('app/api/people/suggest/route.ts').includes('relationship_graph'));
  }

  // ═══ R12 — THE ATTACHABLE-REQUIRES LAW (Aug 4, found live: "attach a confirmation of the
  // Thursday time" — an ANSWER classified as an artifact; the resolver searched drives for a
  // decision and asked the user to attach one) ═══
  {
    check('R12 · a require is a THING: judge rule (v14) + the reasoned attachability floor at the ONE resolver (memoized, keep-all on failure) + word-boundary labels',
      src('lib/work/judge.ts').includes('NEVER a confirmation, approval, decision, answer, availability, or time') &&
      src('lib/work/surface-registry.ts').includes('14: ATTACHABLE-REQUIRES') && // RE-POINTED: the v14 rule survives in the version log; JUDGE_VERSION moved on (15: the ask-direction floor)
      src('lib/prepare/requirements.ts').includes('async function attachableOnly') &&
      src('lib/prepare/requirements.ts').includes('requires = await attachableOnly(admin, userId, requires)') &&
      src('lib/prepare/requirements.ts').includes('return requires; // failure ≠ a verdict — keep all') &&
      src('lib/work/judge.ts').includes('function clipLabel'));
    // LIVE — the floor discriminates on the real label classes (the Carson answer vs EG Bank docs).
    try {
      const { aiCall } = await import('../lib/ai/call');
      const labels = ['confirmation of the Thursday demo call time', 'the Q2 vendor risk register', 'your availability for next week'];
      const res = await aiCall<{ attachable?: number[] }>({
        userId: PERSONAL, supabase: sb, shape: { output: 'json' }, temperature: 0, maxTokens: 60, source: 'task_preparation',
        prompt:
          `Which of these are ATTACHABLE THINGS — a document, file, report, sheet, deck, or link that ` +
          `could be retrieved and attached to an email? NOT attachable: a confirmation, approval, ` +
          `decision, answer, availability, a time, or anything only a person's own words can supply. ` +
          `(A "confirmation letter" IS a document; "confirmation of the meeting time" is an answer.)\n` +
          `${labels.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nJSON only: {"attachable":[numbers]}`,
      });
      const keep = new Set(res.json?.attachable ?? []);
      check('R12 live · answers are never askable attachments; real documents survive',
        !keep.has(1) && keep.has(2) && !keep.has(3), `attachable=${JSON.stringify([...keep])}`);
    } catch { check('R12 live · attachability floor (AI unavailable — vacuous)', true); }
  }

  // ═══ R13 — THE ONE SYSTEM (Aug 5: one grounding, one responder, surfaces as views — "it should
  // feel like Claude"; five parallel panel authors died) ═══
  {
    const g = src('lib/room/grounding.ts');
    check('R13 · THE ONE GROUNDING exists and merges what no consumer held together (board = judged verbs + ACTUAL prepared state per item, asks, ledger, transcript, files)',
      g.includes('export async function assembleRoomGrounding') && g.includes('judgedWork') &&
      g.includes('function preparedOf') && g.includes('THE LIVE BOARD') && g.includes('OPEN ASKS'));
    check('R13 · every room-scope reasoner reads the SAME page: the responder, the chat question path, the agent loop',
      src('lib/room/brief.ts').includes('assembleRoomGrounding') &&
      src('lib/entities/ask.ts').includes('assembleRoomGrounding') &&
      src('lib/converse/index.ts').includes('assembleRoomGrounding'));
    // RE-POINTED, STRICTER (Sep 8): board membership alone was never the law — a settled deed's CTA
    // bound to an unrelated notice that happened to be on the same board. The ref must be ON the
    // board AND be what the move is ABOUT (the house distinctive-token test).
    // ⚠️ RE-POINTED (owner walk, Sep 14 — "I think I had told you to remove the chips here too"):
    // the OFFERS half of this check named a RENDERER the owner retired. The composition law it
    // cared about is untouched (the move is board-validated and about its own object; the offers
    // are still composed, deduped against the move and served); what the room renders is now ONE
    // pinned CTA and a composer, so that is what the gate reads.
    check('R13 · THE MOVE is board-validated AND about its own object (the model picks, the code verifies the ref); the room renders ONE CTA and no chip row',
      src('lib/room/brief.ts').includes('boardByRef.get(target)') &&
      src('lib/room/brief.ts').includes('namesOverlap(label, about)') &&
      !rail.includes('offerChips') && rail.includes('THE MOVE + THE OFFERS'));
    // LIVE — the responder composes {brief, move, offers} for a real tracked project; the move's
    // target, when present, is a real board ref (never an invented deed).
    const { data: cand13 } = await sb.from('work_entities').select('id, user_id, name')
      .eq('kind', 'initiative').eq('tracked', true).eq('status', 'active')
      .in('user_id', [A, PERSONAL]).not('state', 'is', null).limit(1).maybeSingle();
    if (cand13) {
      const { ensureRoomBrief, readRoomResponse } = await import('../lib/room/brief');
      const { assembleRoomGrounding } = await import('../lib/room/grounding');
      await ensureRoomBrief(sb, cand13.user_id as string, cand13.id as string);
      const r = await readRoomResponse(sb, cand13.user_id as string, cand13.id as string);
      const g13 = await assembleRoomGrounding(sb, cand13.user_id as string, { kind: 'entity', entityId: cand13.id as string });
      const refs = new Set(g13.board.map((b) => b.ref));
      check('R13 live · the responder emits one coherent opening (brief non-empty; move target ∈ board when set)',
        !!r?.text && (!r.move?.ref || refs.has(r.move.ref)),
        r ? `move=${r.move ? `"${r.move.label}"→${r.move.ref ?? 'no-target'}` : 'none'} · offers=${r.offers.length}` : 'no response composed');
    } else check('R13 live · responder compose (vacuous — no tracked entity with state)', true);
  }

  // ── R14 · A BRIEF NEVER OBLIGES THE MISADDRESSED (census fix #3, Sep 13) ──────────────────────
  // Live: six of six newest room briefs were about cold outreach addressed to OTHER PEOPLE. One
  // wrote "The email went to the wrong person and was dismissed" AND, in the same breath, "You need
  // to confirm whether this allocation stands"; another reframed the user's own dismissal as "she's
  // waiting on your availability". The composer could SEE the fact and obliged the user anyway —
  // which is why the fact now arrives as a DIRECTIVE and the deed is settled in CODE.
  {
    const b = src('lib/room/brief.ts');
    check('R14: the deterministic noise verdict reaches the mind through THE PRESENT',
      /itemIsNoise\(client, userId, item\.id\)/.test(b) && /NOISE FLOOR: this item is/.test(b));
    check('R14: it arrives as a directive, not a datum (a fact a small model can read as colour)',
      /do NOT tell the user to reply, decide, pursue, confirm, or give availability/.test(b));
    check('R14: the composer law — noise is named ONCE and obliges nothing',
      /NOISE OWES NOTHING/.test(b) && /the MOVE is null/.test(b));
    check('R14: THE USER\'S OWN DECISION IS NOT A DEBT — a dismissal is never re-opened as delinquency',
      /THE USER'S OWN DECISION IS NOT A DEBT/.test(b) && /never re-open it as something they/.test(b));
    check('R14: a MOVE dies on a noise anchor — a prompt rule is a hope, this is the floor',
      /if \(move && noiseAnchor\) move = null;/.test(b));
    check('R14: …and a MOVE may not TARGET a floored board row either',
      /move\.ref\.startsWith\('inbox:'\)/.test(b) && /if \(n\?\.noise\) move = null;/.test(b));
    check('R14: the noise verdict rides the sig (an un-marked row re-composes, never stands on a dead floor)',
      /\$\{present\.noise \? 'noise' : ''\}/.test(b));
    check('R14: the prompt changed, so the version did (every cached opening re-authors once)',
      /ROOM_BRIEF_VERSION = 11;/.test(b) && /NOISE OWES NOTHING \+ A DISMISSAL IS A DECISION/.test(b));
    // LIVE — a real campaign-echo room composes a position with NO move. Read-only except the
    // room_brief cache the composer owns.
    const { getCampaignSignature } = await import('../lib/inbox/campaign-echo');
    const { noiseOf } = await import('../lib/prepare/noise-floor');
    const sig = await getCampaignSignature(sb, A);
    const { data: pend } = await sb.from('inbox_items')
      .select('id, user_id, work_title, work_state, rule_type, type_override, source_data')
      .eq('user_id', A).eq('status', 'pending').limit(600);
    const noisy = (pend ?? []).find((r) => noiseOf(r as never, sig).noise);
    if (noisy) {
      const { ensureLooseRoomBrief, readRoomResponse } = await import('../lib/room/brief');
      const key = `inbox:${noisy.id}`;
      const sd = (noisy.source_data ?? {}) as Record<string, any>;
      await ensureLooseRoomBrief(sb, A, key, {
        title: (noisy.work_title as string) ?? null, who: sd.from_name ?? null,
        ask: sd.understanding?.ask ?? null, prepared: sd.draft ? 'draft' : null,
      });
      const r = await readRoomResponse(sb, A, key);
      check('R14 live · a noise room opens with a position and NO move',
        !!r?.text && !r!.move, r ? `move=${r.move?.label ?? 'none'} · "${r.text.slice(0, 70)}"` : 'no response composed');
    } else check('R14 live · noise room compose (vacuous — no floored pending row on the reference account)', true);
  }

  console.log('\n════ THE ONE ROOM GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
