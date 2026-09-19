'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ASK ZONE — the entry to the brain, at the bottom of the Home below the cards. The reasoned brief
// is its opening context (turn-0); a grounded conversation grows in place below it; a composer with
// state-derived suggested prompts anchors the bottom. Answers are grounded in the ONE registry and cite
// the items they used (chips → the deep-dive). No persona name — the system's own voice (the AUGMTD orb).
// Phase 1: single in-session thread ("New" clears it); History / multi-thread + inline actions come next.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { EyeSlashIcon, FolderIcon } from '@heroicons/react/24/outline';
import { WorkerMentionInput } from '@/components/workers/worker-mention-input';
import { ProjectPickerPanel } from '@/components/work/work-row';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { EmailCard, type CoworkerEmailDraft } from '@/components/home/email-card';
import { WorkflowDraftCard, type WorkflowDraft } from '@/components/workflows/workflow-draft-card';
import { ThreadArtifactsPanel } from '@/components/work/chat-artifact-panel';
import { InviteCard } from '@/components/home/invite-card';
import BulkDeedCard from '@/components/home/bulk-deed-card';
import type { BulkDeed as BulkDeedLike } from '@/lib/deeds/words';
import type { PreparedInviteLike } from '@/lib/prepare/invite-card';
import { ThreadShell } from '@/components/thread';
import type { ThreadCard, ThreadItem } from '@/components/thread';
import { useFeatures } from '@/context/workspace-context';
import { useCosSeat } from '@/hooks/use-cos-seat';
import type { DocumentArtifact } from '@/lib/types/inbox';
// THE DOC CARD'S TWO FACTS, from the ONE resolver (client-safe: types + the version chain).
import { docCardTypeOf, resolveDocVersion, type DocCardType } from '@/lib/documents/doc-card';
import { projectHref } from '@/lib/room/project-href';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { ROLE_LABELS } from '@/lib/workers/roles';
// (BriefingBlock removed from the chat — Phase 3 F2: the prose brief duplicated the deck; the
// composeBriefing machinery survives as the deck's ordering anchor + the daily report.)

type Ref = { id: string; kind: string; label: string; href: string | null };
/** THE CARD CONTRACT's pointer vocabulary — one per card kind a coworker exchange can produce.
 *  Each names ONLY what identifies the card in its own store; the content is read back from there
 *  (`/api/work/threads/<tid>/chat` — messages' metadata + the thread's artifacts). */
type WorkerCardRef =
  | { kind: 'email_draft'; tid: string; agentId: string; draftId: string }
  | { kind: 'document'; tid: string; artifactId: string }
  | { kind: 'workflow_draft'; tid: string; token: string }
  | { kind: 'invite'; tid: string; inviteId: string };
type Turn = { role: 'user' | 'assistant'; text: string; refs?: Ref[];
  /** THE ABSORPTION (brick 1): a coworker's own reply carries their name — the one-narrator
   *  law's attribution, now in the Home panel. */
  author?: string;
  /** The speaking coworker's agent id — the timeline's grouping key and the face's stable accent
   *  (a NAME is not an identity; two custom workers can share a first name). */
  authorId?: string;
  /** What rode WITH the user's words (attachments · @mentions). The kit mounts these as chips on
   *  the user's own bubble — dropping them is information loss, and the composer strips the `@`. */
  chips?: string[];
  /** The user's words AS SENT (with the "[attached: …]" note the brain reads). The bubble shows
   *  the clean text + chips; the model's history must still see exactly what it was told. */
  sent?: string;
  /** Deliverables the coworker produced in THIS exchange (brick 3 — the one surface owns its
   *  outputs): a DOCUMENT card opens the artifact panel HERE (art), a registry render still
   *  points at its page (href); an EMAIL DRAFT mounts the editable send card INLINE. */
  cards?: Array<{
    label: string; sub?: string; href?: string; art?: { tid: string; id: string };
    /** THE REVIEW-FIRST DOC CARD (attention-plan D): a produced DOCUMENT is a handle, not a link —
     *  its facts (glyph family, type word, owner, version) ride here and the card renders as the
     *  grammar's `doc` kind. Absent → the card stays the generic deliverable pointer. */
    doc?: { type: DocCardType; typeLabel: string; owner?: string; versionLabel?: string; groupId?: string };
  }>;
  drafts?: Array<{ draft: CoworkerEmailDraft; tid: string; agentId: string }>;
  /** THE CARDS SURVIVE THE RELOAD: every card an addressed coworker produced comes back as a
   *  POINTER at its own home — never a frozen payload, because each kind's state MOVES (a draft
   *  gets sent, a document gets revised, a workflow draft gets confirmed). `hydrateCardRefs`
   *  re-reads the coworker thread and fills `drafts` / `cards` / `workflowDrafts` / `invites`, so
   *  the SAME hosts mount them and both surfaces agree on what has happened. */
  cardRefs?: WorkerCardRef[];
  /** THE ONE CREATION CARD — a drafted workflow awaiting the user's confirm, inline. */
  workflowDrafts?: Array<WorkflowDraft>;
  /** THE INVITE CARD (threads plan — EVERY THREAD, EVERY PRODUCER): a prepared invite born from a
   *  plain prompt. Durable — it rides the turn's component, so a reload finds it standing. */
  invites?: Array<{ inviteId: string; invite: PreparedInviteLike }>;
  /** THE BULK DEED (attention-plan A7) — a previewed deed over a held-quiet class. The payload
   *  is for the FIRST paint only; the card re-reads the stored row, which is the deed's truth. */
  bulkDeeds?: Array<{ deedId: string; deed?: BulkDeedLike }>;
  /** THE SENSIBLE ASK: one consequential decision as tappable options — a tap SPEAKS its `say`
   *  through the composer. Ephemeral scaffolding (never persisted); consumed on tap. */
  options?: Array<{ label: string; say: string }>;
  /** When this turn was SPOKEN (ISO, from work_messages.created_at). Only loaded history carries
   *  it — a live turn has no timestamp until it is reloaded. ONE CONTINUOUS THREAD (the Slack
   *  model, owner, Aug 13): time is the only separator, so a date divider renders where two
   *  consecutive dated turns fall on different days. */
  at?: string };

// ── NEVER A TWIN (docs/attention-plan.md, law D2: "the new version lands on the SAME card") ─────
// A revision is a NEW artifact id on the SAME chain, so a thread that has revised twice would
// otherwise carry three cards for one document. This fold is the law in code, and it reads the
// STORED chain (lib/documents/doc-card → the one version-utils implementation), never client
// memory: for each chain, exactly ONE card survives — the LAST one spoken, repointed at the
// chain's current version and wearing its version word. Pure and idempotent: running it twice on
// the same artifacts changes nothing, so a mid-stream re-render can never resurrect a twin.
function foldDocCards(turns: Turn[], tid: string, artifacts: DocumentArtifact[]): Turn[] {
  const groupOf = new Map<string, string>();   // artifact id → its chain key
  const latest = new Map<string, ReturnType<typeof resolveDocVersion>>();
  for (const a of artifacts) {
    if (!a?.id) continue;
    const v = resolveDocVersion(artifacts, a.id);
    if (!v) continue;
    groupOf.set(a.id, v.groupIds[0] ?? a.id);
    latest.set(v.groupIds[0] ?? a.id, v);
  }
  // Walk BACKWARDS: the last card of a chain is the survivor, so the document sits where its
  // newest version was spoken about.
  const seen = new Set<string>();
  const out = [...turns];
  for (let i = out.length - 1; i >= 0; i--) {
    const t = out[i];
    if (!t.cards?.length) continue;
    const kept = [...t.cards].reverse().filter((c) => {
      if (!c.doc || c.art?.tid !== tid) return true;
      const g = groupOf.get(c.art.id);
      if (!g) return true;                       // an id the chain doesn't know stays as it is
      if (seen.has(g)) return false;             // an earlier-spoken sibling: the twin goes
      seen.add(g);
      return true;
    }).reverse().map((c) => {
      if (!c.doc || c.art?.tid !== tid) return c;
      const g = groupOf.get(c.art.id);
      const v = g ? latest.get(g) : null;
      if (!v) return c;
      const kind = docCardTypeOf(v.type, v.storagePath);
      return {
        ...c, label: v.title, art: { tid, id: v.id },
        doc: {
          ...c.doc, type: kind.type, typeLabel: kind.label, groupId: g,
          ...(v.versionLabel ? { versionLabel: v.versionLabel } : { versionLabel: undefined }),
        },
      };
    });
    if (kept.length !== t.cards.length || kept.some((c, j) => c !== t.cards![j])) out[i] = { ...t, cards: kept };
  }
  return out;
}

