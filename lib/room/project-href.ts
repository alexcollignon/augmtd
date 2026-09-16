// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ADDRESS LAW (Sep 5) — every project (entity) room owns a REAL address: /project/<id>.
//
// THE BUG, AS A CLASS: the project room used to be query-state over the Home
// (`/home?view=projects&entity=<id>`) — the portfolio lens read the param and swapped its body for
// the room. Worse, a plain row click opened the room with NO url change at all, so back/refresh/
// deep-link were dishonest: `/home?entity=…` painted the deck, and a room on screen reported an
// address that was not its own. Rendering a full room while the URL says something else is
// outlawed.
//
// ONE GRAMMAR, ONE PRODUCER: every door — deck rows, the portfolio grid, the rail's room title,
// the context strip, chat scope chips, sidebar recents, the brief's refs — builds its href HERE.
// Legacy `?entity=`/`?project=` addresses keep working: the Home page redirects them to this one
// (old links in emails/notifications must survive).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** THE ONE ADDRESS of a project (entity) room. */
export function projectHref(entityId: string): string {
  return `/project/${entityId}`;
}
