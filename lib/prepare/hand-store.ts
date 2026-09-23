// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EDIT DOOR — the ONE writer of the user's hand onto a prepared artifact (W9.1 — the law
// `the-users-hand-wins`, lib/prepare/hand.ts). Every card that lets the user change prepared words
// (the email card's item + compose lanes, the invite card, the forward card) saves through here,
// via PATCH /api/items/prepared. The stored artifact keeps its ONE home (THE ONE READER's storage
// map — source_data field or pool row); the save writes the user's content IN PLACE (precedence
// ruling 8: replace-in-place only as the user's own action) with the stamp beside it:
//
//   edited_by_user_at · hand_hash (the canonical content's fingerprint) · prepared_from = the ground
//   the user edited on (so a LATER inbound derives `staleUnderEdit` at THE ONE READER).
//
// A sent artifact refuses (done work is a record). An unchanged save is a no-op (a click is not an
// edit — the email card's own rule, restated at the door). Nothing here calls a model.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  canonicalOf, handStamp, isHandHeld, isPoolRowHandHeld, partitionStrip, handWordsOf, composeHandFiledLine, handFiledKey, handHash,
  type HandKind, type HandField, type HandFileWhy, type HeldArtifact,
} from '@/lib/prepare/hand';

export type HandEdit = {
  itemKind: 'inbox' | 'commitment';
  itemId: string;
  kind: HandKind;
  /** Text kinds: the user's words (plain text). */
  body?: string;
  /** Invite: the fields the card edits. */
  invite?: { title?: string; startISO?: string; endISO?: string; attendees?: string[]; description?: string; timezone?: string; proposed?: boolean };
  /** Forward: recipients + lead-in note. */
  forward?: { to?: string[]; note?: string };
  /** A pool artifact's row, when the card knows it (THE ONE READER's payload ref). */
  rowId?: string | null;
};

export type HandSaveResult =
  | { saved: true; editedAt: string; store: 'source_data' | 'pool'; created?: boolean }
  | { saved: false; reason: 'unchanged' | 'sent' | 'not_found' | 'invalid' | 'failed' };

const FIELD: Partial<Record<HandKind, 'draft' | 'nudge_draft' | 'prepared_invite' | 'prepared_forward'>> = {
  reply_draft: 'draft', nudge_draft: 'nudge_draft', invite: 'prepared_invite', forward: 'prepared_forward',
};

const BODY_MAX = 20_000;
const cleanList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 50);

/** The edit's payload in the artifact's own shape (what canonicalOf reads). */
export function editPayloadOf(e: HandEdit): Record<string, unknown> | null {
  if (e.kind === 'invite') {
    if (!e.invite) return null;
    const i = e.invite;
    return {
      title: String(i.title ?? '').slice(0, 300), startISO: String(i.startISO ?? ''), endISO: String(i.endISO ?? ''),
      attendees: cleanList(i.attendees), description: String(i.description ?? '').slice(0, BODY_MAX),
      ...(i.timezone ? { timezone: String(i.timezone).slice(0, 64) } : {}),
      ...(typeof i.proposed === 'boolean' ? { proposed: i.proposed } : {}),
    };
  }
  if (e.kind === 'forward') {
    if (!e.forward) return null;
    return { to: cleanList(e.forward.to), note: String(e.forward.note ?? '').slice(0, BODY_MAX) };
  }
  if (typeof e.body !== 'string' || !e.body.trim()) return null;
  return { body: e.body.slice(0, BODY_MAX) };
}

