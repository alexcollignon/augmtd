// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CHAT'S NAME (stabilization W23.A). The rooms listing serves each conversation's `label` — its
// custom title when one was set, else its first message clipped — and, by THE CONTRACT, may also
// carry the room's own `title` (the core names a chat once it knows what it is about). The title,
// when present, is the name; the first-message fallback stands only without one. ONE reading, for
// the sidebar's Chats list and All conversations alike. Pure, client-safe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The row's display name: its `title` when present (trimmed, clipped), else its served `label`. */
export function conversationName(row: { label: string; title?: unknown }): string {
  const t = typeof row.title === 'string' ? row.title.replace(/\s+/g, ' ').trim() : '';
  return t ? t.slice(0, 80) : row.label;
}

/** Every row of a listing, named — the one place a served listing becomes what the list shows. */
export function withConversationNames<R extends { label: string; title?: unknown }>(rows: R[]): R[] {
  return rows.map((r) => {
    const name = conversationName(r);
    return name === r.label ? r : { ...r, label: name };
  });
}
