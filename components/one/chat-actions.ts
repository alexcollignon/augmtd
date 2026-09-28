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

// ── SKILLS IN CHAT (W21) — the chat's three skill verbs, on the same terms as the verbs above ──────
/** Every Skills surface (the composer menu, the header's "uses" line) re-reads on this echo. */
export const SKILLS_CHANGED_EVENT = 'aug:skills-changed';
export const skillsChanged = () => {
  try { window.dispatchEvent(new CustomEvent(SKILLS_CHANGED_EVENT)); } catch { /* SSR */ }
};

/** THE ONE IN-CHAT ASSIGNMENT CHANGE — "Always use for <Name>" / "Remove from <Name>" on a Skills
 *  menu row. Speaks its consequence with an Undo that flips it back through the same door. */
export async function setSkillAssignment(
  skill: { id: string; name: string }, agent: { id: string; name: string }, assigned: boolean,
): Promise<boolean> {
  const first = agent.name.split(' ')[0] || agent.name;
  const flip = async (to: boolean) => {
    const r = await post(`/api/skills/${encodeURIComponent(skill.id)}/assign`, { agent_id: agent.id, assigned: to });
    if (!r.ok) throw new Error();
    skillsChanged();
  };
  try {
    await flip(assigned);
    toast(assigned ? `${first} now always uses ${skill.name}` : `${skill.name} removed from ${first}`, {
      action: {
        label: 'Undo',
        onClick: () => { void flip(!assigned).catch(() => toast.error("Couldn't undo that — change it in Settings → Team.")); },
      },
    });
    return true;
  } catch { toast.error("That didn't go through — try again."); return false; }
}

/** SAVE AS SKILL — the server drafts a skill from the conversation; NOTHING is saved here (the editor
 *  opens prefilled, and only its own Save writes). Resolves the draft, or null (and says so). */
export async function draftSkillFromConversation(roomKey: string): Promise<{ name: string; whenToUse: string; instructions: string } | null> {
  try {
    const res = await post('/api/skills/from-conversation', { roomKey });
    const d = (await res.json().catch(() => ({}))) as { draft?: { name?: string; whenToUse?: string; instructions?: string } };
    if (!res.ok || !d.draft) throw new Error();
    return { name: String(d.draft.name ?? ''), whenToUse: String(d.draft.whenToUse ?? ''), instructions: String(d.draft.instructions ?? '') };
  } catch { toast.error("Couldn't draft a skill from this conversation — try again."); return null; }
}

/** "Not now" on a skill offer — the pattern is not offered again. Quiet: no toast on success. */
export async function declineSkillOffer(patternKey: string): Promise<boolean> {
  try { const r = await post('/api/skills/offer-decline', { patternKey }); return r.ok; } catch { return false; }
}