export async function saveUserEdit(client: SupabaseClient, userId: string, e: HandEdit): Promise<HandSaveResult> {
  const payload = editPayloadOf(e);
  if (!payload || !e.itemId) return { saved: false, reason: 'invalid' };
  const at = new Date().toISOString();
  try {
    const { groundOf } = await import('@/lib/prepare/ground');
    const ground = await groundOf(client, userId, { kind: e.itemKind, id: e.itemId });
    const field = e.itemKind === 'inbox' ? FIELD[e.kind] : undefined;

    // ── source_data artifacts (an inbox item's reply / nudge / invite / forward). ──
    if (field) {
      const { data: it, error } = await client.from('inbox_items').select('id, source_data')
        .eq('id', e.itemId).eq('user_id', userId).maybeSingle();
      if (error || !it) return { saved: false, reason: 'not_found' };
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const prior = (sd[field] ?? null) as Record<string, unknown> | null;
      if (prior?.sent_at) return { saved: false, reason: 'sent' };
      if (prior && canonicalOf(e.kind, prior) === canonicalOf(e.kind, payload) && !isHandHeld(e.kind, prior)) {
        return { saved: false, reason: 'unchanged' };
      }
      // `generated_at` is the supply seam's signal (reopenAfterSupply drops it): an edit made AFTER a
      // supply stands on that supply, so a missing stamp is re-set to the edit's own time.
      const next = { ...(prior ?? { prepared: 'user' }), ...payload, ...handStamp(e.kind, payload, at), prepared_from: ground, generated_at: (prior?.generated_at as string | undefined) ?? at };
      const { error: upErr } = await client.from('inbox_items')
        .update({ source_data: { ...sd, [field]: next } }).eq('id', it.id).eq('user_id', userId);
      if (upErr) return { saved: false, reason: 'failed' };
      return { saved: true, editedAt: at, store: 'source_data', ...(prior ? {} : { created: true }) };
    }

    // ── pool artifacts (a commitment's nudge / reply / invite, any paste pack or deliverable). ──
    const poolKind = e.itemKind === 'commitment' ? 'commitment' : 'email';
    type PoolRow = { id: string; content: unknown; metadata: unknown; type?: unknown };
    let row = null as PoolRow | null;
    if (e.rowId) {
      const { data } = await client.from('item_deliverables').select('id, content, metadata, type')
        .eq('id', e.rowId).eq('user_id', userId).eq('entity_id', e.itemId).maybeSingle();
      row = (data as PoolRow | null) ?? null;
    } else {
      // THE ONE READER names the artifact the card is showing — never a re-derived storage rule.
      const { preparedState } = await import('@/lib/prepare/read');
      const st = await preparedState(client, userId, { kind: e.itemKind === 'commitment' ? 'commitment' : 'inbox_item', id: e.itemId });
      const want = (k: string) => k === e.kind || (e.itemKind === 'commitment' && (e.kind === 'reply_draft' || e.kind === 'nudge_draft') && (k === 'reply_draft' || k === 'nudge_draft'));
      const art = st.all.find((a) => want(a.kind) && a.payload?.store === 'pool');
      const rid = art?.payload && 'rowId' in art.payload ? art.payload.rowId : null;
      if (rid) {
        const { data } = await client.from('item_deliverables').select('id, content, metadata, type')
          .eq('id', rid).eq('user_id', userId).maybeSingle();
        row = (data as PoolRow | null) ?? null;
      }
    }
    if (row) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      if (meta.sent_at) return { saved: false, reason: 'sent' };
      const storedPayload = e.kind === 'invite' ? (meta.invite ?? {}) : { content: row.content };
      if (canonicalOf(e.kind, storedPayload) === canonicalOf(e.kind, payload) && !isPoolRowHandHeld(e.kind, row)) {
        return { saved: false, reason: 'unchanged' };
      }
      const stamp = handStamp(e.kind, payload, at);
      const update = e.kind === 'invite'
        ? { metadata: { ...meta, invite: { ...((meta.invite ?? {}) as Record<string, unknown>), ...payload }, ...stamp, prepared_from: ground } }
        : { content: String(payload.body), metadata: { ...meta, ...stamp, prepared_from: ground } };
      const { error } = await client.from('item_deliverables').update(update).eq('id', row.id).eq('user_id', userId);
      if (error) return { saved: false, reason: 'failed' };
      return { saved: true, editedAt: at, store: 'pool' };
    }
    // A commitment message the card drafted on demand (nothing pooled yet): the user's words become
    // the item's message — ONE row, in the pool, stamped. Titled neutrally: a "Nudge — <name>" title
    // is an addressee claim (THE ADDRESSEE FLOOR reads it), and the user named no one here.
    if (e.itemKind === 'commitment' && (e.kind === 'reply_draft' || e.kind === 'nudge_draft')) {
      const { error } = await client.from('item_deliverables').insert({
        user_id: userId, kind: poolKind, entity_id: e.itemId, type: 'draft', title: 'Your message',
        content: String(payload.body), ref: null,
        metadata: { source: 'user_edit', ...handStamp(e.kind, payload, at), prepared_from: ground },
      });
      if (error) return { saved: false, reason: 'failed' };
      return { saved: true, editedAt: at, store: 'pool', created: true };
    }
    return { saved: false, reason: 'not_found' };
  } catch {
    return { saved: false, reason: 'failed' };
  }
}

/** Before a USER-ASKED fresh version replaces a hand-held source_data draft, the user's words are
 *  FILED into the version chain (`version_of` — the reader skips it; the ledger keeps it). */
