'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE GATE'S SHARED PIECES (W3-A — docs/component-map.md §2a, Sep 22)
//
// ONE OBJECT, ONE RENDERING. A gate's parts — where the run stands, what is being asked, what is
// being decided, and what was decided — had been written THREE times: twice inside
// process-drawer.tsx (as private helpers its own comment admitted were "edited in lockstep"), and
// again by hand in the room rail and the commitment deep-dive, which could not import private
// helpers and so drew their own standing lines, their own clamped asks, their own preview blocks
// and their own chips.
//
// They live here now, and a THREAD-SHAPED surface never mounts them directly: it mounts the kit's
// `approval`/`input` cards through the two hosts (components/home/approval-card.tsx ·
// input-card.tsx), which mount these. A NON-thread surface (the process drawer — a drawer is not a
// thread, §2's closing note) mounts them itself. Either way there is one implementation.
//
// PRESENTATIONAL, like the kit: nothing here fetches, routes or mutates. Every word comes from the
// ONE vocabulary (lib/workflows/process-state.ts) or from the caller.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { MarkdownText } from '@/components/work/chat-message';
import { GATE_OUTCOME_WORDS, GATE_WAITING_CHIP, type GateOutcome } from '@/lib/workflows/process-state';

/** The object a gate decides, as the run's own bytes — served, clipped and marked by the producer. */
export type GatePreview = { text: string; truncated: boolean };

// ── THE STANDING LINE — where the run stands, said ONCE, quietly, under the station title.
// It was a full-weight paragraph wedged between the ask and the object: the same visual weight as
// the instruction, and physically separating the two things a reviewer compares. It is context,
// not an instruction, so it wears context's type. ──
export function GateStandingLine({ done, total, mode, holder }: {
  done: number;
  total: number;
  mode: 'input' | 'mine' | 'other';
  holder?: string;
}) {
  return (
    <div className="mt-0.5 text-[11.5px] text-neutral-500">
      {`Ran ${done} of ${total} steps · `}
      {mode === 'input'
        ? 'stopped here — it needs this from you'
        : mode === 'mine'
          ? 'nothing is delivered until you say so'
          : `waiting on ${holder ?? 'a teammate'}`}
    </div>
  );
}

// ── THE ASK, CLAMPED — a long authored instruction pushed the object (the thing being decided)
// below the fold. Two lines, then the reader opens it by choice. `line-clamp-2` is CSS-only: no
// measurement, no layout pass, and the full text is always one click away — never truncated away. ──
export function GateAsk({ text, muted }: { text: string; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160;
  return (
    <div className={`mt-1 text-[12.5px] ${muted ? 'text-neutral-400' : 'text-neutral-600'}`}>
      <span className={open || !long ? '' : 'line-clamp-2'}>{text}</span>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-1 text-[11.5px] text-neutral-400 transition-colors hover:text-neutral-700"
        >
          {open ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

// THE OBJECT READS LIKE THE WORK IT IS (pilot walk, Sep 1). The parked output was rendered as raw
// text in a mono block — a reviewer facing a markdown report with ranked tables could not judge it,
// and an approval you cannot read is an approval you cannot give. Prose renders as prose through
// the SAME `MarkdownText` the chat surfaces use (one renderer, never a second opinion about what
// markdown means); JSON keeps the mono block, where the punctuation IS the meaning. The switch is
// STRUCTURAL, not a guess: previewFromOutput JSON-stringifies anything that is not a string, so a
// leading { or [ is the machine-shaped case by construction.
const looksLikeJson = (s: string) => /^[[{]/.test(s.trimStart());

// ── THE GATE CARRIES ITS OBJECT (owner walk, Aug 20) — a decision asked without showing what it
// decides is the whole find. A run we couldn't read renders nothing at all: the object is additive,
// and Approve never waits on it. ──
export function GateObject({ preview, label = 'What’s being approved' }: {
  preview: GatePreview | null;
  /** The deep-dive says "What you're approving"; the drawer says "What's being approved". ONE
   *  component, the caller's own word — the only difference the two ever actually had. */
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!preview) return null;
  const json = looksLikeJson(preview.text);
  // The collapsed height is a READING height, not a peek. "Show all" appears only when there is
  // plausibly more than fits — measuring the real overflow would cost a layout pass on every render
  // for an affordance that is harmless when it is unnecessary.
  const mayOverflow = preview.text.length > 1200;
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</div>
      <div
        className={`overflow-y-auto rounded-lg border border-neutral-200 bg-white px-3 py-2.5 ${expanded ? 'max-h-[70vh]' : 'max-h-[380px]'}`}
      >
        {json ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-neutral-700">{preview.text}</pre>
        ) : (
          // Tables are the reason this exists — they scroll INSIDE their own container (the shared
          // renderer already wraps each one in overflow-x-auto), so a wide table never pushes the
          // surface sideways.
          <div className="text-[13px] [&_table]:text-[12px]">
            <MarkdownText content={preview.text} />
          </div>
        )}
      </div>
      {mayOverflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11.5px] text-neutral-500 transition-colors hover:text-neutral-800"
        >
          {expanded ? 'Collapse ↑' : 'Show all ↓'}
        </button>
      )}
      {preview.truncated && (
        <div className="mt-1 text-[11px] text-neutral-400">— first 20,000 characters shown; the full output is in the run’s receipts.</div>
      )}
    </div>
  );
}

/** THE OUTCOME CHIP — the one quiet word standing where the verbs stood. Its words are the ONE
 *  vocabulary's; this component owns none of them. `null` ⇒ the gate is still live. */
export function GateOutcomeChip({ outcome }: { outcome: GateOutcome | null }) {
  if (!outcome) {
    return <span className="flex-shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-500">{GATE_WAITING_CHIP}</span>;
  }
  const done = outcome !== 'rejected';
  return (
    <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>
      {done ? '✓ ' : ''}{GATE_OUTCOME_WORDS[outcome].chip}
    </span>
  );
}

// THE ASK'S ROWS are NOT here: they are part of the kit's own input card (components/thread/
// ask-rows.tsx), because a thread-shaped surface must never mount a workflows component to render
// a conversation's ask. Non-thread surfaces import that leaf directly — one implementation, and
// the dependency points from workflows → thread, never back.
