'use client';

// ── THE ASK'S ROWS (W3-A — docs/component-map.md §2a, Sep 22) ──────────────────────────────────
// The concrete things the work is missing, as the room has always shown them: quiet dotted rows,
// never a form. ONE implementation, in the kit, because the ask is a conversation object — the
// kit's `input` card mounts it, and the two non-thread surfaces that also list asks (the Home's
// "Needs your input" band) import this leaf rather than drawing rows of their own.
//
// The snake_case repair is the engine's own labels arriving from a tool contract; it is
// presentation, and it lives here so no ask surface can disagree about whether "signed_addendum"
// is a sentence.
//
// ── THE DOORS MOVED ONTO THE ROW (W4-B, Sep 22 — THE TYPE-IT DOOR) ────────────────────────────
// The ask's answers used to be three chips under the WHOLE card, which is a lie the moment an ask
// is missing two different KINDS of thing: "Attach" and "Type it" are not the same offer for "the
// signed addendum" and "the account reference". So a row may carry its own doors — Type it ·
// Attach · Point me to it — and ALL THREE ARE ALWAYS THERE (the owner's "keeping options open").
// Only their ORDER changes, by `lead` (lib/room/go-ahead.ts `askItemShape`). A door with no handler
// still does not render: no lying doors, the law the whole kit is built on.
//
// Presentational by construction, like everything in components/thread/: no fetch, no router, no
// knowledge of a route. The ONLY state is the text the reader is currently typing into a row —
// ephemeral, local, and handed straight back out through `onType`. It is a leaf on purpose: a
// client component may import it without dragging a graph.

import { useState } from 'react';
import { cn } from '@/lib/cn';

/** What a single missing row may offer. Every field optional — a surface hands over what it owns. */
export type AskRowDoors = {
  /** Which door LEADS. 'fact' → Type it first; 'document' → Attach first. Defaults to 'document'
   *  (the historical order), so a caller that knows nothing changes nothing. */
  lead?: 'fact' | 'document';
  /** The typed fact. The row is held while it is in flight; a strict `false` means the deed did
   *  NOT land, and THE FIELD KEEPS WHAT WAS TYPED (a failure must never destroy the reader's own
   *  words — the house rule the recording vault was written for, one surface over). */
  onType?: (text: string) => void | Promise<boolean | void>;
  onAttach?: () => void;
  onPointToIt?: () => void;
  /** Already answered: the row wears its receipt instead of its doors. */
  supplied?: string | null;
  /** Someone else's deed is in flight on this card — every row stands down. */
  busy?: boolean;
  /** This row's own honest failure line. Never a toast the thread cannot keep. */
  error?: string | null;
  /** THE SAID-IT OFFER — the reader has already typed this fact into the composer. The row OFFERS
   *  to use it; the click is the deed. Never consumed automatically (the ask-direction floor). */
  saidIt?: { label: string; text: string; onUse: () => void } | null;
};

const DOOR = 'aug-focus rounded text-[11.5px] font-medium transition-colors';
const LEAD_DOOR = cn(DOOR, 'text-indigo-600 hover:text-indigo-700');
const QUIET_DOOR = cn(DOOR, 'text-neutral-500 hover:text-neutral-800');

/** The engine's own labels sometimes arrive from a tool contract as snake_case. Presentation only. */
function spoken(m: string): string {
  return /^[a-z0-9_]+(\s|$)/.test(m) ? m.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : m;
}

/** A label spoken mid-sentence: only the first letter drops, so an acronym keeps its case. */
function inSentence(s: string): string { return s.charAt(0).toLowerCase() + s.slice(1); }

