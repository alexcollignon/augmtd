'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE OBJECT CARD (docs/threads-plan.md — THE OPENING CONTRACT, clause 1, owner walk Sep 19)
// — and, since stabilization W15.1, THE ONE THREAD COMPONENT (owner walk, Sep 24).
//
// "Every SOURCE object has exactly one rendering, keyed by kind in the thread kit beside the
// deliverable cards. A surface never authors its own excerpt markup — it mounts the kit card or
// shows nothing."
//
// W15.1 · ONE THREAD COMPONENT. The walk found the card's door reading "Later in this
// conversation →" on one seat and "Thread →" on the next, and a card that ran LONG — every message
// in full, the quoted history under it, blank-line runs, "On Thu … wrote:" tails, signatures. The
// card is a GLANCE; the conversation is one click away. So, for EVERY host (an email thread, a
// commitment's own source message, a meeting source, an invite's mail, the triage evidence, a
// forward's folded object, a project room's opening), and by structure rather than per host:
//   · ONE LABEL — an email source's door reads OPEN_THREAD_LABEL ("Open thread"), whatever a host
//     passes; it opens the host's own thread door (`onOpen`).
//   · THE NEWEST MESSAGE, ITS OWN WORDS — `ownWords` (./source-text.ts: the house reply parser + the wrapped
//     attribution tail + signature block + blank-run collapse), through the render floor
//     (displayText — EXCERPT_MARK never renders). Plain text only: never HTML.
//   · OLDER MESSAGES FOLD to one-line rows (author · date · first line), under a "+N earlier"
//     row that opens the thread (no door → it is a plain count, never a lying button).
//   · A FIXED MAX HEIGHT (SOURCE_CARD_MAX_PX): the card never grows past it; the body clips under
//     a fade, the head and its door always stay in view, so a host's actions are never pushed off
//     screen. The loading skeleton (SourceObjectSkeleton) stands at exactly that height.
//   · THE QUOTE SLOT — one short highlighted line a host may pass, above the message.
//
// THREE LAWS IT CARRIES STRUCTURALLY:
//  1. IT INVENTS NOTHING. Every string is served or composed by the host: the kit reads no clock
//     (`when` is a rendered label), clips no text by length (the host's display clip did that — a
//     boundary + "…"; the prompt-side marker never renders, W11.3) and formats no size.
//  2. ONE TYPE SCALE (clause 5). One body size, one body colour, one muted meta tone.
//  3. NO LYING DOORS. The door renders only with a handler; a file chip without `onOpen` is a fact.
//
// W18.A · THE ONE EMAIL CARD (owner walk, Sep 25 — "shouldn't it have a more email thread like when
// showing the sender's email?"). An EMAIL source reads like a mail client's message header: the
// sender's name and address (muted), the date on the right, a compact "to" line, the subject — then
// the newest message in its own words with older ones folded above it. Same shell, border and radius
// as the reply card beneath it (white, one width — ./kit-width.ts), so the two read as ONE
// conversation. Every header fact is SERVED: no address / no recipients → no row.
//   · OPEN THREAD EXPANDS IN PLACE — never a navigation, on every host. "Open thread" (and "+N
//     earlier") unfold the whole conversation INSIDE the card: the max height lifts, the messages
//     render in the same plain-text own-words treatment (never HTML), older ones folded to a line
//     (a click opens one), scrolled to and marking the message the item came from. "Collapse"
//     folds it back. The read is the HOST's (its one reader, lib/inbox/thread-door.ts) — the kit
//     only asks (`thread.onExpand`) and prints what it is handed.
//
// PRESENTATIONAL, like everything else in this kit: it fetches nothing.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
// ONE CHIP GRAMMAR, ONE VIEWER (T25.9c) — the chip lives with the lightbox; the HOST raises it.
import { AttachmentChip } from '@/components/ui/attachment-lightbox';
import type { SourceCard, SourceThread } from './types';
// W11.3 · THE MARKER NEVER RENDERS — the prompt-side EXCERPT_MARK is floored to "…" here, the one
// render path every source excerpt passes through.
import { displayText } from '@/lib/utils/clip-for-prompt';
import {
  OPEN_THREAD_LABEL, COLLAPSE_THREAD_LABEL, SOURCE_CARD_MAX_PX, EXPANDED_THREAD_MAX_PX,
  ownWords, firstLine, collapseBlankRuns,
} from './source-text';
// W18.A · ONE WIDTH — the kit's one card token.
import { THREAD_CARD_W } from './kit-width';

export { OPEN_THREAD_LABEL, SOURCE_CARD_MAX_PX } from './source-text';

// W18.A · THE REPLY CARD'S SHELL — white, the same border and radius, so the email and the answer
// under it read as one conversation.
const SHELL = 'rounded-xl border border-neutral-200/80 bg-white';
const MAX_W = THREAD_CARD_W;

