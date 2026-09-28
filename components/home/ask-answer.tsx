'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ANSWER RENDERER — ONE renderer for the seat's answer, on every chat surface
// (stabilization W19.B, Sep 28). Extracted verbatim from components/home/home-ask.tsx so the Home
// chat and the project/item room draw the SAME answer the SAME way: plain-prose paragraphs, the
// grounding tags resolved BY ID into inline source chips (lib/home/ask-refs.ts — THE REF IS ITS
// TAG), anything unresolvable stripped. Before W19 the room drew its answers in the narrator's grey
// event-line grammar with the refs as underlined ledger lines ("(handled) — "Bonjour…"") — a second
// renderer for one kind of speech, and the wrong one.
//
// W22.B: the answer is MARKDOWN now, through the one chat markdown renderer (safe by construction),
// with the chips inside its text runs; Copy/Retry ride a quiet row beneath (AnswerActions).
//
// Client-safe: React + the pure resolver + the pure markdown parser only.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { ArrowPathIcon, CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { askTagRe, bracketTags, indexByTag, resolveAskRefs } from '@/lib/home/ask-refs';
import { Markdown } from '@/components/thread/markdown-view';
import { markdownToPlain } from '@/components/thread/markdown';

/** Any served ref: `tag` is the grounding id the prose placed — THE identity a chip resolves by. */
export type AnswerRef = { label: string; href: string | null; tag?: string };

/**
 * A SOURCE CHIP SAYS WHAT THE SOURCE IS — never the ledger's bookkeeping about it. The room's
 * grounding labels a ref with its ledger line (`<title> (handled) — "<gist>" [attached: …]`, clipped),
 * so a chip used to read `(handled) — "Bonjour…"`. The chip keeps the head (the title); the status
 * suffix, the quoted gist and the attachment note are the line's annotations, not its name. A line
 * with no title falls back to its own gist. Pure; a label without those shapes passes through.
 */
export function refChipLabel(label: string): string {
  const raw = String(label ?? '').trim();
  if (!raw) return raw;
  const gistAt = raw.search(/\s+—\s+"/);
  const head = (gistAt >= 0 ? raw.slice(0, gistAt) : raw)
    .replace(/\s*\[attached:[^\]]*\]?\s*$/i, '')
    .replace(/\s*\((?:handled|dismissed)\b[^)]*\)?\s*$/i, '')
    .trim();
  if (head) return head;
  const gist = gistAt >= 0 ? raw.slice(gistAt).replace(/^\s+—\s+"/, '').replace(/"\s*(\[attached:.*)?$/i, '').trim() : '';
  return gist || raw;
}

/** The answer's words, ready for the clipboard: grounding tags become their chip's name, markdown
 *  becomes plain text (Copy). Pure. */
export function answerPlainText<R extends AnswerRef>(text: string, refs: R[]): string {
  const byTag = indexByTag(refs);
  const prose = resolveAskRefs(String(text ?? ''), (t) => byTag.get(t), { cap: byTag.size }).text;
  const named = prose.replace(askTagRe(), (_m, body: string) =>
    bracketTags(body).map((id) => byTag.get(id)).filter(Boolean).map((r) => refChipLabel((r as R).label)).join(', '));
  return markdownToPlain(named);
}

export function Answer<R extends AnswerRef>({ text, refs, onOpen, cursor }: { text: string; refs: R[]; onOpen: (r: R) => void; cursor?: boolean }) {
  // W22.B — THE ANSWER IS MARKDOWN, SAFELY. The renderer used to STRIP `**` and `#` (a plain-prose
  // guard from the grounded-answer era); a real chat answer carries headings, lists, tables and code.
  // It renders through THE ONE CHAT MARKDOWN RENDERER (components/thread/markdown-view.tsx — React
  // elements only, no HTML path, links allow-listed, images never loaded). The source chips live
  // INSIDE the markdown's text runs, so a chip keeps working in a bullet, a bold span or a table cell.
  //
  // ── THE REF IS ITS TAG (Sep 21 — the wrong-object-door incident; lib/home/ask-refs.ts) ──
  // A chip resolves by its ID or it does not render: a missing chip is a gap, a wrong chip is a lie
  // the user can click. THE SAFE DEGRADE for turns stored BEFORE the law (refs without tags): such a
  // turn indexes to nothing, its tags are stripped, and it renders with no inline chips.
  const byTag = indexByTag(refs);
  // ONE PASS removes every tag this turn cannot resolve (and tidies the space it leaves) through
  // the SAME resolver the server serves by — so notation can never reach the reader as raw text,
  // on a live answer or a rehydrated one. The cap is what this turn actually holds: the ceiling was
  // already enforced at the door, and re-capping here would silently drop a served ref.
  const prose = resolveAskRefs(text, (t) => byTag.get(t), { cap: byTag.size }).text;
  const renderText = (run: string, key: string): React.ReactNode => {
    const re = askTagRe();
    const parts: React.ReactNode[] = [];
    let last = 0, m: RegExpExecArray | null, prevWasRef = false, k = 0;
    while ((m = re.exec(run)) !== null) {
      if (m.index > last) { parts.push(run.slice(last, m.index)); prevWasRef = false; }
      for (const id of bracketTags(m[1])) {
        const r = byTag.get(id) ?? null;
        if (!r) continue;                     // unresolvable: the tag renders as nothing at all
        // FORMATTING GUARD: adjacent chips are SEPARATED with " · ".
        if (prevWasRef) parts.push(<span key={`${key}s${k++}`} className="text-neutral-300"> · </span>);
        parts.push(<button key={`${key}r${k++}`} type="button" onClick={() => onOpen(r)} className="inline font-medium text-indigo-700 hover:underline decoration-indigo-300 underline-offset-2">{refChipLabel(r.label)}</button>);
        prevWasRef = true;
      }
      last = m.index + m[0].length;
    }
    if (last === 0) return run;
    if (last < run.length) parts.push(run.slice(last));
    return <>{parts.map((p, i) => (typeof p === 'string' ? <React.Fragment key={`${key}t${i}`}>{p}</React.Fragment> : p))}</>;
  };
  // THE VOICE (design language): the team's answers are the team speaking.
  return <Markdown text={prose} renderText={renderText} cursor={cursor} />;
}

// ── THE ANSWER'S ACTIONS (W22.B) ─────────────────────────────────────────────────────────────────
// A quiet row under an answer: Copy (the answer as plain text) and Retry (the same question, through
// the same door). Hover-revealed on a pointer device, always visible on touch and to the keyboard.
// No thumbs, no share — the row is a convenience, not a feedback form.
export function AnswerActions({ text, refs, onRetry }: { text: string; refs: AnswerRef[]; onRetry?: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answerPlainText(text, refs));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard refused — nothing claimed */ }
  };
  const btn = 'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-300';
  return (
    <div data-answer-actions className="-ml-1.5 mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/answer:opacity-100 focus-within:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
      <button type="button" onClick={() => void copy()} className={btn} aria-label="Copy answer">
        {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {onRetry && (
        <button type="button" onClick={onRetry} className={btn} aria-label="Ask again">
          <ArrowPathIcon className="h-3.5 w-3.5" />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}
