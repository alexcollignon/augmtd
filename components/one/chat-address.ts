// ════════════════════════════════════════════════════════════════════════════════════════════════
// W19.2b · EVERY CROSS-PAGE CHAT DOOR IS AN ADDRESS (THE ADDRESS LAW — owner walk, Sep 28).
//
// The find: clicking a coworker in the sidebar's "Your team" popover from any page other than /home
// landed on an EMPTY Home. The click fired an `aug:dm-worker` event (nobody listens off /home — the
// Home chat panel is not mounted yet) and left a payload-less one-shot flag; the landing then
// restored the LAST chat from localStorage, never the coworker. An intent carried by an event alone
// dies at the navigation.
//
// THE RULE: a door that crosses pages navigates to an ADDRESS that says what opens —
//   · a conversation:  /home?chat=<key>                     (`chat:<uuid>` · `worker:<tid>:<agent>`)
//   · a coworker DM:   /home?chat=worker:<tid>:<agentId>    when the thread is known, else
//                      /home?dm=<agentId>                    — Home resolves it to the thread and
//                                                             rewrites the address to ?chat=worker:…
// A same-page click may still use the event (the panel is mounted); the address is what survives a
// navigation, a refresh and a shared link.
//
// Pure + client-safe (no server imports).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The coworker→thread mapping Home caches (one spelling for both readers). */
export const dmThreadLsKey = (agentId: string): string => `aug-dm2-${agentId}`;

/** The address of a conversation. */
export function chatHref(key: string): string {
  return `/home?chat=${encodeURIComponent(key)}`;
}

/** The address of a coworker DM — the thread's own address when known, else the resolvable one. */
export function dmHref(agentId: string, threadId?: string | null): string {
  return threadId ? chatHref(`worker:${threadId}:${agentId}`) : `/home?dm=${encodeURIComponent(agentId)}`;
}

/** The DM landing's reading of an address: the agent a `?dm=` asks for (null otherwise). */
export function dmParamOf(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get('dm');
    return v && /^[\w-]{1,80}$/.test(v) ? v : null;
  } catch { return null; }
}
