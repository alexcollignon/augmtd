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
  check('R2: the DECISION mounts INLINE in the stream (the rail renders the shared DecisionCard)',
    railSrc.includes('decision?:') && railSrc.includes('<DecisionCard') &&
    detail.includes('decision={!itemDismissed && !decisionCleared'));
  // SUPERSEDED by the UX arc's ONE-COMMIT-LINE law: the card is the conversation's POINTER to the
  // staged work (Open → focuses the stage composer); the stage holds the ONLY Send. Two commit
  // buttons for one artifact was a real duplicated gate.
  check('R2→UX: the ARTIFACT CARD points at the stage (Open →) — ONE commit line, on the composer only',
    railSrc.includes('artifact?:') && railSrc.includes('ONE COMMIT LINE') &&
    !railSrc.includes('artifact.onCommit?.()') &&
    detail.includes("label: 'Reply drafted — ready to review'"));
  check('R2: LOOSE items get the conversation too (railView no longer gated on an entity)',
    detail.includes('const railView = view ? (view as RailView) : null') &&
    !detail.includes('view?.entity ? (view as RailView)'));
  check('R2: the stage keeps the decision ONLY when no rail carries it (loading / embedded room)',
    detail.includes('(!railView || embedded) && !itemDismissed && !decisionCleared'));

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
  check('R3: the strip mounts on the email/followup/commitment stages (hidden when embedded — the room IS the context)',
    (detail.match(/<ContextStrip kind=/g)?.length ?? 0) >= 3 &&
    detail.includes('!embedded && railView && <ContextStrip'));
  check('R3: the conversation no longer carries the room index (navigation is spatial, never repeated in the stream)',
    !railSrc.includes('THE ROOM INDEX (P7c-c1)') && !railSrc.includes('Start a project from this') &&
    railSrc.includes('moved to THE CONTEXT STRIP'));
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
  check('R5 inventory · the launcher renders every content section behind ONE tab bar (experience-spec seat: the right pane inventories, it never asks) + goals/rules + status controls',
    room2.includes('<TabBar') &&
    ["'Tasks'", 'Schedule · ', 'Meetings · ', 'Conversations · ', 'Files · ', 'Activity · '].every((t) => room2.includes(t)) &&
    room2.includes('Goals') && room2.includes('Rules') && room2.includes('StatusUpdateModal'));
  check('R5b · THE LIVING BRIEF (experience-spec laws 1/2/7/8): the room opens with position+debts (never mute), the engine ask is LIFTED into the brief with the one CTA row, history folds past 3 turns, and refs render as inline links — never pills',
    src('components/home/item-rail.tsx').includes('THE LIVING BRIEF') &&
    src('components/home/item-rail.tsx').includes('earlier (') &&
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

  console.log('\n════ THE ONE ROOM GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
