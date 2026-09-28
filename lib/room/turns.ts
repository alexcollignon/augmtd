// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE ROOM — R1: durable room turns (docs/one-room-plan.md). The single write/read module for
// the room conversation. Every writer — the client composer, the prepare pass, delegation
// report-backs, send confirmations — funnels through writeRoomTurn; every reader through
// readRoomTurns. Non-fatal by design: a missing table (migration not yet applied) or a transient
// failure degrades to the in-memory store, never breaks the surface.
//
// ROOM KEY CONVENTION: the ENTITY id for the entity (project) door; `inbox:<id>` /
// `commitment:<id>` / `meeting:<id>` for every ITEM door.
//
// ONE OBJECT, ONE DOOR (stabilization W7.2, Sep 23 — lib/room/door.ts): an item converses under
// its OWN key whatever it is linked to. The old rule ("an item linked to an entity converses in the
// DEAL's room") let a link written by recognition-on-open re-home a commitment's conversation into
// an UNTRACKED machine container mid-visit — and the door then spoke that container's agenda under
// the commitment's title. A link is a fact about the item, never a new address for it. Turns
// already written under entity keys stay where they are, as the entity door's own record.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/utils/fetch-all';

export type RoomTurnAuthor = { kind: 'coworker'; id?: string; name: string; role?: string | null };

export type RoomTurn = {
  id?: string;
  role: 'user' | 'system';
  text: string;
  /** `tag` = the grounding id the turn's own prose placed ([E7], [R2]…). THE REF IS ITS TAG
   *  (lib/home/ask-refs.ts): a stored ref without it cannot be resolved, only guessed at by
   *  position — which is the wrong-object-door bug. Optional: rows written before the law. */
  refs?: Array<{ label: string; href: string | null; tag?: string }>;
  /** An inline component carried by the turn (resolved against the work-component registry, R2). */
  component?: { key: string; refId?: string; state?: Record<string, unknown> } | null;
  /** Coworker attribution — THE ONE-NARRATOR LAW (UX arc): present ONLY when the content is the
   *  coworker's own FIRST-PERSON speech (a deliverable, an ask, a flag). Orchestration narration
   *  ("Max is on X", "Clara drafted the reply") is the chief of staff's voice — author ABSENT —
   *  and renders as a muted event line, never a coworker bubble. */
  author?: RoomTurnAuthor | null;
  createdAt?: string;
  /** The turn's dedupe key — the structural handle renderers fold on (e.g. a `prep:*` narration
   *  collapses into the artifact card it narrates). */
  key?: string;
};

type LooseItemKind = 'inbox' | 'commitment' | 'meeting';

/** The loose anchor's own room key. */
export const looseRoomKey = (kind: LooseItemKind, id: string): string => `${kind}:${id}`;

/** Resolve WHERE an item converses: ALWAYS its own loose key (ONE OBJECT, ONE DOOR — the header).
 *  THE ONE RESOLVER for every narration writer (prepare pass, delegation, verdicts, standing,
 *  handoffs, steer): the signature is kept so no writer forks a key of its own; the link read it
 *  used to make is gone — a link never decides where an item's story is told. Same rule as
 *  lib/room/door.ts `roomKeyForDoor`, which the rail consumes. */
export async function roomKeyForItem(
  _client: SupabaseClient, _userId: string, kind: LooseItemKind, id: string,
): Promise<string> {
  return looseRoomKey(kind, id);
}

/** Append a turn (dedupe_key replaces the prior same-key turn — the keyed-turn idiom). Non-fatal. */
export async function writeRoomTurn(
  client: SupabaseClient, userId: string, roomKey: string,
  turn: RoomTurn & { dedupeKey?: string | null },
): Promise<void> {
  try {
    if (!turn.text?.trim()) return;
    if (turn.dedupeKey) {
      // Dedupe UPDATES IN PLACE — a re-narrated turn keeps its original position in the story
      // (delete+reinsert gave it a fresh created_at, so "Sofia is on X" could land AFTER her own
      // report-back on a re-run — announcement after result). The story's order is part of its truth.
      let ex: { id?: string } | null = null;
      const { data: exLive, error: exErr } = await client.from('room_turns').select('id')
        .eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', turn.dedupeKey)
        .is('archived_at', null).limit(1).maybeSingle();
      ex = exLive;
      if (exErr) { // pre-migration (no archived_at column) — match without the filter
        const { data: exAny } = await client.from('room_turns').select('id')
          .eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', turn.dedupeKey)
          .limit(1).maybeSingle();
        ex = exAny;
      }
      if (ex?.id) {
        await client.from('room_turns').update({
          role: turn.role, text: turn.text,
          refs: turn.refs?.length ? turn.refs : null,
          component: turn.component ?? null,
          author: turn.author ?? null,
        }).eq('id', ex.id);
        return;
      }
    }
    const row = {
      user_id: userId, room_key: roomKey, role: turn.role, text: turn.text,
      refs: turn.refs?.length ? turn.refs : null,
      component: turn.component ?? null,
      author: turn.author ?? null,
      dedupe_key: turn.dedupeKey ?? null,
    };
    const { error: insErr } = await client.from('room_turns').insert(row);
    // ── AN ARCHIVED TURN NEVER HOLDS ITS KEY HOSTAGE (stabilization W13.5 — found live: an engine
    // `requires:<item>` ask was archived, the requirement was still missing, and every later re-post
    // of the ask silently vanished). The dedupe unique index (user_id, room_key, dedupe_key —
    // supabase/migrations/20260725_room_turns.sql) predates `archived_at` and is not partial on it,
    // while the lookup above matches LIVE rows only — so the insert collided with the archived row
    // and the error was swallowed: an archived key was burnt for good (census Sep 24: 84 archived
    // engine asks). THE FIX, zero migration: the archived holder RELEASES the key (it stays in its
    // session as history under `<key>#archived:<its archived_at>`), and the live write lands.
    if (insErr && turn.dedupeKey && isUniqueViolation(insErr)) {
      const released = await releaseArchivedKey(client, userId, roomKey, turn.dedupeKey);
      if (released) await client.from('room_turns').insert(row);
    }
  } catch { /* non-fatal — the in-memory store still renders this session */ }
}