// ONE CONTINUOUS THREAD (owner, Aug 13 — the Slack model): a DM is never cut into sessions, so
// the DAY is the only separator. Both helpers read the user's LOCAL day (a timestamp is a moment;
// which day it belongs to is the reader's, not UTC's).
const dayKey = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toDateString(); };
const dayLabel = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// TYPEWRITER — the same streaming feel as the coworker chats. The answer arrives whole (JSON + refs need
// the full text), so we REVEAL it progressively: ~3 chars/frame, a partial trailing [ref tag is trimmed
// so raw tags never flash mid-reveal. Only the newest assistant turn animates; history renders static.
function useTypewriter(full: string, active: boolean): string {
  const [len, setLen] = useState(active ? 0 : full.length);
  useEffect(() => {
    if (!active) { setLen(full.length); return; }
    setLen(0);
    const iv = window.setInterval(() => {
      setLen((l) => { const n = Math.min(full.length, l + 3); if (n >= full.length) window.clearInterval(iv); return n; });
    }, 16);
    return () => window.clearInterval(iv);
  }, [full, active]);
  return full.slice(0, len).replace(/\[[ECRF]?\d*(?:\s*,\s*[ECRF]?\d*)*$/, '');
}

// Split answer text on [E#]/[C#]/[R#] tags → inline chips that open the referenced item.
function AnimatedAnswer({ text, refs, onOpen, animate }: { text: string; refs: Ref[]; onOpen: (r: Ref) => void; animate: boolean }) {
  const shown = useTypewriter(text, animate);
  return <Answer text={shown} refs={refs} onOpen={onOpen} />;
}

function Answer({ text, refs, onOpen }: { text: string; refs: Ref[]; onOpen: (r: Ref) => void }) {
  // FORMATTING GUARDS: the renderer is plain-prose — strip any markdown the model leaks, and
  // SEPARATE adjacent refs with " · ". Refs resolve by emit order ACROSS paragraphs. Structure:
  // blank lines split the answer into real spaced paragraphs (never one massive block).
  const clean = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1').replace(/^#+\s*/gm, '');
  // Grouped tags ("[E34, E35, E36]") are tolerated — one chip per id, refs consumed in order.
  const re = /\[([ECRF]\d+(?:\s*,\s*[ECRF]\d+)*)\]/g;
  let k = 0, refIdx = 0;
  const renderPara = (para: string) => {
    const parts: React.ReactNode[] = [];
    let last = 0, m: RegExpExecArray | null, prevWasRef = false;
    re.lastIndex = 0;
    while ((m = re.exec(para)) !== null) {
      if (m.index > last) { parts.push(<span key={`t${k++}`}>{para.slice(last, m.index)}</span>); prevWasRef = false; }
      const ids = m[1].split(/\s*,\s*/);
      for (const _id of ids) {
        if (prevWasRef) parts.push(<span key={`s${k++}`} className="text-neutral-300"> · </span>);
        const r = refs[refIdx] ?? null; refIdx++;
        if (r) { parts.push(<button key={`r${k++}`} onClick={() => onOpen(r)} className="inline font-medium text-indigo-700 hover:underline decoration-indigo-300 underline-offset-2">{r.label}</button>); prevWasRef = true; }
      }
      last = m.index + m[0].length;
    }
    if (last < para.length) parts.push(<span key={`t${k++}`}>{para.slice(last)}</span>);
    return parts;
  };
  const paras = clean.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return (
    <div className="space-y-2.5">
      {paras.map((para, i) => (
        // THE VOICE (design language): the team's answers are the team speaking — serif.
        <p key={i} className="text-[14px] text-neutral-700 leading-[1.65] whitespace-pre-line">{renderPara(para)}</p>
      ))}
    </div>
  );
}

// A long paste must never render as an endless wall — but the collapse is the thread KIT's law
// now (thread-timeline's UserBubbleText), so this host hands the FULL text over and mounts no
// toggle of its own. Two owners rendered two nested "Show all" buttons with different counts
// (the pilot's 1k-vs-3k report): one law, one home.

// THE CoS SEAT (docs/threads-plan.md — the identity law): the Home thread's answers wear the
// seat-holder's face, name and the constant "chief of staff" label. Read through the ONE client
// hook (`hooks/use-cos-seat.ts` → /api/workers/cos-seat → the ONE resolver), cached AGELESS —
// identity is ambient, not an action surface, so a remembered face is never a stale claim.
// `null` = a worker-less account (pre-seed): we fall back to the resolver's OWN name fallback
// rather than mint a persona here.

// ── THE DURABLE HOME CHAT (Aug 6 — the fold's enabling brick; one-surface ladder rung 2 +
// law 4: HISTORY IS THE DEFAULT). The Home conversation is a LOOSE ROOM (`chat:<uuid>` in
// room_turns): every exchange persists, a reload rehydrates, "New" starts a fresh room while
// the old one stays durable (the fold's future frame lists them). Persistence ≠ object
// creation — no task/project is minted by chatting (ladder law 3). ──
const CHAT_KEY_LS = 'aug-home-chat-key';
function chatRoomKey(): string {
  try {
    const existing = localStorage.getItem(CHAT_KEY_LS);
    if (existing?.startsWith('chat:')) return existing;
    const fresh = `chat:${crypto.randomUUID()}`;
    localStorage.setItem(CHAT_KEY_LS, fresh);
    return fresh;
  } catch { return `chat:${crypto.randomUUID()}`; }
}

// ── THE DM OPENS INSTANTLY (owner walk, Sep 7 — "takes a lot to load") ─────────────────────────
// The instant-load doctrine, finally reaching the coworker DM. THREE caches, all stamped through
// the house `saveLS/loadLS`, all read AGELESS (a conversation is an ambient surface, not an action
// surface — the deck's freshness demand does not apply, and the refresh lands a beat later):
//   • the coworker→thread MAPPING (`aug-dm2-<agentId>`) — the find-or-create round-trip is skipped
//     whenever we already know the address (a thread id is durable identity, it does not decay);
//   • the thread's last-painted TURNS (`aug-dm-turns-v1-<agentId>`) — the reopen paints the last
//     known conversation immediately and the server load appends behind it;
//   • the presence roster the SIDEBAR already writes — the header's role subtitle, no new read.
const DM_TURNS_LS = (agentId: string) => `aug-dm-turns-v1-${agentId}`;
// A cache is a first paint, never an archive: the tail is what a reopen looks at.
const DM_TURNS_CACHED = 30;

// The presence roster the SIDEBAR already fetches and caches — read here, never re-fetched (the
// header's name and role subtitle are ambient identity, not a reason for a second request).
type PresenceMate = { id: string; name: string; worker_role: string | null };
const presenceMate = (agentId: string): PresenceMate | null =>
  (loadLS<PresenceMate[]>('aug-team-presence-v1') ?? []).find((m) => m.id === agentId) ?? null;
const presenceName = (agentId: string): string | null => presenceMate(agentId)?.name ?? null;
/** The DM header's quiet second line: the coworker's ROLE, and only when it is a known fact.
 *  No counts, no state prose — nothing in the header asks (the thread anatomy). */
const presenceRoleLabel = (agentId: string): string | undefined => {
  const role = presenceMate(agentId)?.worker_role;
  return role ? ROLE_LABELS[role] : undefined;
};

export default function HomeAsk({ suggestions }: { suggestions: string[] }) {
  const router = useRouter();
  const features = useFeatures(); // the sovereign intake gate (Clara's first-contact question)
  const [turns, setTurns] = useState<Turn[]>([]);
  // THE DM IS A PANE, AND THE PANE PAINTS FIRST. `dmActor` mirrors `workerRoomRef` as RENDER state
  // (a ref cannot move the takeover's geometry), and it is set OPTIMISTICALLY the moment the reader
  // clicks a coworker — so the header (face · name · role) is on screen before any request lands.
  // `dmLoading` is the honest cold path: a skeleton in the thread's own shape, never a blank pane.
  const [dmActor, setDmActor] = useState<{ id: string; name: string } | null>(null);
  const [dmLoading, setDmLoading] = useState(false);
  // THE CHAT OPENS INSTANTLY — the DM's law, one lane over (found live: clicking a past conversation
  // in the sidebar sat on the deck until /api/room/turns landed, and a failed or EMPTY room sat there
  // forever). `chatRoom` is the chat lane's `dmActor`: render state set the moment the key is known,
  // so the pane takes the page at CLICK time. `chatLoading` is its honest cold path — the same
  // thread-shaped skeleton the DM waits under, never a blank pane and never a dead click.
  const [chatRoom, setChatRoom] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  // The seat, hydrated from the ageless cache and refreshed once per mount (a reseat lands on the
  // next visit — the face of the voice is not something that may change under a reader mid-answer).
  const cosSeat = useCosSeat();
  // Which long pastes the reader chose to open (keyed by the turn's own key).
  // Rehydrate the current chat room on mount (last-known conversation, the ChatGPT-parity habit) +
  // the SHELL'S WIRES: the sidebar's Home resets this panel (and lands the caret in the composer);
  // opening a past conversation from the sidebar / All-conversations view loads it here.
  useEffect(() => {
    try {
      // THE SEAM DOOR: a project room's "Open the conversation" ref lands here with ?chat= —
      // an explicit click, it outranks every other rehydration path.
      const chatParam = new URLSearchParams(window.location.search).get('chat');
      // A PRE-FILED NEW CHAT (the project room's "New chat" door): the intent carries the
      // project — the fresh conversation starts already scoped, binding written up front.
      const scopeIntent = sessionStorage.getItem('aug-new-chat-scope');
      // HOME IS THE CHAT DOOR, from another route: the sidebar can't fire `augmtd:home-reset`
      // across a navigation (this panel isn't mounted yet), so it leaves a ONE-SHOT intent.
      // Consumed here unconditionally — an unread flag must never steal the caret on a later,
      // ordinary load. It only ACTS on the fresh-floor branch below; a more specific intent
      // (?chat=, a scoped new chat, an open-conversation click) owns the landing when present.
      const homeFocusIntent = sessionStorage.getItem('aug-home-focus-intent');
      if (homeFocusIntent) sessionStorage.removeItem('aug-home-focus-intent');
      if (chatParam?.startsWith('chat:')) {
        loadRoom(chatParam); setOpen(true);
        try { window.history.replaceState(null, '', '/home'); } catch { /* no history */ }
      } else if (chatParam?.startsWith('worker:')) {
        // THE RETIREMENT REPOINT (slice #5): every link that used to say /workers?worker&thread
        // now opens the coworker conversation HERE — one URL form for a conversation.
        void loadWorkerRoom(chatParam); setOpen(true);
        try { window.history.replaceState(null, '', '/home'); } catch { /* no history */ }
      } else if (scopeIntent) {
        sessionStorage.removeItem('aug-new-chat-scope');
        try {
          const s = JSON.parse(scopeIntent) as { id?: string; name?: string };
          if (s?.id && s?.name) {
            setScope({ id: s.id, name: s.name });
            setOpen(true);
            void fetch('/api/rooms/adopt', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ roomKey: chatRoomKey(), entityId: s.id }),
            }).catch(() => {});
            setTimeout(() => focusComposer(), 120);
          }
        } catch { /* bad blob */ }
      } else if (sessionStorage.getItem('aug-open-chat-intent')) {
        // A cross-page "open this conversation" intent (sidebar recents / All conversations /
        // facepile from another route) — the ONLY landing path that restores the stored key:
        // an explicit click, the panel opens with its conversation.
        sessionStorage.removeItem('aug-open-chat-intent');
        const key = localStorage.getItem(CHAT_KEY_LS);
        if (key?.startsWith('chat:')) { loadRoom(key); setOpen(true); }
        else if (key?.startsWith('worker:')) { void loadWorkerRoom(key); setOpen(true); }
      } else {
        // THE FRESH FLOOR (Aug 11, owner — "clicking the chat opens the older one; it should
        // just be the empty home chat"): NO implicit rehydration on landing. The deck is the
        // default; the composer is a fresh chief chat; past conversations open ONLY through
        // explicit doors (sidebar, All conversations, History, ?chat=). The stale key clears
        // so the next persisted turn mints a fresh room, never appends to an unseen old one.
        try { localStorage.removeItem(CHAT_KEY_LS); } catch { /* no LS */ }
        // ...and if the reader got here by CLICKING Home, the caret is waiting for them. The deck
        // still leads (setOpen stays untouched) — this is a ready door, not an opened panel.
        if (homeFocusIntent) focusComposerWhenSettled();
      }
    } catch { /* no LS */ }
    // THE NEW CHAT MINTS A NEW ROOM (hardened Sep 13, found by the gate reconciliation): the
    // handler cleared the turns but LEFT the stored `chat:<uuid>` key, so "new" was fresh only
    // because its one caller (the room's New-chat door) happened to drop the key first. The deed
    // now lives in the handler: whoever fires `aug:new-chat`, the next turn persists to a NEW room
    // and the old one stays durable.
    const onNew = () => { try { localStorage.removeItem(CHAT_KEY_LS); } catch { /* no LS */ } setTurns([]); setTemp(false); setScope(null); setScopeHint(null); workerRoomRef.current = null; setDmActor(null); setDmLoading(false); setChatRoom(null); setChatLoading(false); setOpen(true); setTimeout(() => focusComposer(), 60); };
    const onOpen = (e: Event) => {
      const key = (e as CustomEvent).detail?.key as string | undefined;
      // THE FRESH FLOOR's rider: the cross-page intent flag is a ONE-SHOT for the case where this
      // panel isn't mounted yet. A SAME-PAGE open must eat it too — a flag left standing makes the
      // next cold /home load auto-restore this conversation, which is exactly what the floor forbids.
      try { sessionStorage.removeItem('aug-open-chat-intent'); } catch { /* no storage */ }
      if (key?.startsWith('chat:')) { loadRoom(key); setOpen(true); }
      else if (key?.startsWith('worker:')) { void loadWorkerRoom(key); setOpen(true); }
    };
    // Warm the roster NOW — the submit-time address check must never wait on a cold endpoint
    // (an 8s /api/workers/mentions was the "nothing happened" lag, found live Aug 6).
    void getRoster();
    // Sidebar "Home" IS the close (the idiom: you leave a chat by going home — no in-thread
    // Close button). THE FRESH FLOOR applies here too (Aug 11, owner: "placeholder doesn't
    // update when clicking back in home"): leaving via Home resets to the EMPTY chief chat —
    // DM mode, turns, scope, and the stored key all clear; the conversation stays durable
    // and reachable through its explicit doors (sidebar recents, All conversations).
    const onHomeReset = () => {
      setOpen(false);
      setTurns([]); setTemp(false); setScope(null); setScopeHint(null);
      workerRoomRef.current = null; setDmActor(null); setDmLoading(false);
      setChatRoom(null); setChatLoading(false);
      try { localStorage.removeItem(CHAT_KEY_LS); } catch { /* no LS */ }
      // HOME IS THE CHAT DOOR: the reset above is unchanged (the deck stays the default) — the
      // caret simply lands in the composer so the door is ready to type into. It waits for the
      // reset's own state flush to paint, so the FIRST click lands it (see focusComposerWhenSettled).
      focusComposerWhenSettled();
    };
    // THE FACEPILE'S CHAT VERB (coherence slice #4): open the coworker's DM conversation
    // (find-or-create the "Chat with" thread) — same door as addressing them by name.
    // THE OPEN PATH IS ONE HOP WHEN THE ADDRESS IS KNOWN (owner walk, Sep 7). The pane, the face
    // and the name paint SYNCHRONOUSLY off the click's own detail; the cached thread mapping is
    // read synchronously too, so a warm reopen goes straight to the messages load — no
    // find-then-load round-trip in front of it. Only a genuinely unknown thread pays the
    // find-or-create hop, and it pays it under a skeleton, not a blank page.
    const onDm = (e: Event) => {
      const d = (e as CustomEvent).detail as { agentId?: string; name?: string } | undefined;
      if (!d?.agentId || !d?.name) return;
      const w = { id: d.agentId, name: d.name };
      // Same one-shot, same law (the facepile leaves the flag too): a same-page DM open consumes it.
      try { sessionStorage.removeItem('aug-open-chat-intent'); } catch { /* no storage */ }
      setOpen(true);
      workerRoomRef.current = w; setDmActor(w); setDmLoading(true);
      const known = cachedDmThread(w.id);
      if (known) { void loadWorkerRoom(`worker:${known}:${w.id}`); return; }
      void dmThread(w).then((tid) => {
        if (tid) void loadWorkerRoom(`worker:${tid}:${w.id}`);
        else setDmLoading(false);
      });
    };
    window.addEventListener('aug:dm-worker', onDm);
    window.addEventListener('aug:new-chat', onNew);
    window.addEventListener('aug:open-chat', onOpen);
    window.addEventListener('augmtd:home-reset', onHomeReset);
    return () => {
      window.removeEventListener('aug:dm-worker', onDm);
      window.removeEventListener('aug:new-chat', onNew);
      window.removeEventListener('aug:open-chat', onOpen);
      window.removeEventListener('augmtd:home-reset', onHomeReset);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Load ANY chat room into the panel (mount rehydration + the History picker share this).
  const mapServerTurns = (raw: Array<{ role: string; text: string; refs?: Array<{ label: string; href: string | null }>;
    author?: { kind?: string; id?: string; name?: string } | null;
    component?: { key?: string; refId?: string; state?: Record<string, unknown> } | null }>): Turn[] =>
    raw.map((t) => ({
      role: t.role === 'user' ? 'user' as const : 'assistant' as const,
      text: t.text,
      refs: (t.refs ?? []).map((r, i) => ({ id: `h${i}`, kind: 'link', label: r.label, href: r.href })),
      // THE ONE-NARRATOR LAW on the way back in: a turn a COWORKER spoke wears their face again
      // (the store's server-written author), so a reloaded Home exchange with Clara is still hers.
      ...(t.author?.name ? { author: String(t.author.name).split(' ')[0], ...(t.author.id ? { authorId: String(t.author.id) } : {}) } : {}),
      // A CARD IS A TURN: the persisted invite component comes back as the same card it was —
      // a deliverable that dies on reload is a deliverable the user cannot trust.
      ...(t.component?.key === 'invite_card' && t.component.refId
        ? { invites: [{ inviteId: t.component.refId, invite: (t.component.state?.invite ?? {}) as PreparedInviteLike }] }
        : {}),
      // …and so does a bulk deed. Only the REF survives here by design: the deed's committed state
      // lives on its own row, so a reloaded card can never show "pending" on a deed already run.
      ...(t.component?.key === 'bulk_deed_card' && t.component.refId
        ? { bulkDeeds: [{ deedId: t.component.refId }] }
        : {}),
      // …and so does every card an addressed COWORKER produced — as POINTERS at their own homes
      // (hydrateCardRefs below re-reads them). Nothing about a card's mutable state is copied
      // here: send the draft, revise the document or confirm the task in the DM, and this room
      // shows the same fact on its next load.
      ...(t.component?.key === 'worker_cards' && Array.isArray((t.component.state as { items?: unknown[] } | undefined)?.items)
        ? { cardRefs: ((t.component.state as { items: unknown[] }).items as WorkerCardRef[]) }
        : {}),
    }));
  const loadRoom = (key: string) => {
    workerRoomRef.current = null; setDmActor(null); setDmLoading(false); // a chief chat room leaves worker mode
    // The pane is taken NOW, off the key alone (the DM door's shape): the conversation exists, the
    // reader asked for it, and the wait belongs INSIDE the room — not in front of it.
    setChatRoom(key); setChatLoading(true); setTurns([]);
    if (key.startsWith('chat:')) {
      setScope(null); setScopeHint(null);
      // Scope is SERVER TRUTH (the binding) — per-conversation, survives devices; never a
      // global local cache that bleeds across conversations.
      fetch(`/api/rooms/adopt?key=${encodeURIComponent(key)}`).then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.scope?.id) setScope({ id: d.scope.id, name: d.scope.name }); })
        .catch(() => {});
    }
    fetch(`/api/room/turns?key=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('turns'))))
      .then((d) => {
        if (!Array.isArray(d?.turns)) throw new Error('turns');
        setChatLoading(false);
        // AN EMPTY ROOM IS AN OPEN ROOM: `turns: []` is served truth, so the pane stands with its
        // composer and simply has nothing to say yet — a skeleton that never resolves would be
        // the deterministic forever-nothing this door was built to end.
        setTurns(mapServerTurns(d.turns));
        try { localStorage.setItem(CHAT_KEY_LS, key); } catch { /* no LS */ }
      }).catch(() => {
        // THE FAILURE SPEAKS (openArtifact's idiom): a door that dies silently is a dead click the
        // reader can only fix by guessing. The key is deliberately NOT stored — a conversation we
        // could not read is not a room the next turn should append to.
        setChatLoading(false);
        setTurns([{ role: 'assistant', text: "Couldn't open that conversation — try again." }]);
      });
  };
  // ── THE CARD CONTRACT, THE SECOND HALF: the pointers are filled from the coworker thread ──────
  // ONE SOURCE OF TRUTH PER KIND, and it is never here: the email draft (with the `sent_at`
  // /send-coworker-email stamps), the invite and the workflow draft live on that thread's message
  // metadata; the document lives on the thread's artifact row (revision-in-place moves it there).
  // ONE FLIGHT PER THREAD reads all four — so a rehydrated card cannot disagree with the DM twin,
  // and confirming/sending/revising on either surface shows up on both at their next load.
  const hydratedCards = useRef<Set<string>>(new Set());
  const refKey = (r: WorkerCardRef): string =>
    r.kind === 'email_draft' ? `d:${r.draftId}` : r.kind === 'document' ? `a:${r.artifactId}`
      : r.kind === 'workflow_draft' ? `w:${r.token}` : `i:${r.inviteId}`;
  useEffect(() => {
    const threads = new Set<string>();
    turns.forEach((t) => (t.cardRefs ?? []).forEach((r) => {
      if (hydratedCards.current.has(refKey(r))) return;
      hydratedCards.current.add(refKey(r)); // claimed BEFORE the flight: a re-render can't fan out
      threads.add(r.tid);
    }));
    if (!threads.size) return;
    threads.forEach((tid) => {
      // The DM's own door — the one worker-chat-tab reads (it serves message METADATA, which the
      // /messages door does not).
      void fetch(`/api/work/threads/${tid}/chat`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          const drafts = new Map<string, CoworkerEmailDraft>();
          const invites = new Map<string, PreparedInviteLike>();
          const wf = new Map<string, WorkflowDraft>();
          (d.messages as Array<{ metadata?: {
            email_drafts?: CoworkerEmailDraft[];
            invite_cards?: Array<{ id: string; invite: PreparedInviteLike }>;
            workflow_drafts?: WorkflowDraft[];
          } | null } > ?? []).forEach((m) => {
            (m.metadata?.email_drafts ?? []).forEach((x) => { if (x?.id) drafts.set(x.id, x); });
            (m.metadata?.invite_cards ?? []).forEach((x) => { if (x?.id) invites.set(x.id, x.invite); });
            (m.metadata?.workflow_drafts ?? []).forEach((x) => { if (x?.token) wf.set(x.token, x); });
          });
          const artifacts = ((d.thread as { artifacts?: DocumentArtifact[] } | null)?.artifacts ?? []);
          const docs = new Map<string, { title?: string; type?: string }>();
          artifacts.forEach((a) => { if (a?.id) docs.set(a.id, { title: a.title, type: a.type }); });
          setTurns((prev) => prev.map((t) => {
            const refs = (t.cardRefs ?? []).filter((r) => r.tid === tid);
            if (!refs.length) return t;
            const next = { ...t };
            refs.forEach((r) => {
              if (r.kind === 'email_draft' && drafts.has(r.draftId)) {
                next.drafts = [...(next.drafts ?? []), { draft: drafts.get(r.draftId)!, tid, agentId: r.agentId }];
              } else if (r.kind === 'invite' && invites.has(r.inviteId)) {
                next.invites = [...(next.invites ?? []), { inviteId: r.inviteId, invite: invites.get(r.inviteId)! }];
              } else if (r.kind === 'workflow_draft' && wf.has(r.token)) {
                next.workflowDrafts = [...(next.workflowDrafts ?? []), wf.get(r.token)!];
              } else if (r.kind === 'document' && docs.has(r.artifactId)) {
                const a = docs.get(r.artifactId)!;
                // THE CARD POINTS AT THE CHAIN'S PRESENT (D2): a pointer at v1 resolves, through
                // the stored version chain, to the document as it stands now — a rehydrated card
                // can never show a version a revision has already replaced.
                const v = a.type === 'frame' ? null : resolveDocVersion(artifacts, r.artifactId);
                const kind = v ? docCardTypeOf(v.type, v.storagePath) : null;
                next.cards = [...(next.cards ?? []), {
                  label: v?.title ?? a.title ?? 'Document',
                  sub: `${a.type === 'frame' ? 'frame' : 'document'}${t.author ? ` · by ${t.author}` : ''}`,
                  art: { tid, id: v?.id ?? r.artifactId },
                  ...(v && kind ? {
                    doc: {
                      type: kind.type, typeLabel: kind.label, groupId: v.groupIds[0],
                      ...(t.author ? { owner: t.author } : {}),
                      ...(v.versionLabel ? { versionLabel: v.versionLabel } : {}),
                    },
                  } : {}),
                }];
              }
            });
            return next;
          }));
          // NEVER A TWIN (D2): with the whole artifact list in hand, every card in the thread
          // that points at ANY member of one chain folds to ONE card on the current version.
          setTurns((prev) => foldDocCards(prev, tid, artifacts));
        }).catch(() => {});
    });
  }, [turns]);
  // ── THE ABSORPTION, BRICK 2 (Aug 6): a COWORKER conversation from Recent/All opens HERE — the
  // one panel. `worker:<threadId>:<agentId>` loads the thread's own messages (work_messages IS
  // its store — never copied into room_turns) with the coworker's attribution; the panel enters
  // WORKER MODE: the next message continues in that SAME thread (the DM pointer re-aims), and
  // chief persistence is structurally off while the mode holds. ──
  const workerRoomRef = useRef<{ id: string; name: string } | null>(null);
  // FIRST CONTACT: the coworker introduces THEMSELF (a self-introduction is the coworker's own
  // honest speech — the one-narrator law guards engine narration, not greetings). Simple,
  // benefit-led language ("what I take off your plate"), never product concepts. The team
  // explainer appears exactly once (the flag), then a short greeting + chips.
  const TEAM_INTRO_LS = 'aug-team-intro-v1';
  const workerIntroFor = (first: string): { helps: string; examples: Array<{ label: string; say: string }> } => {
    const byName: Record<string, { helps: string; examples: Array<{ label: string; say: string }> }> = {
      clara: {
        helps: 'I take the busywork off your plate — drafts, reports, agendas, follow-ups, keeping things organized. Tell me what you need in plain words, like you would text a colleague.',
        examples: [
          { label: 'Draft a meeting agenda', say: 'Draft an agenda for a 30-minute kickoff meeting with a new client.' },
          { label: 'Set up a weekly summary', say: 'Set up a weekly task: every Monday morning, summarize my open work for the week.' },
          { label: 'Build a checklist', say: 'Make me a checklist for onboarding a new team member.' },
        ],
      },

      max: {
        helps: 'I do the digging — research, comparisons, data analysis — so you get the answer without the hours of reading. Attach a spreadsheet and I can work the numbers.',
        examples: [
          { label: 'Research a topic', say: 'Research current best practices for quarterly business reviews and give me a structured summary.' },
          { label: 'Compare options', say: 'Compare the pros and cons of three common approaches to team performance reviews.' },
          { label: 'Analyze attached data', say: 'I will attach a spreadsheet — analyze it and tell me the three most important patterns.' },
        ],
      },
      luca: {
        helps: 'I keep your LinkedIn active and credible — posts drafted from your real work, a sustainable cadence, and a voice that stays yours.',
        examples: [
          { label: 'Draft a LinkedIn post', say: 'Draft a LinkedIn post about a recent team milestone — professional but human.' },
          { label: 'Plan a month of posts', say: 'Suggest five LinkedIn post ideas for this month based on what my company does.' },
          { label: 'Rework my draft', say: 'I will paste a rough draft — rework it into a stronger LinkedIn post that keeps my voice.' },
        ],
      },
    };
    return byName[first.toLowerCase()] ?? {
      helps: 'I take real work off your plate — drafts, research, recurring tasks. Tell me what you need in plain words.',
      examples: [
        { label: 'Draft a document', say: 'Draft a one-page document — ask me what you need to get started.' },
        { label: 'Set up a recurring task', say: 'Set up a weekly task that summarizes my open work every Monday morning.' },
        { label: 'Work on a file', say: 'I will attach a file — read it and tell me what you can do with it.' },
      ],
    };
  };
  // Always an EXPLICIT open (THE FRESH FLOOR, Aug 11): landings never call this implicitly —
  // past conversations open only through deliberate doors (sidebar, History, ?chat=, facepile).
  const loadWorkerRoom = async (key: string) => {
    const [, tid, agentId] = key.split(':');
    if (!tid || !agentId) return;
    setChatRoom(null); setChatLoading(false); // a coworker DM leaves the chief-chat lane
    setDmLoading(true);
    // INSTANT PAINT (the instant-load doctrine, reaching the DM): the last conversation this
    // coworker painted goes up NOW, before the request is even sent. The load below then lands
    // behind it under the no-mutation law — the painted turns keep their seat and only genuinely
    // new ones append (a DM is an append-only log, so freezeRows' semantics ARE the merge).
    const painted = loadLS<Turn[]>(DM_TURNS_LS(agentId));
    if (painted?.length) {
      setTurns(painted);
      // A name is never invented: the pane already knows it when the reader clicked a coworker,
      // and on a deep link (?chat=worker:…) the presence roster the sidebar caches supplies it.
      // With neither, the header waits for the load rather than wearing an id.
      setDmActor((prev) => prev ?? (presenceName(agentId) ? { id: agentId, name: presenceName(agentId)! } : prev));
      setTimeout(pinToEnd, 0);
    }
    try {
      // TWO INDEPENDENT READS, ONE FLIGHT: the thread's messages and the roster (for the
      // coworker's real name) never depended on each other — awaiting them in sequence simply
      // added a round-trip to every open. The roster is usually already warm; when it is not,
      // it now costs nothing extra.
      const [d, roster] = await Promise.all([
        // THE DM's OWN DOOR (the one the coworker page reads): it serves message METADATA, where
        // every card of that conversation lives. The /messages door does not select `metadata`,
        // so reading the DM through it made a card-bearing turn arrive stripped of its cards —
        // found while extending the card contract; the workflow-draft mapping below had been
        // silently dead here for exactly that reason.
        fetch(`/api/work/threads/${tid}/chat`).then((r) => (r.ok ? r.json() : null)),
        getRoster(),
      ]);
      if (!Array.isArray(d?.messages)) { setDmLoading(false); return; }
      const name = roster.find((x) => x.id === agentId)?.name
        ?? String((d.thread as { title?: string } | null)?.title ?? 'Coworker').replace(/^Chat with /, '');
      // Each loaded turn carries its OWN moment (work_messages.created_at, ascending from the
      // route) — ONE CONTINUOUS THREAD (the Slack model, owner, Aug 13): the scroll-back IS the
      // history, so the day boundary is the only separator the render needs.
      const loaded: Turn[] = (d.messages as Array<{ role: string; content: string; created_at?: string; metadata?: {
        workflow_drafts?: WorkflowDraft[]; email_drafts?: CoworkerEmailDraft[];
        invite_cards?: Array<{ id: string; invite: PreparedInviteLike }>;
      } }>)
        .filter((m) => (m.role === 'user' || m.role === 'assistant')
          && (String(m.content ?? '').trim() || m.metadata?.workflow_drafts?.length
            || m.metadata?.email_drafts?.length || m.metadata?.invite_cards?.length))
        .map((m) => (m.role === 'user'
          ? { role: 'user' as const, text: m.content, ...(m.created_at ? { at: m.created_at } : {}) }
          : {
              role: 'assistant' as const, text: m.content, author: name.split(' ')[0], authorId: agentId,
              ...(m.created_at ? { at: m.created_at } : {}),
              ...(m.metadata?.workflow_drafts?.length ? { workflowDrafts: m.metadata.workflow_drafts } : {}),
              // The DM TWIN inside this panel reads the same message metadata the coworker page
              // reads — one store, one card per kind, and the mutable facts on them (`sent_at`,
              // the workflow draft's confirm token) are the doors' own stamps.
              ...(m.metadata?.email_drafts?.length
                ? { drafts: m.metadata.email_drafts.map((dr) => ({ draft: dr, tid, agentId })) }
                : {}),
              ...(m.metadata?.invite_cards?.length
                ? { invites: m.metadata.invite_cards.map((iv) => ({ inviteId: iv.id, invite: iv.invite })) }
                : {}),
            }));
      // Brick 3: the thread's documents ride along — openable HERE, never a page away.
      const arts = ((d.thread as { artifacts?: Array<{ id?: string; title?: string }> } | null)?.artifacts ?? [])
        .filter((a): a is { id: string; title: string } => !!a.id && !!a.title);
      if (arts.length) {
        loaded.push({
          role: 'assistant', author: name.split(' ')[0], authorId: agentId, text: '',
          cards: arts.map((a) => ({ label: a.title, sub: 'document', art: { tid, id: a.id } })),
        });
      }
      // A BRAND-NEW DM has zero messages — zero turns meant the panel never took over (found
      // live: the facepile's Chat created the thread, loaded nothing, and read as a dead
      // click). The narrator opens the room (the CoS voice, author absent — never fabricated
      // coworker speech); not persisted. FIRST CONTACT (pilot feedback, Aug 12: "I would not
      // know what to do" — 99% of users have never had an agent team): the very first empty DM
      // explains the concept ONCE (LS flag; never repeated after), and EVERY empty DM carries
      // tappable example asks — affordances, not repeated prose (a chip is guidance that
      // doesn't nag). A tap speaks through the composer (the word is the deed).
      // A synthesized first contact is SPEECH THIS OPEN AUTHORED, not thread history — it is
      // never cached (a cached greeting would re-paint as if the coworker had said it before).
      const synthesized = loaded.length === 0;
      if (loaded.length === 0) {
        const first = name.split(' ')[0];
        const intro = workerIntroFor(first);
        let seenIntro = true;
        try { seenIntro = localStorage.getItem(TEAM_INTRO_LS) === '1'; localStorage.setItem(TEAM_INTRO_LS, '1'); } catch { /* no LS */ }
        // THE INTAKE (owner, Aug 14 — proactivity comes from the COWORKER, in their own voice):
        // on an email-off workspace there is no mailbox to learn the user from, so Clara's first
        // contact ASKS — her question is ordinary speech in her own bubble; the answer flows
        // through the DM and the memory lane extracts it into user-level context every surface
        // reads. Other coworkers keep their standard intros — one greeter, not four.
        const intake = features.email === false && first.toLowerCase() === 'clara';
        const base = seenIntro
          ? `Hi — I'm ${first}. ${intro.helps}`
          : `Hi — I'm ${first}, one of the AI coworkers that comes with your workspace (there's a small team of us, each with a specialty). ${intro.helps}`;
        // The coworker speaks for themself (author set → their avatar + name on the bubble).
        if (intake) {
          // Clara PLACES the whole team (owner, Aug 14): a corporate first contact meets
          // everyone briefly — always in the intake flow, independent of the one-time explainer
          // flag (a tester's LS must not mute it). Names come from the live roster; the
          // specialty line from the seeded-name map, silently omitted for custom workers.
          const specialty: Record<string, string> = {
            max: 'does the research and analysis',
            luca: 'keeps your LinkedIn active',
          };
          const mates = roster
            .map((x) => x.name.split(' ')[0])
            .filter((f) => f.toLowerCase() !== first.toLowerCase())
            .map((f) => { const s = specialty[f.toLowerCase()]; return s ? `${f} ${s}` : f; });
          const teamLine = mates.length
            ? ` There's a small team of us — ${mates.length > 1 ? `${mates.slice(0, -1).join(', ')}, and ${mates[mates.length - 1]}` : mates[0]}. You can message any of us from the Home.`
            : '';
          // The QUESTION gets its own bubble — buried mid-paragraph it reads as boilerplate;
          // alone it reads as a colleague actually asking. Chips ride the question turn and
          // offer only work that needs NO ambient context (a day-one sovereign account has no
          // mail/calendar to summarize or plan from — attach-a-file and standalone drafts do).
          loaded.push({ role: 'assistant', author: first, authorId: agentId, text: `Hi — I'm ${first}. ${intro.helps}${teamLine}` });
          loaded.push({
            role: 'assistant', author: first, authorId: agentId,
            text: `So the whole team starts with real context — what's your role, and what's the main thing on your plate this week? Anything you tell me here, we all remember. Or jump straight in:`,
            options: [
              { label: 'Draft a meeting agenda', say: 'Draft an agenda for a 30-minute kickoff meeting with a new client.' },
              { label: 'Summarize a document I attach', say: 'I will attach a document — summarize it into one page of key takeaways.' },
              { label: 'Build a checklist', say: 'Make me a checklist for onboarding a new team member.' },
            ],
          });
        } else {
          loaded.push({
            role: 'assistant', author: first, authorId: agentId,
            text: `${base} A few things I can do right now:`,
            options: intro.examples,
          });
        }
      }
      // THE NO-MUTATION LAW AT THE HYDRATE SEAM: whatever the cache painted keeps its seat and the
      // server's tail appends behind it. A DM is an append-only log, so index-wise freezing IS the
      // truthful merge — and the cache is written from this same load, so a divergence can only be
      // a tail. Nothing already read moves under the reader; a genuinely fresh open (nothing
      // painted) simply takes the server's turns whole.
      setTurns((prev) => (prev.length && painted?.length
        ? (loaded.length > prev.length ? [...prev, ...loaded.slice(prev.length)] : prev)
        : loaded));
      setDmLoading(false);
      setTimeout(() => focusComposer(), 120);
      workerRoomRef.current = { id: agentId, name };
      setDmActor({ id: agentId, name });
      setScope(null); setScopeHint(null); // a coworker DM is addressed, never project-scoped from here
      saveLS(dmKey(agentId), tid);
      if (!synthesized) saveLS(DM_TURNS_LS(agentId), loaded.slice(-DM_TURNS_CACHED));
      try { localStorage.setItem(CHAT_KEY_LS, key); } catch { /* no LS */ }
    } catch { setDmLoading(false); /* the click already opened the pane — an empty load stays honest */ }
  };
  // THE HISTORY PICKER DIED (owner, Aug 7): the SIDEBAR owns history — Recent + All
  // conversations are the one thread list; a second picker inside the panel was redundant.
  // ── THE ARTIFACT PANEL (brick 3 — the one surface owns its outputs): a document card opens
  // the SAME ThreadArtifactsPanel the worker page uses, as a right-side overlay HERE — viewer,
  // versions, download, delete, all without leaving the conversation. ──
  const [artifactPanel, setArtifactPanel] = useState<{ thread: { id: string; title: string; artifacts?: DocumentArtifact[] }; initialId: string | null } | null>(null);
  const openArtifact = async (tid: string, artifactId: string) => {
    try {
      const d = await fetch(`/api/work/threads/${tid}/messages`).then((r) => (r.ok ? r.json() : null));
      const th = d?.thread as { id: string; title?: string; artifacts?: DocumentArtifact[] } | null;
      if (!th) throw new Error();
      setArtifactPanel({ thread: { id: th.id, title: th.title ?? 'Work', artifacts: th.artifacts ?? [] }, initialId: artifactId });
      // ONE FLIGHT, TWO USES: the same artifact list the panel opens on settles the thread's doc
      // cards — a revision folds onto the card that already stood, wearing its new version word.
      setTurns((prev) => foldDocCards(prev, tid, th.artifacts ?? []));
    } catch {
      setTurns((prev) => [...prev, { role: 'assistant', text: "Couldn't open that document just now — try again." }]);
    }
  };

  // ── THE SCOPE CHIP + THE ADOPTION CASCADE (one-surface § context controls): the conversation
  // header shows its scope ("No project · Add to…" / "<Project> ✓"), settable at ANY time.
  // Adopting moves the conversation's turns INTO the project room (the one membership machinery
  // — /api/rooms/adopt), and from then on the panel talks IN that room: turns persist to its
  // key, answers ground on its full room page (converse entity scope). The chip when scoped is
  // the DOOR to the room. ──
  const [scope, setScope] = useState<{ id: string; name: string } | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  // THE RECOGNITION NUDGE: the ask response names the project the conversation is ABOUT
  // (deterministic focus match) — the chip turns into an OFFER ("About X? · File it"); one
  // click adopts, ✕ dismisses. A suggestion, never an auto-file.
  const [scopeHint, setScopeHint] = useState<{ id: string; name: string } | null>(null);
  const scopeChipRef = useRef<HTMLSpanElement>(null);
  // File / re-file / un-file — one binding call (v2 link model: the conversation keeps its
  // key and turns; the project holds the binding; all three are one upsert/delete).
  const adopt = async (e: { id: string; name: string } | null) => {
    setScopeOpen(false);
    const prev = scope;
    setScope(e); // optimistic — the binding call converges
    try {
      const res = await fetch('/api/rooms/adopt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomKey: chatRoomKey(), entityId: e?.id ?? null }),
      });
      if (!res.ok) throw new Error();
      window.dispatchEvent(new CustomEvent('aug:conversation-changed'));
    } catch {
      setScope(prev);
      setTurns((p) => [...p, { role: 'assistant', text: "That project change didn't go through — try again." }]);
    }
  };
  const createAndAdopt = async (name: string) => {
    try {
      const res = await fetch('/api/entities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.id) throw new Error();
      await adopt({ id: d.id as string, name });
    } catch {
      setScopeOpen(false);
      setTurns((prev) => [...prev, { role: 'assistant', text: "Couldn't create that project — try again." }]);
    }
  };
  // TEMPORARY CHAT (one-surface ladder law 4's opt-out — the explicit ephemeral mode): nothing
  // is persisted, no room is minted; the promise is honest ("won't be saved"). Armed before a
  // conversation starts; locked once it has turns (past turns can't be retro-saved); reset by New.
  const [temp, setTemp] = useState(false);
  const persistTurn = (
    role: 'user' | 'system', text: string, refs?: Ref[],
    // A turn spoken by an ADDRESSED coworker carries their id (the server resolves the name — the
    // client never sets an author string) and, when they produced one, the email draft's pointer.
    extra?: { authorAgentId?: string; component?: { key: string; refId: string; state: Record<string, unknown> } },
  ) => {
    if (temp) return; // temporary: the conversation lives only in this session's memory
    if (workerRoomRef.current) return; // worker mode: the thread's own store holds the conversation
    try {
      fetch('/api/room/turns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // v2 link model: turns ALWAYS live on the chat's own key — the binding, not the
          // turns' address, says which project the conversation belongs to.
          roomKey: chatRoomKey(), role, text,
          refs: refs?.length ? refs.map((r) => ({ label: r.label, href: r.href })) : undefined,
          ...(extra?.authorAgentId ? { authorAgentId: extra.authorAgentId } : {}),
          ...(extra?.component ? { component: extra.component } : {}),
        }),
      }).then(() => {
        // The sidebar's Recent stays live (a new conversation appears as it starts).
        if (role === 'user') window.dispatchEvent(new CustomEvent('aug:conversation-changed'));
      }).catch(() => {});
    } catch { /* persistence is an enhancement — the session still works */ }
  };
  const [busy, setBusy] = useState(false);
  // The live STAGE from the streaming ask ("Searching your files…") — the busy line speaks it.
  const [stage, setStage] = useState<string | null>(null);
  // TOKEN STREAMING (Aug 10): the answer materializing live while the core writes it — replaced
  // by the authoritative `done` payload (which may differ: the honesty floor can amend it).
  const [liveText, setLiveText] = useState('');
  const liveTextRef = useRef('');
  // THE ONE COMPOSER's state: prefill lands a suggestion INTO the textarea (user finishes the
  // thought); pendingFiles buffer until send (the worker-chat pattern — upload rides the route).
  const [prefill, setPrefill] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // THE SHELL OWNS THE SCROLLER (the port's one DOM reach): the thread column is the kit's, so
  // "pin to the newest turn" finds the shell's own overflow container instead of a sentinel div.
  const shellRef = useRef<HTMLDivElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const focusComposer = () => composerWrapRef.current?.querySelector('textarea')?.focus();
  // THE CARET WITHOUT THE PANEL (Home-is-the-chat-door, Aug 25). The composer wrapper opens the
  // chat on ANY focus — right for a human click, wrong for the Home button, whose whole contract
  // is THE FRESH FLOOR: the deck is the default view. So the Home's focus is announced as
  // programmatic and the open-on-focus rule stands down for exactly that one event. The reader
  // gets a ready caret over the deck; typing (or clicking) still opens the panel as it always did.
  const programmaticFocusRef = useRef(false);
  const focusComposerQuietly = () => {
    programmaticFocusRef.current = true;
    focusComposer();
    // Cleared after the focus event has finished bubbling — never left armed for a real click.
    setTimeout(() => { programmaticFocusRef.current = false; }, 0);
  };
  // …AND IT WAITS FOR THE RESET TO SETTLE. The reset sets five pieces of state; a caret placed on
  // a guessed timer races that flush, and a re-render lands it back on <body>. Two frames is the
  // honest wait: the first is scheduled before React's flush completes, the second runs after the
  // resulting paint — so the textarea we focus is the one the reader is actually looking at. No
  // duration is guessed, so it cannot rot on a slower machine.
  const focusComposerWhenSettled = () => {
    if (typeof requestAnimationFrame !== 'function') { focusComposerQuietly(); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => focusComposerQuietly()));
  };
  // Which assistant turn TYPES in live (only the newest — history never re-animates). Staged via a
  // ref from the setTurns updater (no setState-in-updater), committed by the effect below.
  const [animateIdx, setAnimateIdx] = useState<number | null>(null);
  const pendingAnimate = useRef<number | null>(null);
  useEffect(() => {
    if (pendingAnimate.current !== null) { setAnimateIdx(pendingAnimate.current); pendingAnimate.current = null; }
  }, [turns.length]);
  // Pin to the latest turn — CONTAINER-scoped (never scrolls the page), on new turns AND on open
  // (the grid transition needs a beat before the height is real).
  const pinToEnd = () => {
    const el = shellRef.current?.querySelector<HTMLElement>('.overflow-y-auto');
    if (el) el.scrollTop = el.scrollHeight;
  };
  useEffect(() => { pinToEnd(); const tm = window.setTimeout(pinToEnd, 320); return () => window.clearTimeout(tm); }, [turns.length, busy]);
  // While the newest answer TYPES, keep the container pinned to the growing text.
  useEffect(() => {
    if (animateIdx === null) return;
    let raf = 0; const start = performance.now();
    const tick = (now: number) => { pinToEnd(); if (now - start < 6000) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animateIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRef = (r: Ref) => { if ('href' in r && r.href) router.push(r.href); };

  // ── THE ABSORPTION, BRICK 1 (Aug 6 — the doc's verified contract): addressing a coworker
  // ("Clara, …" / "@Clara …") routes the message through the WORKER ENGINE (full capability:
  // tools, memory, skills) and STREAMS the reply into this panel with their attribution. The
  // conversation lives in the worker's own store (work_threads/work_messages — never
  // double-persisted into chat rooms); listing those conversations here is brick 2. ──
  const rosterRef = useRef<Array<{ id: string; name: string }> | null>(null);
  // ONE FLIGHT PER MOUNT: the roster is warmed on mount AND awaited by the open path — without an
  // in-flight promise the two race and fetch it twice (the second one landing behind the first,
  // for nothing). The promise IS the dedupe; the ref is the settled answer.
  const rosterFlight = useRef<Promise<Array<{ id: string; name: string }>> | null>(null);
  const [, rosterTick] = useState(0); // re-render once the roster lands (the @-row reads a ref)
  const getRoster = async (): Promise<Array<{ id: string; name: string }>> => {
    if (rosterRef.current) return rosterRef.current;
    if (rosterFlight.current) return rosterFlight.current;
    rosterFlight.current = (async () => {
      try {
        const d = await fetch('/api/workers/mentions?types=coworker').then((r) => (r.ok ? r.json() : null));
        rosterRef.current = ((d?.results ?? []) as Array<{ type: string; id: string; label: string }>)
          .filter((x) => x.type === 'coworker').map((x) => ({ id: x.id, name: x.label }));
      } catch { rosterRef.current = []; }
      rosterFlight.current = null;
      rosterTick((t) => t + 1);
      return rosterRef.current;
    })();
    return rosterFlight.current;
  };
  const detectAddress = (q: string, roster: Array<{ id: string; name: string }>) => {
    const m = q.match(/^@?([A-Za-zÀ-ÿ]+)(?:[\s,:!—–-]|$)/);
    if (!m) return null;
    const w = m[1].toLowerCase();
    return roster.find((r) => r.name.split(' ')[0].toLowerCase() === w) ?? null;
  };
  // Get-or-create the coworker's Home DM thread (cached; the worker's page shows the same thread).
  // The DM pointer — v2 key: v1 took threads[0] (most-recent) and could GLUE the Home DM onto a
  // delegation/report thread ("Handed to Clara: …", found live Aug 7). The DM is its own
  // "Chat with <name>" thread — found by title, created if absent; old v1 keys are orphaned.
  const dmKey = (agentId: string) => `aug-dm2-${agentId}`;
  // THE MAPPING IS READ SYNCHRONOUSLY (the open path's first cut): knowing the address is what
  // lets the click go straight to the thread's messages. Stamped through the house cache — read
  // AGELESS, because a thread id is durable identity and never decays into a false claim (a
  // deleted thread fails loudly at the messages door, which is the honest place to find out).
  // Legacy raw-string values written before the stamp still read back (loadLS passes a
  // non-envelope through when no freshness is demanded) and re-save stamped on the next open.
  const cachedDmThread = (agentId: string): string | null => {
    const v = loadLS<string>(dmKey(agentId));
    return typeof v === 'string' && v ? v : null;
  };

  // ONE CONTINUOUS THREAD (owner, Aug 13 — the Slack model): a coworker is a PERSON, the
  // relationship is continuous, and time is the only separator. The DM-history popover and
  // "New session" are gone — scroll-back is the history; the sidebar's All conversations still
  // lists the thread. No session chrome sits between the user and their colleague.
  const dmThread = async (w: { id: string; name: string }): Promise<string | null> => {
    const cached = cachedDmThread(w.id);
    if (cached) return cached;
    let id: string | null = null;
    const title = `Chat with ${w.name.split(' ')[0]}`;
    try {
      const d = await fetch(`/api/work/threads?agent_id=${w.id}`).then((r) => (r.ok ? r.json() : null));
      // Past "New session" clicks may have left SEVERAL "Chat with <name>" threads behind; the
      // continuous thread is the NEWEST one. `/api/work/threads` orders `updated_at` DESC (see
      // app/api/work/threads/route.ts GET), so the first title match IS the most recent — the
      // sort is the assumption this .find() rides on.
      id = ((d?.threads ?? []) as Array<{ id: string; title?: string | null }>)
        .find((t) => String(t.title ?? '').startsWith('Chat with'))?.id ?? null;
      if (!id) {
        const c = await fetch('/api/work/threads', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, agentId: w.id }),
        }).then((r) => (r.ok ? r.json() : null));
        id = (c?.thread?.id as string) ?? null;
      }
    } catch { /* honest failure below */ }
    if (id) saveLS(dmKey(w.id), id);
    return id;
  };
  // (A DM has no "new session" door — see the one-continuous-thread law above.)

  const askWorker = async (
    question: string, w: { id: string; name: string },
    extra?: { mentions?: Array<{ id: string; type: string; label: string }>; files?: File[]; echoed?: boolean },
  ) => {
    const fileNote = extra?.files?.length ? ` (attached: ${extra.files.map((f) => f.name).join(', ')})` : '';
    setOpen(true);
    if (!extra?.echoed) setTurns((prev) => [...prev, { role: 'user', text: question, sent: question + fileNote, ...(extra?.files?.length ? { chips: extra.files.map((f) => f.name) } : {}) }]);
    setTurns((prev) => [...prev, { role: 'assistant', text: '', author: w.name, authorId: w.id }]);
    setBusy(true);
    // THE EXCHANGE SURVIVES THE TAB — a coworker addressed FROM the Home thread is speaking in
    // THIS room (worker mode has its own store and persistTurn structurally opts out there), and
    // until now nothing of that exchange was written: the reload found the room empty and every
    // card the coworker produced died with it. The ask persists NOW, the answer when it lands.
    persistTurn('user', question + fileNote);
    const patchLast = (text: string) => setTurns((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant' && last.author === w.name) next[next.length - 1] = { ...last, text };
      return next;
    });
    try {
      const tid = await dmThread(w);
      if (!tid) throw new Error('no thread');
      // Buffered files upload NOW, to the addressed thread (the worker chat's own attach door).
      let attachments: Array<{ id: string; name: string }> = [];
      if (extra?.files?.length) {
        try {
          const fd = new FormData();
          extra.files.forEach((f) => fd.append('file', f));
          const up = await fetch(`/api/work/threads/${tid}/chat-attach`, { method: 'POST', body: fd });
          attachments = up.ok
            ? (((await up.json()).attachments ?? []) as Array<{ chatAttachId: string; filename: string }>).map((r) => ({ id: r.chatAttachId, name: r.filename }))
            : [];
        } catch { attachments = []; }
      }
      const res = await fetch(`/api/work/threads/${tid}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: question, agentId: w.id,
          ...(extra?.mentions?.length ? { mentions: extra.mentions } : {}),
          ...(attachments.length ? { attachments } : {}),
        }),
      });
      if (!res.ok || !res.body) throw new Error('stream failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = ''; let lineBuffer = '';
      const cards: NonNullable<Turn['cards']> = [];
      const drafts: NonNullable<Turn['drafts']> = [];
      const wfDrafts: WorkflowDraft[] = [];
      const invites: NonNullable<Turn['invites']> = [];
      // THE CARD CONTRACT: every card this exchange produces also records its POINTER, so the
      // turn that lands in the room can be rebuilt from the cards' own homes on the next open.
      const refs: WorkerCardRef[] = [];
      const threadHref = `/home?chat=worker:${tid}:${w.id}`;
      const first = w.name.split(' ')[0];
      // THE ARTIFACT ARRIVES OPEN + STAYS CURRENT (Aug 7-8): EVERY document arrival summons/
      // refreshes the pane to the newest version — so "make it shorter" in the same exchange
      // updates the open document in place (the Claude edit loop). The card stays the durable
      // re-open affordance.
      const setCards = () => setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && last.author === w.name) next[next.length - 1] = { ...last, cards: [...cards], drafts: [...drafts], workflowDrafts: [...wfDrafts], invites: [...invites] };
        return next;
      });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              type?: string; delta?: string; label?: string; name?: string;
              artifact?: { id?: string; title?: string; type?: string }; draft?: CoworkerEmailDraft;
              card?: { id?: string; invite?: PreparedInviteLike };
            };
            if (event.type === 'text') { acc += event.delta ?? ''; patchLast(acc); }
            else if (event.type === 'text_clear') { acc = ''; patchLast(acc); }
            else if (event.type === 'tool_start') patchLast(`${acc}${acc ? '\n\n' : ''}· ${event.label ?? event.name ?? 'working'}…`);
            else if (event.type === 'tool_result') patchLast(acc);
            // THE DELIVERABLES SURFACE (brick 3 — the one surface owns its outputs): a document
            // opens the artifact panel HERE; an email draft mounts the SAME editable send card
            // the worker page uses, inline. Only registry renders still point at their page.
            else if (event.type === 'artifact_ready' && event.artifact?.title && event.artifact.id) {
              // The word matches the kind ONLY when the stream states it — never guessed
              // (frames plan law 1: a frame is a deliverable KIND). The card's door is the same
              // artifact panel, which renders a frame through the ONE renderer.
              // A DOCUMENT arrives as THE HANDLE (attention-plan D) — glyph, type word, owner —
              // and its deed is Review. A frame is a different deliverable kind and keeps its own
              // pointer (never a doc handle over a rendered thing).
              const docKind = event.artifact.type === 'frame' ? null : docCardTypeOf(event.artifact.type, null);
              cards.push({
                label: event.artifact.title, sub: `${event.artifact.type === 'frame' ? 'frame' : 'document'} · by ${first}`,
                art: { tid, id: event.artifact.id },
                ...(docKind ? { doc: { type: docKind.type, typeLabel: docKind.label, owner: first } } : {}),
              });
              refs.push({ kind: 'document', tid, artifactId: event.artifact.id }); setCards();
              void openArtifact(tid, event.artifact.id);
            }
            else if (event.type === 'artifact' && event.artifact) {
              // A typed REGISTRY render is the one card with no identity of its own in this
              // payload — it stays a link to the thread that holds it, and points at nothing.
              cards.push({ label: event.artifact.title ?? event.artifact.type ?? 'Prepared work', sub: `by ${first}`, href: threadHref }); setCards();
            }
            else if (event.type === 'email_draft' && event.draft) {
              drafts.push({ draft: event.draft, tid, agentId: w.id });
              if (event.draft.id) refs.push({ kind: 'email_draft', tid, agentId: w.id, draftId: event.draft.id });
              setCards();
            }
            else if (event.type === 'workflow_draft' && event.draft) {
              const wd = event.draft as unknown as WorkflowDraft;
              wfDrafts.push(wd);
              if (wd.token) refs.push({ kind: 'workflow_draft', tid, token: wd.token });
              setCards();
            }
            // THE INVITE CARD reaches this lane too: the DM emits it, and it mounts through the
            // same host the chief's own invites use — one rendering, and now a durable one.
            else if (event.type === 'invite_card' && event.card?.id && event.card.invite) {
              invites.push({ inviteId: event.card.id, invite: event.card.invite });
              refs.push({ kind: 'invite', tid, inviteId: event.card.id }); setCards();
            }
          } catch { /* partial frame */ }
        }
      }
      const made = cards.length || drafts.length || wfDrafts.length || invites.length;
      const said = acc.trim() || (made ? `${first} produced the work below.` : `${first} finished without a written reply.`);
      patchLast(said);
      if (made) setCards();
      // A CARD IS A TURN: the answer lands in the room WITH every card's pointer, so the next open
      // rebuilds them through the same hosts. Each pointer names the card's OWN home — the DM
      // message's metadata (draft · invite · workflow draft) or the thread's artifact row — never
      // a frozen duplicate that could claim "unsent" after the DM twin sent it, offer Confirm on
      // an already-live task, or show a document at a version it no longer has.
      persistTurn('system', said, undefined, {
        authorAgentId: w.id,
        ...(refs.length ? { component: { key: 'worker_cards', refId: tid, state: { items: refs } } } : {}),
      });
    } catch {
      patchLast(`Couldn't reach ${w.name.split(' ')[0]} right now — try again in a moment.`);
    } finally { setBusy(false); }
  };

  // The browser's File.type is unreliable for dragged Office files (often empty) — the
  // extension is the truth of last resort. An octet-stream mime made the presign 400 and the
  // attach VANISH silently (found live: "docx, pptx don't work").
  const mimeFor = (f: File): string => {
    if (f.type) return f.type;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      pdf: 'application/pdf', doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      csv: 'text/csv', txt: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp',
    };
    return map[ext] ?? 'application/octet-stream';
  };

  // Chief-side attachments land in the KNOWLEDGE BASE (presign → PUT → confirm+index) so the
  // brain can find/compute over them immediately — the lawful chief attach (files live with
  // the knowledge, not in a chat blob). Returns the filenames that made it.
  const uploadToKB = async (files: File[]): Promise<string[]> => {
    try {
      const pres = await fetch('/api/drive/upload/presign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: files.map((f) => ({ filename: f.name, mimeType: mimeFor(f), size: f.size })) }),
      }).then((r) => (r.ok ? r.json() : null));
      const uploads = (pres?.uploads ?? []) as Array<{ signedUrl: string; storagePath: string; filename: string; mimeType: string }>;
      const done: string[] = [];
      for (const u of uploads) {
        const f = files.find((x) => x.name === u.filename);
        if (!f) continue;
        const put = await fetch(u.signedUrl, { method: 'PUT', headers: { 'Content-Type': u.mimeType }, body: f });
        if (!put.ok) continue;
        const conf = await fetch('/api/drive/upload/confirm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: u.storagePath, filename: u.filename, mimeType: u.mimeType }),
        });
        if (conf.ok) done.push(u.filename);
      }
      return done;
    } catch { return []; }
  };

  // THE ONE ROUTING (the consolidation's brain): a coworker MENTION is the address; else the
  // typed address; else the chief. Files follow the route — the addressed thread's attach door,
  // or the knowledge base. Temporary mode: no worker routing, no uploads (both stores persist).
  const handleSubmit = async (text: string, mentions: Array<{ id: string; type: 'coworker' | 'task' | 'document'; label: string }>) => {
    const question = text.trim();
    const files = pendingFiles;
    if ((!question && !files.length) || busy) return;
    if (temp && files.length) {
      setPendingFiles([]);
      setTurns((prev) => [...prev, { role: 'assistant', text: 'Attachments are off in a temporary chat (they would persist). Switch Temporary off to attach.' }]);
      return;
    }
    setPendingFiles([]);
    // THE INSTANT ECHO (owner, Aug 6 — "looked like nothing happened"): the submitted turn and
    // the busy line land SYNCHRONOUSLY, before any routing/roster/upload awaits. Feedback is
    // never gated on the network.
    const fileNote = files.length ? ` (attached: ${files.map((f) => f.name).join(', ')})` : '';
    const shown = (question || 'Attached files.') + fileNote;
    setOpen(true);
    // The bubble shows the user's OWN words + chips for what rode with them; `sent` keeps the
    // literal string the brain was given (the attachment note included), so history stays exact.
    const chips = [...files.map((f) => f.name), ...mentions.map((m) => m.label)];
    setTurns((prev) => [...prev, { role: 'user', text: question || 'Attached files.', sent: shown, ...(chips.length ? { chips } : {}) }]);
    setBusy(true);
    try {
      if (!temp) {
        // Address resolution: an explicit @-mention wins → the OPEN worker conversation continues
        // (worker mode) → the typed address ("Clara, …") → else the chief.
        const cw = mentions.find((m) => m.type === 'coworker');
        const w = cw ? { id: cw.id, name: cw.label }
          : (workerRoomRef.current ?? detectAddress(question, await getRoster()));
        if (w) {
          await askWorker(question || 'Here are the files.', w, {
            mentions: mentions.filter((m) => !(m.type === 'coworker' && m.id === w.id)),
            files, echoed: true,
          });
          return;
        }
      }
      await askChief(question, files, mentions, shown);
    } finally { setBusy(false); setStage(null); setLiveText(''); liveTextRef.current = ''; }
  };

  // THE ATTACHED MATERIAL (Aug 10, the production hand-off): extract the files' text NOW so it
  // rides the ask itself — the KB upload (durable copy) indexes in the background and a
  // "fill this in" must never race it. Best-effort; the KB note still lands either way.
  const extractAttachments = async (files: File[]): Promise<Array<{ name: string; text: string | null; image?: { dataB64: string; mime: string }; file?: { dataB64: string; ext: string } }>> => {
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('file', f));
      const res = await fetch('/api/home/extract-attach', { method: 'POST', body: fd });
      if (!res.ok) return [];
      return ((await res.json()).attachments ?? []) as Array<{ name: string; text: string | null }>;
    } catch { return []; }
  };

  // Chief path — KB-upload files first; mention labels ride as grounding hints.
  const askChief = async (
    question: string, files: File[],
    mentions: Array<{ id: string; type: 'coworker' | 'task' | 'document'; label: string }>, shown: string,
  ) => {
    let sendQ = question;
    let attachments: Array<{ name: string; text: string | null; image?: { dataB64: string; mime: string }; file?: { dataB64: string; ext: string } }> = [];
    if (files.length) {
      setStage('Reading the files…');
      const [done, extracted] = await Promise.all([uploadToKB(files), extractAttachments(files)]);
      attachments = extracted;
      if (done.length) { sendQ += `\n[Attached to the knowledge base just now: ${done.join(', ')}]`; }
      else if (!question) { setTurns((prev) => [...prev, { role: 'assistant', text: 'The upload did not go through — try again, or use the Knowledge page.' }]); return; }
      // A partial failure says so OUT LOUD — a vanished attachment reads as "it doesn't work".
      const failed = files.filter((f) => !done.includes(f.name));
      if (failed.length) {
        void import('sonner').then(({ toast }) =>
          toast.error(`Could not attach: ${failed.map((f) => f.name).join(', ')}`));
      }
    }
    const hints = mentions.filter((m) => m.type !== 'coworker').map((m) => m.label);
    if (hints.length) sendQ += ` (about: ${hints.join('; ')})`;
    // History excludes the just-echoed user turn (it rides as `question`). An assistant turn
    // that produced a document sends its card ref along (REVISION-IN-PLACE: "make the chart
    // blue" must resolve to THAT artifact, not mint a second one).
    const history = turns.map((t) => {
      const artCard = t.cards?.find((c) => c.art);
      return {
        // THE BRAIN READS WHAT IT WAS TOLD — the bubble's clean text is presentation; `sent`
        // (with the attachment note) is the turn as it actually went out.
        role: t.role, text: t.sent ?? t.text,
        ...(artCard?.art ? { artifact: { id: artCard.art.id, threadId: artCard.art.tid, title: artCard.label } } : {}),
      };
    });
    persistTurn('user', shown);
    // THE ANSWER SURVIVES THE TAB (Aug 26, found live): passing the room key makes the SERVER
    // persist the system turn the moment the answer is composed — a mid-stream reload used to
    // leave an orphan room (the ask with no reply). When the key was sent, the client's own
    // answer-persist below is SKIPPED (exactly one writer per turn).
    const sentRoomKey = temp || workerRoomRef.current ? null : chatRoomKey();
    try {
      // STREAMING ASK (Aug 6): SSE — `progress` events narrate the core's live stage (the busy
      // line speaks them), `done` carries the answer. A non-SSE response (error JSON) falls back.
      const res = await fetch('/api/home/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: sendQ, history, stream: true, ...(sentRoomKey ? { roomKey: sentRoomKey } : {}), ...(attachments.length ? { attachments } : {}), ...(scope ? { entityId: scope.id } : {}) }) });
      let d: { answer?: string; refs?: Ref[]; focus?: { id: string; name: string }; options?: Array<{ label: string; say: string }>; artifact?: { id: string; title: string; threadId: string; agentName: string }; artifacts?: Array<{ id: string; title: string; threadId: string; agentName: string }>; workflowDraft?: WorkflowDraft; invite?: { id: string; invite: PreparedInviteLike }; bulkDeed?: { id: string; deed: BulkDeedLike } } = {};
      if (res.body && res.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const frames = buf.split('\n\n'); buf = frames.pop() ?? '';
          for (const f of frames) {
            const line = f.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as { type: string; label?: string; answer?: string; refs?: Ref[]; focus?: { id: string; name: string }; options?: Array<{ label: string; say: string }>; artifact?: { id: string; title: string; threadId: string; agentName: string }; artifacts?: Array<{ id: string; title: string; threadId: string; agentName: string }>; workflowDraft?: WorkflowDraft; invite?: { id: string; invite: PreparedInviteLike }; bulkDeed?: { id: string; deed: BulkDeedLike } };
              if (ev.type === 'progress' && ev.label) setStage(ev.label);
              else if (ev.type === 'token' && (ev as unknown as { t?: string }).t) { liveTextRef.current += (ev as unknown as { t: string }).t; setLiveText(liveTextRef.current); }
              else if (ev.type === 'token_reset') { liveTextRef.current = ''; setLiveText(''); }
              else if (ev.type === 'done') d = ev;
            } catch { /* partial frame */ }
          }
        }
      } else {
        d = await res.json();
      }
      // ARTIFACTS-INTO-ORIGIN (Aug 9): a dispatched deliverable's card rides the answer turn and
      // the viewer opens HERE — the conversation that asked holds the work.
      const artList = d.artifacts?.length ? d.artifacts : d.artifact ? [d.artifact] : [];
      const artCard = artList.length
        ? { cards: artList.map((a) => {
            // The delegation lane ships through the ONE production door's document tier — the
            // kind word this line has always spoken. The glyph follows the same word, never a
            // guess of its own; `openArtifact` refines both from the stored artifact.
            const k = docCardTypeOf('document', null);
            return {
              label: a.title, sub: `document · by ${a.agentName.split(' ')[0]}`,
              art: { tid: a.threadId, id: a.id },
              doc: { type: k.type, typeLabel: k.label, owner: a.agentName.split(' ')[0] },
            };
          }) }
        : {};
      // A token-streamed answer already revealed itself — the typewriter must not re-type it.
      setTurns((prev) => { pendingAnimate.current = liveTextRef.current ? -1 : prev.length; return [...prev, { role: 'assistant', text: d.answer || "I couldn't answer that just now.", refs: d.refs ?? [], ...(d.options?.length ? { options: d.options } : {}), ...(d.workflowDraft ? { workflowDrafts: [d.workflowDraft] } : {}), ...(d.invite ? { invites: [{ inviteId: d.invite.id, invite: d.invite.invite }] } : {}), ...(d.bulkDeed ? { bulkDeeds: [{ deedId: d.bulkDeed.id, deed: d.bulkDeed.deed }] } : {}), ...artCard }]; });
      if (d.artifact) void openArtifact(d.artifact.threadId, d.artifact.id);
      if (d.answer && !sentRoomKey) persistTurn('system', d.answer, d.refs ?? []);
      if (d.focus && !scope && !temp) setScopeHint(d.focus);
    } catch {
      setTurns((prev) => [...prev, { role: 'assistant', text: "Something went wrong reaching your brain — try again." }]);
    } finally { setBusy(false); setStage(null); setLiveText(''); liveTextRef.current = ''; }
  };
  const ask = (q: string) => { void handleSubmit(q, []); };

  // ── THE TIMELINE, DERIVED (Phase 2c — docs/threads-plan.md) ─────────────────────────────────
  // THE ONE THREAD COMPONENT renders BOTH modes of this surface: the Home thread (the CoS seat's
  // own thread) and the coworker DM. The turn store maps to ThreadItem[] and the kit owns order,
  // the three grammars and THE SLACK GROUPING (the bespoke grouping this file used to carry is
  // gone — grouping is a law, and a law lives in one place). Every rich render the panel already
  // had — the ref-chipped answer with its typewriter, the editable email draft, the workflow
  // draft card, the utterance chips — is MOUNTED WHOLE through the `custom` card slot; produced
  // documents speak the grammar's own `deliverable` card. A port is a mount, never a rewrite.
  //
  // THE VOICE HAS A FACE: an unauthored answer is the CoS speaking, so it wears the seat-holder's
  // face + name + the constant "chief of staff" label (resolveCosSeat is the ONE resolver behind
  // /api/workers/cos-seat — no name or headshot is chosen here). A worker-less account resolves to
  // no seat: we then speak as the resolver's own fallback name, unlabelled, never a minted persona.
  const items = useMemo<ThreadItem[]>(() => {
    const dm = workerRoomRef.current;
    const out: ThreadItem[] = [];
    const seatId = cosSeat?.agentId ?? 'cos';
    const seatName = cosSeat?.name ?? 'Your assistant';
    const seatLabel = cosSeat ? 'chief of staff' : undefined;

    turns.forEach((t, i) => {
      const key = `t${i}`;
      // THE DATE DIVIDER (ONE CONTINUOUS THREAD, owner, Aug 13 — the Slack model): in a DM, time
      // is the only separator. A live-session turn carries no `at` — we never guess when it was
      // spoken, so it never earns a divider.
      const prevAt = turns[i - 1]?.at;
      if (dm && t.at && prevAt && dayKey(t.at) !== dayKey(prevAt)) {
        out.push({ type: 'divider', id: `${key}-day`, variant: 'day', label: dayLabel(t.at) });
      }

      if (t.role === 'user') {
        const cards: ThreadCard[] = [];
        if (t.chips?.length) {
          cards.push({
            kind: 'custom', id: `${key}-chips`,
            node: (
              <span className="flex flex-wrap justify-end gap-1.5">
                {t.chips.map((c, j) => (
                  <span key={j} className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11.5px] text-neutral-500">{c}</span>
                ))}
              </span>
            ),
          });
        }
        out.push({
          type: 'user_bubble', id: key,
          text: t.text,
          ...(cards.length ? { cards } : {}),
        });
        return;
      }

      const cards: ThreadCard[] = [];
      if (t.text) {
        cards.push({
          kind: 'custom', id: `${key}-body`,
          node: <AnimatedAnswer text={t.text} refs={t.refs ?? []} onOpen={openRef} animate={!t.author && i === animateIdx} />,
        });
      }
      // A produced document speaks the grammar's own card — a DOCUMENT opens the artifact panel
      // HERE (brick 3); a registry render still points at its page.
      (t.cards ?? []).forEach((c, j) => cards.push(
        // THE REVIEW-FIRST DOC CARD (attention-plan D): a produced DOCUMENT is a handle whose one
        // deed is Review — and Review raises THE ONE artifact panel (the player), right here.
        // The document itself never enters the thread. Everything else keeps the generic pointer.
        c.doc && c.art
          ? {
              kind: 'doc', id: `${key}-doc-${j}`, title: c.label,
              docType: c.doc.type, typeLabel: c.doc.typeLabel,
              ...(c.doc.owner ? { owner: c.doc.owner } : {}),
              ...(c.doc.versionLabel ? { versionLabel: c.doc.versionLabel } : {}),
              onReview: () => void openArtifact(c.art!.tid, c.art!.id),
            }
          : {
              kind: 'deliverable', id: `${key}-doc-${j}`, title: c.label, meta: c.sub, icon: 'document',
              openLabel: 'Open →',
              onOpen: () => { if (c.art) void openArtifact(c.art.tid, c.art.id); else if (c.href) router.push(c.href); },
            },
      ));
      // THE EMAIL CARD — one rendering per kind: the Home thread mounts the SAME component the
      // coworker DM and the item rooms mount, and its Send is the same coworker door.
      (t.drafts ?? []).forEach((d, j) => cards.push({
        kind: 'custom', id: `${key}-email-${j}`,
        node: <EmailCard coworker={{ threadId: d.tid, agentId: d.agentId, draft: d.draft }} />,
      }));
      (t.workflowDrafts ?? []).forEach((wd, j) => cards.push({
        kind: 'custom', id: `${key}-wf-${j}`, node: <WorkflowDraftCard draft={wd} />,
      }));
      // THE INVITE CARD — the SAME component the item rooms mount (one rendering per kind); its
      // Send goes through the chat lane's commit door. The open row focuses the composer, where
      // "how about Friday?" is just words.
      (t.invites ?? []).forEach((iv, j) => cards.push({
        kind: 'custom', id: `${key}-invite-${j}`,
        node: <InviteCard chat={iv} onSuggestAnother={focusComposer} />,
      }));
      // THE BULK DEED — the same host the ledger's verb rows will mount (one rendering per kind);
      // its one button is the one commit door.
      (t.bulkDeeds ?? []).forEach((bd, j) => cards.push({
        kind: 'custom', id: `${key}-bulk-${j}`,
        node: <BulkDeedCard deedId={bd.deedId} deed={bd.deed} />,
      }));
      // THE SENSIBLE ASK — a tap SPEAKS its message through the composer (clicks are utterances);
      // the chips consume on tap (ephemeral scaffolding).
      if (t.options?.length) {
        cards.push({
          kind: 'custom', id: `${key}-options`,
          node: (
            <span className="flex flex-wrap gap-1.5">
              {t.options.map((o, j) => (
                <button key={j} disabled={busy}
                  onClick={() => {
                    setTurns((prev) => prev.map((x, ix) => (ix === i ? { ...x, options: undefined } : x)));
                    void handleSubmit(o.say, []);
                  }}
                  className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-50">
                  {o.label}
                </button>
              ))}
            </span>
          ),
        });
      }
      // THE ANSWER STREAMS INTO THE VISIBLE BUBBLE: an addressed coworker's reply is already its
      // own turn, patched as the tokens land — while it is in flight the AVATAR carries the state.
      const inFlight = busy && i === turns.length - 1;
      out.push({
        type: 'actor_bubble', id: key,
        actorId: t.authorId ?? t.author ?? seatId,
        actorName: t.author ?? seatName,
        actorRoleLabel: t.author ? undefined : seatLabel,
        ...(inFlight ? { status: 'working' as const, statusHint: stage ?? `${(t.author ?? seatName).split(' ')[0]} is replying` } : {}),
        ...(cards.length ? { cards } : {}),
      });
    });

    // The chief's own reply has no turn until the `done` frame lands — while it is in flight it is
    // the seat's working bubble, carrying the live token text (or the core's stage line).
    const last = turns[turns.length - 1];
    if (busy && !(last && last.role === 'assistant')) {
      out.push({
        type: 'actor_bubble', id: 'streaming', actorId: seatId, actorName: seatName,
        actorRoleLabel: seatLabel, status: 'working', statusHint: stage ?? 'Thinking…',
        cards: [{
          kind: 'custom', id: 'streaming-body',
          node: liveText ? (
            <span className="block whitespace-pre-wrap text-[13.5px] leading-relaxed text-neutral-800">
              {liveText}<span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-indigo-400 align-text-bottom" />
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[13px] text-neutral-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-300" />{stage ?? 'Thinking…'}
            </span>
          ),
        }],
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, busy, stage, liveText, animateIdx, cosSeat]);

  const hasThread = turns.length > 0;
  // THE DM'S HEADER, TAKEN FROM WHAT WE ALREADY KNOW: face · name · role. Recomputed only when the
  // actor changes — the presence read is a cache read, but it is still JSON, and a header is not
  // a thing that should re-derive on every keystroke.
  const dmHeader = useMemo(() => (dmActor
    ? {
        title: dmActor.name,
        leadFace: { id: dmActor.id, name: dmActor.name },
        ...(presenceRoleLabel(dmActor.id) ? { subtitle: presenceRoleLabel(dmActor.id) } : {}),
      }
    : undefined), [dmActor]);
  // THE COLD PATH WEARS THE THREAD'S OWN SHAPE (owner walk, Sep 7): a DM that has nothing cached
  // waits under three bubble-shaped placeholders, not a blank pane. It never shows once ANY turn
  // is painted — a skeleton beside real content is a second claim about the same thread.
  // ONE SKELETON, BOTH LANES (Sep 18): the chat door waits under exactly this shape too — a second
  // placeholder for the same wait would be a second claim about the same pane.
  const openingSkeleton = (dmLoading || chatLoading) && !hasThread ? (
    <div className="space-y-5 py-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`flex gap-2.5 ${i === 1 ? 'justify-end' : ''}`}>
          {i !== 1 && <span className="h-7 w-7 flex-shrink-0 animate-pulse rounded-full bg-neutral-200/70" />}
          <span className={`h-[52px] animate-pulse rounded-2xl bg-neutral-200/50 ${i === 1 ? 'w-[42%]' : 'w-[62%]'}`} />
        </div>
      ))}
    </div>
  ) : null;
  // THE CONVERSATION IS A PAGE (owner, Aug 6 — "conversation-focused page, not a component"; a
  // hover-out must NEVER collapse a live conversation): once turns exist and the panel is open,
  // the thread OWNS the page — no hover gating, no outside-click close. Leaving is EXPLICIT:
  // Close (hands the dashboard back, the conversation stays and re-opens on focus), or New.
  const [open, setOpen] = useState(false);
  // A DM TAKES THE PAGE THE MOMENT IT IS ADDRESSED — not when its first turn lands. Waiting for
  // turns is what made a cold DM read as a dead click: the pane, the face and the name are known
  // at click time, so they paint at click time and the skeleton holds the timeline's place.
  // …and a CHAT takes it the moment its key is known (`chatRoom`) — the same law, the same instant.
  const showThread = open && (hasThread || !!dmActor || !!chatRoom);
  // THE DM IS A FULL PANE, THE HOME CHAT IS A COLUMN (owner walk, Sep 7 — the DM "looks off"). The
  // frozen board puts the DM's header at the TOP EDGE of the content area with the timeline
  // directly beneath and the composer at the bottom: one pane, one scroller. That geometry needs
  // the HOST to stop treating this mount as the Home's sticky floor, so the takeover event carries
  // its MODE. The Home chat's own layout is untouched — `mode: 'home'` is exactly what it had.
  const dmPane = showThread && !!dmActor;
  // THE PAGE TAKEOVER (owner, Aug 6 — "doesn't transition to a chat page"): a live conversation
  // OWNS the page — the host hides the deck behind it (Claude's arrival feel); closing hands the
  // dashboard back.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('aug:chat-active', { detail: { active: showThread, mode: dmPane ? 'dm' : 'home' } }));
  }, [showThread, dmPane]);
  // Unmount (a lens switch) hands the page back — a stale takeover must never hide the header.
  useEffect(() => () => { window.dispatchEvent(new CustomEvent('aug:chat-active', { detail: { active: false } })); }, []);
  // Re-pin to the latest turn when the thread reveals (the grid transition needs a beat).
  useEffect(() => { const tm = window.setTimeout(pinToEnd, 320); return () => window.clearTimeout(tm); }, [showThread]); // eslint-disable-line react-hooks/exhaustive-deps
  // THE COMPOSER KEEPS ITS CARET ACROSS THE TAKEOVER: the box moves from the page into the kit's
  // composer seat the moment the first turn lands, which remounts it. The text is already sent (the
  // box cleared itself), so nothing is lost but the caret — and losing the caret mid-conversation
  // reads as the app taking the keyboard away. We hand it straight back, once, quietly.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (showThread && !wasOpenRef.current) focusComposerWhenSettled();
    wasOpenRef.current = showThread;
  }, [showThread]); // eslint-disable-line react-hooks/exhaustive-deps
  // ── THE COMPOSER SEAT, TAKEN WHOLE (docs/threads-plan.md — "a slot is data, not a fork") ──
  // The Home box is the ONE composer this surface shares with every coworker DM: the @ picker, the
  // attach + drag-and-drop door, the buffered files, the scope chip, the temporary toggle and the
  // send contract. It sits in the kit's composer SEAT unchanged — a rewrite of it was deliberately
  // deferred as too delicate, and a port is a mount. It is rendered from ONE definition in both
  // states (at rest on the Home, and in the seat once the thread takes the page) so a first
  // message never remounts the box under the reader's hands.
  const composerBlock = (
    <>
        {/* Suggestions ABOVE the input (the floor anatomy: nothing sits below the composer) +
            the quiet TEMPORARY toggle, armable only before the conversation starts.
            THE TOGGLE DOES NOT RIDE THE CHIPS (Sep 13): the warm Home's standing chips were
            retired by owner call, and the row's guard used to require chips to exist — so
            removing them would have taken the Temporary control with them. The row is the
            PRE-CONVERSATION row; a caller with no suggestions simply renders no chips. */}
        {!hasThread && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
            {suggestions.map((s) => (
              <button key={s} onClick={() => (s.endsWith('…') ? (setPrefill(s.slice(0, -1) + ' '), focusComposer()) : ask(s))} disabled={busy} className="rounded-full border border-neutral-200 bg-white/80 px-3 py-1.5 text-[12px] text-neutral-600 hover:border-indigo-300 hover:text-indigo-700 hover:bg-white transition-all duration-150">{s}</button>
            ))}
            <button onClick={() => setTemp((v) => !v)}
              title={temp ? 'This conversation will NOT be saved' : 'Start a conversation that is never saved or remembered'}
              className={`ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${temp ? 'bg-amber-50 text-amber-600' : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100'}`}>
              <EyeSlashIcon className="w-3.5 h-3.5" /> Temporary
            </button>
          </div>
        )}
        {/* THE ONE COMPOSER (workstream 3 — the consolidation): WorkerMentionInput is the SAME
            component the worker surfaces use — @ opens the Coworkers/Tasks/Documents picker,
            📎 buffers files (uploaded on send), Enter submits. A coworker mention IS the address;
            files route to the addressed thread (chat-attach) or into the knowledge base (chief). */}
        <div
          ref={composerWrapRef}
          onFocusCapture={() => { if (!programmaticFocusRef.current) setOpen(true); }}
          className="rounded-2xl border overflow-hidden transition-all duration-300 border-neutral-200 bg-white shadow-[0_4px_28px_-12px_rgba(23,23,23,0.22)] focus-within:border-indigo-300 focus-within:shadow-[0_4px_32px_-10px_rgba(79,70,229,0.28)]">
          <WorkerMentionInput
            frameless
            onSubmit={(text, mentions) => { void handleSubmit(text, mentions); }}
            disabled={busy}
            placeholder={workerRoomRef.current ? `Message ${workerRoomRef.current.name.split(' ')[0]}… — @ pulls a teammate's work or a document in` : "Ask anything — @ mentions your team"}
            prefill={prefill}
            onPrefillConsumed={() => setPrefill(null)}
            onAttach={(files) => setPendingFiles((p) => [...p, ...files])}
            attachments={pendingFiles.map((f, i) => ({ id: `${i}-${f.name}`, name: f.name, size: f.size }))}
            onRemoveAttachment={(id) => setPendingFiles((p) => p.filter((f, i) => `${i}-${f.name}` !== id))}
            accessory={temp ? (
              <span className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-500" title="This conversation won't be saved and won't appear in your conversations">
                <EyeSlashIcon className="w-3.5 h-3.5" />Temporary — not saved
              </span>
            ) : !workerRoomRef.current ? (
              // THE SCOPE CHIP lives WITH the composer (owner, Aug 7): where the words are
              // written is where their destination is set. Scoped, the chip is the room's door.
              <span ref={scopeChipRef} className="relative inline-flex">
                {scope ? (
                  <span className="flex items-center rounded-lg hover:bg-indigo-50/60 transition-colors">
                    <button onClick={() => router.push(projectHref(scope.id))} title="Open the project room"
                      className="flex items-center gap-1 pl-2.5 pr-1 py-1.5 text-[12px] text-indigo-600 hover:text-indigo-800 transition-colors">
                      <FolderIcon className="w-3.5 h-3.5" /> {scope.name} ✓
                    </button>
                    {/* Manage — change or remove the project (the binding is editable, any time). */}
                    <button onClick={() => setScopeOpen((v) => !v)} title="Change or remove the project"
                      className="pr-2 pl-0.5 py-1.5 text-[10px] text-indigo-300 hover:text-indigo-600 transition-colors">▾</button>
                  </span>
                ) : scopeHint ? (
                  <span className="flex items-center rounded-lg bg-indigo-50/70">
                    <button onClick={() => { const h = scopeHint; setScopeHint(null); void adopt(h); }}
                      title={`File this conversation into ${scopeHint.name} — it moves into the project's room`}
                      className="flex items-center gap-1 pl-2.5 pr-1 py-1.5 text-[12px] font-medium text-indigo-700 hover:text-indigo-900 transition-colors">
                      <FolderIcon className="w-3.5 h-3.5" /> About {scopeHint.name}? · File it
                    </button>
                    <button onClick={() => setScopeHint(null)} title="Keep it loose"
                      className="pr-2 pl-1 py-1.5 text-indigo-300 hover:text-indigo-600 transition-colors">×</button>
                  </span>
                ) : (
                  <button onClick={() => setScopeOpen((v) => !v)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors">
                    <FolderIcon className="w-3.5 h-3.5" /> {hasThread ? 'No project' : 'Project'}
                  </button>
                )}
                <AnchoredPopover anchorRef={scopeChipRef} open={scopeOpen} onClose={() => setScopeOpen(false)} align="left" width={240}>
                  <ProjectPickerPanel
                    onSelect={(e) => { void adopt(e); }}
                    onCreateProject={(n) => { void createAndAdopt(n); }}
                    {...(scope ? { onClear: () => { void adopt(null); }, clearLabel: `Remove from ${scope.name}` } : {})}
                  />
                </AnchoredPopover>
              </span>
            ) : undefined}
          />
        </div>
    </>
  );

  return (
    <section className={`w-full ${dmPane ? 'flex min-h-0 flex-1 flex-col' : 'transition-[margin] duration-300 ease-out'} ${artifactPanel ? 'lg:mr-[608px]' : ''}`}>
      {/* PAGE MODE: a live conversation renders directly on the page in a centered reading
          column (Claude's anatomy) — never inside a floating card. With the artifact pane
          docked, the column keeps reading-width beside it (the section margin makes room).
          DM MODE is the board's pane instead: it FILLS the content area, so the header sits at
          the top edge (no dead zone above it, no floating white card mid-page) and the shell's
          own thin scroller is the only scroller — the reading column stays the kit's 760px. */}
      <div ref={shellRef}
        className={dmPane
          ? 'flex min-h-0 flex-1 flex-col'
          : `transition-all duration-300 ease-out ${showThread ? 'max-w-3xl mx-auto w-full' : ''}`}>
        {/* THE TAKEOVER, THROUGH THE ONE THREAD COMPONENT: the conversation IS the page — the kit
            owns the reading column, the three grammars, the grouping and the internal scroll; the
            takeover geometry stays this host's (bounded height, so the thread scrolls inside the
            Home rather than the page under it). The composer keeps its seat as the floor.
            At rest there is no thread and no chrome — just the box, exactly as before.
            DM MODE IS LEGIBLE (owner, Aug 10): the coworker's own face and name lead the header,
            and NOTHING else asks. ONE CONTINUOUS THREAD (owner, Aug 13 — the Slack model): no
            History popover, no New session — the scroll-back IS the history, day dividers mark
            the days, and the sidebar's All conversations still lists the thread. */}
        {showThread ? (
          <ThreadShell
            kind={dmActor ? 'dm' : 'home'}
            className={dmPane ? 'min-h-0 flex-1' : '!bg-transparent max-h-[calc(100vh-200px)] min-h-[46vh]'}
            header={dmHeader}
            beforeTimeline={openingSkeleton}
            items={items}
            composerNode={composerBlock}
          />
        ) : composerBlock}
      </div>
      {/* THE ARTIFACT PANE (brick 3, reworked Aug 8 — owner: "doesn't make sense to have an
          overlay on top of chat; should be workable like Claude"): DOCKED, NON-MODAL — no dim,
          no backdrop; the conversation shifts left (the section's margin) and BOTH stay live.
          Editing is the conversation: "make it shorter" continues the same worker thread, the
          new version arrives, and the pane refreshes to it. Close = the pane's own ✕. */}
      {artifactPanel && (
        <div className="fixed right-0 top-0 z-40 h-screen w-[min(720px,94vw)] border-l border-neutral-200 shadow-[-12px_0_40px_-24px_rgba(23,23,23,0.25)] bg-neutral-50">
          <ThreadArtifactsPanel
            thread={artifactPanel.thread}
            onClose={() => setArtifactPanel(null)}
            initialDetailId={artifactPanel.initialId}
            onArtifactsUpdate={(arts) => setArtifactPanel((p) => (p ? { ...p, thread: { ...p.thread, artifacts: arts } } : p))}
          />
        </div>
      )}
    </section>
  );
}
