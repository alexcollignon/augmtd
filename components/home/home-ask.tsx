'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ASK ZONE — the entry to the brain, at the bottom of the Home below the cards. The reasoned brief
// is its opening context (turn-0); a grounded conversation grows in place below it; a composer with
// state-derived suggested prompts anchors the bottom. Answers are grounded in the ONE registry and cite
// the items they used (chips → the deep-dive). No persona name — the system's own voice (the AUGMTD orb).
// Phase 1: single in-session thread ("New" clears it); History / multi-thread + inline actions come next.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { EyeSlashIcon, FolderIcon } from '@heroicons/react/24/outline';
import { WorkerMentionInput } from '@/components/workers/worker-mention-input';
import { ProjectPickerPanel } from '@/components/work/work-row';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { EmailDraftCard, type EmailDraftData } from '@/components/workers/email-draft-card';
import { WorkflowDraftCard, type WorkflowDraft } from '@/components/workflows/workflow-draft-card';
import { ThreadArtifactsPanel } from '@/components/work/chat-artifact-panel';
import { WorkerFace } from '@/components/work/worker-face';
import { useFeatures } from '@/context/workspace-context';
import type { DocumentArtifact } from '@/lib/types/inbox';
// (BriefingBlock removed from the chat — Phase 3 F2: the prose brief duplicated the deck; the
// composeBriefing machinery survives as the deck's ordering anchor + the daily report.)

type Ref = { id: string; kind: string; label: string; href: string | null };
type Turn = { role: 'user' | 'assistant'; text: string; refs?: Ref[];
  /** THE ABSORPTION (brick 1): a coworker's own reply carries their name — the one-narrator
   *  law's attribution, now in the Home panel. */
  author?: string;
  /** Deliverables the coworker produced in THIS exchange (brick 3 — the one surface owns its
   *  outputs): a DOCUMENT card opens the artifact panel HERE (art), a registry render still
   *  points at its page (href); an EMAIL DRAFT mounts the editable send card INLINE. */
  cards?: Array<{ label: string; sub?: string; href?: string; art?: { tid: string; id: string } }>;
  drafts?: Array<{ draft: EmailDraftData; tid: string; agentId: string }>;
  /** THE ONE CREATION CARD — a drafted workflow awaiting the user's confirm, inline. */
  workflowDrafts?: Array<WorkflowDraft>;
  /** THE SENSIBLE ASK: one consequential decision as tappable options — a tap SPEAKS its `say`
   *  through the composer. Ephemeral scaffolding (never persisted); consumed on tap. */
  options?: Array<{ label: string; say: string }>;
  /** When this turn was SPOKEN (ISO, from work_messages.created_at). Only loaded history carries
   *  it — a live turn has no timestamp until it is reloaded. ONE CONTINUOUS THREAD (the Slack
   *  model, owner, Aug 13): time is the only separator, so a date divider renders where two
   *  consecutive dated turns fall on different days. */
  at?: string };

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

