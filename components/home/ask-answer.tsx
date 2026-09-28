'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ANSWER RENDERER — ONE renderer for the chief of staff's answer, on every chat surface
// (stabilization W19.B, Sep 28). Extracted verbatim from components/home/home-ask.tsx so the Home
// chat and the project/item room draw the SAME answer the SAME way: plain-prose paragraphs, the
// grounding tags resolved BY ID into inline source chips (lib/home/ask-refs.ts — THE REF IS ITS
// TAG), anything unresolvable stripped. Before W19 the room drew its answers in the narrator's grey
// event-line grammar with the refs as underlined ledger lines ("(handled) — "Bonjour…"") — a second
// renderer for one kind of speech, and the wrong one.
//
// Client-safe: React + the pure resolver only.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { askTagRe, bracketTags, indexByTag, resolveAskRefs } from '@/lib/home/ask-refs';

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

export function Answer<R extends AnswerRef>({ text, refs, onOpen }: { text: string; refs: R[]; onOpen: (r: R) => void }) {
  // FORMATTING GUARDS: the renderer is plain-prose — strip any markdown the model leaks, and
  // SEPARATE adjacent chips with " · ". Structure: blank lines split the answer into real spaced
  // paragraphs (never one massive block).
  const clean = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1').replace(/^#+\s*/gm, '');
  // ── THE REF IS ITS TAG (Sep 21 — the wrong-object-door incident; lib/home/ask-refs.ts) ──
  // This loop used to walk the served array with a cursor: chips resolved BY EMIT ORDER across the
  // whole answer. One grouped bracket ("[R1, R2]") consumed the first two served refs — two
  // clickable doors to work the sentence never named. A chip resolves by its ID or it does not render: a missing chip is a gap,
  // a wrong chip is a lie the user can click.
  //
  // THE SAFE DEGRADE for turns stored BEFORE the law (refs without tags): the positional fallback
  // IS the bug, so it is not kept quietly — such a turn indexes to nothing, its tags are stripped,
  // and it renders as clean prose with no inline chips. We deliberately do NOT reconstruct chips in
  // the "counts happen to match" case: a rule with an exception is the rule people trust wrongly.
  const byTag = indexByTag(refs);
  // ONE PASS removes every tag this turn cannot resolve (and tidies the space it leaves) through
  // the SAME resolver the server serves by — so notation can never reach the reader as raw text,
  // on a live answer or a rehydrated one. The cap is what this turn actually holds: the ceiling was
  // already enforced at the door, and re-capping here would silently drop a served ref.
  const prose = resolveAskRefs(clean, (t) => byTag.get(t), { cap: byTag.size }).text;
  const re = askTagRe();
  let k = 0;
  const renderPara = (para: string) => {
    const parts: React.ReactNode[] = [];
    let last = 0, m: RegExpExecArray | null, prevWasRef = false;
    re.lastIndex = 0;
    while ((m = re.exec(para)) !== null) {
      if (m.index > last) { parts.push(<span key={`t${k++}`}>{para.slice(last, m.index)}</span>); prevWasRef = false; }
      for (const id of bracketTags(m[1])) {
        const r = byTag.get(id) ?? null;
        if (!r) continue;                     // unresolvable: the tag renders as nothing at all
        if (prevWasRef) parts.push(<span key={`s${k++}`} className="text-neutral-300"> · </span>);
        parts.push(<button key={`r${k++}`} onClick={() => onOpen(r)} className="inline font-medium text-indigo-700 hover:underline decoration-indigo-300 underline-offset-2">{refChipLabel(r.label)}</button>);
        prevWasRef = true;
      }
      last = m.index + m[0].length;
    }
    if (last < para.length) parts.push(<span key={`t${k++}`}>{para.slice(last)}</span>);
    return parts;
  };
  const paras = prose.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return (
    <div className="space-y-2.5">
      {paras.map((para, i) => (
        // THE VOICE (design language): the team's answers are the team speaking — serif.
        <p key={i} className="text-[14px] text-neutral-700 leading-[1.65] whitespace-pre-line">{renderPara(para)}</p>
      ))}
    </div>
  );
}
