'use client';

import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
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
  /** What already rides with the next send (file chips, "Extracting…") — inside the box, above the
   *  text. Presentational; the host owns the files (W4.1b — the inbox AI panel's file chips). */
  attachmentsSlot?: React.ReactNode;
  /** The host's handle on the textarea (focus after a stream / on open) — the legacy panels'
   *  existing refs keep working when they port onto the kit. */
  inputRef?: React.Ref<HTMLTextAreaElement>;
  autoFocus?: boolean;
  className?: string;
}

export function ThreadComposer({
  placeholder = 'Message the team — @ hands it to someone',
  value, onChange, onSend, disabled, chips, mentionSlot, attachSlot, trailingSlot, attachmentsSlot,
  inputRef, autoFocus, className,
}: ThreadComposerProps) {
  const [inner, setInner] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(inputRef, () => ref.current as HTMLTextAreaElement, []);
  const controlled = value !== undefined;
  const text = controlled ? value! : inner;
  // A CONTROLLED host clears its draft after a send — the grown box shrinks back with it (the
  // uncontrolled path resets in `send`; this is the same law for a host-held draft).
  useEffect(() => { if (text === '' && ref.current) ref.current.style.height = 'auto'; }, [text]);

  function set(v: string) {
    if (!controlled) setInner(v);
    onChange?.(v);
  }

  function send() {
    const t = text.trim();
    if (!t || disabled) return;
    onSend?.(t);
    if (!controlled) {
      setInner('');
      // The grown box shrinks back with the sent draft (an uncontrolled send left it tall).
      if (ref.current) ref.current.style.height = 'auto';
    }
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
        {attachmentsSlot}
        <textarea
          ref={ref}
          rows={1}
          autoFocus={autoFocus}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={placeholder || 'Message'}
          onChange={(e) => {
            set(e.target.value);
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
          }}
          onKeyDown={(e) => {
            // IME SAFETY: an Enter that CONFIRMS a composition (CJK input, dead keys) is not a send.
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          className="w-full resize-none bg-transparent text-[13px] leading-[1.55] text-neutral-800 outline-none placeholder:text-neutral-400 disabled:opacity-60"
        />
        <div className="flex items-center gap-3.5">
          {/* NO LYING DOORS (W4.1): an affordance renders only when the host mounted one — an
              unslotted "Mention"/"Attach" label looked like a door and did nothing. */}
          {mentionSlot}
          {attachSlot}
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
