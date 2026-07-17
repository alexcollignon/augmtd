'use client';

// One tiny cross-surface signal so project changes (create / attach / detach / track) reflect INSTANTLY
// everywhere in the same session — no reload. The meetings sidebar, the Home, and project views all listen
// and refetch. BroadcastChannel is same-origin, cross-tab; guarded for SSR / unsupported browsers.
const CHANNEL = 'augmtd:projects-updated';

export function broadcastProjectsUpdated(detail?: { reason?: string }) {
  if (typeof window === 'undefined') return;
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage({ at: Date.now(), ...detail });
    bc.close();
  } catch { /* older browsers: no-op (surfaces still refresh on focus/poll) */ }
  // Also a same-document event so listeners in THIS tab react without a BroadcastChannel round-trip.
  try { window.dispatchEvent(new CustomEvent(CHANNEL, { detail })); } catch { /* no-op */ }
}

// Subscribe to project changes. Returns an unsubscribe fn. Fires for both cross-tab (BroadcastChannel) and
// same-tab (CustomEvent) updates.
export function onProjectsUpdated(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let bc: BroadcastChannel | null = null;
  try { bc = new BroadcastChannel(CHANNEL); bc.onmessage = () => cb(); } catch { /* no-op */ }
  const handler = () => cb();
  window.addEventListener(CHANNEL, handler);
  return () => { try { bc?.close(); } catch { /* no-op */ } window.removeEventListener(CHANNEL, handler); };
}
