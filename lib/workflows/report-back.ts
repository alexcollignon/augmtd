// ─── Coworker report-back ─────────────────────────────────────────────────────
// After a task run, the coworker proactively messages the user — like a DM from a
// colleague who just finished something: what they did, where it went, the link,
// and (when useful) a proactive next step. AI-written in the worker's voice and
// grounded strictly in the run facts, so it carries nuance without inventing.

import type { OpenAI } from 'openai';
import { aiCreate } from '@/lib/ai/factory';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import type { OutputHome } from './types';

export interface ReportFacts {
  worker: { name: string; description?: string | null; instructions?: string | null };
  firstName?: string;
  taskName: string;
  home: OutputHome;
  channel?: string;          // slack #channel, or email recipients summary
  docTitle?: string;
  link?: string;             // in-app link to the deliverable (document home)
  alsoNote?: string;         // e.g. "and dropped a link in #marketing"
  nextRun?: string;          // e.g. "tomorrow at 9am"
  deliverableGist?: string;  // a slice of the output, for context/nuance
  problem?: string;          // delivery failure to flag plainly
  /** THE GATE'S RECEIPT (guardrails arc) — one factual, pre-built sentence about the delivery
   *  check ("corrected 2 figures…"). Deterministic upstream; the worker only places it. */
  gateNote?: string;
}

function didLine(f: ReportFacts): string {
  switch (f.home) {
    case 'document': return `created the document "${f.docTitle ?? f.taskName}"`;
    case 'slack':    return `posted it to ${f.channel ?? 'Slack'}`;
    case 'email':    return `emailed it${f.channel ? ` to ${f.channel}` : ''}`;
    default:         return `wrote you a message`;
  }
}

/** THE LINK IS A DOOR, NOT A STRING (pilot census): report-backs pasted the raw deliverable URL
 *  into prose and it rendered dead on most surfaces. Every composed report funnels through this
 *  sweep — a bare occurrence of the link becomes a markdown link (the DM surface renders
 *  MarkdownText); one already sitting inside [](…) is left alone, so the sweep is idempotent.
 *  Deterministic by design: a formatting instruction in the prompt coin-flips. */
export function linkifyReport(text: string, link?: string | null): string {
  if (!link || !text.includes(link)) return text;
  const esc = link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(?<!\\]\\()${esc}(?!\\))`, 'g'), `[Open it](${link})`);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HAND-BACK NEVER HANDS THE FIX BACK (Sep 21, found by the T2 replay). A reviewer's objection
// is written FOR THE SYSTEM ("…regenerate it complete; never hand over a truncated document") — it
// was being passed verbatim as the report's PROBLEM fact, under a prompt that says "lead with the
// problem and what would fix it", so the coworker dutifully asked the PRINCIPAL to regenerate the
// coworker's own work. Producing the deliverable is our job; the user is told honestly only after
// our own repair has failed, and never given a chore. Two deterministic halves, because a prompt
// rule alone coin-flips: the objection is stripped of its system-facing instruction before it is
// ever shown, and the composed report is swept for a regeneration ask.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The reader's half of a reviewer objection: what is wrong, never the instruction to the machine. */
export function readerFacingProblem(objection: string): string {
  const said = String(objection ?? '').trim();
  const cut = said.split(/\s+[—–-]\s+|;\s+/).filter(Boolean)[0] ?? said;
  return (cut.trim() || said).replace(/[.\s]+$/, '');
}

const REGENERATION_ASK =
  /\b(can|could|would|will)\s+you\s+(please\s+)?(re-?generate|re-?run|re-?do|re-?create|re-?send|re-?write|regenerate|generate|complete|finish|redo)\b|\bplease\s+(re-?generate|re-?run|re-?do|re-?create|re-?send|re-?write|regenerate)\b|\byou'?(ll| will)\s+need\s+to\s+(re-?generate|re-?run|re-?do|re-?create|re-?send)\b/i;

/** Drop any sentence that asks the reader to produce or re-produce the work themselves. With
 *  nothing left to say, say the honest thing — a hand-back with no ask in it at all. */
export function stripRegenerationAsk(text: string): string {
  const kept = String(text ?? '').split(/(?<=[.!?])\s+/).filter((s) => !REGENERATION_ASK.test(s));
  const out = kept.join(' ').replace(/\s+/g, ' ').trim();
  return out.length >= 20 ? out : "I couldn't get this one into a state worth handing over yet.";
}

/** Plain factual fallback if the model call fails — never block a run on the report. */
export function fallbackReport(f: ReportFacts): string {
  const who = f.firstName ? `${f.firstName}, ` : '';
  if (f.problem) return stripRegenerationAsk(`${who}I finished "${f.taskName}" but couldn't deliver it — ${f.problem}`);
  const where =
    f.home === 'document' ? `it's in your Documents${f.link ? ` (${f.link})` : ''}` :
    f.home === 'slack'    ? `posted to ${f.channel ?? 'Slack'}` :
    f.home === 'email'    ? `emailed${f.channel ? ` to ${f.channel}` : ''}` :
    `here it is`;
  return linkifyReport(`${who}done with "${f.taskName}" — ${where}.${f.gateNote ? ` ${f.gateNote}` : ''}${f.alsoNote ? ` ${f.alsoNote}.` : ''}`, f.link);
}

