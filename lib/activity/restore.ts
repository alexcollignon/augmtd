// Reversibility model (client-shared) — the SINGLE source of truth for which actions can be undone
// and how to restore them. Used by both the Home "Undo" toast and the Activity-log Undo affordance.
//
// STRICT model: only status-flip actions are reversible (the item reappears on the Home). SENDS are
// NOT reversible — the email is already out — so reply_sent / nudge_sent get no undo anywhere.

// Activity-event types that can be undone → the entity type the restore endpoint expects.
export const REVERSIBLE_TYPE_ENTITY: Record<string, 'inbox_item' | 'commitment' | 'sender'> = {
  dismissed: 'inbox_item',
  marked_done: 'inbox_item',
  commitment_done: 'commitment',
  commitment_dismissed: 'commitment',
  sender_muted: 'sender',
};

export function isReversibleType(type: string): boolean {
  return type in REVERSIBLE_TYPE_ENTITY;
}

// Call the shared restore endpoint. Returns true on success. Non-fatal: swallows/returns false so a
// failed undo can show a small error without breaking anything.
export async function restoreEntity(
  entityType: 'inbox_item' | 'commitment' | 'sender',
  entityId: string,
): Promise<boolean> {
  try {
    const res = await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType, entityId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Restore by a raw entityType string (used by the Activity log, where the row carries an arbitrary
// entity_type). Supports sender un-mute too. Returns true on success.
export async function restoreByType(entityType: string, entityId: string): Promise<boolean> {
  try {
    const res = await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType, entityId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
