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
  /** Coworker attribution; absent = the chief of staff (system) or the user. */
  author?: RoomTurnAuthor | null;
  createdAt?: string;
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
      await client.from('room_turns').delete()
        .eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', turn.dedupeKey);
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

/** The room's conversation, oldest→newest (last `limit` turns). Empty pre-migration/on failure. */
export async function readRoomTurns(
  client: SupabaseClient, userId: string, roomKey: string, limit = 50,
): Promise<RoomTurn[]> {
  try {
    const { data, error } = await client.from('room_turns')
      .select('id, role, text, refs, component, author, created_at')
      .eq('user_id', userId).eq('room_key', roomKey)
      .order('created_at', { ascending: false }).limit(limit);
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).reverse().map((r) => ({
      id: r.id as string,
      role: r.role as 'user' | 'system',
      text: String(r.text ?? ''),
      refs: (r.refs as RoomTurn['refs']) ?? undefined,
      component: (r.component as RoomTurn['component']) ?? undefined,
      author: (r.author as RoomTurnAuthor | null) ?? undefined,
      createdAt: (r.created_at as string) ?? undefined,
    }));
  } catch { return []; }
}