export async function generateReportBack(client: OpenAI, model: string, f: ReportFacts): Promise<string> {
  const persona = f.worker.instructions ? f.worker.instructions.split('\n').slice(0, 6).join('\n') : '';
  const prompt = `You are ${f.worker.name}. ${f.worker.description ?? ''}
${persona}

You just finished a task and you're sending ${f.firstName || 'the person you work with'} a quick message — like a DM from a colleague who just got something done.

FACTS (this is all you know — do not invent anything beyond it):
- Task: "${f.taskName}"
- What you did: ${didLine(f)}${f.link ? `\n- Link to it: ${f.link}` : ''}${f.alsoNote ? `\n- Also: ${f.alsoNote}` : ''}${f.gateNote ? `\n- Quality check: ${f.gateNote}` : ''}${f.nextRun ? `\n- Next run: ${f.nextRun}` : ''}${f.problem ? `\n- PROBLEM: ${readerFacingProblem(f.problem)}` : ''}${f.deliverableGist ? `\n- Gist of the output: ${clipForPrompt(f.deliverableGist, 500)}\n- ${EXCERPT_RULE}` : ''}

Write 1–3 short sentences, first person, warm and human — a colleague's DM, not a status report.
- Say what you did and where it is (include the link naturally if there is one).
${f.problem ? '- Lead with the problem, plainly, in your own words, and say what YOU will do about it.' : '- If a genuinely useful next step or question fits, offer it briefly. Don\'t force one.'}
- NEVER ask them to regenerate, re-run, redo or re-send the work — producing it is your job, not theirs. A question about a FACT only they hold is fine; a chore is not.
- Never say the work was cut off, truncated or is incomplete unless the PROBLEM above says so — the task name and the gist above are clipped by this system for length, which is never evidence about the work itself.
${f.gateNote ? '- Mention the quality check naturally, in ONE clause, using only what it says — never as a list and never as a claim of your own.' : ''}
${f.firstName ? `- You can address ${f.firstName} by name if it feels natural.` : ''}
- No "I noticed", no "I wanted to let you know", no corporate phrasing. Don't restate the whole output.`;

  try {
    const res = await aiCreate(client, {
      model,
      messages: [{ role: 'user', content: prompt }],
      // THE REPORT ENDS AT A BOUNDARY (proactive-reach W4, census fix 7). The stored reports on the
      // owner's account end mid-word — "…Next one runs Wednesday at 08:00. Let me " — two cuts, both
      // now closed: the pre-Aug-10 `summary: reportText.slice(0, 280)` writer (dead with the feed
      // that read it) and THIS budget, which a three-sentence DM on a current, more verbose model
      // can genuinely exhaust (finish_reason 'length' = a sentence the model never got to finish).
      // The budget is raised to a real ceiling AND a truncated completion is trimmed back to its
      // last finished sentence — a receipt never ends mid-thought.
      max_tokens: 400,
      temperature: 0.7,
    });
    const choice = res.choices[0];
    const text = choice?.message?.content?.trim();
    if (!text) return fallbackReport(f);
    return stripRegenerationAsk(linkifyReport(choice?.finish_reason === 'length' ? endAtBoundary(text) : text, f.link));
  } catch {
    return fallbackReport(f);
  }
}

/** Trim a completion the model never finished back to its last complete sentence; with no sentence
 *  end at all, cut at the last word break and MARK the cut (never mid-word, never a silent cut). */
export function endAtBoundary(text: string): string {
  const t = text.trim();
  const end = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
  if (end > t.length * 0.4) return t.slice(0, end + 1).trim();
  if (/[.!?]$/.test(t)) return t;
  const space = t.lastIndexOf(' ');
  return space > 0 ? `${t.slice(0, space).replace(/[\s,;:—-]+$/, '')}…` : t;
}
