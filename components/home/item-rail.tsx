'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONVERSATIONAL RAIL (just-works P1.5b) — the deep-dive's right column talks like a colleague,
// not a data card. The opening narration is the entity's OWN judged state (zero AI at render — the
// brain already authored it); every mention is a live CHIP (✉ thread, meeting, file, coworker avatar
// with one-tap hand-off). One composer at the bottom is the whole channel: a correction reworks the
// draft + writes entity memory, a question gets a grounded answer, and "have <coworker> do X" routes
// a real delegation — all via /api/items/steer.
//
// VISUAL LANGUAGE: mirrors the app's ONE chat-panel idiom (components/shared/chat-sidebar.tsx — the
// meetings/drive assistant): h-10 icon header, neutral-100 user bubbles (rounded-br-sm), small round
// assistant avatar + plain text, bouncing-dots typing indicator, rounded-2xl composer with the round
// indigo send button. Same visual = same meaning across screens.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentIcon, PaperAirplaneIcon, PaperClipIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { ROLE_AVATARS } from '@/lib/workers/roles';
import { DecisionCard } from '@/components/work/decision-card';

// 'entity' = the PROJECT DOOR (P7c-c2): the same rail inside the project room — id is the entity
// id, steer/ingest run in entity scope, the Overview chip hides (you're already there).
type RailKind = 'email' | 'followup' | 'commitment' | 'meeting' | 'awareness' | 'entity';

export type RailView = {
  // The open item — what the rail's opening message narrates FIRST (P5b: item-anchored, never generic).
  anchor?: { who: string | null; ask: string | null; prepared: string | null } | null;
  gap: string | null;
  entity: {
    id: string; name: string;
    tracked?: boolean; // T4 — accepted (project) vs merely recognized (quiet context)
    summary: string | null; momentum: string | null; nextMove: string | null;
    whoOwesYou: string[]; whoOwesThem: string[];
    suggestedWorker?: { id: string; name: string; role: string } | null;
  } | null;
  siblings: {
    threads: Array<{ id: string; subject: string; who: string | null; at: string | null; current: boolean }>;
    meetings: Array<{ id: string; title: string; at: string | null }>;
    commitments: Array<{ id: string; description: string; who: string | null }>;
    files: Array<{ id: string; filename: string }>;
  };
};

/** A tappable offer inside a narration turn (W3) — the word is the deed:
 *  'prepare' fires THE ONE preparation engine for the item; 'say' posts the text through the
 *  one conversation core (hand-offs ride the existing steer path). */
export type TurnAction = { label: string } & (
  | { act: 'prepare'; itemKind: 'inbox' | 'commitment'; itemId: string }
  | { act: 'say'; text: string });

type Turn =
  | { role: 'user'; text: string }
  | { role: 'system'; text: string; key?: string; actions?: TurnAction[]; refs?: Array<{ label: string; href: string | null }>; files?: Array<{ id: string; filename: string; source: string }>; author?: { name: string; role?: string | null } };

// THE ROOM (P7c-c1 → one-room R1): the conversation is PER-DEAL, not per-item — navigating between
// a deal's artifacts keeps the chat. The module store is now only the LIVE RENDER CACHE; the durable
// record is `room_turns` (every write POSTs, mounts hydrate from GET — a reload keeps the story).
const _dealTurns = new Map<string, Turn[]>();

// R1 — fire-and-forget persistence to the ONE turns table (non-fatal; the in-memory store still
// renders this session if the write fails or the migration isn't applied yet).
function persistTurn(roomKey: string, t: Turn): void {
  try {
    fetch('/api/room/turns', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomKey, role: t.role, text: t.text,
        refs: t.role === 'system' ? t.refs : undefined,
        dedupeKey: t.role === 'system' ? t.key : undefined,
      }),
    }).catch(() => {});
  } catch { /* SSR-safe */ }
}