/** The one word above the card — what KIND of thing the reader is looking at, never a claim. */
const SOURCE_WORD: Record<SourceCard['source'], string> = {
  email: 'the message',
  meeting: 'the meeting',
  document: 'the document',
};

/** The door's words: an email source ALWAYS reads the one label; other kinds may name theirs. */
export function sourceDoorLabel(card: Pick<SourceCard, 'source' | 'openLabel'>): string {
  return card.source === 'email' ? OPEN_THREAD_LABEL : (card.openLabel ?? 'Open →');
}

/** THE LOADING STATE — the same frame at exactly the card's max height (no layout shift upward). */
export function SourceObjectSkeleton() {
  return (
    <div data-source-skeleton="" aria-busy="true" aria-label="Loading the message"
      className={cn(SHELL, MAX_W, 'flex flex-col gap-2.5 overflow-hidden px-3.5 py-3')}
      style={{ height: SOURCE_CARD_MAX_PX }}>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-32 animate-pulse rounded-full bg-neutral-200/80 motion-reduce:animate-none" />
        <span className="ml-auto h-2.5 w-16 animate-pulse rounded-full bg-neutral-200/60 motion-reduce:animate-none" />
      </div>
      <span className="h-3 w-3/5 animate-pulse rounded-full bg-neutral-200/80 motion-reduce:animate-none" />
      <span className="h-2.5 w-full animate-pulse rounded-full bg-neutral-200/60 motion-reduce:animate-none" />
      <span className="h-2.5 w-11/12 animate-pulse rounded-full bg-neutral-200/60 motion-reduce:animate-none" />
      <span className="h-2.5 w-4/5 animate-pulse rounded-full bg-neutral-200/60 motion-reduce:animate-none" />
    </div>
  );
}

const DOOR = 'aug-focus flex-shrink-0 text-[12px] font-medium text-indigo-600 transition-colors hover:text-indigo-700 motion-reduce:transition-none';