export async function fileHandVersion(
  client: SupabaseClient, userId: string,
  args: { poolKind: 'email' | 'commitment'; itemId: string; kind: HandKind; content: string; editedAt?: string | null },
): Promise<void> {
  try {
    await client.from('item_deliverables').insert({
      user_id: userId, kind: args.poolKind, entity_id: args.itemId, type: 'draft',
      title: 'Your edit — kept version', content: args.content, ref: null,
      metadata: { version_of: args.kind, superseded: true, hand: true, ...(args.editedAt ? { edited_by_user_at: args.editedAt } : {}) },
    });
  } catch { /* the version is a record — never blocks the user's own fresh version */ }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CONSEQUENCE NEVER DELETES THE USER'S HAND (W9.1b — lib/prepare/hand.ts `partitionStrip`). The
// IO half: every ENGINE strip of a prepared artifact (the verdict's hygiene + resolution, the evidence
// settle, the conversation cascade, the mirror archive, the booked-meeting floor, the pool's re-run
// dedupe) goes through these two functions. Zero AI.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Narrate a filed hand-held artifact ONCE into the item's room, carrying the user's words. */
async function narrateHandFiled(
  client: SupabaseClient, userId: string,
  args: { itemKind: 'inbox' | 'commitment'; itemId: string; kind: HandKind; words: string; hash: string; why: HandFileWhy },
): Promise<void> {
  try {
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(client, userId, args.itemKind, args.itemId);
    await writeRoomTurn(client, userId, roomKey, {
      role: 'system', text: composeHandFiledLine(args.kind, args.why, args.words),
      refs: [{ label: 'Open the item', href: args.itemKind === 'commitment' ? `/item/${args.itemId}?kind=commitment` : `/item/${args.itemId}` }],
      dedupeKey: handFiledKey(args.itemId, args.kind, args.hash),
    });
  } catch { /* the filed version row is the record — narration is an enhancement */ }
}

/** FILE one hand-held source_data artifact: a version-chain row (the ledger) + the one narration.
 *  Returns false when the version row could not be written — the caller then KEEPS the artifact. */
async function fileHeldSourceArtifact(
  client: SupabaseClient, userId: string,
  args: { itemKind: 'inbox' | 'commitment'; itemId: string; held: HeldArtifact; why: HandFileWhy },
): Promise<boolean> {
  const { held } = args;
  const words = handWordsOf(held.kind, held.artifact);
  const hash = String(held.artifact.hand_hash ?? handHash(canonicalOf(held.kind, held.artifact)));
  try {
    const { error } = await client.from('item_deliverables').insert({
      user_id: userId, kind: args.itemKind === 'commitment' ? 'commitment' : 'email', entity_id: args.itemId, type: 'draft',
      title: 'Your edit — kept version', content: words, ref: null,
      metadata: {
        version_of: held.kind, superseded: true, hand: true, filed_because: args.why, field: held.field,
        edited_by_user_at: held.artifact.edited_by_user_at ?? null, hand_hash: hash,
        ...(held.kind === 'invite' || held.kind === 'forward' ? { artifact: held.artifact } : {}),
      },
    });
    if (error) return false;
  } catch { return false; }
  await narrateHandFiled(client, userId, { itemKind: args.itemKind, itemId: args.itemId, kind: held.kind, words, hash, why: args.why });
  return true;
}

/**
 * THE ONE ENGINE STRIP for an inbox item's source_data artifacts. Machine words strip; an artifact
 * the user's hand holds is FILED (version row + one narration with their words) before it leaves,
 * and a filing that fails puts it back (fail closed). Returns the next source_data — the caller
 * writes it in its OWN update (its status flip, its conditional claim) — plus what stripped / filed.
 */
export async function stripSourceArtifacts(
  client: SupabaseClient, userId: string,
  args: { itemId: string; sd: Record<string, unknown> | null | undefined; fields: HandField[]; why: HandFileWhy; itemKind?: 'inbox' | 'commitment' },
): Promise<{ sd: Record<string, unknown>; stripped: HandField[]; filed: HandField[]; kept: HandField[] }> {
  const part = partitionStrip(args.sd, args.fields);
  const filed: HandField[] = [];
  const kept: HandField[] = [];
  for (const h of part.held) {
    const ok = await fileHeldSourceArtifact(client, userId, { itemKind: args.itemKind ?? 'inbox', itemId: args.itemId, held: h, why: args.why });
    if (ok) filed.push(h.field);
    else { part.sd[h.field] = h.artifact; kept.push(h.field); }
  }
  return { sd: part.sd, stripped: part.stripped.filter((f) => !kept.includes(f)), filed, kept };
}

/**
 * FILE a hand-held POOL row instead of deleting it (the pool's re-run dedupe): the row stays, marked
 * `version_of` (the reader skips it; the ledger keeps it), and the room hears it once with the words.
 * Returns false when the mark could not be written — the caller must then NOT delete the row.
 */
export async function fileHeldPoolRow(
  client: SupabaseClient, userId: string,
  args: { itemKind: 'inbox' | 'commitment' | null; itemId: string; row: { id: string; content?: unknown; metadata?: unknown }; kind: HandKind; why: HandFileWhy },
): Promise<boolean> {
  const meta = (args.row.metadata ?? {}) as Record<string, unknown>;
  try {
    const { error } = await client.from('item_deliverables')
      .update({ metadata: { ...meta, version_of: args.kind, superseded: true, hand: true, filed_because: args.why } })
      .eq('id', args.row.id).eq('user_id', userId);
    if (error) return false;
  } catch { return false; }
  if (!args.itemKind) return true; // an entity-scoped row has no item room — the filed row is the record
  const payload = args.kind === 'invite' ? (meta.invite ?? {}) : { content: args.row.content };
  await narrateHandFiled(client, userId, {
    itemKind: args.itemKind, itemId: args.itemId, kind: args.kind, words: handWordsOf(args.kind, payload),
    hash: String(meta.hand_hash ?? ''), why: args.why,
  });
  return true;
}
