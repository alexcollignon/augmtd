'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHAT VERBS — ONE IMPLEMENTATION (W19.C). Home's sidebar and a project's Details → Chats group
// delete the same Home chat and un-file the same binding; two copies of "delete with Undo" would
// drift (one would forget the Undo, the other the echo). Every verb here:
//   · speaks its consequence with a toast that carries the way back (speak-consequence law),
//   · echoes `aug:conversation-changed` so every list re-reads from server truth,
//   · resolves true only when the server said so.
// Client-safe: fetch + toast only — no server module is imported.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { toast } from 'sonner';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
export const conversationChanged = () => {
  try { window.dispatchEvent(new CustomEvent('aug:conversation-changed')); } catch { /* SSR */ }
};
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

/** DELETE a Home chat (`chat:<uuid>`) — its turns archive in one batch; Undo restores that batch. */
export async function deleteHomeChat(key: string, onChange?: () => void): Promise<boolean> {
  try {
    const res = await fetch(`/api/room/turns?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    conversationChanged(); onChange?.();
    toast('Conversation deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          void (async () => {
            try {
              const r = await post('/api/rooms/restore', { key });
              if (!r.ok) throw new Error();
              conversationChanged(); onChange?.();
            } catch { toast.error("Couldn't restore it — check All conversations."); }
          })();
        },
      },
    });
    return true;
  } catch { conversationChanged(); onChange?.(); return false; }
}

/** UN-FILE a Home chat from its project (the binding goes; the conversation stays). Undo re-files. */
export async function unfileHomeChat(key: string, entityId: string, onChange?: () => void): Promise<boolean> {
  try {
    const res = await post('/api/rooms/adopt', { roomKey: key, entityId: null });
    if (!res.ok) throw new Error();
    conversationChanged(); onChange?.();
    toast('Removed from the project — it stays in your chats', {
      action: {
        label: 'Undo',
        onClick: () => {
          void (async () => {
            try {
              const r = await post('/api/rooms/adopt', { roomKey: key, entityId });
              if (!r.ok) throw new Error();
              conversationChanged(); onChange?.();
            } catch { toast.error("Couldn't put it back — file it again from the chat."); }
          })();
        },
      },
    });
    return true;
  } catch { toast.error("That didn't go through — try again."); return false; }
}

/** DELETE one saved chat of a PROJECT room (its archived batch). Undo brings the batch back. */
export async function deleteProjectChat(roomKey: string, at: string, onChange?: () => void): Promise<boolean> {
  try {
    const res = await fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}&session=${encodeURIComponent(at)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    onChange?.();
    toast('Chat deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          void (async () => {
            try {
              const r = await post('/api/rooms/restore', { key: roomKey, session: at });
              if (!r.ok) throw new Error();
              onChange?.();
            } catch { toast.error("Couldn't restore that chat."); }
          })();
        },
      },
    });
    return true;
  } catch { toast.error("Couldn't delete that chat — try again."); onChange?.(); return false; }
}

/** MOVE one saved project chat OUT into a Home chat. Undo moves it back as the same saved session. */
export async function moveProjectChatOut(roomKey: string, at: string, onChange?: () => void): Promise<string | null> {
  try {
    const res = await post('/api/room/turns/move', { key: roomKey, session: at });
    const d = (await res.json().catch(() => ({}))) as { chatKey?: string };
    if (!res.ok || !d.chatKey) throw new Error();
    const chatKey = d.chatKey;
    conversationChanged(); onChange?.();
    toast('Moved out of the project — it is a Home chat now', {
      action: {
        label: 'Undo',
        onClick: () => {
          void (async () => {
            try {
              const r = await post('/api/room/turns/move', { key: roomKey, session: at, undo: chatKey });
              if (!r.ok) throw new Error();
              conversationChanged(); onChange?.();
            } catch { toast.error("Couldn't move it back."); }
          })();
        },
      },
    });
    return chatKey;
  } catch { toast.error("Couldn't move that chat — try again."); onChange?.(); return null; }
}
