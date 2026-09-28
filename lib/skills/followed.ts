// ════════════════════════════════════════════════════════════════════════════════════════════════
// W21 — THE FOLLOWED FLOOR (A CLAIM RENDERS, applied to skills).
//
// An answer may say which skills it followed — and that claim renders ("Followed: Board summary"), so
// it must be true. Two conditions, both required:
//   (1) the skill's instructions were IN THE PROMPT for this answer (the resolver's `offered` list —
//       what lib/work/worker-skills-context.ts renderSkillsBlock actually rendered);
//   (2) the model REPORTED applying it, through one trailing machine marker this module owns:
//         [[skills_applied:Name A|Name B]]
// The marker is stripped from every surface before a person reads it (it shares the house marker
// shape, so lib/work/chat-markers.ts would strip a stray one anyway), and the reported names are
// FLOORED to the offered set — a name the model invents, or a skill that was not loaded, is never
// claimed. Under-claiming is allowed; over-claiming is structurally impossible.
//
// Pure + client-safe (the stream filter reuses the house stream-safe splitter).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { splitStreamableText, stripChatMarkers } from '@/lib/work/chat-markers';
import type { SkillFollowed } from './chat-contract';

/** The marker's family name (the house `[[name:payload]]` shape). */
export const SKILLS_MARKER_NAME = 'skills_applied';

const MARKER_RE = /\[\[skills_applied:([^\]]*)\]\]/gi;

/** The prompt contract appended to a skills block whose answer may report. */
export const SKILLS_REPORT_RULE =
  `SKILLS REPORT: if you followed one or more of the skills above in this answer, end your answer with ` +
  `ONE final line, exactly: [[${SKILLS_MARKER_NAME}:<skill name>|<skill name>]] — the names exactly as ` +
  `written after "##" above, only the ones you actually applied. If you followed none, write no such ` +
  `line. The line is machinery: it is removed before the user reads your answer, so never mention it.`;

/** Parse and strip the marker(s). Returns the clean text and every reported name (deduped, trimmed). */
export function parseSkillsMarker(text: string | null | undefined): { text: string; names: string[] } {
  const t = String(text ?? '');
  if (!t.includes('[[')) return { text: t, names: [] };
  const names: string[] = [];
  for (const m of t.matchAll(MARKER_RE)) {
    for (const n of m[1].split('|')) { const v = n.trim(); if (v) names.push(v); }
  }
  if (!names.length && !/\[\[skills_applied:[^\]]*\]\]/i.test(t)) return { text: t, names: [] };
  const clean = t.replace(MARKER_RE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return { text: clean, names: [...new Set(names)] };
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** THE FLOOR: reported names ∩ offered skills, in offered order. Never a skill that was not loaded. */
export function floorFollowed(reported: string[], offered: SkillFollowed[]): SkillFollowed[] {
  if (!reported.length || !offered.length) return [];
  const want = new Set(reported.map(key));
  const out: SkillFollowed[] = [];
  const seen = new Set<string>();
  for (const s of offered) {
    if (!want.has(key(s.name)) || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, name: s.name });
  }
  return out;
}

/** One call for an answer door: strip the marker, floor the report. */
export function settleSkillsFollowed(
  text: string | null | undefined, offered: SkillFollowed[],
): { text: string; followed: SkillFollowed[] } {
  const { text: clean, names } = parseSkillsMarker(text);
  return { text: clean, followed: floorFollowed(names, offered) };
}

/** A token stream that never shows the marker: text is released up to any possible marker opening,
 *  the tail that could still become a marker is held, a completed marker is dropped. `flush()` at the
 *  end releases whatever tail remained (stripped). Control tokens (the NUL reset) pass straight through. */
export function createSkillsMarkerFilter(emit: (t: string) => void): { push: (t: string) => void; flush: () => void; reset: () => void } {
  let buf = '';
  return {
    push(t: string) {
      if (t === '\u0000') { buf = ''; emit(t); return; }
      buf += t;
      const { emit: out, hold } = splitStreamableText(buf);
      buf = hold;
      if (out) emit(out);
    },
    flush() {
      if (buf) { const out = stripChatMarkers(buf); buf = ''; if (out) emit(out); }
    },
    /** Drop the held tail without emitting it (the surface cleared its preview). */
    reset() { buf = ''; },
  };
}
