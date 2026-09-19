'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE OBJECT CARD (docs/threads-plan.md — THE OPENING CONTRACT, clause 1, owner walk Sep 19).
//
// "Every SOURCE object has exactly one rendering, keyed by kind in the thread kit beside the
// deliverable cards. A surface never authors its own excerpt markup — it mounts the kit card or
// shows nothing."
//
// What the walk found, three times in one evening: a decision card asking to approve a thing that
// was nowhere on the page (the retired "nothing is attached to review" line, on a decision whose
// object IS the inbound inquiry); a room opening with an ask and no reminder of what was asked.
// The reader "won't remember everything all the time" — so the thing being decided, asked about
// or briefed on renders WITH the ask, in one grammar, on every surface.
//
// THREE LAWS IT CARRIES STRUCTURALLY:
//  1. IT INVENTS NOTHING. Every string is served or composed by the host: the kit reads no clock
//     (`when` is a rendered label), clips no text (THE ONE CLIPPER did that, with its honest
//     excerpt marker) and formats no size (the shared chip does).
//  2. ONE TYPE SCALE (clause 5). One body size, one body colour, one muted meta tone — hierarchy
//     by SPACING and weight, never a per-paragraph colour change.
//  3. NO LYING DOORS. The door renders only with a handler; a file chip without `onOpen` is a fact
//     about the material rather than an affordance.
//
// PRESENTATIONAL, like everything else in this kit: it fetches nothing. The host reads the thread
// door ONCE through lib/inbox/thread-door.ts (the same read the triage deck warms) and mounts this.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { cn } from '@/lib/cn';
// ONE CHIP GRAMMAR, ONE VIEWER (T25.9c) — the chip lives with the lightbox; the HOST raises it.
import { AttachmentChip } from '@/components/ui/attachment-lightbox';
import type { SourceCard } from './types';

const SHELL = 'rounded-xl border border-neutral-200/80 bg-neutral-50/60';
const MAX_W = 'w-full max-w-[560px]';

/** The one word above the card — what KIND of thing the reader is looking at, never a claim. */
const SOURCE_WORD: Record<SourceCard['source'], string> = {
  email: 'the message',
  meeting: 'the meeting',
  document: 'the document',
};

export function SourceObjectCard({ card }: { card: SourceCard }) {
  const messages = card.messages ?? [];
  const files = card.files ?? [];
  // TRUTH BEFORE PRESENTATION: with nothing to show, there is no card — never an empty frame with
  // a label on it (the "labelled empty space is worse than a shorter card" rule).
  if (!messages.length && !card.excerpt && !files.length && !card.title) return null;

  const head = [card.who, card.when].filter(Boolean).join(' · ');

  return (
    <div className={cn(SHELL, MAX_W, 'flex flex-col gap-2 px-3.5 py-3')}>
      {/* ── WHO / WHEN / WHAT KIND — the facts, in one muted tone. ── */}
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-grow truncate text-[11px] text-neutral-400">
          {head || SOURCE_WORD[card.source]}
        </span>
        {card.onOpen && (
          <button type="button" onClick={card.onOpen}
            className="aug-focus flex-shrink-0 text-[12px] font-medium text-indigo-600 transition-colors hover:text-indigo-700">
            {card.openLabel ?? 'Open →'}
          </button>
        )}
      </div>

      {card.title && (
        <div className="text-[13px] font-medium leading-[1.45] text-neutral-900">{card.title}</div>
      )}

      {/* ── THE THING ITSELF ──
          The tail: each message's OWN words (the reply-chain stripped upstream), already clipped.
          Its author line is the same muted meta tone as the head — one scale, hierarchy by space. */}
      {messages.map((m) => (
        <div key={m.id} className="flex flex-col gap-0.5">
          <span className="text-[11px] text-neutral-400">{m.author}</span>
          <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-neutral-600">{m.body}</p>
        </div>
      ))}

      {/* The single-excerpt lane (a meeting's summary, a served first-words line). */}
      {!messages.length && card.excerpt && (
        <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-neutral-600">{card.excerpt}</p>
      )}

      {/* ── WHAT CAME WITH IT — the shared chip, the host's viewer. ── */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {files.map((f, i) => (
            f.onOpen
              ? <AttachmentChip key={`${f.name}:${i}`} name={f.name} size={f.size ?? null} onClick={f.onOpen} />
              : (
                <span key={`${f.name}:${i}`}
                  className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-[11.5px] text-neutral-500">
                  <span className="truncate">{f.name}</span>
                </span>
              )
          ))}
        </div>
      )}
    </div>
  );
}