// ── W18.A · THE OPEN CONVERSATION ─────────────────────────────────────────────────────────────────
// Every message in its own words (plain text, the same floor as the glance), oldest→newest. Older
// ones fold to ONE line (author · date · first line) and open on a click; the message the item came
// from and the newest stand open. The list scrolls INSIDE its own bound, and it opens scrolled to the
// item's own message — the page never jumps.
function OpenConversation({ thread }: { thread: SourceThread }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const messages = (thread.messages ?? [])
    .map((m) => ({ ...m, own: ownWords(displayText(m.body) ?? '') }))
    .filter((m) => !!m.own);
  const newestId = messages.length ? messages[messages.length - 1].id : null;
  const highlight = thread.highlightId && messages.some((m) => m.id === thread.highlightId) ? thread.highlightId : null;
  const targetId = highlight ?? newestId;
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const isOpen = (id: string) => id === highlight || id === newestId || opened.has(id);
  const toggle = (id: string) => setOpened((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Scroll the LIST (never the page) to the item's own message once the conversation lands.
  const ready = thread.messages !== null;
  useEffect(() => {
    const list = listRef.current;
    const el = targetRef.current;
    if (!list || !el) return;
    list.scrollTop = Math.max(0, el.offsetTop - 8);
  }, [ready, targetId]);

  if (thread.messages === null) {
    return (
      <div data-source-thread-loading="" aria-busy="true" className="flex flex-col gap-2 py-1">
        <span className="h-2.5 w-2/3 animate-pulse rounded-full bg-neutral-200/70 motion-reduce:animate-none" />
        <span className="h-2.5 w-11/12 animate-pulse rounded-full bg-neutral-200/60 motion-reduce:animate-none" />
        <span className="h-2.5 w-4/5 animate-pulse rounded-full bg-neutral-200/60 motion-reduce:animate-none" />
      </div>
    );
  }
  if (!messages.length) {
    return <p className="text-[12px] text-neutral-400">The rest of the conversation couldn&rsquo;t be read just now.</p>;
  }

  return (
    <div ref={listRef} data-source-thread="" className="relative -mx-1 flex flex-col gap-1 overflow-y-auto px-1 [scrollbar-width:thin]"
      style={{ maxHeight: EXPANDED_THREAD_MAX_PX }}>
      {messages.map((m) => {
        const open = isOpen(m.id);
        const mine = m.id === highlight;
        return (
          <div key={m.id} data-thread-msg={m.id} ref={m.id === targetId ? targetRef : undefined}
            {...(mine ? { 'data-thread-source': '' } : {})}
            className={cn('rounded-lg px-2 py-1.5', mine && 'bg-indigo-50/50 ring-1 ring-inset ring-indigo-100')}>
            {open ? (
              <div className="flex flex-col gap-1">
                <button type="button" onClick={() => toggle(m.id)} disabled={m.id === highlight || m.id === newestId}
                  className="aug-focus flex min-w-0 items-baseline gap-1.5 text-left disabled:cursor-default">
                  <span className="flex-shrink-0 text-[12px] font-medium text-neutral-700">{m.author}</span>
                  {m.address && <span className="min-w-0 truncate text-[11px] text-neutral-400">{m.address}</span>}
                  {m.when && <span className="ml-auto flex-shrink-0 pl-2 text-[11px] text-neutral-400">{m.when}</span>}
                </button>
                <p className="whitespace-pre-line text-[13px] leading-[1.55] text-neutral-600">{m.own}</p>
              </div>
            ) : (
              <button type="button" onClick={() => toggle(m.id)} data-source-older=""
                className="aug-focus flex w-full min-w-0 items-baseline gap-1.5 text-left text-[12px] text-neutral-400 transition-colors hover:text-neutral-600 motion-reduce:transition-none">
                <span className="flex-shrink-0 font-medium text-neutral-500">{m.author}</span>
                {m.when && <span className="flex-shrink-0">· {m.when}</span>}
                <span className="min-w-0 truncate">· {firstLine(m.own)}</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SourceObjectCard({ card }: { card: SourceCard }) {
  const isEmail = card.source === 'email';
  // THE RENDER FLOOR FIRST (the marker never renders), THEN the message's own words. A meeting's
  // summary or a document's preview is not mail: it keeps its words and only loses blank runs.
  const own = isEmail ? ownWords : collapseBlankRuns;
  const messages = (card.messages ?? [])
    .map((m) => ({ ...m, own: own(displayText(m.body) ?? '') }))
    .filter((m) => !!m.own);
  const files = card.files ?? [];
  const excerpt = card.excerpt ? own(displayText(card.excerpt) ?? '') : '';

  // W18.A · THE DOOR. An email source's door is the in-place expansion, and only that (no `thread`
  // → no door: an email card never navigates). A meeting / document source keeps its host's door.
  const thread = isEmail ? card.thread ?? null : null;
  const [expanded, setExpanded] = useState(() => !!thread?.startOpen);
  const expand = () => { if (!thread) return; setExpanded(true); thread.onExpand?.(); };
  const toggle = () => { if (expanded) setExpanded(false); else expand(); };
  const door: (() => void) | null = isEmail ? (thread ? toggle : null) : (card.onOpen ?? null);

  // THE CLIP IS MEASURED, NOT GUESSED: the fade shows only when the body really overflows.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [card, expanded]);

  // TRUTH BEFORE PRESENTATION: with nothing to show, there is no card — never an empty frame with
  // a label on it (the "labelled empty space is worse than a shorter card" rule).
  if (!messages.length && !excerpt && !files.length && !card.title) return null;

  const newest = messages.length ? messages[messages.length - 1] : null;
  const older = messages.filter((m) => m !== newest);
  const earlier = Math.max(0, card.earlierCount ?? 0);
  const quote = card.quote ? displayText(card.quote).trim() : '';
  const doorLabel = isEmail ? (expanded ? COLLAPSE_THREAD_LABEL : OPEN_THREAD_LABEL) : sourceDoorLabel(card);
  const doorButton = door ? (
    <button type="button" onClick={door} data-source-door="" aria-expanded={isEmail ? expanded : undefined} className={DOOR}>
      {doorLabel}
    </button>
  ) : null;

  // ── THE HEAD ──────────────────────────────────────────────────────────────────────────────────
  // EMAIL: a mail client's message header — sender + address (muted), date at the right, the "to"
  // line, the subject with the door beside it. Every row only when its fact is served.
  // MEETING / DOCUMENT: the one byline (who · when) with the door, then the title.
  const address = (card.fromAddress ?? '').trim();
  const who = (card.who ?? '').trim();
  const showAddress = !!address && address.toLowerCase() !== who.toLowerCase();
  const head = isEmail ? (
    <div data-source-head="" className="flex flex-shrink-0 flex-col gap-0.5 border-b border-neutral-100 pb-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-[13px] font-medium text-neutral-900">{who || (showAddress ? address : SOURCE_WORD.email)}</span>
        {showAddress && who && <span data-source-address="" className="min-w-0 truncate text-[11.5px] text-neutral-400">{address}</span>}
        {card.when && <span data-source-when="" className="ml-auto flex-shrink-0 pl-2 text-[11px] text-neutral-400">{card.when}</span>}
      </div>
      {card.to && <div data-source-to="" className="truncate text-[11px] text-neutral-400">{card.to}</div>}
      {(card.title || doorButton) && (
        <div className="flex min-w-0 items-baseline gap-2 pt-0.5">
          <span className="min-w-0 flex-grow truncate text-[13px] font-medium leading-[1.45] text-neutral-800">{card.title ?? ''}</span>
          {doorButton}
        </div>
      )}
    </div>
  ) : (
    <>
      <div className="flex flex-shrink-0 items-baseline gap-2">
        <span className="min-w-0 flex-grow truncate text-[11px] text-neutral-400">
          {[card.who, card.when].filter(Boolean).join(' · ') || SOURCE_WORD[card.source]}
        </span>
        {doorButton}
      </div>
      {card.title && (
        <div className="flex-shrink-0 truncate text-[13px] font-medium leading-[1.45] text-neutral-900">{card.title}</div>
      )}
    </>
  );

  return (
    <div data-source-card="" data-source-expanded={expanded ? '' : undefined}
      className={cn(SHELL, MAX_W, 'flex flex-col gap-2 overflow-hidden px-3.5 py-3')}
      // W18.A · the max height lifts while the conversation is open (the list bounds itself).
      style={expanded ? undefined : { maxHeight: SOURCE_CARD_MAX_PX }}>
      {head}

      {expanded && thread ? (
        <div className="flex min-h-0 flex-col gap-1.5">
          {quote && (
            <p data-source-quote="" className="line-clamp-2 flex-shrink-0 border-l-2 border-indigo-200 pl-2 text-[12.5px] italic leading-[1.5] text-neutral-700">
              {quote}
            </p>
          )}
          <OpenConversation thread={thread} />
        </div>
      ) : (
        /* ── THE BODY — clipped at the card's max height, under a fade. ── */
        <div ref={bodyRef} className="relative flex min-h-0 flex-shrink flex-col gap-1.5 overflow-hidden">
          {quote && (
            <p data-source-quote="" className="line-clamp-2 flex-shrink-0 border-l-2 border-indigo-200 pl-2 text-[12.5px] italic leading-[1.5] text-neutral-700">
              {quote}
            </p>
          )}

          {/* OLDER MESSAGES FOLD — "+N earlier" (the part of the conversation not served here), then
              each served older message as ONE line: author · date · first line. W18.A: "+N earlier"
              opens the conversation in place, like the door (no thread → a plain count). */}
          {(earlier > 0 || older.length > 0) && (
            <div className="flex flex-shrink-0 flex-col gap-0.5">
              {earlier > 0 && (thread
                ? (
                  <button type="button" onClick={expand} data-source-earlier=""
                    className="aug-focus self-start text-[11px] font-medium text-neutral-400 transition-colors hover:text-indigo-600 motion-reduce:transition-none">
                    +{earlier} earlier
                  </button>
                ) : (
                  <span data-source-earlier="" className="text-[11px] text-neutral-400">+{earlier} earlier</span>
                ))}
              {older.map((m) => (
                <div key={m.id} data-source-older="" className="flex min-w-0 items-baseline gap-1.5 text-[12px] text-neutral-400">
                  <span className="flex-shrink-0 font-medium text-neutral-500">{m.author}</span>
                  {m.when && <span className="flex-shrink-0">· {m.when}</span>}
                  <span className="min-w-0 truncate">· {firstLine(m.own)}</span>
                </div>
              ))}
            </div>
          )}

          {/* THE NEWEST MESSAGE — its OWN words; the author line in the one muted meta tone. */}
          {newest && (
            <div data-source-newest="" className="flex min-h-0 flex-col gap-0.5">
              {(older.length > 0 || earlier > 0 || newest.author !== card.who) && (
                <span className="text-[11px] text-neutral-400">
                  {[newest.author, newest.when].filter(Boolean).join(' · ')}
                </span>
              )}
              <p className="whitespace-pre-line text-[13px] leading-[1.55] text-neutral-600">{displayText(newest.own)}</p>
            </div>
          )}

          {/* The single-excerpt lane (a meeting's summary, a source message's served own words). */}
          {!newest && excerpt && (
            <p className="whitespace-pre-line text-[13px] leading-[1.55] text-neutral-600">{displayText(excerpt)}</p>
          )}

          {clipped && (
            <div aria-hidden data-source-fade=""
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent" />
          )}
        </div>
      )}

      {/* ── WHAT CAME WITH IT — the shared chip, the host's viewer. ONE ROW, never clipped by the
          body and never wrapping into it: chips past the card's width hide (the drawer lists all). */}
      {files.length > 0 && (
        <div className="flex flex-shrink-0 gap-1.5 overflow-hidden pt-0.5">
          {files.map((f, i) => (
            f.onOpen
              ? <AttachmentChip key={`${f.name}:${i}`} name={f.name} size={f.size ?? null} onClick={f.onOpen} />
              : (
                <span key={`${f.name}:${i}`}
                  className="inline-flex max-w-[220px] flex-shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-[11.5px] text-neutral-500">
                  <span className="truncate">{f.name}</span>
                </span>
              )
          ))}
        </div>
      )}
    </div>
  );
}