/** Push a narration turn into a deal's conversation from OUTSIDE the rail (5A.5 — the room's
 *  CTA-focus continuation). Writes the module store + the DURABLE room_turns row + notifies any
 *  mounted rail via a window event (the rail re-reads its roomKey store on it). Deterministic — no AI.
 *  W3: an opts.key DEDUPES — any prior turn with the same key is dropped before appending, so a
 *  re-clicked CTA re-surfaces its one line instead of stuttering duplicates. opts.actions render
 *  as tappable offers ("Draft it now" / "Hand to …"). */
export function pushDealTurn(entityId: string, text: string, opts?: { key?: string; actions?: TurnAction[]; role?: 'user' | 'system' }): void {
  const turns = _dealTurns.get(entityId) ?? [];
  const kept = opts?.key ? turns.filter((t) => t.role !== 'system' || t.key !== opts.key) : turns;
  const turn: Turn = opts?.role === 'user'
    ? { role: 'user', text }
    : { role: 'system', text, key: opts?.key, actions: opts?.actions };
  _dealTurns.set(entityId, [...kept, turn]);
  persistTurn(entityId, turn);
  try { window.dispatchEvent(new CustomEvent('aug:deal-turn', { detail: { entityId } })); } catch { /* SSR-safe */ }
}

// The hand-off chip's coworker comes SERVED on the view (entity.suggestedWorker — the ONE routing
// brain, lib/prepare/route-suggestion.ts). The old client-side keyword match is deleted (W2).



// Mechanical dedup — plumbing, not judgment: two phrasings of the same move share most of their
// distinctive words. Normalized content-token overlap ≥ 0.6 (against the shorter set) = an echo.
function echoesAnchor(nextMove: string, ask: string | null): boolean {
  if (!ask) return false;
  const toks = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 3));
  const a = toks(nextMove); const b = toks(ask);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size) >= 0.6;
}

