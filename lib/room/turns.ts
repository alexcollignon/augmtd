// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE ROOM — R1: durable room turns (docs/one-room-plan.md). The single write/read module for
// the room conversation. Every writer — the client composer, the prepare pass, delegation
// report-backs, send confirmations — funnels through writeRoomTurn; every reader through
// readRoomTurns. Non-fatal by design: a missing table (migration not yet applied) or a transient
// failure degrades to the in-memory store, never breaks the surface.
//
// ROOM KEY CONVENTION (locked in the plan): the ENTITY id for deal rooms; `inbox:<id>` /
// `commitment:<id>` / `meeting:<id>` for loose anchors. An item linked to an entity converses in
// the DEAL's room — navigating between a deal's artifacts keeps ONE conversation.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

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
const LINK_KIND: Record<LooseItemKind, string> = { inbox: 'inbox_item', commitment: 'commitment', meeting: 'meeting' };

/** The loose anchor's own room key. */
export const looseRoomKey = (kind: LooseItemKind, id: string): string => `${kind}:${id}`;

/** Resolve WHERE an item converses: its entity's room when linked, else its own loose key. */
export async function roomKeyForItem(
  client: SupabaseClient, userId: string, kind: LooseItemKind, id: string,
): Promise<string> {
  try {
    const { data } = await client.from('entity_links').select('entity_id')
      .eq('user_id', userId).eq('item_kind', LINK_KIND[kind]).eq('item_id', id)
      .not('entity_id', 'is', null).maybeSingle();
    return (data?.entity_id as string) ?? looseRoomKey(kind, id);
  } catch { return looseRoomKey(kind, id); }
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
    await client.from('room_turns').insert({
      user_id: userId, room_key: roomKey, role: turn.role, text: turn.text,
      refs: turn.refs?.length ? turn.refs : null,
      component: turn.component ?? null,
      author: turn.author ?? null,
      dedupe_key: turn.dedupeKey ?? null,
    });
  } catch { /* non-fatal — the in-memory store still renders this session */ }
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
    return n;
  } catch { return 0; }
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

export type RoomSession = { at: string; count: number; firstText: string };

/** The room's archived SESSIONS (History ⌄), newest first — turns sharing an archived_at batch. */
export async function listRoomSessions(client: SupabaseClient, userId: string, roomKey: string): Promise<RoomSession[]> {
  try {
    const { data, error } = await client.from('room_turns')
      .select('archived_at, text, created_at')
      .eq('user_id', userId).eq('room_key', roomKey).not('archived_at', 'is', null)
      .order('created_at', { ascending: true }).limit(1000);
    if (error || !data) return [];
    const by = new Map<string, { count: number; firstText: string }>();
    for (const r of data as Array<{ archived_at: string; text: string }>) {
      const k = r.archived_at;
      const e = by.get(k);
      if (e) e.count++;
      else by.set(k, { count: 1, firstText: String(r.text ?? '').slice(0, 80) });
    }
    return [...by.entries()].map(([at, v]) => ({ at, ...v })).sort((a, b) => b.at.localeCompare(a.at));
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
// component strips (the affordance dies), the text stays as history (the story is never erased —
// the same mechanic the ingest funnel uses on attach). A MERGED ask (one artifact, many items —
// component.state.covers) only strips once every covered item has resolved.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export async function settleAsksForItem(
  client: SupabaseClient, userId: string,
  itemKind: 'inbox_item' | 'commitment', itemId: string,
): Promise<number> {
  try {
    const ref = `${itemKind === 'commitment' ? 'commitment' : 'inbox'}:${itemId}`;
    // Own asks (requires:<id> · delegate:<id>:*) + merged asks in ANY room that cover this item.
    const { data: own } = await client.from('room_turns').select('id, component')
      .eq('user_id', userId)
      .or(`dedupe_key.like.delegate:${itemId}:*,dedupe_key.eq.requires:${itemId}`)
      .filter('component->>key', 'eq', 'input_checklist');
    const { data: covering } = await client.from('room_turns').select('id, component')
      .eq('user_id', userId)
      .filter('component->>key', 'eq', 'input_checklist')
      .contains('component->state', { covers: [ref] });
    const rows = [...(own ?? []), ...(covering ?? [])];
    const seen = new Set<string>();
    let settled = 0;
    for (const t of rows as Array<{ id: string; component: { key?: string; state?: Record<string, unknown> } | null }>) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const state = (t.component?.state ?? {}) as Record<string, unknown>;
      const covers = Array.isArray(state.covers) ? (state.covers as string[]).filter((c) => c !== ref) : [];
      if (covers.length > 0) {
        // Other live work still needs this artifact — the ask stays, minus this beneficiary.
        await client.from('room_turns').update({ component: { ...(t.component ?? {}), state: { ...state, covers } } }).eq('id', t.id);
      } else {
        // FORWARD-MOTION LAW #5: an ENGINE ask's text is pure scaffolding ("To finish this I
        // need…") — stripping only the checklist left a ghost line (found live). The whole turn
        // archives; a COWORKER's ask keeps its text (their speech is conversation history).
        const { data: full } = await client.from('room_turns').select('author').eq('id', t.id).maybeSingle();
        const engineAsk = !((full?.author ?? null) as { name?: string } | null)?.name;
        const upd = engineAsk ? { component: null, archived_at: new Date().toISOString() } : { component: null };
        const { error: settleErr } = await client.from('room_turns').update(upd).eq('id', t.id);
        if (settleErr && engineAsk) await client.from('room_turns').update({ component: null }).eq('id', t.id); // pre-migration: no archived_at column
        settled++;
      }
    }
    return settled;
  } catch { return 0; }
}