// A long paste must never render as an endless wall (Aug 10 — the pilot's questionnaire filled
// the whole viewport): past ~700 chars the user bubble collapses to its head with an explicit
// expand. The FULL text still went to the brain — this is presentation only.
function UserBubble({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 700;
  return (
    <span className="rounded-2xl rounded-br-sm bg-neutral-100 px-3.5 py-2 text-[13.5px] text-neutral-800 max-w-[80%] whitespace-pre-wrap">
      {long && !open ? `${text.slice(0, 700)}…` : text}
      {long && (
        <button onClick={() => setOpen((v) => !v)}
          className="mt-1 block text-[12px] font-medium text-indigo-600 hover:text-indigo-700">
          {open ? 'Show less' : `Show all (${Math.round(text.length / 1000)}k characters)`}
        </button>
      )}
    </span>
  );
}

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

export default function HomeAsk({ suggestions }: { suggestions: string[] }) {
  const router = useRouter();
  const features = useFeatures(); // the sovereign intake gate (Clara's first-contact question)
  const [turns, setTurns] = useState<Turn[]>([]);
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
    const onNew = () => { setTurns([]); setTemp(false); setScope(null); setScopeHint(null); workerRoomRef.current = null; setOpen(true); setTimeout(() => focusComposer(), 60); };
    const onOpen = (e: Event) => {
      const key = (e as CustomEvent).detail?.key as string | undefined;
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
      workerRoomRef.current = null;
      try { localStorage.removeItem(CHAT_KEY_LS); } catch { /* no LS */ }
      // HOME IS THE CHAT DOOR: the reset above is unchanged (the deck stays the default) — the
      // caret simply lands in the composer so the door is ready to type into. It waits for the
      // reset's own state flush to paint, so the FIRST click lands it (see focusComposerWhenSettled).
      focusComposerWhenSettled();
    };
    // THE FACEPILE'S CHAT VERB (coherence slice #4): open the coworker's DM conversation
    // (find-or-create the "Chat with" thread) — same door as addressing them by name.
    const onDm = (e: Event) => {
      const d = (e as CustomEvent).detail as { agentId?: string; name?: string } | undefined;
      if (!d?.agentId || !d?.name) return;
      setOpen(true);
      void dmThread({ id: d.agentId, name: d.name }).then((tid) => {
        if (tid) void loadWorkerRoom(`worker:${tid}:${d.agentId}`);
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
  const mapServerTurns = (raw: Array<{ role: string; text: string; refs?: Array<{ label: string; href: string | null }> }>): Turn[] =>
    raw.map((t) => ({
      role: t.role === 'user' ? 'user' as const : 'assistant' as const,
      text: t.text,
      refs: (t.refs ?? []).map((r, i) => ({ id: `h${i}`, kind: 'link', label: r.label, href: r.href })),
    }));
  const loadRoom = (key: string) => {
    workerRoomRef.current = null; // switching to a chief chat room leaves worker mode
    if (key.startsWith('chat:')) {
      setScope(null); setScopeHint(null);
      // Scope is SERVER TRUTH (the binding) — per-conversation, survives devices; never a
      // global local cache that bleeds across conversations.
      fetch(`/api/rooms/adopt?key=${encodeURIComponent(key)}`).then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.scope?.id) setScope({ id: d.scope.id, name: d.scope.name }); })
        .catch(() => {});
    }
    fetch(`/api/room/turns?key=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!Array.isArray(d?.turns)) return;
        setTurns(mapServerTurns(d.turns));
        try { localStorage.setItem(CHAT_KEY_LS, key); } catch { /* no LS */ }
      }).catch(() => {});
  };
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
        helps: 'I keep everything you ship on-brand — how your documents look, how your company sounds, and a LinkedIn presence that feels like you.',
        examples: [
          { label: 'Theme my documents', say: 'I will attach our logo — build a brand kit and apply it to the documents the team produces.' },
          { label: 'Review for brand fit', say: 'I will attach a draft — review it for brand consistency in tone and look, and fix what reads off.' },
          { label: 'Draft a LinkedIn post', say: 'Draft a LinkedIn post about a recent team milestone — professional but human.' },
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
    try {
      const d = await fetch(`/api/work/threads/${tid}/messages`).then((r) => (r.ok ? r.json() : null));
      if (!Array.isArray(d?.messages)) return;
      const roster = await getRoster();
      const name = roster.find((x) => x.id === agentId)?.name
        ?? String((d.thread as { title?: string } | null)?.title ?? 'Coworker').replace(/^Chat with /, '');
      // Each loaded turn carries its OWN moment (work_messages.created_at, ascending from the
      // route) — ONE CONTINUOUS THREAD (the Slack model, owner, Aug 13): the scroll-back IS the
      // history, so the day boundary is the only separator the render needs.
      const loaded: Turn[] = (d.messages as Array<{ role: string; content: string; created_at?: string; metadata?: { workflow_drafts?: WorkflowDraft[] } }>)
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && (String(m.content ?? '').trim() || m.metadata?.workflow_drafts?.length))
        .map((m) => (m.role === 'user'
          ? { role: 'user' as const, text: m.content, ...(m.created_at ? { at: m.created_at } : {}) }
          : {
              role: 'assistant' as const, text: m.content, author: name.split(' ')[0],
              ...(m.created_at ? { at: m.created_at } : {}),
              ...(m.metadata?.workflow_drafts?.length ? { workflowDrafts: m.metadata.workflow_drafts } : {}),
            }));
      // Brick 3: the thread's documents ride along — openable HERE, never a page away.
      const arts = ((d.thread as { artifacts?: Array<{ id?: string; title?: string }> } | null)?.artifacts ?? [])
        .filter((a): a is { id: string; title: string } => !!a.id && !!a.title);
      if (arts.length) {
        loaded.push({
          role: 'assistant', author: name.split(' ')[0], text: '',
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
            luca: 'keeps everything you ship on-brand',
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
          loaded.push({ role: 'assistant', author: first, text: `Hi — I'm ${first}. ${intro.helps}${teamLine}` });
          loaded.push({
            role: 'assistant', author: first,
            text: `So the whole team starts with real context — what's your role, and what's the main thing on your plate this week? Anything you tell me here, we all remember. Or jump straight in:`,
            options: [
              { label: 'Draft a meeting agenda', say: 'Draft an agenda for a 30-minute kickoff meeting with a new client.' },
              { label: 'Summarize a document I attach', say: 'I will attach a document — summarize it into one page of key takeaways.' },
              { label: 'Build a checklist', say: 'Make me a checklist for onboarding a new team member.' },
            ],
          });
        } else {
          loaded.push({
            role: 'assistant', author: first,
            text: `${base} A few things I can do right now:`,
            options: intro.examples,
          });
        }
      }
      setTurns(loaded);
      setTimeout(() => focusComposer(), 120);
      workerRoomRef.current = { id: agentId, name };
      setScope(null); setScopeHint(null); // a coworker DM is addressed, never project-scoped from here
      try { localStorage.setItem(dmKey(agentId), tid); localStorage.setItem(CHAT_KEY_LS, key); } catch { /* no LS */ }
    } catch { /* the click already opened the panel — an empty load stays honest */ }
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
  const persistTurn = (role: 'user' | 'system', text: string, refs?: Ref[]) => {
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
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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
  const pinToEnd = () => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; };
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
  const [, rosterTick] = useState(0); // re-render once the roster lands (the @-row reads a ref)
  const getRoster = async (): Promise<Array<{ id: string; name: string }>> => {
    if (rosterRef.current) return rosterRef.current;
    try {
      const d = await fetch('/api/workers/mentions?types=coworker').then((r) => (r.ok ? r.json() : null));
      rosterRef.current = ((d?.results ?? []) as Array<{ type: string; id: string; label: string }>)
        .filter((x) => x.type === 'coworker').map((x) => ({ id: x.id, name: x.label }));
    } catch { rosterRef.current = []; }
    rosterTick((t) => t + 1);
    return rosterRef.current;
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

  // ONE CONTINUOUS THREAD (owner, Aug 13 — the Slack model): a coworker is a PERSON, the
  // relationship is continuous, and time is the only separator. The DM-history popover and
  // "New session" are gone — scroll-back is the history; the sidebar's All conversations still
  // lists the thread. No session chrome sits between the user and their colleague.
  const dmThread = async (w: { id: string; name: string }): Promise<string | null> => {
    const k = dmKey(w.id);
    try { const c = localStorage.getItem(k); if (c) return c; } catch { /* no LS */ }
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
    if (id) { try { localStorage.setItem(k, id); } catch { /* no LS */ } }
    return id;
  };
  // (A DM has no "new session" door — see the one-continuous-thread law above.)

  const askWorker = async (
    question: string, w: { id: string; name: string },
    extra?: { mentions?: Array<{ id: string; type: string; label: string }>; files?: File[]; echoed?: boolean },
  ) => {
    const fileNote = extra?.files?.length ? ` (attached: ${extra.files.map((f) => f.name).join(', ')})` : '';
    setOpen(true);
    if (!extra?.echoed) setTurns((prev) => [...prev, { role: 'user', text: question + fileNote }]);
    setTurns((prev) => [...prev, { role: 'assistant', text: '', author: w.name }]);
    setBusy(true);
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
      const threadHref = `/home?chat=worker:${tid}:${w.id}`;
      const first = w.name.split(' ')[0];
      // THE ARTIFACT ARRIVES OPEN + STAYS CURRENT (Aug 7-8): EVERY document arrival summons/
      // refreshes the pane to the newest version — so "make it shorter" in the same exchange
      // updates the open document in place (the Claude edit loop). The card stays the durable
      // re-open affordance.
      const setCards = () => setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && last.author === w.name) next[next.length - 1] = { ...last, cards: [...cards], drafts: [...drafts], workflowDrafts: [...wfDrafts] };
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
              artifact?: { id?: string; title?: string; type?: string }; draft?: EmailDraftData;
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
              cards.push({ label: event.artifact.title, sub: `${event.artifact.type === 'frame' ? 'frame' : 'document'} · by ${first}`, art: { tid, id: event.artifact.id } }); setCards();
              void openArtifact(tid, event.artifact.id);
            }
            else if (event.type === 'artifact' && event.artifact) {
              cards.push({ label: event.artifact.title ?? event.artifact.type ?? 'Prepared work', sub: `by ${first}`, href: threadHref }); setCards();
            }
            else if (event.type === 'email_draft' && event.draft) {
              drafts.push({ draft: event.draft, tid, agentId: w.id }); setCards();
            }
            else if (event.type === 'workflow_draft' && event.draft) {
              wfDrafts.push(event.draft as unknown as WorkflowDraft); setCards();
            }
          } catch { /* partial frame */ }
        }
      }
      patchLast(acc.trim() || (cards.length || drafts.length || wfDrafts.length ? `${first} produced the work below.` : `${first} finished without a written reply.`));
      if (cards.length || drafts.length || wfDrafts.length) setCards();
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
    setTurns((prev) => [...prev, { role: 'user', text: shown }]);
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
        role: t.role, text: t.text,
        ...(artCard?.art ? { artifact: { id: artCard.art.id, threadId: artCard.art.tid, title: artCard.label } } : {}),
      };
    });
    persistTurn('user', shown);
    try {
      // STREAMING ASK (Aug 6): SSE — `progress` events narrate the core's live stage (the busy
      // line speaks them), `done` carries the answer. A non-SSE response (error JSON) falls back.
      const res = await fetch('/api/home/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: sendQ, history, stream: true, ...(attachments.length ? { attachments } : {}), ...(scope ? { entityId: scope.id } : {}) }) });
      let d: { answer?: string; refs?: Ref[]; focus?: { id: string; name: string }; options?: Array<{ label: string; say: string }>; artifact?: { id: string; title: string; threadId: string; agentName: string }; artifacts?: Array<{ id: string; title: string; threadId: string; agentName: string }>; workflowDraft?: WorkflowDraft } = {};
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
              const ev = JSON.parse(line.slice(6)) as { type: string; label?: string; answer?: string; refs?: Ref[]; focus?: { id: string; name: string }; options?: Array<{ label: string; say: string }>; artifact?: { id: string; title: string; threadId: string; agentName: string }; artifacts?: Array<{ id: string; title: string; threadId: string; agentName: string }>; workflowDraft?: WorkflowDraft };
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
        ? { cards: artList.map((a) => ({ label: a.title, sub: `document · by ${a.agentName.split(' ')[0]}`, art: { tid: a.threadId, id: a.id } })) }
        : {};
      // A token-streamed answer already revealed itself — the typewriter must not re-type it.
      setTurns((prev) => { pendingAnimate.current = liveTextRef.current ? -1 : prev.length; return [...prev, { role: 'assistant', text: d.answer || "I couldn't answer that just now.", refs: d.refs ?? [], ...(d.options?.length ? { options: d.options } : {}), ...(d.workflowDraft ? { workflowDrafts: [d.workflowDraft] } : {}), ...artCard }]; });
      if (d.artifact) void openArtifact(d.artifact.threadId, d.artifact.id);
      if (d.answer) persistTurn('system', d.answer, d.refs ?? []);
      if (d.focus && !scope && !temp) setScopeHint(d.focus);
    } catch {
      setTurns((prev) => [...prev, { role: 'assistant', text: "Something went wrong reaching your brain — try again." }]);
    } finally { setBusy(false); setStage(null); setLiveText(''); liveTextRef.current = ''; }
  };
  const ask = (q: string) => { void handleSubmit(q, []); };

  const hasThread = turns.length > 0;
  // THE CONVERSATION IS A PAGE (owner, Aug 6 — "conversation-focused page, not a component"; a
  // hover-out must NEVER collapse a live conversation): once turns exist and the panel is open,
  // the thread OWNS the page — no hover gating, no outside-click close. Leaving is EXPLICIT:
  // Close (hands the dashboard back, the conversation stays and re-opens on focus), or New.
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const showThread = hasThread && open;
  // THE PAGE TAKEOVER (owner, Aug 6 — "doesn't transition to a chat page"): a live conversation
  // OWNS the page — the host hides the deck behind it (Claude's arrival feel); closing hands the
  // dashboard back.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('aug:chat-active', { detail: { active: showThread } }));
  }, [showThread]);
  // Unmount (a lens switch) hands the page back — a stale takeover must never hide the header.
  useEffect(() => () => { window.dispatchEvent(new CustomEvent('aug:chat-active', { detail: { active: false } })); }, []);
  // Re-pin to the latest turn when the thread reveals (the grid transition needs a beat).
  useEffect(() => { const tm = window.setTimeout(pinToEnd, 320); return () => window.clearTimeout(tm); }, [showThread]); // eslint-disable-line react-hooks/exhaustive-deps
  // THE CHAT CARD (final): standard chat anatomy — the CONVERSATION ABOVE, the INPUT AT THE BOTTOM
  // of the card. At rest the card is just the input (top of the page); when a conversation starts,
  // the thread SMOOTHLY expands above it (grid-rows transition — the same Collapse idiom), the
  // input stays put as the card's floor, and the scroll container pins to the latest turn.
  return (
    <section className={`w-full transition-[margin] duration-300 ease-out ${artifactPanel ? 'lg:mr-[608px]' : ''}`}>
      {/* PAGE MODE: a live conversation renders directly on the page in a centered reading
          column (Claude's anatomy) — never inside a floating card. With the artifact pane
          docked, the column keeps reading-width beside it (the section margin makes room). */}
      <div ref={shellRef}
        className={`transition-all duration-300 ease-out ${showThread ? 'max-w-3xl mx-auto w-full' : ''}`}>
        {/* The thread — above the input, smooth open/close (grid-rows), bounded + self-scrolling. */}
        <div className={`grid transition-all duration-300 ease-out ${showThread ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden min-h-0">
            {/* NO conversation chrome (owner, Aug 7 — "is New/Close best practice? that's not
                how others do it"): the SIDEBAR is the navigation — Home shows the day AND starts
                fresh (one door, cursor ready), All conversations manages. The thread is just
                the thread. */}
            {/* THE TAKEOVER (Claude-feel): a live conversation gets a CHAT'S room to breathe —
                tall column, same smooth grid morph in, composer fixed as the floor. */}
            {/* DM MODE IS LEGIBLE (owner, Aug 10 — "even in the DM we still have the mention
                placeholder"): a quiet persistent header names the room, and NOTHING else.
                ONE CONTINUOUS THREAD (owner, Aug 13 — the Slack model): a coworker is a person,
                the relationship is continuous, so there is no History popover and no New session
                — the SCROLL-BACK is the history (date dividers mark the days), and the sidebar's
                All conversations still lists this thread. */}
            {workerRoomRef.current && (
              <div className="flex items-center pb-2 mb-1 border-b border-neutral-100">
                <span className="text-[12px] font-medium text-neutral-500">Chat with {workerRoomRef.current.name.split(' ')[0]}</span>
              </div>
            )}
            <div ref={scrollRef} className="space-y-4 max-h-[calc(100vh-250px)] min-h-[40vh] overflow-y-auto [scrollbar-width:thin] pr-1 pb-3">
              {turns.map((t, i) => {
                // THE DATE DIVIDER (ONE CONTINUOUS THREAD, owner, Aug 13 — the Slack model):
                // in a DM, time is the only separator. A hairline day marker renders where two
                // consecutive DATED turns fall on different days. A live-session turn carries no
                // `at` — it never gets a divider before it (we don't guess when it was spoken).
                const prevAt = turns[i - 1]?.at;
                const divider = workerRoomRef.current && t.at && prevAt && dayKey(t.at) !== dayKey(prevAt)
                  ? dayLabel(t.at) : null;
                const body = t.role === 'user' ? (
                  <div className="flex justify-end"><UserBubble text={t.text} /></div>
                ) : (
                  <div className="pr-2">
                    {/* A coworker's reply wears THEIR name AND face (the one-narrator law +
                        same-visual-same-meaning: the worker page and email signatures carry the
                        headshot — the Home DM must too). Name → role png; initial chip fallback. */}
                    {/* DM grouping: consecutive bubbles from the SAME coworker share one header
                        (the Slack rule) — the face+name only marks a change of speaker. */}
                    {t.author && (i === 0 || turns[i - 1]?.author !== t.author) && (
                      <span className="mb-1.5 flex items-center gap-2">
                        {/* size 28 — owner call, Aug 12 ("bigger coworker faces in chat"); the shared
                            WorkerFace defaults to 20 for inline bylines, chat headers stay larger. */}
                        <WorkerFace name={t.author} size={28} />
                        <span className="text-[12.5px] font-semibold text-indigo-600">{t.author.split(' ')[0]}</span>
                      </span>
                    )}
                    <AnimatedAnswer text={t.text} refs={t.refs ?? []} onOpen={openRef} animate={!t.author && i === animateIdx} />
                    {/* Deliverable cards at the exchange's now edge — a DOCUMENT opens the
                        artifact panel HERE (brick 3); registry renders still point away. */}
                    {t.cards?.map((c, j) => (
                      <button key={j} onClick={() => { if (c.art) void openArtifact(c.art.tid, c.art.id); else if (c.href) router.push(c.href); }}
                        className="mt-2 w-full flex items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/40 px-3.5 py-2.5 text-left hover:border-indigo-300 transition-colors">
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-medium text-neutral-800">{c.label}</span>
                          {c.sub && <span className="block text-[11px] text-neutral-400">{c.sub}</span>}
                        </span>
                        <span className="flex-shrink-0 text-[12px] font-semibold text-indigo-600">Open →</span>
                      </button>
                    ))}
                    {/* An email draft is the SAME editable send card the worker page uses —
                        review, edit, and the user-gated Send, inline in this exchange. */}
                    {t.drafts?.map((d, j) => (
                      <EmailDraftCard key={d.draft.id ?? j} draft={d.draft} threadId={d.tid} agentId={d.agentId} />
                    ))}
                    {/* THE ONE CREATION CARD — a drafted workflow reviews INLINE; Confirm fires
                        the one create door; the card collapses to a receipt linking the ledger. */}
                    {t.workflowDrafts?.map((wd, j) => (
                      <div key={wd.token ?? j} className="mt-2">
                        <WorkflowDraftCard draft={wd} />
                      </div>
                    ))}
                    {/* THE SENSIBLE ASK — a tap SPEAKS its message through the composer (clicks
                        are utterances); the chips consume on tap (ephemeral scaffolding). */}
                    {t.options && t.options.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {t.options.map((o, j) => (
                          <button key={j} disabled={busy}
                            onClick={() => {
                              setTurns((prev) => prev.map((x) => (x === t ? { ...x, options: undefined } : x)));
                              void handleSubmit(o.say, []);
                            }}
                            className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50">
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
                return (
                  <React.Fragment key={i}>
                    {divider && (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="h-px flex-1 bg-neutral-100" />
                        <span className="text-[11px] text-neutral-400">{divider}</span>
                        <span className="h-px flex-1 bg-neutral-100" />
                      </div>
                    )}
                    {body}
                  </React.Fragment>
                );
              })}
              {busy && liveText && (
                <div className="pr-2 text-[13.5px] leading-relaxed text-neutral-800 whitespace-pre-wrap">{liveText}<span className="inline-block w-0.5 h-4 ml-0.5 align-text-bottom bg-indigo-400 animate-pulse" /></div>
              )}
              {busy && !liveText && <div className="flex items-center gap-1.5 text-[13px] text-neutral-400"><span className="w-1.5 h-1.5 rounded-full bg-indigo-300 animate-pulse" />{stage ?? 'Thinking…'}</div>}
              <div ref={endRef} />
            </div>
          </div>
        </div>
        {/* Suggestions ABOVE the input (the floor anatomy: nothing sits below the composer) +
            the quiet TEMPORARY toggle, armable only before the conversation starts. */}
        {!hasThread && suggestions.length > 0 && (
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
                    <button onClick={() => router.push(`/home?view=projects&entity=${scope.id}`)} title="Open the project room"
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
