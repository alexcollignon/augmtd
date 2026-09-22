// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MARKERS NEVER REACH THE BUBBLE (Sep 22, WAVE 0 — THE PRESENTATION LAW, third instance).
//
// Four card families travel as machine markers inside tool RESULTS, so the runtime can mount a real
// card without the model hand-encoding anything: `[[artifact:id|type|title]]`,
// `[[email_draft:<b64>]]`, `[[workflow_draft:<b64>]]`, `[[card:<b64>]]`. The parsers strip them out
// of the tool result — but a model that has SEEN one in its context will sometimes write one back
// in its own prose, and on the AgentOS bridge that prose was streamed and persisted untouched.
//
// ONE implementation, used by both coworker lanes: the bridge (streaming + persisted) and the
// native route (persisted). Markers are machinery; a person never reads them.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The four families, plus any future `[[name:payload]]` of the same shape — the net is the SHAPE,
 *  not a list of names, so a fifth family cannot leak while someone remembers to add it here. */
const MARKER_RE = /\[\[[a-z_]+:[^\]]*\]\]/gi;

/** How much unterminated tail the stream may hold before it is released as plain prose. */
const MAX_HOLD = 4000;

/** Remove every complete marker from text a person will read. Whitespace left behind is collapsed
 *  so a stripped marker does not leave a hole mid-sentence. */
export function stripChatMarkers(text: string): string {
  if (!text || !text.includes('[[')) return text;
  return text.replace(MARKER_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * STREAM-SAFE SPLIT — a marker arrives across SSE chunk boundaries, so stripping each delta alone
 * would let `[[artif` + `act:…]]` through in two halves. Everything up to a possible marker opening
 * is emitted (stripped); the tail that could still BECOME a marker is held for the next chunk.
 * Flush the final `hold` through `stripChatMarkers` when the stream ends.
 */
export function splitStreamableText(buffer: string): { emit: string; hold: string } {
  // The last unmatched "[[" — anything after it might still close into a marker.
  let open = -1;
  for (let i = buffer.length - 1; i >= 1; i--) {
    if (buffer[i] === '[' && buffer[i - 1] === '[') {
      const rest = buffer.slice(i - 1);
      if (!rest.includes(']]')) open = i - 1;
      break;
    }
  }
  // A lone trailing '[' could become '[[' on the next chunk — hold it too.
  if (open === -1 && buffer.endsWith('[')) open = buffer.length - 1;
  if (open === -1) return { emit: stripChatMarkers(buffer), hold: '' };
  // A "[[" the model never closes must not swallow the rest of the answer: past a marker's plausible
  // length the hold is released as ordinary prose (a partial marker is not worth a silent bubble).
  if (buffer.length - open > MAX_HOLD) return { emit: stripChatMarkers(buffer), hold: '' };
  return { emit: stripChatMarkers(buffer.slice(0, open)), hold: buffer.slice(open) };
}
