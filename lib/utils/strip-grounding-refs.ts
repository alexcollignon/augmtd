// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEED-REF FLOOR (stabilization W3.4 · the ref-tag floor's second shape).
//
// The room grounding writes its live board as `[commit:<uuid>]` / `[inbox:<uuid>]` lines (the
// deed-building handle), and the ledger carries `meeting:` / `event:` / `deliv:` refs. The ref-tag
// floor (GROUNDING_TAG_RE) only knew the letter+digits notation ([L3], [F2]) — a model echoing a
// board handle leaked a raw uuid into a Home-ask answer. Grounding notation is OURS: every
// `[kind:<uuid>]` shape is stripped at the exit. A markdown link (`[label](href)`) is never
// notation and is never touched; neither is prose in brackets ("[CONFIRM: …]" has no uuid).
// ════════════════════════════════════════════════════════════════════════════════════════════════

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** `[kind:<uuid>]` — one or several comma-joined, never followed by `(` (a markdown link). */
export const DEED_REF_RE = new RegExp(
  `[ \\t]?\\[(?:[a-z_]{2,16}:${UUID})(?:\\s*,\\s*[a-z_]{2,16}:${UUID})*\\](?!\\()`,
  'gi',
);

/** Strip every `[kind:<uuid>]` grounding handle from model prose. Pure; idempotent. */
export function stripGroundingRefs(text: string): string {
  if (!text || !text.includes(':')) return text;
  return text.replace(DEED_REF_RE, ''); // the leading space rides the match — no reflow of prose
}
