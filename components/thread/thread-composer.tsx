'use client';

import React, { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { ComposerChip } from './types';

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE COMPOSER — one grammar everywhere: text · @mention · attach · send
 * (docs/design/threads/Main.dc.html · HomeThread.dc.html · CoworkerDM.dc.html).
 *
 * PRESENTATIONAL SHELL ONLY. The mention picker, the attach flow, the streaming state and the
 * send itself all live in the HOST — they arrive here as slots and callbacks. That is why the
 * three surfaces can port onto one composer without any of them losing what it already had.
 *
 * CHIPS ARE UTTERANCES (the standing law): a chip click is literally a word — the host sends its
 * label through the same door the typed text takes.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

export interface ThreadComposerProps {
  placeholder?: string;
  /** Controlled text; omit for the uncontrolled form (the kit holds the draft). */
  value?: string;
  onChange?: (v: string) => void;
  onSend?: (text: string) => void;
  disabled?: boolean;
  /** Utterance chips above the box. */
  chips?: ComposerChip[];
  /** Affordance slots — the host mounts its OWN pickers here; the kit only reserves the seat. */
  mentionSlot?: React.ReactNode;
  attachSlot?: React.ReactNode;
  /** Anything the host wants between the affordances and Send (a project chip, a model note). */
  trailingSlot?: React.ReactNode;
  className?: string;
}

function MentionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 8v1.2a1.8 1.8 0 0 0 3.6 0V8a6.6 6.6 0 1 0-2.6 5.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="m13.2 7.4-5 5a3.2 3.2 0 0 1-4.6-4.6l5.6-5.6a2.2 2.2 0 0 1 3.2 3.2l-5.5 5.5a1.2 1.2 0 0 1-1.8-1.8l4.8-4.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function ThreadComposer({
  placeholder = 'Message the team — @ hands it to someone',
  value, onChange, onSend, disabled, chips, mentionSlot, attachSlot, trailingSlot, className,
}: ThreadComposerProps) {
  const [inner, setInner] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const controlled = value !== undefined;
  const text = controlled ? value! : inner;

  function set(v: string) {
    if (!controlled) setInner(v);
    onChange?.(v);
  }

  function send() {
    const t = text.trim();
    if (!t || disabled) return;
    onSend?.(t);
    if (!controlled) setInner('');
  }

  return (
    <div className={cn('flex w-full flex-col gap-2.5', className)}>
      {!!chips?.length && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={c.label} type="button" onClick={c.onClick} disabled={disabled}
              className="aug-focus rounded-full border border-neutral-200/80 bg-white px-3 py-1.5 text-[12px] text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50">
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2.5 rounded-2xl border border-neutral-200/80 bg-white px-4 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            set(e.target.value);
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          className="w-full resize-none bg-transparent text-[13px] leading-[1.55] text-neutral-800 outline-none placeholder:text-neutral-400 disabled:opacity-60"
        />
        <div className="flex items-center gap-3.5">
          {mentionSlot ?? (
            <span className="flex items-center gap-1.5 text-[12px] text-neutral-500"><MentionIcon />Mention</span>
          )}
          {attachSlot ?? (
            <span className="flex items-center gap-1.5 text-[12px] text-neutral-500"><AttachIcon />Attach</span>
          )}
          {trailingSlot}
          <span className="flex-grow" />
          <button type="button" onClick={send} disabled={disabled || !text.trim()} aria-label="Send"
            className="aug-focus flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-40">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2.5 8 13.5 2.8 10.8 13.5 7.8 9.4 2.5 8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
