// ════════════════════════════════════════════════════════════════════════════════════════════════
// W19.C · ONE SEAT IS LIT (owner walk, Sep 28 — Home stayed highlighted while a Home chat was open).
//
// The sidebar lit Home on "the /home lens is the dashboard" and lit a chat row on "the row I last
// clicked" — two unrelated facts, so both glowed at once, and a chat opened from anywhere but the
// sidebar lit neither correctly. THE ADDRESS DECIDES (every thread owns a URL — `/home?chat=<key>`,
// written by home-ask's ONE writer, writeChatAddress, which also announces it on
// `CHAT_ADDRESS_EVENT` because a history.replaceState is invisible to other components). From that
// one fact the seats are EXCLUSIVE by construction:
//   · a chat row is lit only while its key is the open address,
//   · Home is lit only on /home with NO chat open (dashboard/timeline lens) — or on an /item page.
// Pure and client-safe; the gate reads the same function the sidebar renders with.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const CHAT_ADDRESS_EVENT = 'aug:chat-address';

/** The open chat key an address names (`?chat=<key>`), or null. */
export function chatKeyFromSearch(search: string | null | undefined): string | null {
  try {
    const v = new URLSearchParams(search ?? '').get('chat');
    return v && v.trim() ? v : null;
  } catch { return null; }
}

export type NavFacts = { pathname: string; lens: string | null; openChatKey: string | null };

export function navActive(f: NavFacts): { home: boolean; chat: (key: string) => boolean; lens: (...vs: string[]) => boolean } {
  const onHome = f.pathname === '/home';
  const chatOpen = onHome && !!f.openChatKey;
  const lens = (...vs: string[]) => onHome && vs.includes(f.lens ?? 'dashboard');
  return {
    home: (lens('dashboard', 'timeline') && !chatOpen) || f.pathname.startsWith('/item'),
    chat: (key: string) => chatOpen && f.openChatKey === key,
    lens,
  };
}