function Row({ label, doors }: { label: string; doors?: AskRowDoors | null }) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const d = doors ?? null;
  const busy = sending || !!d?.busy;

  const submit = async () => {
    const said = draft.trim();
    if (!said || !d?.onType || busy) return;
    setSending(true);
    let ok: boolean | void;
    try { ok = await d.onType(said); } finally { setSending(false); }
    if (ok === false) return; // it did not land — the field and its text stay exactly as they are
    setTyping(false);
    setDraft('');
  };

  const canType = !!d?.onType;
  const doorList = d && !d.supplied && (canType || d.onAttach || d.onPointToIt)
    ? (d.lead === 'fact'
      // A FACT LEADS WITH TYPING — the whole point: a reference or an IBAN is faster said than found.
      ? [
        canType ? { key: 'type', label: 'Type it', lead: true, run: () => setTyping(true) } : null,
        d.onAttach ? { key: 'attach', label: 'Attach', lead: false, run: d.onAttach } : null,
        d.onPointToIt ? { key: 'point', label: 'Point me to it', lead: false, run: d.onPointToIt } : null,
      ]
      // A DOCUMENT LEADS WITH ATTACH — but typing stays, because the reader may hold the one number
      // that document was ever wanted for.
      : [
        d.onAttach ? { key: 'attach', label: 'Attach', lead: true, run: d.onAttach } : null,
        canType ? { key: 'type', label: 'Type it', lead: false, run: () => setTyping(true) } : null,
        d.onPointToIt ? { key: 'point', label: 'Point me to it', lead: false, run: d.onPointToIt } : null,
      ]).filter(Boolean) as Array<{ key: string; label: string; lead: boolean; run: () => void }>
    : [];

  return (
    <div className="flex items-start gap-2">
      <span className="mt-[6px] flex-shrink-0 w-1 h-1 rounded-full bg-neutral-300" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[13px] leading-[1.5]', d?.supplied ? 'text-neutral-500' : 'text-neutral-800')}>
          {spoken(label)}
          {/* THE RECEIPT IS THE ROW: what was typed stays legible where the gap was. */}
          {d?.supplied && (
            <span className="text-neutral-500"> — <span className="text-neutral-700">{d.supplied}</span> <span className="text-emerald-600">✓</span> <span className="text-[11.5px] text-neutral-400">typed</span></span>
          )}
        </span>
        {typing && canType && (
          <span className="mt-1.5 block">
            <textarea
              autoFocus
              rows={1}
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a second line (an address has two); Escape is out.
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
                else if (e.key === 'Escape') { e.preventDefault(); setTyping(false); setDraft(''); }
              }}
              placeholder={`Type ${inSentence(spoken(label))} — Enter to send`}
              className="aug-focus w-full resize-none rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[13px] leading-[1.5] text-neutral-800 placeholder:text-neutral-400 focus:border-indigo-300 disabled:opacity-60"
            />
            <span className="mt-1 flex items-center gap-3">
              <button type="button" onClick={() => void submit()} disabled={busy || !draft.trim()} className={cn(LEAD_DOOR, 'disabled:opacity-40')}>
                {sending ? 'Sending…' : 'Send it →'}
              </button>
              <button type="button" onClick={() => { setTyping(false); setDraft(''); }} className={QUIET_DOOR}>Cancel</button>
            </span>
          </span>
        )}
        {/* THE SAID-IT OFFER, above the doors: they already typed it — this is the shortest path
            left, and it is still a click (our ask, their words, their click). */}
        {!typing && !d?.supplied && d?.saidIt && (
          <span className={cn('mt-1 flex flex-wrap items-baseline gap-2', busy && 'pointer-events-none opacity-60')}>
            <button type="button" onClick={d.saidIt.onUse} className={LEAD_DOOR}>{d.saidIt.label}</button>
            <span className="min-w-0 truncate text-[11.5px] text-neutral-400">“{d.saidIt.text.slice(0, 60)}”</span>
          </span>
        )}
        {!typing && doorList.length > 0 && (
          <span className={cn('mt-1 flex flex-wrap items-center gap-3', busy && 'pointer-events-none opacity-60')}>
            {doorList.map((x) => (
              <button key={x.key} type="button" onClick={x.run} className={x.lead ? LEAD_DOOR : QUIET_DOOR}>{x.label}</button>
            ))}
          </span>
        )}
        {d?.error && <span className="mt-1 block text-[12px] text-rose-600">{d.error}</span>}
      </span>
    </div>
  );
}

export function AskRows({ rows, doors }: {
  rows: string[];
  /** Index-aligned with `rows`. Absent ⇒ the rows are a plain list, exactly as they always were. */
  doors?: Array<AskRowDoors | null>;
}) {
  if (!rows.length) return null;
  return (
    <div className="space-y-1">
      {rows.map((m, j) => <Row key={`${j}:${m}`} label={m} doors={doors?.[j] ?? null} />)}
    </div>
  );
}

export default AskRows;
