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
  refs?: Array<{ label: string; href: string | null }>;
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
