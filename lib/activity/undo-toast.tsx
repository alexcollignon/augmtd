'use client';

import { toast } from 'sonner';
import { restoreEntity } from './restore';

// Transient "…· Undo" toast shown after a REVERSIBLE Home action (Done / Dismiss on must-respond &
// priority cards, commitment done/dismiss, mute-sender). Reuses the app's existing sonner Toaster
// (mounted in app/layout.tsx). Auto-dismisses (~5s). Its Undo calls the shared restore endpoint and,
// on success, invokes onUndo() so the caller can clear its session state (dismissed / clearedIds) →
// the item reappears immediately, not just on the next poll.
//
// SENDS never call this — a sent email is not reversible.
export function showUndoToast(opts: {
  message: string;                                    // e.g. "Dismissed", "Marked done"
  entityType: 'inbox_item' | 'commitment' | 'sender';
  entityId: string;
  onUndo: () => void;                                 // clear session state so the item re-renders
}) {
  const { message, entityType, entityId, onUndo } = opts;
  toast(message, {
    duration: 5000,
    action: {
      label: 'Undo',
      onClick: async () => {
        const ok = await restoreEntity(entityType, entityId);
        if (ok) {
          onUndo();
          toast.success('Restored');
        } else {
          toast.error("Couldn't undo");
        }
      },
    },
  });
}
