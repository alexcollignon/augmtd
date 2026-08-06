'use client';

import Link from 'next/link';

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
import { DocumentIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { WorkerMentionInput } from '@/components/workers/worker-mention-input';
import { ROLE_AVATARS } from '@/lib/workers/roles';
import { DecisionCard } from '@/components/work/decision-card';

// 'entity' = the PROJECT DOOR (P7c-c2): the same rail inside the project room — id is the entity
// id, steer/ingest run in entity scope, the Overview chip hides (you're already there).
type RailKind = 'email' | 'followup' | 'commitment' | 'meeting' | 'awareness' | 'entity';

export type RailView = {
  // The open item — what the rail's opening message narrates FIRST (P5b: item-anchored, never generic).
  anchor?: { who: string | null; ask: string | null; prepared: string | null } | null;
  /** THE ONE RESPONDER for a LOOSE room (no entity) — composed server-side; the anchor stitch
   *  is only the fallback until the first compose lands. Linked rooms carry it on entity.*. */
  brief?: string | null;
  move?: { label: string; ref: string | null } | null;
  offers?: Array<{ label: string; say: string }>;
  gap: string | null;
  entity: {
    id: string; name: string;
    tracked?: boolean; // T4 — accepted (project) vs merely recognized (quiet context)
    summary: string | null; momentum: string | null; nextMove: string | null; nextMoveHref?: string | null;
    whoOwesYou: string[]; whoOwesThem: string[];
    suggestedWorker?: { id: string; name: string; role: string } | null;
    /** THE ONE RESPONDER — the room's whole opening from one reasoned pass over the one grounding
     *  (served last-good; null until first compose → the stitched fields fall back). */
    brief?: string | null;
    move?: { label: string; ref: string | null } | null;
    offers?: Array<{ label: string; say: string }>;
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
  | { act: 'say'; text: string }
  | { act: 'adopt'; targetId: string; sourceId: string }
  /** THE EXCHANGE (Aug 4): a direction pick — lands as the USER'S turn, redrafts through the one
   *  steer path with its own item scope (works from the project room's rail too). */
  | { act: 'direction'; instruction: string; itemKind: 'email' | 'followup'; itemId: string });

type Turn =
  | { role: 'user'; text: string }
  | { role: 'system'; text: string; key?: string; actions?: TurnAction[]; refs?: Array<{ label: string; href: string | null }>; files?: Array<{ id: string; filename: string; source: string }>; author?: { name: string; role?: string | null };
      /** FIX 3 — a coworker's ASK renders as an inline checklist (input_checklist component): the
       *  concrete things they need from the principal. Rows wire to the 📎 ingest funnel. */
      checklist?: string[];
      /** W3 — the durable turn's id (the ask-lifecycle actions key on it) + the proceeded stamp
       *  (the user already said "go ahead" — the button hides, the checklist stays as record). */
      turnId?: string; proceeded?: boolean;
      /** UX arc — the turn's dedupe key: the structural handle folding rules key on (a `prep:*`
       *  narration collapses into the artifact card it narrates; never content-matching). */
      dkey?: string;
      /** THE SPEC CARD (Arc 2): a proposed standing task awaiting the user's explicit confirm —
       *  the card IS the commit surface (saying prepared it; confirming creates it). */
      standingSpec?: { name: string; deliverable: string; cadenceLabel: string; ownerName: string; firstRun?: string | null; status: string; workflowId?: string | null } };

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
export function pushDealTurn(entityId: string, text: string, opts?: { key?: string; actions?: TurnAction[]; role?: 'user' | 'system';
  /** THE EXCHANGE (Aug 4): interaction scaffolding (an offer awaiting a pick, a "drafting…" ack)
   *  renders live but never persists — the durable story is the PICK and the RESULT, not the
   *  furniture around them (a reloaded offer with dead buttons is noise, not history). */
  ephemeral?: boolean }): void {
  const turns = _dealTurns.get(entityId) ?? [];
  const kept = opts?.key ? turns.filter((t) => t.role !== 'system' || t.key !== opts.key) : turns;
  const turn: Turn = opts?.role === 'user'
    ? { role: 'user', text }
    : { role: 'system', text, key: opts?.key, actions: opts?.actions };
  _dealTurns.set(entityId, [...kept, turn]);
  if (!opts?.ephemeral) persistTurn(entityId, turn);
  try { window.dispatchEvent(new CustomEvent('aug:deal-turn', { detail: { entityId } })); } catch { /* SSR-safe */ }
}

/** Drop a keyed live turn (an ephemeral offer/ack whose moment has passed). */
export function dropDealTurn(entityId: string, key: string): void {
  const turns = _dealTurns.get(entityId) ?? [];
  _dealTurns.set(entityId, turns.filter((t) => t.role !== 'system' || t.key !== key));
  try { window.dispatchEvent(new CustomEvent('aug:deal-turn', { detail: { entityId } })); } catch { /* SSR-safe */ }
}

// The hand-off chip's coworker comes SERVED on the view (entity.suggestedWorker — the ONE routing
// brain, lib/prepare/route-suggestion.ts). The old client-side keyword match is deleted (W2).



// A sender's SPOKEN name: first-name a person, keep an ORGANIZATION whole ("M Condomínios Lda"
// must never become "M" — found live, Aug 3). Structural: legal-form/functional tokens mark an
// org; a person is 2–4 plain word tokens.
const ORG_TOKEN = /^(lda|ltda|ltd|llc|gmbh|inc|s\.?a\.?u?|corp|plc|srl|sl|bv|ag|oy|ab|as|kk|co|group|holdings?|team|support|service|services|billing|noreply|no-reply|info|admin|office|geral|contact|hello|hq)[.,]?$/i;
function spokenName(raw: string): string {
  const name = raw.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  if (!name) return name;
  const toks = name.split(/\s+/);
  const looksOrg = toks.some((t) => ORG_TOKEN.test(t)) || /@/.test(name) || toks.length === 1 && name === name.toUpperCase();
  return looksOrg ? name : toks[0];
}

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

export function ItemRail({ kind, id, view, pending = false, onDraft, decision, artifacts, onOpenHref, onStage }: {
  kind: RailKind; id: string; view: RailView;
  /** THE STRUCTURAL FRAME (UX arc): true while the view is still loading — the rail mounts its
   *  shell (header, turns, composer) immediately and shows a quiet shimmer instead of anchor
   *  claims; it must never assert anything (like "isn't tied to a project") it can't know yet. */
  pending?: boolean;
  onDraft?: (draft: string) => void;
  /** One-room R2 — the judged DECISION mounts INLINE in the stream (surface:'inline' per the
   *  registry). The caller wires onChoose through steer; "Leave it with me" clears. */
  decision?: { title: string | null; options: Array<{ label: string }>; onChoose: (label: string) => void | Promise<void>; onDismiss: () => void } | null;
  /** One-room R2 → the PREPARED-ACTION GRAMMAR (Aug 4): EVERY prepared thing — reply draft,
   *  calendar invite, forward — is an ARTIFACT CARD in the conversation that summons its own
   *  stage (onOpen). The words and the deed are ONE element (law 8).
   *  A COMPONENT IS A TURN: `anchorKey` (a turn dedupe-key, e.g. `prep:<itemId>`) seats the card
   *  at its CHRONOLOGICAL moment in the stream — the engine's narration turn BECOMES the card.
   *  A card whose anchor turn isn't visible appends at the stream's end (never pinned, never
   *  floating above later conversation — the invite must not trail questions asked after it). */
  artifacts?: Array<{ key: string; label: string; by?: string | null; onOpen: () => void; anchorKey?: string }> | null;
  /** THE ONE-NAVIGATION LAW (Aug 4): inside a room, a rail link must open IN the room (the host's
   *  focus/summoned-stage opener), never page-navigate away — clicking Clara's draft from the EG
   *  Bank room dumped the user on a separate item page. Return true = handled; false = fall
   *  through to normal navigation (non-item hrefs). */
  onOpenHref?: (href: string) => boolean;
  /** THE PARITY LAW (Aug 4): a chat verb whose review lives on a stage ("forward this to Rita")
   *  summons it through the host. Absent → the rail falls back to navigation. */
  onStage?: (stage: 'forward' | 'invite' | 'reply', itemId: string) => boolean;
}) {
  const router = useRouter();
  const ent = view.entity;
  const sib = view.siblings;
  const inRoom = kind === 'entity';
  // ONE-NAVIGATION LAW: every rail link goes through here — the host's in-room opener first
  // (focus/summoned stage), page navigation only when unhandled.
  const go = (href: string) => { if (onOpenHref?.(href)) return; router.push(href); };
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
        const server: Turn[] = (d.turns as Array<{ id?: string; key?: string; role: 'user' | 'system'; text: string; refs?: Array<{ label: string; href: string | null }>; author?: { name: string; role?: string | null } | null; component?: { key?: string; state?: { targetId?: string; options?: Array<{ label: string; sourceId: string }>; items?: string[]; proceeded?: boolean } } | null }>)
          .map((t) => {
            const turn: Turn = { role: t.role, text: t.text, refs: t.refs ?? undefined, author: t.author ?? undefined } as Turn;
            if (turn.role === 'system' && t.key) turn.dkey = t.key;
            // Durable inline components: the founding proposal's options re-render as actions on
            // every load until taken (the adopt endpoint updates/deletes the stored turn).
            if (turn.role === 'system' && t.component?.key === 'founding_proposal' && t.component.state?.targetId) {
              const tid = t.component.state.targetId;
              turn.actions = (t.component.state.options ?? []).map((o) => ({ label: o.label, act: 'adopt' as const, targetId: tid, sourceId: o.sourceId }));
              turn.key = 'founding-proposal';
            }
            // FIX 3 — a coworker's ASK: the input checklist re-renders on every load until an
            // ingest clears it (the ingest route strips the component; the text stays as history).
            if (turn.role === 'system' && t.component?.key === 'input_checklist' && Array.isArray(t.component.state?.items)) {
              turn.checklist = t.component.state.items.map((m) => String(m)).filter(Boolean);
              turn.turnId = t.id;
              turn.proceeded = !!t.component.state?.proceeded;
            }
            // THE SPEC CARD (Arc 2): the durable proposal re-renders until confirmed (the confirm
            // route flips the stored component in place; the card then reads as the record).
            if (turn.role === 'system' && t.component?.key === 'standing_spec' && t.component.state) {
              const st = t.component.state as unknown as { name?: string; deliverable?: string; cadenceLabel?: string; ownerName?: string; firstRun?: string | null; status?: string; workflowId?: string | null };
              if (st.name) {
                turn.standingSpec = { name: String(st.name), deliverable: String(st.deliverable ?? ''), cadenceLabel: String(st.cadenceLabel ?? ''), ownerName: String(st.ownerName ?? 'a coworker'), firstRun: st.firstRun ?? null, status: String(st.status ?? 'pending'), workflowId: st.workflowId ?? null };
                turn.turnId = t.id;
              }
            }
            return turn;
          });
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
  const [showEarlier, setShowEarlier] = useState(false); // history folds — the room reads ONE thing
  const [busy, setBusy] = useState(false);
  // History (Claude-style): archived sessions of THIS room; viewing one is read-only.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<Array<{ at: string; count: number; firstText: string }> | null>(null);
  const [viewingSession, setViewingSession] = useState<{ at: string; turns: Turn[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [turns, busy]);

  // (The hand-off affordance now arrives as one of the responder's OFFERS — the routing brain's
  // suggestion rides the grounding; no dedicated chip.)

  // R1 — every conversational write goes through here: render + durable persist in one motion.
  const addTurn = (t: Turn) => { setTurns((prev) => [...prev, t]); persistTurn(roomKey, t); };

  // W3: a narration turn's tappable offer. 'prepare' fires THE ONE preparation engine (the grounded
  // result is narrated; 'aug:prepared' tells the room to refresh its board); 'say' rides the one
  // conversation core (hand-offs go through the existing steer path).
  const runAction = async (a: TurnAction) => {
    if (busy) return;
    if (a.act === 'say') { await send(a.text); return; }
    // THE EXCHANGE (Aug 4) — a direction pick: the pick lands as the USER'S OWN turn, the offer's
    // options collapse (decided), a quiet ack shows while the one steer path redrafts, and the
    // result lands as the response turn. Human rhythm: offer → pick → "on it" → done.
    if (a.act === 'direction') {
      addTurn({ role: 'user', text: a.label });
      setTurns((prev) => prev.map((t) => (t.role === 'system' && t.key?.startsWith('reply-offer:') ? { ...t, actions: undefined } : t)));
      pushDealTurn(roomKey, 'Got it — drafting.', { key: `reply-ack:${a.itemId}`, ephemeral: true });
      setBusy(true);
      try {
        const res = await fetch('/api/items/steer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: a.itemKind, id: a.itemId, text: `Redraft the reply to take this direction: ${a.instruction}` }),
        });
        const d = await res.json().catch(() => ({}));
        dropDealTurn(roomKey, `reply-ack:${a.itemId}`);
        if (res.ok && d.draft && onDraft) onDraft(d.draft);
        addTurn({ role: 'system', text: res.ok
          ? String(d.say || 'Done — the updated draft is on the card; open it to review and send.')
          : "I couldn't redraft just now — tell me the direction in your own words and I'll take it." });
      } catch {
        dropDealTurn(roomKey, `reply-ack:${a.itemId}`);
        addTurn({ role: 'system', text: "I couldn't redraft just now — tell me the direction in your own words and I'll take it." });
      } finally { setBusy(false); }
      return;
    }
    if (a.act === 'adopt') {
      setBusy(true);
      try {
        const res = await fetch('/api/entities/adopt', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetId: a.targetId, sourceId: a.sourceId }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) setTurns((prev) => [...prev, { role: 'system', text: d.error || "I couldn't bring that in just now." }]);
        else {
          // The server rewrote the durable proposal + narrated the result — re-read the room.
          const r = await fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
          if (Array.isArray(r?.turns)) { /* the hydrate effect path re-maps on next event; do it inline */ }
          try { window.dispatchEvent(new CustomEvent('aug:prepared', { detail: {} })); } catch { /* SSR-safe */ }
          try { window.dispatchEvent(new CustomEvent('aug:deal-turn', { detail: { entityId: roomKey } })); } catch { /* SSR-safe */ }
          setTurns((prev) => prev.map((t) => (t.role === 'system' && t.key === 'founding-proposal'
            ? { ...t, actions: t.actions?.filter((x) => !(x.act === 'adopt' && x.sourceId === a.sourceId)) }
            : t)));
          setTurns((prev) => [...prev, { role: 'system', text: `Brought it in — ${d.total ?? ''} items now on ${d.keptName ?? 'this project'}.` }]);
        }
      } catch {
        setTurns((prev) => [...prev, { role: 'system', text: "I couldn't bring that in just now." }]);
      } finally { setBusy(false); }
      return;
    }
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

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
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
        // THE PARITY LAW (Aug 4): a chat-approved SEND fires the one existing send door from the
        // client (route + exactly-once hash + outcome log — never a second send path), and a
        // stage verb summons its stage. The outcome lands as a visible turn either way.
        if (d.commit?.kind === 'send_reply' && d.commit.itemId && d.commit.body) {
          addTurn({ role: 'system', text: String(d.say || 'Sending it now…') });
          const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const html = String(d.commit.body).replace(/\r\n/g, '\n').split(/\n{2,}/)
            .map((p: string) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
          try {
            const sres = await fetch(`/api/inbox/${d.commit.itemId}/send-reply`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ customMessage: html, aiDraft: d.commit.body }),
            });
            addTurn({ role: 'system', text: sres.ok ? 'Sent — on its way.' : "Couldn't send — open the draft and send from there." });
            if (sres.ok) { try { window.dispatchEvent(new CustomEvent('aug:prepared', { detail: {} })); } catch { /* SSR-safe */ } }
          } catch { addTurn({ role: 'system', text: "Couldn't send — open the draft and send from there." }); }
          setBusy(false); return;
        }
        if (d.openStage?.stage && d.openStage.itemId) {
          const handled = onStage?.(d.openStage.stage, d.openStage.itemId);
          if (!handled) go(`/item/${d.openStage.itemId}?kind=email`); // the stage lives on the item view
        }
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
      {/* Header — the shared chat-sidebar idiom. HISTORY ⌄ lists archived sessions ("Clear" =
          archive, a session boundary — never a deletion; the brain's memory is untouched). */}
      <div className="h-10 flex items-center gap-2 px-3 border-b border-neutral-100 flex-shrink-0">
        <ChatBubbleLeftRightIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
        {/* The room title IS the project door (the word is the deed — law 8): a deep-dive on a
            project-member item reaches its room through the name, never a separate chip. */}
        {!inRoom && ent && ent.tracked !== false ? (
          <Link href={`/home?view=projects&entity=${ent.id}`}
            className="text-[12px] font-semibold text-neutral-700 truncate hover:text-indigo-600 transition-colors">{ent.name}</Link>
        ) : (
          <span className="text-[12px] font-semibold text-neutral-700 truncate">{inRoom ? 'Chat' : ent ? ent.name : 'About this'}</span>
        )}
        <div className="ml-auto flex items-center gap-2.5 relative">
          <button
            onClick={async () => {
              if (historyOpen) { setHistoryOpen(false); return; }
              setHistoryOpen(true);
              try {
                const d = await fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}&sessions=1`).then((r) => (r.ok ? r.json() : null));
                setSessions(Array.isArray(d?.sessions) ? d.sessions : []);
              } catch { setSessions([]); }
            }}
            className="text-[11px] font-medium text-neutral-300 hover:text-neutral-500 transition-colors"
            title="Past conversations on this work"
          >History</button>
          {turns.length > 0 && !viewingSession && (
            <button
              onClick={() => {
                _dealTurns.set(roomKey, []);
                setTurnsRaw([]);
                fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}`, { method: 'DELETE' }).catch(() => {});
              }}
              className="text-[11px] font-medium text-neutral-300 hover:text-neutral-500 transition-colors"
              title="Archive this conversation (find it again under History; the brain's memory is untouched)"
            >Clear</button>
          )}
          {historyOpen && (
            <div className="absolute top-6 right-0 z-30 w-60 max-h-64 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg p-1">
              {sessions === null ? (
                <p className="px-2 py-1.5 text-[12px] text-neutral-400">Loading…</p>
              ) : sessions.length === 0 ? (
                <p className="px-2 py-1.5 text-[12px] text-neutral-400">No past conversations yet.</p>
              ) : sessions.map((sn) => (
                <button
                  key={sn.at}
                  onClick={async () => {
                    setHistoryOpen(false);
                    try {
                      const d = await fetch(`/api/room/turns?key=${encodeURIComponent(roomKey)}&session=${encodeURIComponent(sn.at)}`).then((r) => (r.ok ? r.json() : null));
                      if (Array.isArray(d?.turns)) {
                        setViewingSession({
                          at: sn.at,
                          turns: (d.turns as Array<{ role: 'user' | 'system'; text: string; refs?: Array<{ label: string; href: string | null }>; author?: { name: string; role?: string | null } | null }>)
                            .map((t) => ({ role: t.role, text: t.text, refs: t.refs ?? undefined, author: t.author ?? undefined } as Turn)),
                        });
                      }
                    } catch { /* non-fatal */ }
                  }}
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-indigo-50 transition-colors"
                >
                  <span className="block text-[12px] font-medium text-neutral-700">
                    {new Date(sn.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {sn.count} message{sn.count === 1 ? '' : 's'}
                  </span>
                  <span className="block text-[11px] text-neutral-400 truncate">{sn.firstText}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Viewing a past session — read-only banner; the live conversation is one tap back. */}
      {viewingSession && (
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-amber-50/60 border-b border-amber-100">
          <span className="text-[11.5px] text-amber-800/90 min-w-0 truncate">
            Past conversation · {new Date(viewingSession.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
          <button onClick={() => setViewingSession(null)} className="ml-auto text-[11.5px] font-medium text-amber-700 hover:text-amber-900">Back to current</button>
        </div>
      )}

      {/* Messages — narration first, then the conversation. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-4 min-h-0">
        {/* Opening — THIS item first (who · verb-first ask · what's already prepared), assembled
            deterministically from the anchor (grounded-or-absent per part); then the deal's judged
            state as ONE line. Who-owes folds to a single line, and disappears entirely when the
            next-move below already carries the actionable. */}
        {/* THE LIVING BRIEF, in-room (experience-spec seat: the left panel IS the working
            conversation — it never opens mute). Position + debts, derived fresh from the entity
            state each entry; the next move + hand-off follow below (moved here FROM the right
            pane — one fact, one home). */}
        {!viewingSession && inRoom && (
          <AssistantRow>
            {/* THE ONE-VOICE BRIEF (Aug 3): when the composer has spoken, the paragraph IS the
                opening — one colleague voice carrying position, delta, consequence and the ask in
                one place. The stitched fields (summary + debt lines) are ONLY the fallback until
                the first compose lands. */}
            {ent?.brief
              ? <p className="font-voice text-[14.5px] leading-[1.65] text-neutral-800">{ent.brief}</p>
              : ent?.summary
                ? <p>{ent.summary}</p>
                : turns.length === 0
                  ? <p className="text-[12.5px] text-neutral-500">This is the room for {ent?.name ?? 'this work'} — ask anything, correct me, or hand work off. I hold everything on it.</p>
                  : null}
            {/* One fact once: the debt line only speaks when it says something the next move
                doesn't already say — and never beside the composed brief (it carries the debts). */}
            {!ent?.brief && ent?.whoOwesYou[0] && !(ent.nextMove && echoesAnchor(ent.nextMove, ent.whoOwesYou[0])) && (
              <p className="text-[12.5px] text-neutral-500">You owe: {ent.whoOwesYou[0]}</p>
            )}
            {!ent?.brief && !ent?.nextMove && ent?.whoOwesThem[0] && <p className="text-[12.5px] text-neutral-500">They owe: {ent.whoOwesThem[0]}</p>}
          </AssistantRow>
        )}
        {!viewingSession && !inRoom && <AssistantRow>
          {/* THE ONE-VOICE BRIEF on the deep-dive door too (Aug 3): when composed (entity room's
              or the loose room's own), the paragraph IS the opening — the anchor stitch below is
              only the fallback until the first compose lands. */}
          {/* THE VOICE (Arc 3 design language): the room's authored opening is the TEAM speaking —
              serif, a touch larger; chrome stays sans. */}
          {(ent?.brief || view.brief) ? <p className="font-voice text-[14.5px] leading-[1.65] text-neutral-800">{ent?.brief ?? view.brief}</p> : (() => {
            const a = view.anchor;
            const who = a?.who ? spokenName(a.who) : null;
            const ask = a?.ask ? a.ask.charAt(0).toLowerCase() + a.ask.slice(1).replace(/\.+$/, '') : null;
            const prep = a?.prepared ? (a.prepared === 'draft' ? 'I drafted a reply below' : `${a.prepared.split(' ')[0]} drafted a reply below`) : null;
            // Never lowercase the drafter — "I"/a name stays capital mid-sentence ("— I drafted…").
            if (who && ask) return <p>{who} is asking you to {ask}{prep ? ` — ${prep}` : ''}.</p>;
            if (ask) return <p>This needs you to {ask}{prep ? ` — ${prep}` : ''}.</p>;
            if (prep) return <p>{prep}.</p>;
            return null;
          })()}
          {pending && !ent && !view.anchor?.ask && !view.brief && (
            // The frame is up before the view — a quiet shimmer, never a claim we can't back yet.
            <div className="space-y-1.5 py-0.5" aria-hidden>
              <div className="h-3 w-4/5 rounded bg-neutral-100 animate-pulse" />
              <div className="h-3 w-3/5 rounded bg-neutral-100 animate-pulse" />
            </div>
          )}
          {!ent?.brief && !view.brief && (ent?.summary
            ? <p className={view.anchor?.ask || view.anchor?.prepared ? 'text-[12.5px] text-neutral-500' : undefined}>{ent.summary}</p>
            : (!view.anchor?.ask && !pending && <p>This isn&apos;t tied to a bigger body of work yet — I&apos;ll keep it standalone.</p>))}
          {!ent?.brief && !view.brief && !ent?.nextMove && ent?.whoOwesThem[0] && <p className="text-[12.5px] text-neutral-500">They owe: {ent.whoOwesThem[0]}</p>}
          {!ent?.brief && !view.brief && !ent?.nextMove && ent?.whoOwesYou[0] && <p className="text-[12.5px] text-neutral-500">You owe: {ent.whoOwesYou[0]}</p>}
        </AssistantRow>}

        {/* R3 — the ROOM INDEX + founding moved to THE CONTEXT STRIP on the stage
            (components/room/context-strip.tsx): the conversation stays narrative (events,
            proposals, chat); navigation/inventory is spatial, never repeated here. */}

        {/* The gap — one plain ask, same channel (never a step list). */}
        {!viewingSession && view.gap && (
          <AssistantRow>
            <p className="text-amber-800/90">{view.gap}</p>
          </AssistantRow>
        )}

        {/* THE LIVING BRIEF's ASK (experience-spec laws 1+7): the ENGINE's live ask is part of the
            room's standing position — lifted OUT of the history stream into the opening block,
            with the ONE CTA row (Attach · Go ahead). It dies with its work (law 3 settles the
            component server-side) — never a second copy below. Coworker asks stay in the stream:
            they are a person's speech, not the room's position. */}
        {!viewingSession && (() => {
          const ask = turns.find((t): t is Extract<Turn, { role: 'system' }> => t.role === 'system' && !t.author?.name && !!t.checklist?.length && !!t.turnId);
          if (!ask) return null;
          return (
            <AssistantRow>
              <p className="whitespace-pre-wrap">{ask.text}</p>
              <div className="mt-1.5 space-y-1">
                {ask.checklist!.map((m, j) => (
                  <div key={j} className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50/40 px-2.5 py-1.5">
                    <span className="flex-shrink-0 w-3.5 h-3.5 rounded-full border-[1.5px] border-amber-400/70" aria-hidden />
                    <span className="min-w-0 flex-1 text-[12px] text-neutral-800">{m}</span>
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={busy}
                      className="flex-shrink-0 text-[11.5px] font-medium text-amber-700 hover:text-amber-900 transition-colors disabled:opacity-50"
                    >Attach →</button>
                  </div>
                ))}
                {!ask.proceeded && (
                  <button
                    onClick={async () => {
                      const tid = ask.turnId!;
                      const res = await fetch('/api/room/asks', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ turnId: tid, action: 'proceed' }),
                      }).catch(() => null);
                      if (res?.ok) setTurns((prev) => prev.map((x) => (x.role === 'system' && x.turnId === tid ? { ...x, proceeded: true } : x)));
                    }}
                    disabled={busy}
                    className="mt-0.5 rounded-full border border-neutral-200 px-2.5 py-1 text-[11.5px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors disabled:opacity-50"
                  >Go ahead with what&apos;s available →</button>
                )}
              </div>
            </AssistantRow>
          );
        })()}

        {/* ═══ THE MOVE + THE OFFERS (Aug 5 — the one responder): ONE primary action card (the
            single most consequential next thing, board-validated) + ≤3 uniform offer chips, each
            of which literally SPEAKS through the composer (clicks are utterances). This replaced
            the "Next:" text link, the hand-off pill, and every "want me on it?" narration — one
            state, one recommended action, one affordance grammar. Falls back to the legacy
            next-move line only until the responder's first compose lands. ═══ */}
        {!viewingSession && (() => {
          const resp = ent?.brief || view.brief ? { move: ent?.move ?? view.move ?? null, offers: ent?.offers ?? view.offers ?? [] } : null;
          if (!resp) {
            // Pre-compose fallback: the legacy next-move line (plain, deed-only).
            if (!(ent?.nextMove && !echoesAnchor(ent.nextMove, view.anchor?.ask ?? null))) return null;
            const target = ent.nextMoveHref && !(!inRoom && ent.nextMoveHref.includes(`/item/${id}`)) ? ent.nextMoveHref : null;
            return (
              <AssistantRow>
                {target ? (
                  <button onClick={() => go(target)} className="text-left text-[13px] text-neutral-800 hover:text-indigo-700 transition-colors">
                    Next: <span className="underline decoration-neutral-200 underline-offset-2">{ent.nextMove}</span> →
                  </button>
                ) : <p>Next: {ent.nextMove}</p>}
              </AssistantRow>
            );
          }
          const refHref = (ref: string | null): string | null => {
            if (!ref) return null;
            const [k, i] = ref.split(':');
            return k === 'inbox' ? `/item/${i}` : k === 'commit' ? `/item/${i}?kind=commitment` : null;
          };
          const href = refHref(resp.move?.ref ?? null);
          const selfTarget = !inRoom && !!href && href.includes(`/item/${id}`);
          const moveClick = resp.move
            ? () => {
                if (selfTarget) { if (!onStage?.('reply', id)) { /* the stage host isn't mounted — nothing to do */ } return; }
                if (href) go(href);
              }
            : null;
          return (
            <>
              {resp.move && (
                <AssistantRow>
                  {(href || selfTarget) && moveClick ? (
                    <button onClick={moveClick}
                      className="w-full flex items-center gap-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-3.5 py-2.5 text-left transition-colors">
                      <span className="min-w-0 flex-1 text-[13px] font-medium text-white">{resp.move.label}</span>
                      <span className="flex-shrink-0 text-white/80" aria-hidden>→</span>
                    </button>
                  ) : (
                    <div className="w-full rounded-xl border border-indigo-200 bg-indigo-50/50 px-3.5 py-2.5">
                      <span className="text-[13px] font-medium text-indigo-800">{resp.move.label}</span>
                    </div>
                  )}
                </AssistantRow>
              )}
              {resp.offers.length > 0 && (
                <AssistantRow>
                  <div className="flex flex-wrap gap-1.5">
                    {resp.offers.map((o, j) => (
                      <button key={j} onClick={() => send(o.say)} disabled={busy}
                        className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-[12.5px] font-medium text-neutral-600 hover:border-indigo-300 hover:text-indigo-600 transition-colors disabled:opacity-50">
                        {o.label}
                      </button>
                    ))}
                  </div>
                </AssistantRow>
              )}
            </>
          );
        })()}

        {/* One-room R2 — INLINE COMPONENTS in the stream (the registry's surface:'inline' class).
            The judged DECISION renders as a conversation card (numbered routes, decline last). */}
        {!viewingSession && decision && decision.options.length >= 2 && (
          <AssistantRow>
            <DecisionCard
              title={decision.title}
              options={decision.options}
              onChoose={decision.onChoose}
              onDismissCard={decision.onDismiss}
            />
          </AssistantRow>
        )}

        {/* THE VERB-SCOPE LAW (Aug 4): item verbs live ON the stage, attached to their object —
            never floating in the conversation. The left panel is pure dialogue: brief →
            conversation → artifact cards → composer. */}

        {/* THE CONVERSATION — three grammars, derived STRUCTURALLY from each turn, never styled per
            call site (the UX-arc law):
              1. user           → bubble (right-aligned)
              2. system+author  → coworker bubble (avatar + name — the coworker's own FIRST-PERSON
                                  speech; the one-narrator law keeps narration out of this class)
              3. system, no author, no inline affordance → EVENT LINE: the narrator's muted
                                  one-liner ("Clara drafted…", "filed — undo from Activity") — the
                                  Slack/Linear grammar: status is visible but never shouts.
            Component turns (checklists, founding, decisions) keep their prominent renders — they
            are conversation events WITH affordances (P17). A `prep:*` narration FOLDS entirely
            when its artifact card is on the rail (one artifact, one live element — the card's
            byline carries the attribution). */}
        {(() => {
          const all = viewingSession?.turns ?? turns;
          // A COMPONENT IS A TURN (Aug 4): the artifact card renders AT its anchor turn's
          // chronological position; the shared card row keeps one markup for both seats.
          const cardRow = (art: NonNullable<typeof artifacts>[number]) => (
            <AssistantRow key={`card-${art.key}`}>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-2.5 flex items-center gap-2.5">
                <span className="min-w-0 flex-1 text-[12.5px] text-neutral-800">
                  <span className="font-medium">{art.label}</span>
                  {art.by && <span className="text-[11px] text-indigo-500 font-semibold ml-1.5">by {art.by.split(' ')[0]}</span>}
                </span>
                <button
                  onClick={art.onOpen}
                  className="flex-shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-1 text-[12px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
                >Open →</button>
              </div>
            </AssistantRow>
          );
          // The lifted engine ask lives in the brief above — never twice on screen (law 1).
          const liftedAsk = viewingSession ? null : turns.find((t): t is Extract<Turn, { role: 'system' }> => t.role === 'system' && !t.author?.name && !!t.checklist?.length && !!t.turnId);
          const stream = all.filter((t) => t !== liftedAsk);
          // A SETTLED ask's remnant ("To finish this I need…" with its checklist stripped) is
          // history, not news — it folds into "earlier" always, never the default read (law 6).
          const isDeadAsk = (t: Turn) => t.role === 'system' && !!t.dkey && /^(requires:|delegate:)/.test(t.dkey) && !t.checklist?.length;
          const fresh = stream.filter((t) => !isDeadAsk(t));
          // HISTORY FOLDS (law: the user reads ONE thing) — the newest 3 turns show; everything
          // older waits behind one "earlier" line. Sessions view stays complete (it IS history).
          const visible = viewingSession || showEarlier ? stream : fresh.slice(-3);
          const earlier = stream.length - visible.length;
          // A COMPONENT IS A TURN: cards whose anchor turn is VISIBLE seat there (the narration
          // becomes the card); the rest append at the stream's end (never above later conversation).
          const visibleDkeys = new Set(visible.map((t) => (t.role === 'system' ? t.dkey : undefined)).filter(Boolean) as string[]);
          const anchoredByKey = new Map<string, NonNullable<typeof artifacts>>();
          for (const a of (viewingSession ? [] : artifacts ?? [])) {
            if (a.anchorKey && visibleDkeys.has(a.anchorKey)) {
              anchoredByKey.set(a.anchorKey, [...(anchoredByKey.get(a.anchorKey) ?? []), a]);
            }
          }
          const endArtifacts = (viewingSession ? [] : artifacts ?? []).filter((a) => !(a.anchorKey && visibleDkeys.has(a.anchorKey)));
          return (
            <>
              {earlier > 0 && (
                <button onClick={() => setShowEarlier(true)}
                  className="flex items-center gap-1.5 pl-0.5 text-[11.5px] text-neutral-400 hover:text-neutral-600 transition-colors">
                  <span className="text-neutral-300" aria-hidden>·</span>earlier ({earlier}) ⌄
                </button>
              )}
              {visible.map((t, i) => t.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[80%] px-3 py-2 bg-neutral-100 rounded-2xl rounded-br-sm text-[13px] text-neutral-800 leading-relaxed">{t.text}</div>
          </div>
        ) : (t.role === 'system' && t.dkey && anchoredByKey.has(t.dkey)) ? (
          // The anchor turn IS the card — its moment in the story, its words folded into the label.
          <React.Fragment key={i}>{anchoredByKey.get(t.dkey)!.map(cardRow)}</React.Fragment>
        ) : ((artifacts?.length ?? 0) > 0 && t.dkey && /^(prep:|meeting-prep:)/.test(t.dkey)) ? null
        : (!t.author?.name && !t.checklist?.length && !t.actions?.length && t.key !== 'founding-proposal') ? (
          /* TWO TEXT CLASSES ONLY (Aug 4, user law — "different font colors and sizes are hard to
             read"): the brief speaks in ONE body style (13px neutral-800); everything secondary —
             events, refs, debts — whispers in ONE muted style (12.5px neutral-500). No third grey,
             no size ladder. */
          <div key={i} className="flex items-start gap-1.5 pl-0.5">
            <span className="flex-shrink-0 text-neutral-300 text-[12.5px] leading-[1.5]" aria-hidden>·</span>
            <p className="min-w-0 text-[12.5px] text-neutral-500 leading-snug">
              {t.text}
              {/* ONE ref, ONE word — the sentence already says what it's about; a wrapping
                  full-title link doubled the text (too many sizes, too much text). */}
              {t.refs?.filter((r) => inRoom || !r.href?.includes(`/item/${id}`)).slice(0, 1).map((r, j) => (
                r.href
                  ? <Link key={j} href={r.href} onClick={(e) => { if (onOpenHref?.(r.href!)) e.preventDefault(); }} className="ml-1.5 text-neutral-500 underline decoration-neutral-200 underline-offset-2 hover:text-indigo-500 transition-colors whitespace-nowrap">open →</Link>
                  : null
              ))}
            </p>
          </div>
        ) : (
          /* R1 — coworker attribution, DM-STYLE: a teammate's turn reads like a message from a
             person — avatar in its own left column, name header, then the content. The chief of
             staff (no author) stays the unlabeled anchor voice — WHO is parseable at a glance. */
          <div key={i} className={t.author?.name ? 'flex items-start gap-2.5' : undefined}>
            {t.author?.name && (
              t.author.role && ROLE_AVATARS[t.author.role] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ROLE_AVATARS[t.author.role]} alt="" className="w-[26px] h-[26px] rounded-full flex-shrink-0 mt-0.5" />
              ) : <span className="flex-shrink-0 mt-0.5 inline-flex items-center justify-center w-[26px] h-[26px] rounded-full bg-indigo-100 text-indigo-600 text-[11px] font-semibold">{(t.author.name.trim()[0] ?? '?').toUpperCase()}</span>
            )}
            <div className={t.author?.name ? 'min-w-0 flex-1' : 'min-w-0 w-full'}>
          <AssistantRow>
            {t.author?.name && (
              <span className="text-[11.5px] font-semibold text-indigo-600">{t.author.name.split(' ')[0]}</span>
            )}
            <p className="whitespace-pre-wrap">{t.text}</p>
            {/* FIX 3 — the coworker's ASK as an inline checklist: each row a concrete thing they
                need. Attach opens the one ingest funnel (the pool); answering in the composer is
                equally valid — the ask is a conversation event, never a "Prepared by" card. */}
            {t.checklist && t.checklist.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {t.checklist.map((m, j) => (
                  <div key={j} className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50/40 px-2.5 py-1.5">
                    <span className="flex-shrink-0 w-3.5 h-3.5 rounded-full border-[1.5px] border-amber-400/70" aria-hidden />
                    <span className="min-w-0 flex-1 text-[12px] text-neutral-800">{m}</span>
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={busy}
                      className="flex-shrink-0 text-[11.5px] font-medium text-amber-700 hover:text-amber-900 transition-colors disabled:opacity-50"
                    >Attach →</button>
                  </div>
                ))}
                {/* NEVER BLOCKING: an ask is a request, not a gate — one tap says proceed with
                    what's shared. A coworker's ask routes through the one conversation core (it
                    re-delegates with the instruction); the ENGINE's own ask (W3) stamps the
                    lifecycle directly (/api/room/asks proceed) and re-runs the one preparation
                    engine — both land on the work-with-what-you-have contract. Hidden once
                    proceeded (the decision stands; the checklist stays as the record). */}
                {!t.proceeded && t.author?.name && (
                  <button
                    onClick={() => send(`Have ${t.author!.name.split(' ')[0]} go ahead with what's available — work with what I've shared and note any gaps.`)}
                    disabled={busy}
                    className="mt-0.5 rounded-full border border-neutral-200 px-2.5 py-1 text-[11.5px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors disabled:opacity-50"
                  >Go ahead with what&apos;s available →</button>
                )}
                {!t.proceeded && !t.author?.name && t.turnId && (
                  <button
                    onClick={async () => {
                      const tid = t.turnId!;
                      const res = await fetch('/api/room/asks', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ turnId: tid, action: 'proceed' }),
                      }).catch(() => null);
                      // The server writes the visible go-ahead turn (dedupe proceed:<id>) — the
                      // local flip hides the button now; the turn arrives on the next hydrate.
                      if (res?.ok) {
                        setTurns((prev) => prev.map((x) => (x.role === 'system' && x.turnId === tid ? { ...x, proceeded: true } : x)));
                      }
                    }}
                    disabled={busy}
                    className="mt-0.5 rounded-full border border-neutral-200 px-2.5 py-1 text-[11.5px] font-medium text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors disabled:opacity-50"
                  >Go ahead with what&apos;s available →</button>
                )}
              </div>
            )}
            {/* THE SPEC CARD (Arc 2): the standing-task proposal — explicit fields, ONE Confirm.
                Saying prepared it; only this click (or the user's explicit word) creates anything.
                Confirmed → the card flips in place and reads as the record. */}
            {t.standingSpec && (
              <div className="mt-1.5 rounded-xl border border-neutral-200 px-3.5 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-neutral-800 truncate">{t.standingSpec.name}</span>
                  {t.standingSpec.status === 'confirmed' && (
                    <span className="flex-shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">✓ standing</span>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] text-neutral-500">{t.standingSpec.deliverable}</p>
                <p className="mt-1 text-[11.5px] text-neutral-400">
                  {t.standingSpec.cadenceLabel} · {t.standingSpec.ownerName.split(' ')[0]} owns it{t.standingSpec.firstRun ? ` · first run ${String(t.standingSpec.firstRun).slice(0, 10)}` : ''}
                  {/* Studio DEMOTED to the method editor (Arc 2): a deep-dive behind the standing
                      object, never a destination — the quiet link is its only door from here. */}
                  {t.standingSpec.status === 'confirmed' && t.standingSpec.workflowId && (
                    <> · <a href={`/studio?workflow=${t.standingSpec.workflowId}`} className="text-neutral-400 underline decoration-neutral-300 hover:text-indigo-600 transition-colors">method</a></>
                  )}
                </p>
                {t.standingSpec.status === 'pending' && t.dkey && (
                  <button
                    onClick={async () => {
                      const dk = t.dkey!;
                      const res = await fetch('/api/tasks/standing', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ roomKey, dedupeKey: dk }),
                      }).catch(() => null);
                      const d = res?.ok ? await res.json().catch(() => null) : null;
                      if (d?.ok) {
                        setTurns((prev) => prev.map((x) => (x.role === 'system' && x.dkey === dk && x.standingSpec
                          ? { ...x, standingSpec: { ...x.standingSpec, status: 'confirmed', firstRun: d.firstRun ?? x.standingSpec.firstRun } } : x)));
                      }
                    }}
                    disabled={busy}
                    className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                  >Confirm — start it</button>
                )}
              </div>
            )}
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
            {(() => {
              // The item ref disambiguates a SHARED deal room ("about what?"); inside the item's
              // OWN room it's self-referential noise. Rendered as a quiet inline LINK, never a
              // pill — the word is the deed (law 8); a chip restating the sentence above is noise.
              const shownRefs = (t.refs ?? []).filter((r) => inRoom || !r.href?.includes(`/item/${id}`));
              return shownRefs.length > 0 && (
                <p className="text-[12.5px] text-neutral-500">
                  {shownRefs.map((r, j) => (
                    r.href
                      ? <Link key={j} href={r.href} onClick={(e) => { if (onOpenHref?.(r.href!)) e.preventDefault(); }} className="mr-2 underline decoration-neutral-200 underline-offset-2 hover:text-indigo-500 transition-colors">{r.label}</Link>
                      : <span key={j} className="mr-2">{r.label}</span>
                  ))}
                </p>
              );
            })()}
            {t.files && t.files.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.files.map((f, j) => (
                  <Chip key={j} icon={<DocumentIcon className="w-3 h-3 flex-shrink-0" />} label={f.filename} />
                ))}
              </div>
            )}
          </AssistantRow>
            </div>
          </div>
              ))}
              {/* Cards without a visible anchor turn — the stream's end (never above later talk). */}
              {endArtifacts.map(cardRow)}
            </>
          );
        })()}
        {busy && <AssistantRow><TypingDots /></AssistantRow>}
      </div>

      {/* THE ONE COMPOSER (workstream 3, the rail fold): the SAME WorkerMentionInput as the Home
          floor and the worker surfaces — @ picks Coworkers/Tasks/Documents, attach feeds the
          room's INGEST FUNNEL (the pool — immediate, the room's law), Enter sends through the
          one steer core. A coworker mention becomes the ADDRESS in the sent words (the delegate
          path already speaks names); task/document mentions ride as grounding hints. Hidden
          while viewing a past session — read-only. */}
      {/* The hidden file input stays — the checklist asks' attach buttons share it. */}
      <input ref={fileRef} type="file" className="hidden"
        accept=".pdf,.docx,.txt,.csv,.xlsx,.pptx"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); }} />
      {!viewingSession && (
      <div className="flex-shrink-0 px-3 pb-3 pt-2">
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
          <WorkerMentionInput
            frameless
            onSubmit={(t, mentions) => {
              const cw = mentions.find((m) => m.type === 'coworker');
              const hints = mentions.filter((m) => m.type !== 'coworker').map((m) => m.label);
              let out = cw ? `${cw.label.split(' ')[0]}, ${t}` : t;
              if (hints.length) out += ` (about: ${hints.join('; ')})`;
              void send(out);
            }}
            disabled={busy}
            placeholder="Ask, correct, or hand off…"
            onAttach={(files) => { void (async () => { for (const f of files) await attach(f); })(); }}
          />
        </div>
      </div>
      )}
    </div>
  );
}