/** Postgres unique_violation (23505), as PostgREST reports it. Pure. */
export function isUniqueViolation(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!err && (err.code === '23505' || /duplicate key value/i.test(String(err.message ?? '')));
}

/** The archived spelling of a released key — unique per archive batch, and never matched by a live
 *  lookup (no writer ever keys on it). Pure; exported for the gate. */
export function archivedKeyOf(dedupeKey: string, archivedAt: string | null | undefined): string {
  return `${dedupeKey}#archived:${archivedAt ?? 'unknown'}`;
}

/** Release a dedupe key held only by ARCHIVED turns (never a live one). Returns true when a holder was
 *  renamed. Non-fatal; a live holder is never touched (the caller's live lookup would have found it). */
export async function releaseArchivedKey(
  client: SupabaseClient, userId: string, roomKey: string, dedupeKey: string,
): Promise<boolean> {
  try {
    const { data, error } = await client.from('room_turns').select('id, archived_at')
      .eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).not('archived_at', 'is', null);
    if (error || !data?.length) return false;
    let n = 0;
    for (const r of data as Array<{ id: string; archived_at: string | null }>) {
      const { error: upErr } = await client.from('room_turns').update({ dedupe_key: archivedKeyOf(dedupeKey, r.archived_at) })
        .eq('id', r.id).eq('user_id', userId).not('archived_at', 'is', null);
      if (!upErr) n++;
    }
    return n > 0;
  } catch { return false; }
}

const mapRows = (rows: Array<Record<string, unknown>>): RoomTurn[] =>
  rows.map((r) => ({
    id: r.id as string,
    role: r.role as 'user' | 'system',
    text: String(r.text ?? ''),
    refs: (r.refs as RoomTurn['refs']) ?? undefined,
    component: (r.component as RoomTurn['component']) ?? undefined,
    author: (r.author as RoomTurnAuthor | null) ?? undefined,
    createdAt: (r.created_at as string) ?? undefined,
    key: (r.dedupe_key as string | null) ?? undefined,
  }));

/** Word-boundary clip — narration NEVER cuts mid-word ("ALP allocation s Nothing goes…" was a real
 *  turn). Cuts at the last word break under `n`, adds an ellipsis only when something was dropped. */
