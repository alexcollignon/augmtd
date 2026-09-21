'use client';

import React from 'react';
import { PaperClipIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/cn';
import ReplyEditor from '@/components/inbox/reply-editor';
// ONE CHIP GRAMMAR, ONE VIEWER (T25.9c) — the chip lives with the lightbox and is never redrawn
// per surface. The kit mounts the shared chip; the HOST owns the viewer it raises.
import { AttachmentChip } from '@/components/ui/attachment-lightbox';
// THE ONE OBJECT CARD — the source half of the grammar, in its own file (one component, one law).
import { SourceObjectCard } from './source-object-card';
import type { BulkCard, DocCard, EmailCard, InviteCard, ThreadCard, ThreadCardIcon, ThreadCardOption } from './types';

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MESSAGE GRAMMAR — every engine organ delivers as exactly ONE card, in a thread, from a face
 * (docs/threads-plan.md's card table · docs/design/threads/Cards.dc.html).
 *
 * PRESENTATIONAL ONLY. Every action is a callback prop: this file never fetches, never routes,
 * never commits. An action with no handler renders as plain text, never a lying door.
 * A card kind the kit does not own arrives as `custom` — the host mounts its own component whole.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

const SHELL = 'rounded-xl border border-neutral-200/80 bg-white';
const MAX_W = 'w-full max-w-[480px]';
// Custom cards carry HOSTS' existing rich components (email drafts at 560px, wide markdown
// tables) — clamping them to the built-ins' 480 shrank real content (the P2b port find).
const CUSTOM_MAX_W = 'w-full max-w-[560px]';

// ── the icon tile ───────────────────────────────────────────────────────────────────────────────
const ICON_PATHS: Record<ThreadCardIcon, React.ReactNode> = {
  mail: (
    <>
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="m2.5 5 5.5 4 5.5-4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </>
  ),
  document: (
    <>
      <path d="M9.5 1.8H4.4A1.4 1.4 0 0 0 3 3.2v9.6a1.4 1.4 0 0 0 1.4 1.4h7.2a1.4 1.4 0 0 0 1.4-1.4V5.3L9.5 1.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5.5 8.5h5M5.5 11h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  file: (
    <>
      <path d="M9.5 1.8H4.4A1.4 1.4 0 0 0 3 3.2v9.6a1.4 1.4 0 0 0 1.4 1.4h7.2a1.4 1.4 0 0 0 1.4-1.4V5.3L9.5 1.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.5 1.8v3.5H13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </>
  ),
  calendar: (
    <>
      <rect x="2.4" y="3.4" width="11.2" height="10.2" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.4 6.6h11.2M5.6 2.2v2.4M10.4 2.2v2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
};

function IconTile({ icon }: { icon: ThreadCardIcon }) {
  return (
    <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">{ICON_PATHS[icon]}</svg>
    </span>
  );
}

// ── the affordances ─────────────────────────────────────────────────────────────────────────────
/** "Open →" — the one quiet door out of a card. Text when there is nowhere to go. */
function OpenLink({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return <span className="flex-shrink-0 text-[13px] font-medium text-neutral-400">{label}</span>;
  return (
    <button type="button" onClick={onClick} className="aug-focus flex-shrink-0 rounded text-[13px] font-medium text-indigo-600 hover:text-indigo-700">
      {label}
    </button>
  );
}

function CardButton({ label, onClick, tone = 'primary' }: { label: string; onClick?: () => void; tone?: 'primary' | 'secondary' | 'quiet' }) {
  const cls =
    tone === 'primary' ? 'bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-1.5 rounded-lg' :
    tone === 'secondary' ? 'border border-neutral-200/80 text-neutral-600 hover:bg-neutral-50 px-3 py-1.5 rounded-lg' :
    'text-neutral-400 hover:text-neutral-600';
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={cn('aug-focus text-[12px] font-medium transition-colors disabled:cursor-default disabled:opacity-60', cls)}>
      {label}
    </button>
  );
}

/** A chip in the input station's answer row — Attach · Paste · Pick a file. */
function SupplyChip({ label, onClick, icon }: { label: string; onClick?: () => void; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className="aug-focus inline-flex items-center gap-1.5 rounded-lg border border-neutral-200/80 px-3 py-1.5 text-[12px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-default disabled:opacity-60">
      {icon}{label}
    </button>
  );
}

// ── THE IN-CARD SELECTOR ────────────────────────────────────────────────────────────────────────
// A contained list of full-width rows INSIDE the card (never loose pills beneath it): radio ·
// label · muted annotation, hairline separators, the open row last. A row with no handler is
// plain text — a selector that cannot select is a lying door.
function SelectorRow({ option, selected, onPick }: { option: ThreadCardOption; selected: boolean; onPick?: (id: string) => void }) {
  const body = (
    <>
      <span
        aria-hidden
        className={cn('h-[13px] w-[13px] flex-shrink-0 rounded-full border',
          selected ? 'border-[4.5px] border-indigo-600' : 'border-[1.5px] border-neutral-300')}
      />
      <span className={cn('flex-grow text-left text-[12.5px]', option.open && !selected ? 'text-neutral-400' : 'text-neutral-700')}>
        {option.label}
        {option.annotation && <span className="text-neutral-400"> — {option.annotation}</span>}
      </span>
    </>
  );
  const cls = 'flex w-full items-center gap-2.5 px-4 py-[9px] text-left border-t border-neutral-200/55 first:border-t-0';
  if (!onPick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={() => onPick(option.id)}
      className={cn('aug-focus transition-colors hover:bg-neutral-50', cls)}>
      {body}
    </button>
  );
}

/** The `· edit` affordance of the board — quiet, inline, never a button. */
function EditMark({ onClick }: { onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button type="button" onClick={onClick} className="aug-focus rounded text-[12px] text-neutral-400 hover:text-neutral-600">· edit</button>
  );
}

/** One attendee chip — initial circle + name, the room's own people (never an invented address). */
function AttendeeChip({ name, email }: { name: string; email?: string }) {
  return (
    <span title={email} className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200/80 py-[2px] pl-[3px] pr-2">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-400 text-[8px] font-semibold text-white">
        {(name || '?').trim().charAt(0).toUpperCase()}
      </span>
      <span className="text-[12px] text-neutral-700">{name}</span>
    </span>
  );
}

function InviteCardView({ card }: { card: InviteCard }) {
  const [editing, setEditing] = React.useState<'title' | 'description' | null>(null);
  const [buf, setBuf] = React.useState('');
  const commit = (field: 'title' | 'description') => { card.onEdit?.(field, buf); setEditing(null); };
  const openPicked = card.options.find((o) => o.id === card.selectedOptionId)?.open === true;
  const filled = card.state === 'ready';

  return (
    <div className={cn(SHELL, MAX_W, 'flex flex-col overflow-hidden')}>
      {/* THE FILLED INVITE — rendered ONLY from genuinely prepared data. `needs_time` renders no
          fields at all: a missing fact asks plainly, it never poses as an empty form. */}
      {filled && (
        <div className={cn('flex flex-col gap-2.5 px-4 py-3.5', workingClass(card.busy))}>
          <div className="flex items-center gap-2.5">
            {card.dateLabel && (
              <span className="flex h-[34px] w-[34px] flex-shrink-0 flex-col items-center justify-center rounded-lg bg-indigo-50">
                <span className="text-[8px] font-bold uppercase tracking-[0.05em] text-indigo-600">{card.dateLabel.month}</span>
                <span className="text-[14px] font-bold leading-none text-indigo-700">{card.dateLabel.day}</span>
              </span>
            )}
            <span className="flex min-w-0 flex-col gap-px">
              {editing === 'title' ? (
                <input
                  autoFocus value={buf} onChange={(e) => setBuf(e.target.value)}
                  onBlur={() => commit('title')}
                  onKeyDown={(e) => { if (e.key === 'Enter') commit('title'); if (e.key === 'Escape') setEditing(null); }}
                  className="w-full rounded border border-indigo-300 px-1.5 py-0.5 text-[13px] font-semibold text-neutral-900 focus:outline-none"
                />
              ) : (
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate text-[13px] font-semibold text-neutral-900">{card.title}</span>
                  <EditMark onClick={card.onEdit ? () => { setBuf(card.title ?? ''); setEditing('title'); } : undefined} />
                </span>
              )}
              {card.whenLabel && <span className="truncate text-[12px] text-neutral-500">{card.whenLabel}</span>}
            </span>
          </div>

          {(card.attendeesEditor || (card.attendees?.length ?? 0) > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[11px] text-neutral-400">With</span>
              {card.attendeesEditor ?? (
                <>
                  {card.attendees!.map((a) => <AttendeeChip key={a.email ?? a.name} name={a.name} email={a.email} />)}
                  <EditMark onClick={card.onEdit ? () => card.onEdit!('attendees') : undefined} />
                </>
              )}
            </div>
          )}

          {editing === 'description' ? (
            <textarea
              autoFocus value={buf} onChange={(e) => setBuf(e.target.value)} rows={2}
              onBlur={() => commit('description')}
              onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }}
              className="w-full resize-y rounded border border-indigo-300 px-2 py-1 text-[12px] leading-[1.5] text-neutral-600 focus:outline-none"
            />
          ) : (card.description || card.onEdit) ? (
            <div className="border-l-2 border-neutral-200/80 pl-2.5 text-[12px] leading-[1.5] text-neutral-500">
              {card.description || <span className="text-neutral-300">No agenda yet</span>}{' '}
              <EditMark onClick={card.onEdit ? () => { setBuf(card.description ?? ''); setEditing('description'); } : undefined} />
            </div>
          ) : null}
        </div>
      )}

      {/* THE IN-CARD SELECTOR — grounded slots only. */}
      {card.options.length > 0 && (
        <div role="radiogroup" className={cn('flex flex-col', filled && 'border-t border-neutral-200/70')}>
          {card.options.map((o) => (
            <SelectorRow key={o.id} option={o} selected={o.id === card.selectedOptionId} onPick={card.onPickOption} />
          ))}
          {openPicked && card.onPickTime && (
            <div className="border-t border-neutral-200/55 px-4 py-[9px]">
              <input
                type="datetime-local" value={card.pickedTimeValue ?? ''}
                onChange={(e) => card.onPickTime!(e.target.value)}
                className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12.5px] text-neutral-800 focus:border-indigo-300 focus:outline-none"
              />
            </div>
          )}
        </div>
      )}

      {card.error && <div className="border-t border-neutral-200/55 px-4 py-2 text-[12px] text-rose-600">{card.error}</div>}

      {/* THE COMMIT ROW — always the card's bottom edge; the receipt word sits at its right. */}
      {(card.onSend || card.receipt) && (
        <div className="flex items-center gap-2.5 border-t border-neutral-200/70 bg-neutral-50 px-4 py-2.5">
          {card.onSend && (
            <button type="button" onClick={card.onSend} disabled={card.sendDisabled || card.busy}
              className="aug-focus rounded-lg bg-indigo-600 px-3.5 py-[7px] text-[12.5px] font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-default disabled:opacity-60">
              {card.sendLabel ?? 'Send invite'}
            </button>
          )}
          <span className="flex-grow" />
          {card.receipt && <span className="text-[11px] font-medium text-indigo-600">{card.receipt}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * THE WORKING STATE (owner, Sep 9: "always show a smooth animation state so the user knows
 * something is happening"). ONE motion idiom for every regenerating card region — the DraftingPulse
 * grammar: the content itself breathes while the machine works, and the landing content replaces it
 * without a jump. `motion-safe:` keeps the promise to a reader who asked for less motion: they get
 * the honest dim, never a throb.
 */
const workingClass = (busy?: boolean) =>
  cn('transition-opacity duration-200', busy && 'motion-safe:animate-pulse opacity-60');

/** One recipient chip on the To/Cc row — the address itself, never a name the card invented. */
function RecipientChip({ address }: { address: string }) {
  return (
    <span className="rounded-full border border-neutral-200/80 px-[9px] py-[2px] text-[12px] text-neutral-700">{address}</span>
  );
}

/**
 * THE EMAIL CARD (docs/design/threads/EmailCard.dc.html) — the drafted message, in the thread.
 *
 *   the tab row      DIRECTION-VARIANTS (the reply-directions organ) + the `Thread →` door
 *   the draft        To/Cc chips · the subject, quiet at the right · the editable body
 *   the selector     grounded refinements + the open "…or tell me what to change" row
 *   the commit row   Send · the tone tweak · the receipt word — always the card's bottom edge
 *
 * TRUTH BEFORE PRESENTATION: `needs_recipient` carries NO Send — the recipient editor leads and the
 * card waits (the invite's `needs_time` law, one kind over). The raw email THREAD is never inlined:
 * it lives behind the door, which the host points at the room that already renders it.
 */
function EmailCardView({ card }: { card: EmailCard }) {
  const [editingBody, setEditingBody] = React.useState(false);
  const [editingSubject, setEditingSubject] = React.useState(false);
  const [buf, setBuf] = React.useState('');
  const [steer, setSteer] = React.useState('');
  const [attachOpen, setAttachOpen] = React.useState(false);
  const ready = card.state === 'ready';

  // ── THE TAB ROW SCROLLS; THE DOOR NEVER DOES (owner walk, Sep 14: "these are not scrollable
  // sideways" + "where is the option to open email thread?"). Four reasoned directions on a 560px
  // card overflow — and the door, seated INSIDE the same flex row, was the first thing pushed out of
  // sight. So the strip is its own horizontal scroll area (the wide-content-scrolls-in-its-own-
  // container law, the inbox top bar's idiom: no scrollbar chrome, momentum scroll), and the door
  // sits OUTSIDE it, pinned at the row's right edge — structurally unscrollable-away.
  // The fade masks are honest: they render only on the side that actually has more to see.
  const stripRef = React.useRef<HTMLDivElement>(null);
  const [edge, setEdge] = React.useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const measureStrip = React.useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const over = el.scrollWidth - el.clientWidth > 1;
    setEdge({
      left: over && el.scrollLeft > 1,
      right: over && el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
    });
  }, []);
  const variantCount = card.variants?.length ?? 0;
  React.useEffect(() => {
    measureStrip();
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureStrip);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureStrip, variantCount]);
  const stripMask = edge.left && edge.right
    ? '[mask-image:linear-gradient(90deg,transparent,#000_16px,#000_calc(100%-16px),transparent)]'
    : edge.left ? '[mask-image:linear-gradient(90deg,transparent,#000_16px)]'
    : edge.right ? '[mask-image:linear-gradient(90deg,#000_calc(100%-16px),transparent)]'
    : '';
  const openPicked = card.options?.find((o) => o.id === card.selectedOptionId)?.open === true;

  const submitSteer = () => {
    const t = steer.trim();
    if (!t || !card.onSteer) return;
    setSteer('');
    card.onSteer(t);
  };

  return (
    <div className={cn(SHELL, CUSTOM_MAX_W, 'flex flex-col overflow-hidden')}>
      {/* THE DIRECTION TABS — reasoned paths, never generic tones; the second generates on its
          first click. The row also carries the one door out of the card.
          NO DEAD CONTROLS (owner, Sep 9): editing the body never takes the tabs away — the user's
          own version joins the row as its leading tab and every other tab stays pickable. A tab
          renders as plain text ONLY where the host passes no handler at all (a sent card). */}
      {(variantCount > 0 || card.onOpenThread) && (
        <div className="flex items-center border-b border-neutral-200/70 px-4">
          <div
            ref={stripRef} onScroll={measureStrip}
            className={cn(
              'min-w-0 flex-1 flex items-center gap-4 overflow-x-auto overscroll-x-contain',
              '[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]',
              stripMask,
            )}
          >
            {(card.variants ?? []).map((v) => {
              const on = v.id === card.selectedVariantId;
              const cls = cn('whitespace-nowrap py-[9px] text-[12px] transition-colors',
                on ? 'border-b-2 border-indigo-600 font-semibold text-indigo-700'
                   : v.open ? 'text-neutral-400 hover:text-neutral-600' : 'text-neutral-500 hover:text-neutral-700');
              if (!card.onPickVariant) return <span key={v.id} className={cls}>{v.label}</span>;
              return (
                <button key={v.id} type="button" onClick={() => card.onPickVariant!(v.id)}
                  onMouseEnter={card.onWarmVariant ? () => card.onWarmVariant!(v.id) : undefined}
                  onFocus={card.onWarmVariant ? () => card.onWarmVariant!(v.id) : undefined}
                  className={cn('aug-focus', cls)} aria-pressed={on}>
                  {v.loading ? `${v.label}…` : v.label}
                </button>
              );
            })}
          </div>
          {/* PINNED, OUTSIDE THE SCROLL AREA — the door to the message being answered is always in
              view, however many directions the organ reasoned. */}
          {card.onOpenThread && (
            <button type="button" onClick={card.onOpenThread}
              className="aug-focus ml-3 flex-shrink-0 rounded py-[9px] text-[12px] font-medium text-indigo-600 hover:text-indigo-700">
              {card.threadLabel ?? 'Thread →'}
            </button>
          )}
        </div>
      )}

      {/* THE DRAFT */}
      <div className="flex flex-col gap-2 px-4 py-3">
        {/* THE FROM ROW — present only where the sender is a real question (the standalone lane).
            One mailbox states itself; several offer themselves. Same 11px address-row grammar as
            To, so the two read as one block rather than a settings strip bolted on top. */}
        {(card.from || (card.fromOptions?.length ?? 0) > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-neutral-400">From</span>
            {(card.fromOptions?.length ?? 0) > 1 && card.onPickFrom ? (
              <select
                value={card.selectedFromId ?? card.fromOptions![0].id}
                onChange={(ev) => card.onPickFrom!(ev.target.value)}
                aria-label="Send from"
                className="aug-focus max-w-full rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[12px] text-neutral-700"
              >
                {card.fromOptions!.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            ) : (
              <span className="truncate text-[12px] text-neutral-600">
                {card.from ?? card.fromOptions?.[0]?.label}
              </span>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-neutral-400">To</span>
          {card.recipientsEditor ?? (
            <>
              {card.to.map((a) => <RecipientChip key={a} address={a} />)}
              {card.to.length === 0 && <span className="text-[12px] text-neutral-300">nobody yet</span>}
              <EditMark onClick={card.onEditRecipients} />
            </>
          )}
          {/* THE COLLAPSED Cc · Bcc (the Gmail idiom) — quiet words beside To until one is asked
              for. A lane whose door cannot carry the field passes no handler, and the word simply
              is not there: the card never offers an address line its send would drop. */}
          {!card.ccEditor && (card.cc?.length ?? 0) === 0 && card.onOpenCc && (
            <button type="button" onClick={card.onOpenCc}
              className="aug-focus rounded text-[11px] text-neutral-400 hover:text-neutral-600">Cc</button>
          )}
          {!card.bccEditor && (card.bcc?.length ?? 0) === 0 && card.onOpenBcc && (
            <button type="button" onClick={card.onOpenBcc}
              className="aug-focus rounded text-[11px] text-neutral-400 hover:text-neutral-600">Bcc</button>
          )}
          {(card.subject || card.onEditSubject) && (
            editingSubject ? (
              <input
                autoFocus value={buf} onChange={(e) => setBuf(e.target.value)}
                onBlur={() => { card.onEditSubject?.(buf); setEditingSubject(false); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { card.onEditSubject?.(buf); setEditingSubject(false); }
                  if (e.key === 'Escape') setEditingSubject(false);
                }}
                className="ml-auto min-w-[140px] rounded border border-indigo-300 px-1.5 py-0.5 text-[12px] text-neutral-800 focus:outline-none"
              />
            ) : (
              // THE SUBJECT SITS QUIET AT THE RIGHT of the address row (the frozen board). It needs
              // `min-w-0` for its own truncate to bite, and a cap so a long "Re: …" never pushes the
              // recipient chips into a second line.
              <span className="ml-auto flex min-w-0 max-w-[46%] items-baseline gap-1 text-[11px] text-neutral-400">
                <span className="truncate">{card.subject || 'No subject'}</span>
                <EditMark onClick={card.onEditSubject ? () => { setBuf(card.subject ?? ''); setEditingSubject(true); } : undefined} />
              </span>
            )
          )}
        </div>

        {card.ccEditor && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-neutral-400">Cc</span>{card.ccEditor}
          </div>
        )}
        {card.bccEditor && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-neutral-400">Bcc</span>{card.bccEditor}
          </div>
        )}

        {/* WHAT CAME WITH THE MESSAGE YOU ARE ANSWERING — the source email's own attachments, in
            the email context rather than only in the drawer's Files tab. Read-only by construction
            (no ✕): these are not riding this send, and a control that cannot act must not render.
            Counted, never claimed — with no files the whole lane is absent. */}
        {(card.contextFiles?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-neutral-400">{card.contextFilesLabel ?? 'Came with the email'}</span>
            {card.contextFiles!.map((f, i) => (
              <AttachmentChip key={`${f.name}:${i}`} name={f.name} size={f.size} onClick={() => f.onOpen?.()} />
            ))}
          </div>
        )}

        {/* CLICK ANYWHERE TO EDIT — the card IS the workspace; the stage survives for the deep 20%.
            The editor is the INBOX'S OWN rich composer (contentEditable + FormatToolbar: bold ·
            italic · lists · link), mounted, never forked — so a card send and a stage send of the
            same words are byte-identical HTML. It commits on real input ONLY: entering and leaving
            the body without typing is not an edit, and the walk's "tabs not clickable" died there. */}
        {editingBody && card.onEditBody && card.richBody ? (
          <ReplyEditor
            key={card.bodyRev ?? 'v0'}
            initialHTML={card.bodyHtml ?? card.body}
            onInput={(html) => card.onEditBody!(html)}
            autoFocus
            minHeight={120} maxHeight={420}
            className={cn('-mx-2 rounded border border-indigo-300 px-2 py-1.5', workingClass(card.busy))}
          />
        ) : editingBody && card.onEditBody ? (
          // The plain lane (a coworker's Resend email): same law, no toolbar — the edit is reported
          // on the KEYSTROKE, never on entering or leaving the field.
          <textarea
            key={card.bodyRev ?? 'v0'}
            autoFocus defaultValue={card.body} rows={9}
            onChange={(e) => card.onEditBody!(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditingBody(false); }}
            className={cn('-mx-2 w-[calc(100%+1rem)] resize-y rounded border border-indigo-300 px-2 py-1.5 text-[13px] leading-[1.6] text-neutral-800 focus:outline-none', workingClass(card.busy))}
          />
        ) : (
          <div
            role={card.onEditBody ? 'button' : undefined}
            tabIndex={card.onEditBody ? 0 : undefined}
            onClick={card.onEditBody ? () => setEditingBody(true) : undefined}
            onKeyDown={card.onEditBody ? (e) => { if (e.key === 'Enter') setEditingBody(true); } : undefined}
            className={cn('aug-focus text-left text-[13px] leading-[1.6] text-neutral-700',
              // ONE PARAGRAPH RHYTHM, AT REST AND UNDER THE CARET (owner walk, Sep 10: "editor
              // looks messy"). These are the global `[contenteditable] p/ul/ol` rules the rich
              // editor already obeys — 0.6em between blocks and NOTHING after the last one — so
              // the words do not re-space themselves the moment the body is clicked into.
              '[&_p]:mb-[0.6em] [&_ul]:mb-[0.6em] [&_ol]:mb-[0.6em]',
              '[&_p:last-child]:mb-0 [&_ul:last-child]:mb-0 [&_ol:last-child]:mb-0 [&_li]:mb-[0.15em]',
              '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_a]:text-indigo-600 [&_a]:underline',
              !card.bodyHtml && 'whitespace-pre-line',
              // The same box the editor occupies, drawn in a transparent border: clicking to edit
              // must not shove the draft two pixels sideways and one line down.
              card.onEditBody && '-mx-2 cursor-text rounded border border-transparent px-2 py-1.5',
              workingClass(card.busy))}
            {...(card.bodyHtml ? { dangerouslySetInnerHTML: { __html: card.bodyHtml } } : {})}
          >
            {card.bodyHtml ? undefined : (card.body || <span className="text-neutral-300">Nothing drafted yet</span>)}
          </div>
        )}
        {/* THE HINT IS THE QUIETEST THING ON THE CARD — vocabulary about the surface, never speech
            about the work. It sits a step below the labels it explains and never competes with the
            draft (owner walk, Sep 10: "editor looks messy"). */}
        {card.bodyHint && <div className="text-[11px] leading-[1.5] text-neutral-300">{card.bodyHint}</div>}

        {/* THE ATTACHMENT CHIPS — the receipt that a file rides this send. */}
        {(card.attachments?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {card.attachments!.map((a, i) => (
              <span key={`${a.name}:${i}`} className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700">
                <PaperClipIcon className="h-3 w-3 flex-shrink-0" />
                <span className="max-w-[160px] truncate">{a.name}</span>
                {a.onRemove && (
                  <button type="button" onClick={a.onRemove} aria-label={`Remove ${a.name}`}
                    className="aug-focus ml-0.5 rounded transition-colors hover:text-rose-500">
                    <XMarkIcon className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {card.attachNode}
      </div>

      {/* THE IN-CARD SELECTOR — contained rows, never pills beneath the card. */}
      {(card.options?.length ?? 0) > 0 && (
        <div role="radiogroup" className="flex flex-col border-t border-neutral-200/70">
          {card.options!.map((o) => (
            <SelectorRow key={o.id} option={o} selected={o.id === card.selectedOptionId} onPick={card.onPickOption} />
          ))}
          {openPicked && card.onSteer && (
            <div className="flex items-center gap-2 border-t border-neutral-200/55 px-4 py-[9px]">
              <input
                autoFocus value={steer} onChange={(e) => setSteer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitSteer(); }}
                placeholder={card.steerPlaceholder ?? 'Tell me what to change…'}
                className="min-w-0 flex-grow rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12.5px] text-neutral-800 placeholder:text-neutral-300 focus:border-indigo-300 focus:outline-none"
              />
              <button type="button" onClick={submitSteer} disabled={!steer.trim() || card.steerBusy}
                className="aug-focus flex-shrink-0 rounded-lg border border-neutral-200/80 px-3 py-1.5 text-[12px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-default disabled:opacity-60">
                {card.steerBusy ? 'Redrafting…' : 'Redraft'}
              </button>
            </div>
          )}
        </div>
      )}

      {card.error && <div className="border-t border-neutral-200/55 px-4 py-2 text-[12px] text-rose-600">{card.error}</div>}

      {/* THE COMMIT ROW — always the card's bottom edge; the receipt word sits at its right.
          While the machine is redrafting the row STANDS DOWN (a click that would race the landing
          content is not a door), and it comes back the moment the words arrive. */}
      {(card.onSend || card.receipt || card.onAttachFile || card.onAttachFromKb) && (
        <div className="flex items-center gap-2.5 border-t border-neutral-200/70 bg-neutral-50 px-4 py-2.5">
          {ready && card.onSend && (
            <button type="button" onClick={card.onSend} disabled={card.sendDisabled || card.busy}
              className="aug-focus rounded-lg bg-indigo-600 px-3.5 py-[7px] text-[12.5px] font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-default disabled:opacity-60">
              {card.sendLabel ?? 'Send reply'}
            </button>
          )}
          {(card.onAttachFile || card.onAttachFromKb) && (
            <AttachMenu onFile={card.onAttachFile} onKb={card.onAttachFromKb}
              open={attachOpen} setOpen={setAttachOpen} disabled={card.busy} />
          )}
          {(card.toneOptions?.length ?? 0) > 0 && card.onPickTone && (
            <ToneMenu options={card.toneOptions!} onPick={card.onPickTone} disabled={card.busy} />
          )}
          <span className="flex-grow" />
          {card.receipt && <span className="text-[11px] font-medium text-indigo-600">{card.receipt}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * THE ATTACH DOOR — the inbox reply's own two ways in (a local file · the knowledge base), on the
 * card's commit row. The host owns the picker surfaces; this is only the affordance.
 */
function AttachMenu({ onFile, onKb, open, setOpen, disabled }: {
  onFile?: () => void; onKb?: () => void;
  open: boolean; setOpen: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <span className="relative">
      <button type="button" onClick={() => setOpen(!open)} disabled={disabled} title="Attach a file"
        className="aug-focus rounded-lg border border-neutral-200/80 bg-white px-2.5 py-[6px] text-neutral-500 transition-colors hover:bg-neutral-50 disabled:cursor-default disabled:opacity-60">
        <PaperClipIcon className="h-4 w-4" />
      </button>
      {open && (
        <span className="absolute bottom-full left-0 z-20 mb-1 flex w-52 flex-col rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
          {onFile && (
            <button type="button" onClick={() => { setOpen(false); onFile(); }}
              className="aug-focus px-3 py-1.5 text-left text-[12.5px] text-neutral-700 hover:bg-neutral-50">Upload a file</button>
          )}
          {onKb && (
            <button type="button" onClick={() => { setOpen(false); onKb(); }}
              className="aug-focus px-3 py-1.5 text-left text-[12.5px] text-neutral-700 hover:bg-neutral-50">From knowledge base</button>
          )}
        </span>
      )}
    </span>
  );
}

/** "Tweak the tone ▾" — a FIXED vocabulary (never speech), applied through the one redraft path. */
function ToneMenu({ options, onPick, disabled }: { options: Array<{ id: string; label: string }>; onPick: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <span className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={disabled}
        className="aug-focus rounded-lg border border-neutral-200/80 bg-white px-3 py-[6px] text-[12px] text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-default disabled:opacity-60">
        Tweak the tone ▾
      </button>
      {open && (
        <span className="absolute bottom-full left-0 z-20 mb-1 flex w-48 flex-col rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
          {options.map((o) => (
            <button key={o.id} type="button" onClick={() => { setOpen(false); onPick(o.id); }}
              className="aug-focus px-3 py-1.5 text-left text-[12.5px] text-neutral-700 hover:bg-neutral-50">
              {o.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * THE BULK-DEED CARD (docs/attention-plan.md, law A7) — the third interactive kind.
 *
 *   the intro      what will happen, to how many ("Archive 31 messages from Notices.")
 *   the breakdown  one muted line per real lane; THE HONEST UNSUBSCRIBE SUBSET lives here
 *   the tail       the needs-a-click messages, NAMED with their subjects — never a bare count
 *   the undo note  the quietest line, honest per verb (an unsubscribe says it cannot be undone)
 *   the commit row ONE primary door · a quiet way out · the receipt at the right edge
 *
 * Every word arrives composed from the stored deed (`lib/deeds/bulk.ts`). The `done` state carries
 * NO commit door — a deed that has run cannot be run again, and a card must never wear a button its
 * engine would refuse.
 */
function BulkCardView({ card }: { card: BulkCard }) {
  const done = card.state === 'done';
  const busy = card.busy || card.state === 'committing';

  return (
    <div className={cn(SHELL, MAX_W, 'flex flex-col overflow-hidden')}>
      <div className={cn('flex flex-col gap-2 px-4 py-3.5', workingClass(busy))}>
        <div className="text-[13px] font-semibold text-neutral-900">{card.intro}</div>

        {/* WHAT WILL HAPPEN, TO HOW MANY — one line per lane that actually has members. */}
        {(card.lines?.length ?? 0) > 0 && (
          <ul className="flex flex-col gap-1">
            {card.lines!.map((l, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-[1.5] text-neutral-500">
                <span aria-hidden className="mt-[7px] h-[3px] w-[3px] flex-shrink-0 rounded-full bg-neutral-300" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        )}

        {/* THE HONEST SUBSET, NAMED. These are the ones we refuse to fire; a count with no way to
            reach them would be a dead end wearing a number. A row with no door is plain text. */}
        {(card.needsClick?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-1 border-l-2 border-neutral-200/80 pl-2.5">
            <span className="text-[11px] text-neutral-400">{card.needsClickLabel ?? 'These need a click from you'}</span>
            {card.needsClick!.map((n, i) => (
              n.url || n.onOpen ? (
                <a key={i} href={n.url} target="_blank" rel="noreferrer noopener"
                  onClick={n.onOpen ? (e) => { e.preventDefault(); n.onOpen!(); } : undefined}
                  className="aug-focus truncate rounded text-[12px] text-indigo-600 hover:text-indigo-700">
                  {n.subject}
                </a>
              ) : (
                <span key={i} className="truncate text-[12px] text-neutral-500">{n.subject}</span>
              )
            ))}
          </div>
        )}

        {/* THE UNDO NOTE — the quietest line on the card, and never a promise the verb cannot keep. */}
        {card.undoNote && <div className="text-[11px] leading-[1.5] text-neutral-300">{card.undoNote}</div>}
      </div>

      {card.error && <div className="border-t border-neutral-200/55 px-4 py-2 text-[12px] text-rose-600">{card.error}</div>}

      {/* THE POSTURE TAIL (A8) — offered only where a standing version is actually keepable; the
          host decides that, and with no handler the tail does not render (never a lying offer).
          Once answered, the offer is replaced IN PLACE by what was understood, or by the honest
          refusal — the word is the deed, read back where it was said. */}
      {done && card.postureNote && (
        <div className="border-t border-neutral-200/55 px-4 py-2.5 text-[12px] text-neutral-500">{card.postureNote}</div>
      )}
      {done && !card.postureNote && card.postureAsk && card.onKeepDoingThis && (
        <div className="flex items-center gap-2.5 border-t border-neutral-200/55 px-4 py-2.5">
          <span className="text-[12px] text-neutral-500">{card.postureAsk}</span>
          <CardButton label="Keep doing this" onClick={card.onKeepDoingThis} tone="secondary" />
        </div>
      )}

      {/* THE COMMIT ROW — always the card's bottom edge. ONE door; the way out stays quiet; a deed
          that has run keeps only its receipt. */}
      {(!done || card.receipt) && (
        <div className="flex items-center gap-2.5 border-t border-neutral-200/70 bg-neutral-50 px-4 py-2.5">
          {!done && card.onCommit && (
            <button type="button" onClick={card.onCommit} disabled={busy}
              className="aug-focus rounded-lg bg-indigo-600 px-3.5 py-[7px] text-[12.5px] font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-default disabled:opacity-60">
              {card.commitLabel ?? 'Do it'}
            </button>
          )}
          {!done && card.onCancel && (
            <CardButton label={card.cancelLabel ?? 'Not now'} onClick={busy ? undefined : card.onCancel} tone="quiet" />
          )}
          <span className="flex-grow" />
          {card.receipt && <span className="text-[11px] font-medium text-indigo-600">{card.receipt}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * THE DOC GLYPHS — one shape per file family, in the house stroke style (16-box, 1.4 stroke, the
 * icon-tile grammar every other card wears). No emoji, no vendor marks: the glyph says WHAT KIND
 * OF FILE, never whose product made it.
 */
const DOC_GLYPHS: Record<DocCard['docType'], React.ReactNode> = {
  // the page with a folded corner + the PDF's own double rule
  pdf: (
    <>
      <path d="M9.4 1.8H4.4A1.4 1.4 0 0 0 3 3.2v9.6a1.4 1.4 0 0 0 1.4 1.4h7.2a1.4 1.4 0 0 0 1.4-1.4V5.4L9.4 1.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.4 1.8v3.6H13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5.4 9.4h5.2M5.4 11.4h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  // the written page — full text lines
  word: (
    <>
      <path d="M9.4 1.8H4.4A1.4 1.4 0 0 0 3 3.2v9.6a1.4 1.4 0 0 0 1.4 1.4h7.2a1.4 1.4 0 0 0 1.4-1.4V5.4L9.4 1.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5.4 6.4h4M5.4 8.8h5.2M5.4 11.2h3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  // the projected frame on its stand
  slides: (
    <>
      <rect x="2.4" y="2.8" width="11.2" height="7.6" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 10.4v2.8M5.6 13.2h4.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  // the grid
  sheet: (
    <>
      <rect x="2.4" y="2.8" width="11.2" height="10.4" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.4 6.2h11.2M6.6 6.2v7M2.4 9.7h11.2" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  // the honest generic — a page, and no claim about its kind
  doc: (
    <>
      <path d="M9.4 1.8H4.4A1.4 1.4 0 0 0 3 3.2v9.6a1.4 1.4 0 0 0 1.4 1.4h7.2a1.4 1.4 0 0 0 1.4-1.4V5.4L9.4 1.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.4 1.8v3.6H13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </>
  ),
};

/**
 * THE DOC CARD (docs/attention-plan.md, law D) — the handle, never the document.
 *
 *   the intro     the mind's composed line (host-authored, or absent)
 *   the handle    glyph · title · the meta line, joined from the facts that are actually known
 *   the doors     Review → (primary, the side panel) · a commit ONLY where a send-deed exists
 *
 * There is nothing else here by design: no first-page excerpt, no embedded body, no editor. The
 * document is read in the player, and the conversation continues beside it.
 */
function DocCardView({ card }: { card: DocCard }) {
  // THE META LINE IS JOINED, NEVER COMPOSED: every part is a stored fact, and an unknown fact is
  // simply absent (pages are "when known" — a card that has rendered nothing says nothing).
  const meta = [
    card.typeLabel,
    typeof card.pages === 'number' && card.pages > 0 ? `${card.pages} page${card.pages === 1 ? '' : 's'}` : null,
    card.versionLabel || null,
    card.owner ? `by ${card.owner}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={cn(SHELL, MAX_W, 'flex flex-col overflow-hidden')}>
      {card.intro && (
        <div className="px-3.5 pt-3 text-[13px] leading-[1.5] text-neutral-700">{card.intro}</div>
      )}
      <div className="flex items-center gap-3 px-3.5 py-3">
        <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">{DOC_GLYPHS[card.docType]}</svg>
        </span>
        <span className="flex min-w-0 flex-grow flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold text-neutral-900">{card.title}</span>
          {meta && <span className="truncate text-[12px] text-neutral-500">{meta}</span>}
        </span>
        <OpenLink label={card.reviewLabel ?? 'Review →'} onClick={card.onReview} />
      </div>

      {card.error && <div className="border-t border-neutral-200/55 px-4 py-2 text-[12px] text-rose-600">{card.error}</div>}

      {/* THE COMMIT ROW — present only where a send-deed for THIS document was handed in. */}
      {(card.onSend || card.receipt) && (
        <div className="flex items-center gap-2.5 border-t border-neutral-200/70 bg-neutral-50 px-4 py-2.5">
          {card.onSend && (
            <button type="button" onClick={card.onSend} disabled={card.sendDisabled}
              className="aug-focus rounded-lg bg-indigo-600 px-3.5 py-[7px] text-[12.5px] font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-default disabled:opacity-60">
              {card.sendLabel ?? 'Send it'}
            </button>
          )}
          <span className="flex-grow" />
          {card.receipt && <span className="text-[11px] font-medium text-indigo-600">{card.receipt}</span>}
        </div>
      )}
    </div>
  );
}

// ── the card renders ────────────────────────────────────────────────────────────────────────────

export function ThreadCardView({ card }: { card: ThreadCard }) {
  switch (card.kind) {
    // 1 · PREPARED WORK — a coworker hands you the finished thing. Open → the stage, the only Send.
    case 'deliverable':
      return (
        <div className={cn(SHELL, MAX_W, 'flex items-center gap-3 px-3.5 py-3')}>
          <IconTile icon={card.icon ?? 'document'} />
          <span className="flex min-w-0 flex-grow flex-col gap-0.5">
            <span className="truncate text-[13px] font-semibold text-neutral-900">{card.title}</span>
            {card.meta && <span className="truncate text-[12px] text-neutral-500">{card.meta}</span>}
          </span>
          <OpenLink label={card.openLabel ?? 'Open →'} onClick={card.onOpen} />
        </div>
      );

    // 2 · APPROVAL — a gate is a coworker asking, answered in place. Reject stays quiet.
    case 'approval':
      return (
        <div className={cn(SHELL, MAX_W, 'flex flex-col gap-2.5 p-3.5')}>
          <div className="text-[13px] font-semibold text-neutral-900">{card.title}</div>
          {card.preview && (
            <div className="border-l-2 border-neutral-200/80 pl-2.5 text-[12px] leading-[1.5] text-neutral-500 whitespace-pre-wrap">
              {card.preview}
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <CardButton label={card.approveLabel ?? 'Approve'} onClick={card.onApprove} />
            {(card.onOpen || card.openLabel) && <CardButton label={card.openLabel ?? 'Open'} onClick={card.onOpen} tone="secondary" />}
            <CardButton label={card.rejectLabel ?? 'Reject'} onClick={card.onReject} tone="quiet" />
          </div>
        </div>
      );

    // 3 · INPUT NEEDED — the ask carries its own answer door, and NEVER blocks.
    case 'input':
      return (
        <div className={cn(SHELL, MAX_W, 'flex flex-col gap-2.5 p-3.5')}>
          <div className="text-[13px] leading-[1.5] text-neutral-800">{card.ask}</div>
          <div className="flex flex-wrap items-center gap-2">
            <SupplyChip label="Attach" onClick={card.onAttach} icon={
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="m13.2 7.4-5 5a3.2 3.2 0 0 1-4.6-4.6l5.6-5.6a2.2 2.2 0 0 1 3.2 3.2l-5.5 5.5a1.2 1.2 0 0 1-1.8-1.8l4.8-4.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            } />
            <SupplyChip label="Paste" onClick={card.onPaste} />
            <SupplyChip label="Pick a file" onClick={card.onPickFile} />
            {card.onProceed && (
              <button type="button" onClick={card.onProceed} className="aug-focus rounded text-[12px] font-medium text-indigo-600 hover:text-indigo-700">
                {card.proceedLabel ?? 'Go ahead without it →'}
              </button>
            )}
          </div>
        </div>
      );

    // 4 · ROUTINE DELIVERY — a standing responsibility, owned by a face.
    case 'routine':
      return (
        <div className={cn(SHELL, MAX_W, 'flex items-center gap-3 px-3.5 py-3')}>
          <IconTile icon="document" />
          <span className="flex min-w-0 flex-grow flex-col gap-0.5">
            <span className="truncate text-[13px] font-semibold text-neutral-900">{card.title}</span>
            {card.meta && <span className="truncate text-[12px] text-neutral-500">{card.meta}</span>}
          </span>
          <OpenLink label={card.openLabel ?? 'Open →'} onClick={card.onOpen} />
        </div>
      );

    // 5 · FRAME — a living deliverable, previewed inline; Open raises the side panel (the Claude idiom).
    case 'frame':
      return (
        <div className={cn(SHELL, MAX_W, 'flex flex-col overflow-hidden')}>
          <div className="h-[110px] border-b border-neutral-200/80 bg-neutral-50">{card.preview}</div>
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="flex min-w-0 flex-grow flex-col gap-0.5">
              <span className="truncate text-[13px] font-semibold text-neutral-900">{card.title}</span>
              {card.meta && <span className="truncate text-[12px] text-neutral-500">{card.meta}</span>}
            </span>
            <OpenLink label={card.openLabel ?? 'Open →'} onClick={card.onOpen} />
          </div>
        </div>
      );

    // (Heavy work in flight is NOT a card — it is the `working_line` timeline item: the walk
    // caught the card form doubling the face inside its own actor bubble.)

    // 8 · A ROUTINE IS BORN IN CONVERSATION — saying prepares, committing stays explicit.
    case 'proposal':
      return (
        <div className={cn(SHELL, MAX_W, 'flex flex-col gap-2.5 p-3.5')}>
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-indigo-600">
              <path d="M8.8 1.8 3.2 9h4l-.8 5.2L12 7H8l.8-5.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <div className="text-[13px] font-semibold text-neutral-900">{card.title}</div>
          </div>
          {card.detail && <div className="text-[12px] leading-[1.5] text-neutral-500">{card.detail}</div>}
          <div className="flex items-center gap-2.5">
            <CardButton label={card.confirmLabel ?? 'Confirm'} onClick={card.onConfirm} />
            <CardButton label={card.dismissLabel ?? 'Not now'} onClick={card.onDismiss} tone="quiet" />
          </div>
        </div>
      );

    // 9 · THE INVITE — the first INTERACTIVE card: filled, editable, its grounded alternatives in
    // the in-card selector, its commit at the bottom edge. The card IS the workspace.
    case 'invite':
      return <InviteCardView card={card} />;

    // 10 · THE EMAIL — the drafted message, in the thread: direction-variants on the top edge, the
    // raw thread behind its door, refinements in the selector, one Send at the bottom edge.
    case 'email':
      return <EmailCardView card={card} />;

    // 11 · THE BULK DEED — a ledger class's natural verb: what will happen, to how many, the undo
    // note, ONE commit door. The preview it prints is a stored fact, not client state.
    case 'bulk':
      return <BulkCardView card={card} />;

    // 12 · THE DOC — the review-first handle (attention-plan D): glyph · title · the known facts,
    // and ONE deed. The document itself is never in the thread; Review raises the ONE panel.
    case 'doc':
      return <DocCardView card={card} />;

    // 13 · THE ONE OBJECT CARD — the SOURCE half of the contract (THE OPENING CONTRACT, clause 1):
    // what the ask, the decision or the brief is ABOUT, in one rendering on every surface.
    case 'source':
      return <SourceObjectCard card={card} />;

    // THE CARD SLOT — a host's own rich component, mounted whole.
    case 'custom':
      return <div className={CUSTOM_MAX_W}>{card.node}</div>;
  }
}

export function ThreadCards({ cards }: { cards?: ThreadCard[] }) {
  if (!cards?.length) return null;
  return (
    <>
      {cards.map((c, i) => <ThreadCardView key={c.id ?? `${c.kind}:${i}`} card={c} />)}
    </>
  );
}
