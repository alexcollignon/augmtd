// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SAME-CLIENT ECHO (owner walk, Sep 8 — the stale room)
//
// The server half of "the deed moves the brief" lives at the action seam (lib/entities/on-action.ts):
// a send re-authors the room's opening and appends its event line. This is the CLIENT half — the one
// word the surface that fired the deed says to the surfaces around it, so the room the reader is
// looking at re-reads AT ONCE instead of waiting for the poll or a remount.
//
// Why it is its own module and not four ad-hoc `dispatchEvent` lines: the invite card fired nothing
// at all (a sent invite was invisible to a mounted room), the email card fired `aug:prepared` — a
// PREPARATION finished, which is a different fact — and the reply lane narrated client-side only.
// One name, one meaning: A DEED WAS COMMITTED IN THIS SESSION.
//
// It is deliberately payload-free. A listener re-reads its own doors; nothing here carries state a
// surface could render, so this event can never become a second source of truth.
//
// THE NO-MUTATION LAW: a deed echo is "changes the reader's own action just caused" — the one
// arrival reason that may replace composed prose in place (lib/room/no-mutation.ts). A poll is NOT
// this; it stays `background` and freezes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The one event name. Listeners: the project room (re-read as `user`), the room's thread (re-read
 *  its turns so the appended deed line lands). */
export const DEED_EVENT = 'aug:deed';

/** Say it. SSR/permission-safe — an echo that throws must never break a send that already landed. */
export function announceDeed(): void {
  try { window.dispatchEvent(new CustomEvent(DEED_EVENT)); } catch { /* SSR / locked-down env */ }
}