export function clip(text: string, n: number): string {
  const t = String(text ?? '').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n + 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > n * 0.6 ? cut.slice(0, at) : cut.slice(0, n)).replace(/[\s,;:—-]+$/, '')}…`;
}

/** The room's LIVE conversation, oldest→newest (last `limit` turns; archived sessions excluded).
 *  Pre-migration (no archived_at column) the filtered query fails → retry unfiltered. */
export async function readRoomTurns(
  client: SupabaseClient, userId: string, roomKey: string, limit = 50,
): Promise<RoomTurn[]> {
  try {
    let { data, error } = await client.from('room_turns')
      .select('id, role, text, refs, component, author, created_at, dedupe_key')
      .eq('user_id', userId).eq('room_key', roomKey).is('archived_at', null)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
    if (error) {
      ({ data, error } = await client.from('room_turns')
        .select('id, role, text, refs, component, author, created_at, dedupe_key')
        .eq('user_id', userId).eq('room_key', roomKey)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit));
    }
    if (error || !data) return [];
    return mapRows((data as Array<Record<string, unknown>>).reverse());
  } catch { return []; }
}

/** ARCHIVE the live conversation ("Clear" = a session boundary, never a deletion). Pre-migration
 *  degrades to the old delete so Clear always works. */
export async function archiveRoomTurns(client: SupabaseClient, userId: string, roomKey: string): Promise<void> {
  try {
    const { error } = await client.from('room_turns')
      .update({ archived_at: new Date().toISOString() })
      .eq('user_id', userId).eq('room_key', roomKey).is('archived_at', null);
    if (error) await client.from('room_turns').delete().eq('user_id', userId).eq('room_key', roomKey);
  } catch { /* non-fatal */ }
}

/**
 * A NEW CHAT IS A NEW SESSION, NOT A NEW ROOM (owner walk, Sep 14: "new chat should maybe just
 * reset the current project chat, instead of redirecting to home?").
 *
 * The project room's stream carries two different things under one roof: the AD-HOC EXCHANGE (the
 * user's words and the replies to them) and the room's STANDING RECORD (engine narrations keyed to
 * a piece of work, component cards, a coworker's attributed speech). Archiving the room wholesale —
 * what `archiveRoomTurns` does for a chat room, where everything IS the exchange — would wipe the
 * record with the chat, and the record is the work's own story.
 *
 * So the boundary is STRUCTURAL, never a guess: a SYSTEM turn belongs to the exchange exactly when
 * it carries no durable handle — no dedupe key (an engine narration is always keyed to its work), no
 * component (a card is a deed, not talk), no author (attributed speech is a colleague's record).
 * Those turns archive as ONE session (the archived_at batch IS the session id, the same grouping
 * `listRoomSessions` already reads); everything else stays exactly where it is.
 *
 * ⚠️ A USER TURN IS CHAT BY DEFINITION (orchestrator walk, Sep 15 — a live project room: New chat left
 * the reader's own "Go ahead without it — use what you have…" bubble standing in an otherwise empty
 * room, and because a user turn survived, the room never counted as fresh).
 *
 * The handle boundary above was written to protect ENGINE narrations, CARDS and COWORKER speech —
 * three kinds of system-role record. It was never a statement about the reader. But the go-ahead is
 * written server-side (app/api/room/asks) as `role: 'user'` with `dedupeKey: proceed:<turnId>`, and
 * that key exists for IDEMPOTENCE — so a double-click cannot speak twice — not for durability. The
 * filter could not tell the two apart, so one utterance became immortal: unarchivable by New chat,
 * un-resumable by a saved session, standing over every future conversation in that room.
 *
 * THE LAW: role='user' turns are chat, unconditionally, whatever handles they carry. A user
 * utterance is the reader talking; nothing about a key makes it part of the work's record.
 *
 * WHY TWO UPDATES AND NOT ONE `.or()`: PostgREST `or()` filters are known to ERROR on UPDATE in this
 * codebase (the `connections` claim, 42703 — fine on SELECT, not on UPDATE), and this is the one
 * seam where a silent failure means "your chat did not reset". Two sequential conditional updates
 * SHARING ONE `archived_at` stamp are deterministic, and the shared stamp is what keeps them ONE
 * session for `listRoomSessions` and for `restoreRoomSession`.
 */
export async function archiveRoomChat(client: SupabaseClient, userId: string, roomKey: string): Promise<number> {
  try {
    const at = new Date().toISOString();   // ONE stamp = ONE session, across both passes
    let n = 0;
    // 1 · EVERY word of the reader's, handles and all.
    const { data: mine, error: mineErr } = await client.from('room_turns')
      .update({ archived_at: at })
      .eq('user_id', userId).eq('room_key', roomKey).is('archived_at', null)
      .eq('role', 'user')
      .select('id');
    if (!mineErr) n += (mine ?? []).length;
    // 2 · The system side of the exchange — the unhandled turns, exactly as before.
    const { data: theirs, error: theirsErr } = await client.from('room_turns')
      .update({ archived_at: at })
      .eq('user_id', userId).eq('room_key', roomKey).is('archived_at', null)
      .eq('role', 'system')
      .is('dedupe_key', null).is('component', null).is('author', null)
      .select('id');
    if (!theirsErr) n += (theirs ?? []).length;
    // W19.2b · A NEW SESSION GETS A FRESH OPENING: the pinned seen opening (and its update ledger)
    // belonged to the session just saved — released, so the next open paints the room's newest
    // composition (lib/room/room-update). The update turns themselves are chat, and archived above.
    await releaseOpeningPin(client, userId, roomKey);
    return n;
  } catch { return 0; }
}

/**
 * W19.2b · A NEW SESSION GETS A FRESH OPENING — the pin (and its update ledger) on the room's
 * `room_brief` row is released; the newest composition's words are untouched and the next open paints
 * them. Lives HERE (a leaf: the one item_plans door only), never in lib/room/brief — this module is
 * reached by client bundles, and the composer's graph is server-only. Non-fatal.
 */
export async function releaseOpeningPin(client: SupabaseClient, userId: string, roomKey: string): Promise<void> {
  try {
    const { readPlan, updatePlan } = await import('@/lib/store/item-plans');
    const data = await readPlan(client, userId, 'room_brief', roomKey);
    const t = (data?.tasks ?? null) as Record<string, unknown> | null;
    if (!t || (!t.shown && !t.update && !t.earlier)) return;
    const rest = Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'shown' && k !== 'update' && k !== 'earlier'));
    await updatePlan(client, userId, 'room_brief', roomKey, rest as never, { updatedAt: data?.updated_at ?? undefined });
  } catch { /* non-fatal — the worst case is the old opening standing one more session */ }
}

/**
 * W19.2b · AN UPDATE IS A NEW MESSAGE (lib/room/room-update). The seat's delta is posted as its OWN
 * words — a SYSTEM turn with no dedupe key, no component and no author: the exchange side of the room
 * (W19.B's boundary), so New chat saves it with the session, Resume brings it back, and it renders as
 * the seat's message through the one answer renderer. `replaceId` supersedes an update nobody has read
 * yet (at most one pending update per room); an archived one is never touched — a fresh row lands.
 * Returns the row's id + stamp, or null (non-fatal — the brief still stores).
 */
export async function postRoomUpdate(
  client: SupabaseClient, userId: string, roomKey: string, text: string, replaceId?: string | null,
): Promise<{ turnId: string | null; at: string } | null> {
  try {
    const body = String(text ?? '').trim();
    if (!body) return null;
    if (replaceId) {
      const { data, error } = await client.from('room_turns').update({ text: body })
        .eq('id', replaceId).eq('user_id', userId).eq('room_key', roomKey).is('archived_at', null)
        .select('id, created_at');
      const row = (data ?? [])[0] as { id: string; created_at: string } | undefined;
      if (!error && row) return { turnId: row.id, at: new Date().toISOString() };
    }
    const { data, error } = await client.from('room_turns')
      .insert({ user_id: userId, room_key: roomKey, role: 'system', text: body, refs: null, component: null, author: null, dedupe_key: null })
      .select('id, created_at').maybeSingle();
    if (error) return null;
    const created = Date.parse(String(data?.created_at ?? ''));
    return { turnId: (data?.id as string | undefined) ?? null, at: new Date(Number.isFinite(created) ? created : Date.now()).toISOString() };
  } catch { return null; }
}

/**
 * RESUME MEANS CONTINUE (owner walk, Sep 14: "shouldn't clicking on saved chats open the actual chat?
 * and allow to resume from there?").
 *
 * A saved chat was read-only history. But a room holds ONE live chat session at a time, and "saved"
 * was only ever a session boundary — nothing about those turns is less real than the ones on screen.
 * So resuming SWAPS the live session for a saved one:
 *
 *   1. the current ad-hoc exchange is SAVED first, through the one door that owns that boundary
 *      (`archiveRoomChat` — so the structural rule for what counts as chat is decided in exactly one
 *      place, and the record, cards and attributed speech stay live regardless);
 *   2. the named session's turns come back to live (`archived_at` cleared on that batch).
 *
 * SAVE-THEN-RESTORE, IN THAT ORDER, is the whole atomicity story: restoring first would hand the
 * archive step its own just-restored turns to re-file. If step 2 fails, step 1 still stands — the
 * user's current words are saved, nothing is lost, and the drawer lists both sessions.
 *
 * THE DURABLE HANDLES NEVER MOVE: a SYSTEM turn comes back only with no dedupe key, no component and
 * no author — the same structural boundary `archiveRoomChat` archives by, mirrored exactly. A settled
 * engine ask (which archives WITH its dedupe key) can never be resurrected by resuming a chat that sat
 * beside it. And the mirror follows the Sep 15 law with it: every USER turn of that session comes back
 * unconditionally, because that is precisely the set that left. ARCHIVE AND RESTORE MUST FILTER BY THE
 * SAME RULE — two spellings of one boundary would resume half a conversation.
 */
export async function restoreRoomSession(
  client: SupabaseClient, userId: string, roomKey: string, sessionId: string,
): Promise<{ restored: number; saved: number }> {
  let saved = 0;
  try {
    if (!sessionId) return { restored: 0, saved: 0 };
    saved = await archiveRoomChat(client, userId, roomKey);
    let restored = 0;
    // 1 · the reader's own words, handles and all (the archive's mirror)
    const { data: mine, error: mineErr } = await client.from('room_turns')
      .update({ archived_at: null })
      .eq('user_id', userId).eq('room_key', roomKey).eq('archived_at', sessionId)
      .eq('role', 'user')
      .select('id');
    if (!mineErr) restored += (mine ?? []).length;
    // 2 · the system side of the exchange — unhandled turns only
    const { data: theirs, error: theirsErr } = await client.from('room_turns')
      .update({ archived_at: null })
      .eq('user_id', userId).eq('room_key', roomKey).eq('archived_at', sessionId)
      .eq('role', 'system')
      .is('dedupe_key', null).is('component', null).is('author', null)
      .select('id');
    if (!theirsErr) restored += (theirs ?? []).length;
    return { restored, saved };
  } catch { return { restored: 0, saved }; }
}

export type RoomSession = { at: string; count: number; title: string };

/** THE CHAT BOUNDARY AS A PREDICATE (pure) — the exact rule `archiveRoomChat` / `restoreRoomSession`
 *  filter by, for callers that hold rows: every USER turn, and a SYSTEM turn only with no dedupe key,
 *  no component and no author. Durable handles (engine narrations, cards, a coworker's speech) are
 *  never chat — so no session verb can ever move them. */
export function isChatTurn(r: { role: string; dedupe_key?: string | null; component?: unknown; author?: unknown }): boolean {
  if (r.role === 'user') return true;
  return r.role === 'system' && !r.dedupe_key && !r.component && !r.author;
}

/** "Sep 28" from an ISO stamp, in UTC (server-side, zone-free — the label is a date, not a moment). */
function sessionDay(at: string): string {
  const d = new Date(at);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** W19.C · A SESSION IS TITLED BY THE READER'S OWN FIRST WORDS (owner walk, Sep 28: two saved chats
 *  both titled "What do you want to pick up?"). The first turn of a batch was the persisted OPENER —
 *  the seat's question, identical in every session. The title is the first USER turn, clipped at a
 *  word boundary; a session with no user words falls back to its date. Pure. */
export function sessionTitle(rows: Array<{ role: string; text: string }>, at: string): string {
  const first = rows.find((r) => r.role === 'user' && String(r.text ?? '').trim());
  if (first) return clip(String(first.text).replace(/\s+/g, ' '), 60);
  const day = sessionDay(at);
  return day ? `Chat · ${day}` : 'Chat';
}

/** The room's archived SESSIONS (History ⌄), newest first — turns sharing an archived_at batch.
 *  NO SILENT CAPS (invariant 10): a long-lived room's full archived history is a full listing —
 *  an unpaged `.limit(1000)` would silently drop older sessions from the History picker (and
 *  under-count a session's turns) once a room passed 1000 archived turns. Paged via
 *  `fetchAllRows`, keeping the room's existing stable `created_at` order.
 *  W19.C: a batch with NO user turn is not a chat (a settled engine ask archives under its own
 *  stamp) and is not listed; a session is titled by `sessionTitle`. */
export async function listRoomSessions(client: SupabaseClient, userId: string, roomKey: string): Promise<RoomSession[]> {
  try {
    const data = await fetchAllRows<{ archived_at: string; role: string; text: string; created_at: string }>((from, to) =>
      client.from('room_turns').select('archived_at, role, text, created_at')
        .eq('user_id', userId).eq('room_key', roomKey).not('archived_at', 'is', null)
        .order('created_at', { ascending: true }).range(from, to));
    const by = new Map<string, Array<{ role: string; text: string }>>();
    for (const r of data) {
      const k = r.archived_at;
      const e = by.get(k);
      if (e) e.push(r); else by.set(k, [r]);
    }
    return [...by.entries()]
      .filter(([, rows]) => rows.some((r) => r.role === 'user'))
      .map(([at, rows]) => ({ at, count: rows.length, title: sessionTitle(rows, at) }))
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch { return []; }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// W19.C · A PROJECT CHAT CAN BE DELETED OR MOVED OUT — AND NOTHING IT MADE GOES WITH IT.
//
// A project room's saved chat is an `archived_at` batch INSIDE the entity's own room key (never a
// `chat:*` room), so the Home verbs did not apply. Two verbs, both CONDITIONAL CLAIMS (the batch is
// claimed by one UPDATE filtered on its room key AND its stamp — a second click finds zero rows and
// changes nothing: exactly once) and both REVERSIBLE:
//   · DELETE re-keys the batch's CHAT turns to `deleted:<roomKey>` (still archived — no listing,
//     no reader, no sidebar ever reads that key); undo re-keys them back under the same stamp.
//   · MOVE OUT re-keys them to a fresh `chat:<uuid>` and makes them live — the conversation becomes a
//     Home chat; undo re-keys that chat back into the project under the same stamp.
// NOTHING CASCADES, BY CONSTRUCTION: both verbs touch `room_turns` rows only, and only rows the chat
// boundary (`isChatTurn`) owns. Tasks, drafts and deliverables are keyed by ITEM, never by room —
// no row anywhere references a turn (no FK on room_turns) — so they survive untouched.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const DELETED_ROOM_PREFIX = 'deleted:';
export const deletedRoomKey = (roomKey: string): string => `${DELETED_ROOM_PREFIX}${roomKey}`;

/** The ids of one archived batch's CHAT turns (the boundary predicate, applied to the rows). Paged —
 *  a full listing (no silent caps). Null = the read failed (the caller does nothing). */
async function sessionChatIds(
  client: SupabaseClient, userId: string, roomKey: string, at: string, opts: { fromFirstUserTurn?: boolean } = {},
): Promise<string[] | null> {
  try {
    const rows = await fetchAllRows<{ id: string; role: string; dedupe_key: string | null; component: unknown; author: unknown }>((from, to) =>
      client.from('room_turns').select('id, role, dedupe_key, component, author')
        .eq('user_id', userId).eq('room_key', roomKey).eq('archived_at', at)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to));
    const chat = rows.filter(isChatTurn);
    // A conversation that LEAVES the project starts at the reader's own words: the seat's opener
    // ahead of them is the room's greeting, not the conversation (it stays behind, archived).
    // No words of the reader's left in the batch → there is no conversation to move.
    const start = opts.fromFirstUserTurn ? chat.findIndex((r) => r.role === 'user') : 0;
    return start < 0 ? [] : chat.slice(start).map((r) => r.id);
  } catch { return null; }
}

/** The ids currently under a key (+ stamp, or live when `at` is null). Paged. */
async function idsUnder(client: SupabaseClient, userId: string, roomKey: string, at: string | null): Promise<string[] | null> {
  try {
    const rows = await fetchAllRows<{ id: string }>((from, to) => {
      const q = client.from('room_turns').select('id').eq('user_id', userId).eq('room_key', roomKey);
      return (at === null ? q.is('archived_at', null) : q.eq('archived_at', at))
        .order('id', { ascending: true }).range(from, to);
    });
    return rows.map((r) => r.id);
  } catch { return null; }
}

/** Re-key a claimed set of turns, CONDITIONALLY (room key + stamp still what we read), in bounded
 *  chunks (an `in()` list rides the URL). Returns how many rows actually moved. */
async function rekeyClaimed(
  client: SupabaseClient, userId: string, ids: string[],
  from: { roomKey: string; at: string | null }, to: { roomKey: string; at: string | null },
): Promise<number> {
  let n = 0;
  for (let i = 0; i < ids.length; i += 200) {
    let q = client.from('room_turns').update({ room_key: to.roomKey, archived_at: to.at })
      .eq('user_id', userId).eq('room_key', from.roomKey).in('id', ids.slice(i, i + 200));
    q = from.at === null ? q.is('archived_at', null) : q.eq('archived_at', from.at);
    const { data, error } = await q.select('id');
    if (!error) n += (data ?? []).length;
  }
  return n;
}

/** DELETE one saved session of a room (reversible). Returns how many turns left the listing. */
export async function deleteRoomSession(client: SupabaseClient, userId: string, roomKey: string, at: string): Promise<number> {
  try {
    if (!roomKey || !at || roomKey.startsWith(DELETED_ROOM_PREFIX)) return 0;
    const ids = await sessionChatIds(client, userId, roomKey, at);
    if (!ids) return 0;
    return await rekeyClaimed(client, userId, ids, { roomKey, at }, { roomKey: deletedRoomKey(roomKey), at });
  } catch { return 0; }
}

/** UNDO a session delete — the batch comes back to the room's saved chats under its own stamp. */
export async function restoreDeletedRoomSession(client: SupabaseClient, userId: string, roomKey: string, at: string): Promise<number> {
  try {
    if (!roomKey || !at) return 0;
    const ids = await idsUnder(client, userId, deletedRoomKey(roomKey), at);
    if (!ids) return 0;
    return await rekeyClaimed(client, userId, ids, { roomKey: deletedRoomKey(roomKey), at }, { roomKey, at });
  } catch { return 0; }
}

/** MOVE a saved session OUT of the project into a fresh Home chat (reversible). `chatKey` may be
 *  supplied (a test, an idempotent retry); a fresh `chat:<uuid>` otherwise. Null = nothing moved. */
export async function moveRoomSessionOut(
  client: SupabaseClient, userId: string, roomKey: string, at: string, chatKey?: string,
): Promise<{ chatKey: string; moved: number } | null> {
  try {
    if (!roomKey || !at || roomKey.startsWith('chat:') || roomKey.startsWith(DELETED_ROOM_PREFIX)) return null;
    const key = chatKey && chatKey.startsWith('chat:') ? chatKey : `chat:${crypto.randomUUID()}`;
    const ids = await sessionChatIds(client, userId, roomKey, at, { fromFirstUserTurn: true });
    if (!ids?.length) return null;
    const moved = await rekeyClaimed(client, userId, ids, { roomKey, at }, { roomKey: key, at: null });
    return moved > 0 ? { chatKey: key, moved } : null;
  } catch { return null; }
}

/** UNDO a move-out: the Home chat's live turns go back into the project as the saved session they
 *  were (same stamp). Only a `chat:*` key moves, and only its live turns. */
export async function moveRoomSessionBack(
  client: SupabaseClient, userId: string, chatKey: string, roomKey: string, at: string,
): Promise<number> {
  try {
    if (!chatKey.startsWith('chat:') || !roomKey || roomKey.startsWith('chat:') || !at) return 0;
    const ids = await idsUnder(client, userId, chatKey, null);
    if (!ids) return 0;
    return await rekeyClaimed(client, userId, ids, { roomKey: chatKey, at: null }, { roomKey, at });
  } catch { return 0; }
}

export type FiledChat = { key: string; title: string; at: string; count: number };

/** THE HOME CHATS FILED INTO A PROJECT (the `room_scope` binding written by /api/rooms/adopt), each
 *  titled like the sidebar does (the reader's rename, else the first user turn). A chat whose turns
 *  are all archived (deleted from Home) is not listed. Full listings, paged (no silent caps). */
export async function listFiledChats(client: SupabaseClient, userId: string, entityId: string): Promise<FiledChat[]> {
  try {
    // Through THE ONE item_plans door (lib/store/item-plans): every room_scope binding of this user
    // (paged — a full listing), kept where the binding names THIS project.
    const { readPlans } = await import('@/lib/store/item-plans');
    const scopes = await readPlans(client, userId, 'room_scope', { keyPrefix: 'chat:' });
    const keys = scopes.filter((r) => (r.tasks as { entityId?: string } | null)?.entityId === entityId).map((r) => r.key);
    if (!keys.length) return [];
    const [turns, titles] = await Promise.all([
      fetchAllRows<{ room_key: string; role: string; text: string; created_at: string }>((from, to) =>
        client.from('room_turns').select('room_key, role, text, created_at')
          .eq('user_id', userId).in('room_key', keys).is('archived_at', null)
          .order('created_at', { ascending: true }).range(from, to)),
      readPlans(client, userId, 'room_title', { keys }),
    ]);
    const custom = new Map<string, string>();
    for (const t of titles) {
      const title = (t.tasks as { title?: unknown } | null)?.title;
      if (typeof title === 'string' && title.trim()) custom.set(t.key, title.trim());
    }
    const by = new Map<string, Array<{ role: string; text: string; created_at: string }>>();
    for (const t of turns) { const e = by.get(t.room_key); if (e) e.push(t); else by.set(t.room_key, [t]); }
    const out: FiledChat[] = [];
    for (const k of keys) {
      const rows = by.get(k);
      if (!rows?.some((r) => r.role === 'user')) continue;
      const last = rows[rows.length - 1].created_at;
      out.push({ key: k, title: custom.get(k) ?? sessionTitle(rows, last), at: last, count: rows.length });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  } catch { return []; }
}

/** One archived session's turns, oldest→newest. */
export async function readRoomSession(client: SupabaseClient, userId: string, roomKey: string, at: string): Promise<RoomTurn[]> {
  try {
    const { data, error } = await client.from('room_turns')
      .select('id, role, text, refs, component, author, created_at')
      .eq('user_id', userId).eq('room_key', roomKey).eq('archived_at', at)
      .order('created_at', { ascending: true }).limit(200);
    if (error || !data) return [];
    return mapRows(data as Array<Record<string, unknown>>);
  } catch { return []; }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ASKS LIVE AND DIE WITH THEIR WORK (experience-spec law 3, Aug 2): an input-checklist ask exists
// only while the work it serves is open. When the item/commitment RESOLVES — verdict-applied,
// fulfillment-closed, reply-resolved, or the user's own Done/Dismiss — its ask SETTLES: the
// affordance dies, the text stays as history (the story is never erased — the same mechanic the
// ingest funnel uses on attach). A MERGED ask (one artifact, many items — component.state.covers)
// only settles once every covered item has resolved.
//
// W14.2 · AN UNDO BRINGS THE ASK BACK (census Sep 24: 9 live asks on dismissed items; the activity
// Undo re-opened items whose asks had been stripped for good). The settle is now REVERSIBLE by
// construction: it never nulls the component — it RE-KEYS it (`SETTLED_ASK_KEY`, every ask reader
// matches `input_checklist` only, so the affordance is gone everywhere) and stamps WHO settled it
// (`state.settled = { ref, at, why }`). An engine ask's turn also archives (its words were
// scaffolding); a coworker's stays as conversation history. `restoreAsksForItem` — called by THE
// ONE REOPEN (lib/activity/reopen.ts) — puts back exactly the asks a RESOLUTION of that item
// settled (never one the user answered, never one a verdict retired), and a live re-post of the
// same key always wins over the restore (the newer ask is the truth).
// ════════════════════════════════════════════════════════════════════════════════════════════════
export type AskSettleWhy = 'resolved' | 'answered' | 'verdict';

export async function settleAsksForItem(
  client: SupabaseClient, userId: string,
  itemKind: 'inbox_item' | 'commitment', itemId: string,
  opts: { why?: AskSettleWhy } = {},
): Promise<number> {
  try {
    const { settledAskComponent, askRefOf } = await import('@/lib/room/ask-settle');
    const ref = askRefOf(itemKind, itemId);
    const at = new Date().toISOString();
    const why: AskSettleWhy = opts.why ?? 'resolved';
    // Own asks (requires:<id> · delegate:<id>:*) + merged asks in ANY room that cover this item —
    // LIVE turns only (an ask archived for another reason is never re-stamped as this settle's).
    const { data: own } = await client.from('room_turns').select('id, component, author')
      .eq('user_id', userId)
      .or(`dedupe_key.like.delegate:${itemId}:*,dedupe_key.eq.requires:${itemId}`)
      .filter('component->>key', 'eq', 'input_checklist')
      .is('archived_at', null);
    const { data: covering } = await client.from('room_turns').select('id, component, author')
      .eq('user_id', userId)
      .filter('component->>key', 'eq', 'input_checklist')
      .contains('component->state', { covers: [ref] })
      .is('archived_at', null);
    const rows = [...(own ?? []), ...(covering ?? [])];
    const seen = new Set<string>();
    let settled = 0;
    type AskRow = { id: string; component: { key?: string; state?: Record<string, unknown> } | null; author?: { name?: string } | null };
    for (const t of rows as AskRow[]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const state = (t.component?.state ?? {}) as Record<string, unknown>;
      const covers = Array.isArray(state.covers) ? (state.covers as string[]).filter((c) => c !== ref) : [];
      if (covers.length > 0) {
        // Other live work still needs this artifact — the ask stays, minus this beneficiary (kept in
        // `coversSettled`, so an undo of THIS item puts it back among the beneficiaries).
        const prior = Array.isArray(state.coversSettled) ? (state.coversSettled as string[]) : [];
        await client.from('room_turns').update({ component: { ...(t.component ?? {}), state: { ...state, covers, coversSettled: [...new Set([...prior, ref])] } } })
          .eq('id', t.id).eq('user_id', userId);
      } else {
        // FORWARD-MOTION LAW #5: an ENGINE ask's text is pure scaffolding ("To finish this I
        // need…") — stripping only the checklist left a ghost line (found live). The whole turn
        // archives; a COWORKER's ask keeps its text (their speech is conversation history).
        const engineAsk = !((t.author ?? null) as { name?: string } | null)?.name;
        const component = settledAskComponent(t.component, { ref, at, why });
        const upd = engineAsk ? { component, archived_at: at } : { component };
        const { error: settleErr } = await client.from('room_turns').update(upd).eq('id', t.id).eq('user_id', userId).is('archived_at', null);
        if (settleErr && engineAsk) await client.from('room_turns').update({ component }).eq('id', t.id).eq('user_id', userId); // pre-migration: no archived_at column
        settled++;
      }
    }
    return settled;
  } catch { return 0; }
}

/**
 * W14.2 · THE UNDO'S MIRROR — the asks a RESOLUTION of this item settled come back live (the ONE
 * reopen calls it; the item is open again, so is what it was waiting on). Symmetric with the settle:
 * the component's key and state are restored, an engine ask's turn un-archives under its original
 * key — unless a LIVE turn already holds that key (a later re-post is the newer truth; the settled
 * row stays record). A merged ask this item had left gets it back among its beneficiaries.
 * Returns how many asks came back. Non-fatal.
 */
export async function restoreAsksForItem(
  client: SupabaseClient, userId: string,
  itemKind: 'inbox_item' | 'commitment', itemId: string,
): Promise<number> {
  try {
    const { SETTLED_ASK_KEY, restoredAskComponent, askRefOf, baseDedupeKey, restorableBy } = await import('@/lib/room/ask-settle');
    const ref = askRefOf(itemKind, itemId);
    let restored = 0;
    const { data: settledRows } = await client.from('room_turns').select('id, room_key, dedupe_key, component, archived_at')
      .eq('user_id', userId)
      .filter('component->>key', 'eq', SETTLED_ASK_KEY)
      .filter('component->state->settled->>ref', 'eq', ref);
    for (const t of (settledRows ?? []) as Array<{ id: string; room_key: string; dedupe_key: string | null; component: { key?: string; state?: Record<string, unknown> } | null; archived_at: string | null }>) {
      if (!restorableBy(t.component, ref)) continue;
      const component = restoredAskComponent(t.component);
      if (!t.archived_at) {
        const { error } = await client.from('room_turns').update({ component }).eq('id', t.id).eq('user_id', userId);
        if (!error) restored++;
        continue;
      }
      const key = t.dedupe_key ? baseDedupeKey(t.dedupe_key) : null;
      if (key) {
        const { data: liveHolder } = await client.from('room_turns').select('id')
          .eq('user_id', userId).eq('room_key', t.room_key).eq('dedupe_key', key).is('archived_at', null).limit(1).maybeSingle();
        if (liveHolder?.id) continue; // the re-posted ask stands — never two live asks on one key
        // Another ARCHIVED row may hold the original spelling (the key-release idiom renamed ours).
        if (key !== t.dedupe_key) await releaseArchivedKey(client, userId, t.room_key, key);
      }
      const { error } = await client.from('room_turns').update({ component, archived_at: null, ...(key ? { dedupe_key: key } : {}) })
        .eq('id', t.id).eq('user_id', userId).eq('archived_at', t.archived_at);
      if (!error) restored++;
    }
    // A merged ask that stayed live for its siblings takes this beneficiary back.
    const { data: merged } = await client.from('room_turns').select('id, component')
      .eq('user_id', userId)
      .filter('component->>key', 'eq', 'input_checklist')
      .contains('component->state', { coversSettled: [ref] })
      .is('archived_at', null);
    for (const t of (merged ?? []) as Array<{ id: string; component: { key?: string; state?: Record<string, unknown> } | null }>) {
      const state = (t.component?.state ?? {}) as Record<string, unknown>;
      const covers = [...new Set([...(Array.isArray(state.covers) ? state.covers as string[] : []), ref])];
      const coversSettled = (Array.isArray(state.coversSettled) ? state.coversSettled as string[] : []).filter((c) => c !== ref);
      const { error } = await client.from('room_turns').update({ component: { ...(t.component ?? {}), state: { ...state, covers, coversSettled } } })
        .eq('id', t.id).eq('user_id', userId);
      if (!error) restored++;
    }
    return restored;
  } catch { return 0; }
}

/** The batch mirror (a bulk deed's undo): ONE read finds which of these items have settled asks at
 *  all (usually none), and only those are restored. Returns the total restored. Non-fatal. */
export async function restoreAsksForItems(
  client: SupabaseClient, userId: string,
  itemKind: 'inbox_item' | 'commitment', itemIds: string[],
): Promise<number> {
  try {
    if (!itemIds.length) return 0;
    const { SETTLED_ASK_KEY, askRefOf } = await import('@/lib/room/ask-settle');
    const want = new Map(itemIds.map((id) => [askRefOf(itemKind, id), id]));
    type R = { id: string; component: { state?: { settled?: { ref?: string }; coversSettled?: string[] } } | null };
    // Two small full listings (never a silent cap): every settled ask, and every live ask (a merged
    // one may carry this item in `coversSettled`).
    const [settledRows, liveAsks] = await Promise.all(([SETTLED_ASK_KEY, 'input_checklist'] as const).map((key) =>
      fetchAllRows<R>((from, to) => {
        const q = client.from('room_turns').select('id, component').eq('user_id', userId).filter('component->>key', 'eq', key);
        return (key === 'input_checklist' ? q.is('archived_at', null) : q).order('id', { ascending: true }).range(from, to);
      })));
    const rows = [...settledRows, ...liveAsks];
    const hit = new Set<string>();
    for (const r of rows) {
      const s = r.component?.state;
      if (s?.settled?.ref && want.has(s.settled.ref)) hit.add(want.get(s.settled.ref)!);
      for (const c of s?.coversSettled ?? []) if (want.has(c)) hit.add(want.get(c)!);
    }
    let n = 0;
    for (const id of hit) n += await restoreAsksForItem(client, userId, itemKind, id);
    return n;
  } catch { return 0; }
}