function Initials({ name }: { name: string }) {
  const parts = name.replace(/<[^>]*>/g, '').trim().split(/\s+/);
  const ini = (parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
  return (
    <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-indigo-100 text-indigo-600 text-[9px] font-semibold flex-shrink-0">
      {ini.toUpperCase()}
    </span>
  );
}

function Chip({ icon, label, onClick }: { icon?: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600 transition-colors max-w-full ${onClick ? 'hover:border-indigo-200 hover:text-indigo-600 cursor-pointer' : 'cursor-default'}`}
    >
      {icon}<span className="truncate">{label}</span>
    </button>
  );
}

// An assistant message — PLAIN indented paragraphs (user call: the rail is a narrator, not a
// persona; no per-message avatar). The panel header keeps the shared chat-sidebar icon.
function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-[13px] text-neutral-800 leading-relaxed space-y-1.5">{children}</div>
  );
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 mt-1">
      <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

export function ItemRail({ kind, id, view, onDraft, decision, artifact }: {
  kind: RailKind; id: string; view: RailView; onDraft?: (draft: string) => void;
  /** One-room R2 — the judged DECISION mounts INLINE in the stream (surface:'inline' per the
   *  registry). The caller wires onChoose through steer; "Leave it with me" clears. */
  decision?: { title: string | null; options: Array<{ label: string }>; onChoose: (label: string) => void | Promise<void>; onDismiss: () => void } | null;
  /** One-room R2 — the ARTIFACT CARD: a staged workspace's inline handle ("Draft ready — open ·
   *  Send"), commit line right on it. onOpen focuses the stage; onCommit fires the same gate. */
  artifact?: { label: string; by?: string | null; commitLabel?: string; onOpen: () => void; onCommit?: () => void | Promise<void>; committing?: boolean } | null;
}) {
  const router = useRouter();
  const ent = view.entity;
  const sib = view.siblings;
  const inRoom = kind === 'entity';
  // R1 — the ONE room-key convention: the entity id for deal rooms; `<kind>:<id>` for loose
  // anchors (inbox | commitment | meeting — matches lib/room/turns.ts `looseRoomKey`).
  const roomKey = ent?.id ?? (kind === 'entity' ? id
    : `${kind === 'commitment' || kind === 'followup' ? 'commitment' : kind === 'meeting' ? 'meeting' : 'inbox'}:${id}`);
  const [turns, setTurnsRaw] = useState<Turn[]>(() => _dealTurns.get(roomKey) ?? []);
  const setTurns = (updater: (prev: Turn[]) => Turn[]) => {
    setTurnsRaw((prev) => { const next = updater(prev); _dealTurns.set(roomKey, next); return next; });
  };
  // Same-deal navigation remounts the rail — restore the deal's conversation. External pushes
  // (pushDealTurn) land live via the window event.
  useEffect(() => { setTurnsRaw(_dealTurns.get(roomKey) ?? []); }, [roomKey]);
  // R1 — HYDRATE from the durable record: the server's turns are the story (engine narrations
  // wrote there while this tab was closed). The in-memory cache wins only when it's AHEAD of the
  // server (turns added this session whose fire-and-forget write may still be in flight).
  useEffect(() => {
    let alive = true;
    fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !Array.isArray(d?.turns)) return;
        const server: Turn[] = (d.turns as Array<{ role: 'user' | 'system'; text: string; refs?: Array<{ label: string; href: string | null }>; author?: { name: string; role?: string | null } | null }>)
          .map((t) => ({ role: t.role, text: t.text, refs: t.refs ?? undefined, author: t.author ?? undefined } as Turn));
        setTurnsRaw((local) => {
          if (local.length > server.length) return local;
          _dealTurns.set(roomKey, server);
          return server;
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [roomKey]);
  useEffect(() => {
    const onTurn = (ev: Event) => { if ((ev as CustomEvent).detail?.entityId === roomKey) setTurnsRaw(_dealTurns.get(roomKey) ?? []); };
    window.addEventListener('aug:deal-turn', onTurn);
    return () => window.removeEventListener('aug:deal-turn', onTurn);
  }, [roomKey]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [turns, busy]);

  const suggested = ent?.suggestedWorker ?? null; // the ONE routing brain's served verdict (W2)

  // R1 — every conversational write goes through here: render + durable persist in one motion.
  const addTurn = (t: Turn) => { setTurns((prev) => [...prev, t]); persistTurn(roomKey, t); };

  // W3: a narration turn's tappable offer. 'prepare' fires THE ONE preparation engine (the grounded
  // result is narrated; 'aug:prepared' tells the room to refresh its board); 'say' rides the one
  // conversation core (hand-offs go through the existing steer path).
  const runAction = async (a: TurnAction) => {
    if (busy) return;
    if (a.act === 'say') { await send(a.text); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/items/prepare-now', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: a.itemKind, id: a.itemId }),
      });
      const d = await res.json().catch(() => ({}));
      const by = d.worker ? String(d.worker).split(' ')[0] : null; // O3: the work always has a name
      const say = !res.ok ? (d.error || "I couldn't prepare that just now.")
        : d.did === 'draft' ? `${by ? `${by} drafted it` : 'Drafted'} — it’s ready below. Send it as-is or tell me what to change.`
          : d.did === 'nudge' ? `${by ? `${by} drafted the nudge` : 'Nudge drafted'} — it’s on the task.`
            : d.did === 'docsend' ? `${by ? `${by} found the file and drafted the send` : 'Found the file and drafted the send'} — it’s ready below.`
              : d.did === 'delegated' ? `${String(d.worker || 'A coworker').split(' ')[0]} is on it — the work lands here when it’s ready.`
                : (d.reason || 'Nothing to prepare here.');
      addTurn({ role: 'system', text: say });
      if (res.ok && d.did && d.did !== 'none') { try { window.dispatchEvent(new CustomEvent('aug:prepared', { detail: {} })); } catch { /* SSR-safe */ } }
    } catch {
      addTurn({ role: 'system', text: "I couldn't prepare that just now." });
    } finally { setBusy(false); }
  };

  const send = async (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || busy) return;
    setText('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    addTurn({ role: 'user', text: t });
    setBusy(true);
    try {
      const res = await fetch('/api/items/steer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, text: t }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        addTurn({ role: 'system', text: d.error || "I couldn't do that just now." });
      } else {
        // The ONE conversation core's uniform turn: `say` is the reply; refs/files are chips; a
        // reworked draft re-seeds the composer. (P6b — the rail owns zero logic.)
        if (d.draft && onDraft) onDraft(d.draft);
        setTurns((prev) => [...prev, {
          role: 'system',
          // Refs render as chips below — the raw [L4]/[F2] markers must never sit in the prose.
          text: String(d.say || d.answer || 'Done.').replace(/\s*\[[LF]?\d+(?:\s*,\s*[LF]?\d+)*\]/g, ''),
          refs: Array.isArray(d.refs) ? d.refs.map((r: { label?: string; href?: string | null }) => ({ label: String(r.label ?? ''), href: r.href ?? null })) : [],
          files: Array.isArray(d.files) ? d.files : undefined,
        }]);
      }
    } catch {
      addTurn({ role: 'system', text: "I couldn't do that just now." });
    } finally { setBusy(false); }
  };

  // 📎 — the ingest funnel: the file lands in the per-item deliverable pool (ONE write, every reader
  // — steps, coworkers, find_file — sees it); the rail only narrates what happened.
  const attach = async (f: File) => {
    if (busy) return;
    addTurn({ role: 'user', text: `Attached: ${f.name}` });
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f); fd.append('kind', kind); fd.append('id', id);
      const res = await fetch('/api/items/ingest', { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) addTurn({ role: 'system', text: d.error || "I couldn't read that file." });
      else setTurns((prev) => [...prev, {
        role: 'system',
        text: d.satisfiedStep
          ? `Got it — that covers "${d.satisfiedStep}". It's folded into this work now.`
          : `Got it — I've folded ${d.filename} into this work. Anything running here can read it now.`,
      }]);
    } catch {
      addTurn({ role: 'system', text: "I couldn't read that file." });
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden min-h-0">
      {/* Header — the shared chat-sidebar idiom: h-10, panel icon + title. "Clear" wipes the
          room's TURNS only (narration, not memory) — the reset the wrong-grouping flow needs. */}
      <div className="h-10 flex items-center gap-2 px-3 border-b border-neutral-100 flex-shrink-0">
        <ChatBubbleLeftRightIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
        <span className="text-[12px] font-semibold text-neutral-700 truncate">{inRoom ? 'Chat' : ent ? ent.name : 'About this'}</span>
        {turns.length > 0 && (
          <button
            onClick={() => {
              _dealTurns.set(roomKey, []);
              setTurnsRaw([]);
              fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}`, { method: 'DELETE' }).catch(() => {});
            }}
            className="ml-auto text-[11px] font-medium text-neutral-300 hover:text-neutral-500 transition-colors"
            title="Clear this conversation (the brain's memory is untouched)"
          >Clear</button>
        )}
      </div>

      {/* Messages — narration first, then the conversation. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-4 min-h-0">
        {/* Opening — THIS item first (who · verb-first ask · what's already prepared), assembled
            deterministically from the anchor (grounded-or-absent per part); then the deal's judged
            state as ONE line. Who-owes folds to a single line, and disappears entirely when the
            next-move below already carries the actionable. */}
        {inRoom && turns.length === 0 && (
          <AssistantRow>
            <p className="text-[12.5px] text-neutral-500">This is the room for {ent?.name ?? 'this work'} — ask anything, correct me, or hand work off. I hold everything on it.</p>
          </AssistantRow>
        )}
        {!inRoom && <AssistantRow>
          {(() => {
            const a = view.anchor;
            const who = a?.who ? a.who.replace(/<[^>]*>/g, '').trim().split(/\s+/)[0] : null;
            const ask = a?.ask ? a.ask.charAt(0).toLowerCase() + a.ask.slice(1).replace(/\.+$/, '') : null;
            const prep = a?.prepared ? (a.prepared === 'draft' ? 'I drafted a reply below' : `${a.prepared.split(' ')[0]} drafted a reply below`) : null;
            if (who && ask) return <p>{who} is asking you to {ask}{prep ? ` — ${prep.charAt(0).toLowerCase() + prep.slice(1)}` : ''}.</p>;
            if (ask) return <p>This needs you to {ask}{prep ? ` — ${prep.charAt(0).toLowerCase() + prep.slice(1)}` : ''}.</p>;
            if (prep) return <p>{prep}.</p>;
            return null;
          })()}
          {ent?.summary
            ? <p className={view.anchor?.ask || view.anchor?.prepared ? 'text-[12px] text-neutral-500' : undefined}>{ent.summary}</p>
            : (!view.anchor?.ask && <p>This isn&apos;t tied to a bigger body of work yet — I&apos;ll keep it standalone.</p>)}
          {!ent?.nextMove && ent?.whoOwesThem[0] && <p className="text-[12px] text-neutral-500">They owe: {ent.whoOwesThem[0]}</p>}
          {!ent?.nextMove && ent?.whoOwesYou[0] && <p className="text-[12px] text-neutral-500">You owe: {ent.whoOwesYou[0]}</p>}
        </AssistantRow>}

        {/* R3 — the ROOM INDEX + founding moved to THE CONTEXT STRIP on the stage
            (components/room/context-strip.tsx): the conversation stays narrative (events,
            proposals, chat); navigation/inventory is spatial, never repeated here. */}

        {/* The gap — one plain ask, same channel (never a step list). */}
        {view.gap && (
          <AssistantRow>
            <p className="text-amber-800/90">{view.gap}</p>
          </AssistantRow>
        )}

        {/* The next move + a matching coworker as a PERSON (avatar + one-tap hand-off).
            Mechanical dedup (J2 rail cleanup): when the deal's next move IS this item's ask (the
            opening line already said it), the echo is noise — skip the line, keep the hand-off. */}
        {!inRoom && ent?.nextMove && !echoesAnchor(ent.nextMove, view.anchor?.ask ?? null) && (
          <AssistantRow>
            <p>Next: {ent.nextMove}</p>
            {suggested && (
              <button
                onClick={() => send(`Have ${suggested.name.split(' ')[0]} ${ent.nextMove}`)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50/50 pl-1 pr-2.5 py-0.5 text-[11.5px] font-medium text-indigo-700 hover:bg-indigo-50 transition-colors"
              >
                {suggested.role && ROLE_AVATARS[suggested.role] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ROLE_AVATARS[suggested.role]} alt="" className="w-[18px] h-[18px] rounded-full" />
                ) : <Initials name={suggested.name} />}
                {suggested.name.split(' ')[0]} can take this →
              </button>
            )}
          </AssistantRow>
        )}

        {/* One-room R2 — INLINE COMPONENTS in the stream (the registry's surface:'inline' class).
            The judged DECISION renders as a conversation card (numbered routes, decline last). */}
        {decision && decision.options.length >= 2 && (
          <AssistantRow>
            <DecisionCard
              title={decision.title}
              options={decision.options}
              onChoose={decision.onChoose}
              onDismissCard={decision.onDismiss}
            />
          </AssistantRow>
        )}

        {/* The ARTIFACT CARD — the staged workspace's inline handle: what's ready, who made it,
            open to edit, or commit right here (same gate, same executor as the stage). */}
        {artifact && (
          <AssistantRow>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-2.5 flex items-center gap-2.5">
              <span className="min-w-0 flex-1 text-[12.5px] text-neutral-800">
                <span className="font-medium">{artifact.label}</span>
                {artifact.by && <span className="text-[11px] text-indigo-500 font-semibold ml-1.5">by {artifact.by.split(' ')[0]}</span>}
              </span>
              <button
                onClick={artifact.onOpen}
                className="flex-shrink-0 text-[12px] font-medium text-neutral-600 hover:text-indigo-600 transition-colors"
              >Open</button>
              {artifact.onCommit && (
                <button
                  onClick={() => artifact.onCommit?.()}
                  disabled={!!artifact.committing}
                  className="flex-shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-1 text-[12px] font-medium text-white transition-colors disabled:opacity-60"
                >{artifact.committing ? 'Sending…' : (artifact.commitLabel ?? 'Send')}</button>
              )}
            </div>
          </AssistantRow>
        )}

        {/* The conversation — user bubbles + assistant replies, the shared idiom. */}
        {turns.map((t, i) => t.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[80%] px-3 py-2 bg-neutral-100 rounded-2xl rounded-br-sm text-[13px] text-neutral-800 leading-relaxed">{t.text}</div>
          </div>
        ) : (
          <AssistantRow key={i}>
            {/* R1 — coworker attribution: the group-channel model, turns carry WHO. Absent = the
                chief of staff (the anchor voice stays unlabeled). */}
            {t.author?.name && (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600">
                {t.author.role && ROLE_AVATARS[t.author.role] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ROLE_AVATARS[t.author.role]} alt="" className="w-[16px] h-[16px] rounded-full" />
                ) : <Initials name={t.author.name} />}
                {t.author.name.split(' ')[0]}
              </span>
            )}
            <p className="whitespace-pre-wrap">{t.text}</p>
            {/* O5: the commit line is a DECISION, not buttons. ≥2 routes → the numbered options
                idiom (the brain's judged route first, "Leave it with me" always last); a single
                offer stays one calm chip. */}
            {t.actions && t.actions.length >= 2 && (
              <div className="rounded-xl border border-neutral-200 overflow-hidden">
                {t.actions.map((a, j) => (
                  <button
                    key={j} onClick={() => runAction(a)} disabled={busy}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-[12.5px] text-neutral-700 hover:bg-indigo-50/60 transition-colors disabled:opacity-50 border-b border-neutral-100"
                  >
                    <span className="flex-shrink-0 w-5 h-5 rounded-md bg-neutral-100 text-neutral-500 text-[11px] font-semibold flex items-center justify-center">{j + 1}</span>
                    <span className={j === 0 ? 'font-medium text-neutral-800' : ''}>{a.label}</span>
                  </button>
                ))}
                <button
                  onClick={() => setTurns((prev) => prev.map((x) => x === t ? { ...x, actions: undefined } : x))} disabled={busy}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-[12.5px] text-neutral-400 hover:bg-neutral-50 transition-colors"
                >
                  <span className="flex-shrink-0 w-5 h-5 rounded-md bg-neutral-100 text-neutral-400 text-[11px] font-semibold flex items-center justify-center">{t.actions.length + 1}</span>
                  Leave it with me
                </button>
              </div>
            )}
            {t.actions && t.actions.length === 1 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => runAction(t.actions![0])} disabled={busy}
                  className="rounded-full border border-indigo-200 bg-indigo-50/50 px-2.5 py-1 text-[11.5px] font-medium text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                >{t.actions[0].label}</button>
              </div>
            )}
            {t.refs && t.refs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.refs.map((r, j) => (
                  <Chip key={j} label={r.label} onClick={r.href ? () => router.push(r.href!) : undefined} />
                ))}
              </div>
            )}
            {t.files && t.files.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.files.map((f, j) => (
                  <Chip key={j} icon={<DocumentIcon className="w-3 h-3 flex-shrink-0" />} label={f.filename} />
                ))}
              </div>
            )}
          </AssistantRow>
        ))}
        {busy && <AssistantRow><TypingDots /></AssistantRow>}
      </div>

      {/* Composer — the shared idiom: rounded-2xl box, auto-growing textarea, round send button. */}
      <div className="flex-shrink-0 px-3 pb-3 pt-2">
        <div className="flex items-end gap-2 rounded-2xl border border-neutral-200 bg-white shadow-sm px-3 py-2">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask, correct, or hand off…"
            rows={1}
            disabled={busy}
            className="flex-1 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none min-w-0 disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
            style={{ maxHeight: '120px', overflowY: 'auto' }}
          />
          <input ref={fileRef} type="file" className="hidden"
            accept=".pdf,.docx,.txt,.csv,.xlsx,.pptx"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 transition-colors mb-px"
            title="Attach a file"
          >
            <PaperClipIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => send()}
            disabled={busy || !text.trim()}
            className="flex-shrink-0 w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center disabled:opacity-40 transition-opacity mb-px"
            title="Send"
          >
            <PaperAirplaneIcon className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
