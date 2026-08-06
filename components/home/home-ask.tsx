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
import { ArrowPathIcon, EyeSlashIcon, XMarkIcon, FolderIcon } from '@heroicons/react/24/outline';
import { WorkerMentionInput } from '@/components/workers/worker-mention-input';
import { ProjectPickerPanel } from '@/components/work/work-row';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
// (BriefingBlock removed from the chat — Phase 3 F2: the prose brief duplicated the deck; the
// composeBriefing machinery survives as the deck's ordering anchor + the daily report.)

type Ref = { id: string; kind: string; label: string; href: string | null };
type Turn = { role: 'user' | 'assistant'; text: string; refs?: Ref[];
  /** THE ABSORPTION (brick 1): a coworker's own reply carries their name — the one-narrator
   *  law's attribution, now in the Home panel. */
  author?: string;
  /** Deliverables the coworker produced in THIS exchange — cards POINT (Open →); the full
   *  viewer/send door lives on the worker's page until the Home grows its own stage. */
  cards?: Array<{ label: string; sub?: string; href: string }> };

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
        <p key={i} className="font-voice text-[14.5px] text-neutral-700 leading-[1.7] whitespace-pre-line">{renderPara(para)}</p>
      ))}
    </div>
  );
}

// ── THE DURABLE HOME CHAT (Aug 6 — the fold's enabling brick; one-surface ladder rung 2 +
// law 4: HISTORY IS THE DEFAULT). The Home conversation is a LOOSE ROOM (`chat:<uuid>` in
// room_turns): every exchange persists, a reload rehydrates, "New" starts a fresh room while
// the old one stays durable (the fold's future frame lists them). Persistence ≠ object
// creation — no task/project is minted by chatting (ladder law 3). ──
const CHAT_KEY_LS = 'aug-home-chat-key';
const SCOPE_LS = 'aug-home-chat-scope';
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
  const [turns, setTurns] = useState<Turn[]>([]);
  // Rehydrate the current chat room on mount (last-known conversation, the ChatGPT-parity habit) +
  // the SHELL'S WIRES: the sidebar's "New chat" resets this panel; opening a past conversation
  // from the sidebar / All-conversations view loads it here.
  useEffect(() => {
    try {
      const key = localStorage.getItem(CHAT_KEY_LS);
      const sc = localStorage.getItem(SCOPE_LS);
      if (sc) {
        // A SCOPED conversation rehydrates into its project room (the adoption stuck).
        try { const s = JSON.parse(sc) as { id?: string; name?: string }; if (s?.id && s?.name) { setScope({ id: s.id, name: s.name }); loadRoom(s.id); } } catch { /* bad blob */ }
      } else if (key?.startsWith('chat:')) loadRoom(key);
      else if (key?.startsWith('worker:')) void loadWorkerRoom(key);
      // A cross-page "open this conversation" intent (sidebar/All-conversations from another
      // route): the panel must actually OPEN — loading turns into a closed card reads as a
      // dead click (found live, Aug 6).
      if (sessionStorage.getItem('aug-open-chat-intent')) {
        sessionStorage.removeItem('aug-open-chat-intent');
        setOpen(true);
      }
    } catch { /* no LS */ }
    const onNew = () => { setTurns([]); setTemp(false); setScope(null); workerRoomRef.current = null; try { localStorage.removeItem(SCOPE_LS); } catch { /* no LS */ } setOpen(true); setTimeout(() => focusComposer(), 60); };
    const onOpen = (e: Event) => {
      const key = (e as CustomEvent).detail?.key as string | undefined;
      if (key?.startsWith('chat:')) { loadRoom(key); setOpen(true); }
      else if (key?.startsWith('worker:')) { void loadWorkerRoom(key); setOpen(true); }
    };
    window.addEventListener('aug:new-chat', onNew);
    window.addEventListener('aug:open-chat', onOpen);
    return () => {
      window.removeEventListener('aug:new-chat', onNew);
      window.removeEventListener('aug:open-chat', onOpen);
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
    if (key.startsWith('chat:')) { setScope(null); try { localStorage.removeItem(SCOPE_LS); } catch { /* no LS */ } }
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
  const loadWorkerRoom = async (key: string) => {
    const [, tid, agentId] = key.split(':');
    if (!tid || !agentId) return;
    try {
      const d = await fetch(`/api/work/threads/${tid}/messages`).then((r) => (r.ok ? r.json() : null));
      if (!Array.isArray(d?.messages)) return;
      const roster = await getRoster();
      const name = roster.find((x) => x.id === agentId)?.name
        ?? String((d.thread as { title?: string } | null)?.title ?? 'Coworker').replace(/^Chat with /, '');
      setTurns((d.messages as Array<{ role: string; content: string }>)
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content ?? '').trim())
        .map((m) => (m.role === 'user'
          ? { role: 'user' as const, text: m.content }
          : { role: 'assistant' as const, text: m.content, author: name.split(' ')[0] })));
      workerRoomRef.current = { id: agentId, name };
      setScope(null); // a coworker DM is addressed, never project-scoped from here
      try { localStorage.setItem(`aug-dm-${agentId}`, tid); localStorage.setItem(CHAT_KEY_LS, key); localStorage.removeItem(SCOPE_LS); } catch { /* no LS */ }
    } catch { /* the click already opened the panel — an empty load stays honest */ }
  };
  // THE HISTORY PICKER — thread management lives INSIDE the chat panel (the owner's law: threads
  // belong to the converged chat section, never a nav surface). Lazily fetched, quiet, Claude-shaped.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chats, setChats] = useState<Array<{ key: string; label: string; at: string }> | null>(null);
  const toggleHistory = () => {
    setHistoryOpen((v) => !v);
    if (!chats) {
      fetch('/api/rooms/recent').then((r) => (r.ok ? r.json() : null))
        .then((d) => setChats(Array.isArray(d?.chats) ? d.chats : []))
        .catch(() => setChats([]));
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
  const scopeChipRef = useRef<HTMLSpanElement>(null);
  const adopt = async (e: { id: string; name: string }) => {
    setScopeOpen(false);
    try {
      const res = await fetch('/api/rooms/adopt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomKey: chatRoomKey(), entityId: e.id }),
      });
      if (!res.ok) throw new Error();
      setScope(e);
      try { localStorage.setItem(SCOPE_LS, JSON.stringify(e)); localStorage.setItem(CHAT_KEY_LS, e.id); } catch { /* no LS */ }
      window.dispatchEvent(new CustomEvent('aug:conversation-changed'));
    } catch {
      setTurns((prev) => [...prev, { role: 'assistant', text: "Filing into the project didn't go through — try again." }]);
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
          // Scoped conversations persist INTO the project room — one conversation, one home.
          roomKey: scope ? scope.id : chatRoomKey(), role, text,
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
  // THE ONE COMPOSER's state: prefill lands a suggestion INTO the textarea (user finishes the
  // thought); pendingFiles buffer until send (the worker-chat pattern — upload rides the route).
  const [prefill, setPrefill] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const focusComposer = () => composerWrapRef.current?.querySelector('textarea')?.focus();
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
  const dmThread = async (w: { id: string; name: string }): Promise<string | null> => {
    const k = `aug-dm-${w.id}`;
    try { const c = localStorage.getItem(k); if (c) return c; } catch { /* no LS */ }
    let id: string | null = null;
    try {
      const d = await fetch(`/api/work/threads?agent_id=${w.id}`).then((r) => (r.ok ? r.json() : null));
      id = (d?.threads?.[0]?.id as string) ?? null;
      if (!id) {
        const c = await fetch('/api/work/threads', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `Chat with ${w.name.split(' ')[0]}`, agentId: w.id }),
        }).then((r) => (r.ok ? r.json() : null));
        id = (c?.thread?.id as string) ?? null;
      }
    } catch { /* honest failure below */ }
    if (id) { try { localStorage.setItem(k, id); } catch { /* no LS */ } }
    return id;
  };
  const askWorker = async (
    question: string, w: { id: string; name: string },
    extra?: { mentions?: Array<{ id: string; type: string; label: string }>; files?: File[] },
  ) => {
    const fileNote = extra?.files?.length ? ` (attached: ${extra.files.map((f) => f.name).join(', ')})` : '';
    setOpen(true);
    setTurns((prev) => [...prev, { role: 'user', text: question + fileNote }]);
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
      const threadHref = `/workers?worker=${w.id}&thread=${tid}`;
      const first = w.name.split(' ')[0];
      const setCards = () => setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && last.author === w.name) next[next.length - 1] = { ...last, cards: [...cards] };
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
              artifact?: { id?: string; title?: string; type?: string }; draft?: { subject?: string };
            };
            if (event.type === 'text') { acc += event.delta ?? ''; patchLast(acc); }
            else if (event.type === 'text_clear') { acc = ''; patchLast(acc); }
            else if (event.type === 'tool_start') patchLast(`${acc}${acc ? '\n\n' : ''}· ${event.label ?? event.name ?? 'working'}…`);
            else if (event.type === 'tool_result') patchLast(acc);
            // THE DELIVERABLES SURFACE (the room grammar, on the Home): cards POINT at what was
            // produced; the full viewer / the editable send card live on the worker's page.
            else if (event.type === 'artifact_ready' && event.artifact?.title) {
              cards.push({ label: event.artifact.title, sub: `document · by ${first}`, href: threadHref }); setCards();
            }
            else if (event.type === 'artifact' && event.artifact) {
              cards.push({ label: event.artifact.title ?? event.artifact.type ?? 'Prepared work', sub: `by ${first}`, href: threadHref }); setCards();
            }
            else if (event.type === 'email_draft') {
              cards.push({ label: event.draft?.subject ? `Email drafted — "${String(event.draft.subject).slice(0, 60)}"` : 'Email drafted', sub: `review & send on ${first}'s page`, href: threadHref }); setCards();
            }
          } catch { /* partial frame */ }
        }
      }
      patchLast(acc.trim() || (cards.length ? `${first} produced the work below.` : `${first} finished without a reply — their page has the full thread.`));
      if (cards.length) setCards();
    } catch {
      patchLast(`Couldn't reach ${w.name.split(' ')[0]} right now — try again, or open their page from Settings → Team.`);
    } finally { setBusy(false); }
  };

  // Chief-side attachments land in the KNOWLEDGE BASE (presign → PUT → confirm+index) so the
  // brain can find/compute over them immediately — the lawful chief attach (files live with
  // the knowledge, not in a chat blob). Returns the filenames that made it.
  const uploadToKB = async (files: File[]): Promise<string[]> => {
    try {
      const pres = await fetch('/api/drive/upload/presign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: files.map((f) => ({ filename: f.name, mimeType: f.type || 'application/octet-stream', size: f.size })) }),
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
    if (!temp) {
      // Address resolution: an explicit @-mention wins → the OPEN worker conversation continues
      // (worker mode) → the typed address ("Clara, …") → else the chief.
      const cw = mentions.find((m) => m.type === 'coworker');
      const w = cw ? { id: cw.id, name: cw.label }
        : (workerRoomRef.current ?? detectAddress(question, await getRoster()));
      if (w) {
        await askWorker(question || 'Here are the files.', w, {
          mentions: mentions.filter((m) => !(m.type === 'coworker' && m.id === w.id)),
          files,
        });
        return;
      }
    }
    // Chief path — KB-upload files first; mention labels ride as grounding hints.
    let sendQ = question;
    let fileNote = '';
    if (files.length) {
      const done = await uploadToKB(files);
      if (done.length) { sendQ += `\n[Attached to the knowledge base just now: ${done.join(', ')}]`; fileNote = ` (attached: ${done.join(', ')})`; }
      else if (!question) { setTurns((prev) => [...prev, { role: 'assistant', text: 'The upload did not go through — try again, or use the Knowledge page.' }]); return; }
    }
    const hints = mentions.filter((m) => m.type !== 'coworker').map((m) => m.label);
    if (hints.length) sendQ += ` (about: ${hints.join('; ')})`;
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    const shown = (question || 'Attached files.') + fileNote;
    setOpen(true);
    setTurns((prev) => [...prev, { role: 'user', text: shown }]);
    persistTurn('user', shown);
    setBusy(true);
    try {
      // STREAMING ASK (Aug 6): SSE — `progress` events narrate the core's live stage (the busy
      // line speaks them), `done` carries the answer. A non-SSE response (error JSON) falls back.
      const res = await fetch('/api/home/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: sendQ, history, stream: true, ...(scope ? { entityId: scope.id } : {}) }) });
      let d: { answer?: string; refs?: Ref[] } = {};
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
              const ev = JSON.parse(line.slice(6)) as { type: string; label?: string; answer?: string; refs?: Ref[] };
              if (ev.type === 'progress' && ev.label) setStage(ev.label);
              else if (ev.type === 'done') d = ev;
            } catch { /* partial frame */ }
          }
        }
      } else {
        d = await res.json();
      }
      setTurns((prev) => { pendingAnimate.current = prev.length; return [...prev, { role: 'assistant', text: d.answer || "I couldn't answer that just now.", refs: d.refs ?? [] }]; });
      if (d.answer) persistTurn('system', d.answer, d.refs ?? []);
    } catch {
      setTurns((prev) => [...prev, { role: 'assistant', text: "Something went wrong reaching your brain — try again." }]);
    } finally { setBusy(false); setStage(null); }
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
  // Re-pin to the latest turn when the thread reveals (the grid transition needs a beat).
  useEffect(() => { const tm = window.setTimeout(pinToEnd, 320); return () => window.clearTimeout(tm); }, [showThread]); // eslint-disable-line react-hooks/exhaustive-deps
  // THE CHAT CARD (final): standard chat anatomy — the CONVERSATION ABOVE, the INPUT AT THE BOTTOM
  // of the card. At rest the card is just the input (top of the page); when a conversation starts,
  // the thread SMOOTHLY expands above it (grid-rows transition — the same Collapse idiom), the
  // input stays put as the card's floor, and the scroll container pins to the latest turn.
  return (
    <section className="w-full">
      {/* PAGE MODE: a live conversation renders directly on the page in a centered reading
          column (Claude's anatomy) — never inside a floating card. */}
      <div ref={shellRef}
        className={`transition-all duration-300 ease-out ${showThread ? 'max-w-3xl mx-auto w-full' : ''}`}>
        {/* The thread — above the input, smooth open/close (grid-rows), bounded + self-scrolling. */}
        <div className={`grid transition-all duration-300 ease-out ${showThread ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden min-h-0">
            <div className="flex items-center justify-between mb-1">
              {/* THE HISTORY PICKER — threads managed inside the chat panel (Claude-shaped). */}
              <div className="relative flex items-center gap-3">
                <button onClick={toggleHistory} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-400 hover:text-neutral-700 transition-colors">
                  History
                </button>
                {/* THE SCOPE CHIP — the conversation's project scope, settable any time. Scoped,
                    the chip is the DOOR to the project room. Hidden in temp (nothing persists to
                    adopt) and in a coworker DM (addressed, not scoped). */}
                {!temp && !workerRoomRef.current && (
                  <span ref={scopeChipRef} className="relative inline-flex">
                    {scope ? (
                      <button onClick={() => router.push(`/home?view=projects&entity=${scope.id}`)} title="Open the project room"
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
                        <FolderIcon className="w-3.5 h-3.5" /> {scope.name} ✓
                      </button>
                    ) : (
                      <button onClick={() => setScopeOpen((v) => !v)}
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-400 hover:text-neutral-700 transition-colors">
                        <FolderIcon className="w-3.5 h-3.5" /> No project · Add to…
                      </button>
                    )}
                    <AnchoredPopover anchorRef={scopeChipRef} open={scopeOpen} onClose={() => setScopeOpen(false)} align="left" width={240}>
                      <ProjectPickerPanel onSelect={(e) => { void adopt(e); }} onCreateProject={(n) => { void createAndAdopt(n); }} />
                    </AnchoredPopover>
                  </span>
                )}
                {historyOpen && (
                  <div className="absolute left-0 top-full mt-1.5 z-30 w-72 max-w-[80vw] rounded-xl border border-neutral-200 bg-white shadow-lg py-1.5">
                    {chats === null && <p className="px-3.5 py-2 text-[12px] text-neutral-400">Loading…</p>}
                    {chats?.length === 0 && <p className="px-3.5 py-2 text-[12px] text-neutral-400">No earlier conversations yet.</p>}
                    {(chats ?? []).map((c) => (
                      <button key={c.key}
                        onClick={() => { loadRoom(c.key); setHistoryOpen(false); }}
                        className="w-full text-left px-3.5 py-2 hover:bg-neutral-50 transition-colors">
                        <span className="block text-[12.5px] text-neutral-700 truncate">{c.label}</span>
                        <span className="block text-[11px] text-neutral-400">{c.at.slice(0, 10)}</span>
                      </button>
                    ))}
                    {/* ONE thread system: the picker and the full view are the same story. */}
                    <a href="/home?view=conversations" className="block px-3.5 py-2 text-[11.5px] text-neutral-400 hover:text-neutral-700 border-t border-neutral-100 transition-colors">
                      All conversations →
                    </a>
                  </div>
                )}
              </div>
              <span className="flex items-center gap-3">
                {temp && <span className="flex items-center gap-1 text-[11px] font-medium text-amber-500" title="This conversation won't be saved and won't appear in History"><EyeSlashIcon className="w-3.5 h-3.5" />Temporary — not saved</span>}
                <button onClick={() => { setTurns([]); setTemp(false); setScope(null); setHistoryOpen(false); workerRoomRef.current = null; try { localStorage.removeItem(CHAT_KEY_LS); localStorage.removeItem(SCOPE_LS); } catch { /* no LS */ } }} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-400 hover:text-neutral-700 transition-colors">
                  <ArrowPathIcon className="w-3.5 h-3.5" /> New
                </button>
                {/* Close hands the dashboard back — the conversation STAYS (focus the composer
                    to return to it); leaving is a decision, never a hover accident. */}
                <button onClick={() => setOpen(false)} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-400 hover:text-neutral-700 transition-colors">
                  <XMarkIcon className="w-3.5 h-3.5" /> Close
                </button>
              </span>
            </div>
            {/* THE TAKEOVER (Claude-feel): a live conversation gets a CHAT'S room to breathe —
                tall column, same smooth grid morph in, composer fixed as the floor. */}
            <div ref={scrollRef} className="space-y-4 max-h-[calc(100vh-250px)] min-h-[40vh] overflow-y-auto [scrollbar-width:thin] pr-1 pb-3">
              {turns.map((t, i) => (
                t.role === 'user' ? (
                  <div key={i} className="flex justify-end"><span className="rounded-2xl rounded-br-sm bg-neutral-100 px-3.5 py-2 text-[13.5px] text-neutral-800 max-w-[80%]">{t.text}</span></div>
                ) : (
                  <div key={i} className="pr-2">
                    {/* A coworker's reply wears THEIR name (the one-narrator law); it streams
                        live, so no typewriter re-reveal. */}
                    {t.author && <p className="mb-1 text-[11.5px] font-semibold text-indigo-600">{t.author.split(' ')[0]}</p>}
                    <AnimatedAnswer text={t.text} refs={t.refs ?? []} onOpen={openRef} animate={!t.author && i === animateIdx} />
                    {/* Deliverable cards at the exchange's now edge — cards POINT (Open →). */}
                    {t.cards?.map((c, j) => (
                      <button key={j} onClick={() => router.push(c.href)}
                        className="mt-2 w-full flex items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/40 px-3.5 py-2.5 text-left hover:border-indigo-300 transition-colors">
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-medium text-neutral-800">{c.label}</span>
                          {c.sub && <span className="block text-[11px] text-neutral-400">{c.sub}</span>}
                        </span>
                        <span className="flex-shrink-0 text-[12px] font-semibold text-indigo-600">Open →</span>
                      </button>
                    ))}
                  </div>
                )
              ))}
              {busy && <div className="flex items-center gap-1.5 text-[13px] text-neutral-400"><span className="w-1.5 h-1.5 rounded-full bg-indigo-300 animate-pulse" />{stage ?? 'Thinking…'}</div>}
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
          onFocusCapture={() => setOpen(true)}
          className="rounded-2xl border overflow-hidden transition-all duration-300 border-neutral-200 bg-white shadow-[0_4px_28px_-12px_rgba(23,23,23,0.22)] focus-within:border-indigo-300 focus-within:shadow-[0_4px_32px_-10px_rgba(79,70,229,0.28)]">
          <WorkerMentionInput
            frameless
            onSubmit={(text, mentions) => { void handleSubmit(text, mentions); }}
            disabled={busy}
            placeholder="Ask anything — @ mentions your team"
            prefill={prefill}
            onPrefillConsumed={() => setPrefill(null)}
            onAttach={(files) => setPendingFiles((p) => [...p, ...files])}
            attachments={pendingFiles.map((f, i) => ({ id: `${i}-${f.name}`, name: f.name, size: f.size }))}
            onRemoveAttachment={(id) => setPendingFiles((p) => p.filter((f, i) => `${i}-${f.name}` !== id))}
          />
        </div>
      </div>
    </section>
  );
}
