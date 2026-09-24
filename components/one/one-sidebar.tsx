'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SIDEBAR LISTS CONVERSATIONS, NOT MODULES (docs/threads-plan.md, "The Home thread's seat";
// the frozen boards Main.dc.html / HomeThread.dc.html — owner-confirmed Sep 7; Phase 4b).
//
// The shape, top to bottom: Home + its needs-you badge · CONVERSATIONS (project threads with a
// judged state dot · ONE row per coworker, face + name + the avatar's working state · the chats
// you have spoken in) · "All conversations →" · the QUIET GROUP of module doors (Routines ·
// Inbox · Meetings · Documents, feature-gated) · the team facepile · the account.
//
// THE LAWS THIS FRAME OWES:
//   • THE CONTAINERS LAW — a coworker DM is ONE continuous thread (owner, Aug 13). The list holds
//     ONE row per ACTIVE ROSTER coworker (the facepile's own presence source), wearing the bare
//     NAME — never one row per DM session titled by its first ask. The roster rows render even
//     with zero threads: the team is always reachable, and the door is the facepile's door.
//   • THREE GRAMMARS, THREE WEIGHTS (owner walk, Sep 7 — "the sidebar feels a bit messy"): the
//     projects block leads (≤6, the served order), the coworker block follows after real
//     breathing room, the chat sessions trail (≤3, italic). Everything past those caps lives
//     behind "All projects" / "All conversations →" — a sidebar is a list of doors, not a dump.
//   • BADGES ARE HONEST OR ABSENT — every number here is a SERVED count (the deck's own
//     dayProgress.needYou; the workflow ledger's unreviewed runs). A badge with nothing real
//     behind it is a lying door, so silence is the fallback, never a placeholder.
//   • ONE ADDRESS PRODUCER — a project thread's href comes from projectHref, never hand-rolled.
//   • THE MODULES WHISPER — they are doors, not the shape of the product; conversations lead.
//   • ATTENTION STAYS ON THE DECK — this list is never the item firehose.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  HomeIcon, EnvelopeIcon, VideoCameraIcon, FolderIcon, DocumentTextIcon,
  Cog6ToothIcon, ArrowRightOnRectangleIcon, ShieldCheckIcon,
  ChatBubbleLeftEllipsisIcon, BoltIcon,
} from '@heroicons/react/24/outline';
import { useRecordingContext } from '@/context/recording-context';
import type { WorkspaceFeatures } from '@/lib/workspace/types';
import { DEFAULT_FEATURES } from '@/lib/workspace/types';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { ROLE_LABELS } from '@/lib/workers/roles';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { AvatarStatus } from '@/components/thread/avatar-status';
import { projectHref } from '@/lib/room/project-href';
import { warmEntityRoom, cancelWarmEntityRoom } from '@/lib/room/warm-room';
import { momentumOf } from '@/lib/work-items/states';
import { toast } from 'sonner';
import { prefetchChatTurns } from '@/components/home/chat-turns-warm';

type Conversation = { key: string; kind: 'room' | 'chat' | 'coworker'; label: string; href: string | null; sub?: string };
// `unread` — THE PROJECT RAISING ITS HAND (Sep 7): per project room key, the count of live turns
// that landed since the reader last saw the room and that the reader did not write. Served ONLY
// for rooms with a real read marker, so an absent key means "nothing honest to say", never zero-
// as-decoration. Coworker DM rows carry no badge by design (see the route's own note).
type Rooms = { pinned: Array<{ id: string; name: string; href: string }>; conversations: Conversation[]; workflowsUnread?: number; unread?: Record<string, number> };
const LS_KEY = 'aug-one-sidebar-v1';
// THE BADGE IS HONEST OR ABSENT (threads-plan, the sidebar paragraph): the Home badge speaks the
// DECK's own needs-you number — `dayProgress.needYou` off the served brief, read from the same
// stamped cache the Home paints from (no second fetch, no second definition, and never a
// placeholder). The stamp carries the action-surface freshness demand: a cache too old to trust
// yields NO badge rather than a stale claim.
const BRIEF_LS_KEY = 'aug-home-brief-v1';
const BRIEF_MAX_AGE_MS = 15 * 60_000;
type CachedBrief = { dayProgress?: { needYou?: number } | null };
// The project dot reads the portfolio's own judged momentum (the ONE vocabulary, lib/work-items/
// states) out of the shared portfolio cache. No cache → `unknown` → the honest neutral dot; the
// sidebar never fetches the portfolio itself (an ambient row is not worth a query on every page).
const PORTFOLIO_LS_KEY = 'aug-portfolio-v1';
type CachedPortfolio = { entities?: Array<{ id: string; momentum?: string }> };

function formatElapsed(secs: number) {
  const m = Math.floor(secs / 60); const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function OneSidebar({
  userEmail, avatarUrl = null, isSuperAdmin = false, features = DEFAULT_FEATURES,
  brandLogo = null, brandName = null, sovereign = false,
}: { userEmail?: string; avatarUrl?: string | null; isSuperAdmin?: boolean; features?: WorkspaceFeatures;
  /** THE CO-BRAND (the sovereign door): the client's logo beside ours, from companies.settings.branding. */
  brandLogo?: string | null; brandName?: string | null;
  /** THE SAFE-DATA MARK: shown for corporate workspaces (no third-party auth). Visual only. */
  sovereign?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const recording = useRecordingContext();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rooms, setRooms] = useState<Rooms>({ pinned: [], conversations: [] });
  // THE ROW MENU (owner, Aug 8 — "the 3 dots on hover of the recents"): manage where you see —
  // rename inline, delete with the Undo toast (the same archive-under-the-hood as everywhere).
  const [convMenu, setConvMenu] = useState<string | null>(null);
  const [convRenaming, setConvRenaming] = useState<string | null>(null);
  const [convRenameVal, setConvRenameVal] = useState('');
  const menuAnchorRef = useRef<HTMLElement | null>(null);
  const workerTid = (key: string) => key.split(':')[1] ?? null;
  const bump = () => { try { window.dispatchEvent(new CustomEvent('aug:conversation-changed')); } catch { /* SSR */ } };
  const renameConv = async (c: Conversation) => {
    const title = convRenameVal.trim().slice(0, 80);
    setConvRenaming(null);
    if (!title || title === c.label) return;
    setRooms((r) => ({ ...r, conversations: r.conversations.map((x) => (x.key === c.key ? { ...x, label: title } : x)) }));
    try {
      const res = c.kind === 'chat'
        ? await fetch('/api/rooms/title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: c.key, title }) })
        : await fetch(`/api/work/threads/${workerTid(c.key)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      if (!res.ok) throw new Error();
      bump();
    } catch { bump(); /* refetch restores truth */ }
  };
  const removeConv = async (c: Conversation) => {
    setConvMenu(null);
    setRooms((r) => ({ ...r, conversations: r.conversations.filter((x) => x.key !== c.key) }));
    try {
      const res = c.kind === 'chat'
        ? await fetch(`/api/room/turns?key=${encodeURIComponent(c.key)}`, { method: 'DELETE' })
        : await fetch(`/api/work/threads/${workerTid(c.key)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) });
      if (!res.ok) throw new Error();
      bump();
      toast('Conversation deleted', {
        action: {
          label: 'Undo',
          onClick: () => {
            void (async () => {
              try {
                const r = c.kind === 'chat'
                  ? await fetch('/api/rooms/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: c.key }) })
                  : await fetch(`/api/work/threads/${workerTid(c.key)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) });
                if (!r.ok) throw new Error();
                bump();
              } catch { toast.error("Couldn't restore it — check All conversations."); }
            })();
          },
        },
      });
    } catch { bump(); }
  };

  useEffect(() => {
    const cached = loadLS<Rooms>(LS_KEY);
    if (cached?.pinned) setRooms(cached);
    const refresh = () => {
      fetch('/api/rooms/recent').then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (d && Array.isArray(d.pinned)) {
          const next: Rooms = { pinned: d.pinned, conversations: Array.isArray(d.conversations) ? d.conversations : [], workflowsUnread: typeof d.workflowsUnread === 'number' ? d.workflowsUnread : 0, unread: (d.unread && typeof d.unread === 'object') ? d.unread as Record<string, number> : {} };
          setRooms(next); saveLS(LS_KEY, next);
        }
      }).catch(() => {});
    };
    refresh();
    window.addEventListener('aug:membership-changed', refresh);
    window.addEventListener('aug:conversation-changed', refresh);
    return () => {
      window.removeEventListener('aug:membership-changed', refresh);
      window.removeEventListener('aug:conversation-changed', refresh);
    };
  }, []);

  // ── THE HONEST BADGE + THE HONEST DOT ─────────────────────────────────────────────────────────
  // Both read caches the shell already writes (the brief the Home paints from; the portfolio every
  // picker hydrates from). Zero new fetches, and both degrade to SILENCE — no number, no badge; no
  // momentum, a neutral dot — because a badge with nothing real behind it is a lying door.
  const [needsYou, setNeedsYou] = useState<number | null>(null);
  const [momentum, setMomentum] = useState<Record<string, string>>({});
  useEffect(() => {
    const readCaches = () => {
      const b = loadLS<CachedBrief>(BRIEF_LS_KEY, { maxAgeMs: BRIEF_MAX_AGE_MS });
      const n = b?.dayProgress?.needYou;
      setNeedsYou(typeof n === 'number' && n > 0 ? n : null);
      const p = loadLS<CachedPortfolio>(PORTFOLIO_LS_KEY);
      const next: Record<string, string> = {};
      for (const e of p?.entities ?? []) if (e?.id && e.momentum) next[e.id] = e.momentum;
      setMomentum(next);
    };
    readCaches();
    const onVis = () => { if (document.visibilityState === 'visible') readCaches(); };
    window.addEventListener('focus', readCaches);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('aug:membership-changed', readCaches);
    window.addEventListener('aug:conversation-changed', readCaches);
    // THE COLD-LOAD SEAM (walk find, Sep 7): on a fresh open the sidebar's mount read runs BEFORE
    // the brief fetch lands, and nothing re-read until a refocus — the honest-or-absent badge was
    // honestly absent all session. The Home announces its save; the sidebar hears it.
    window.addEventListener('aug:brief-updated', readCaches);
    return () => {
      window.removeEventListener('focus', readCaches);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('aug:membership-changed', readCaches);
      window.removeEventListener('aug:conversation-changed', readCaches);
      window.removeEventListener('aug:brief-updated', readCaches);
    };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowUserMenu(false); };
    if (showUserMenu) document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showUserMenu]);

  // NB: the sidebar's "New chat" seat is retired (Home is the chat door). The `aug:new-chat`
  // EVENT stays live — the project room's own "New chat" door still fires it, and HomeAsk still
  // listens; only this nav item is gone.
  // Opening a past chat: set the key, open the panel (same-page via the event; cross-page via
  // the intent flag — a click must never load turns into a CLOSED card).
  // THE CLICK ANSWERS AT ONCE: the row it opened wears the active seat immediately (the panel's
  // own pane paints on the same click — see home-ask's chat lane). It clears whenever the chat
  // lane does: Home hands the dashboard back, and a new chat leaves no past conversation open.
  const [openConvKey, setOpenConvKey] = useState<string | null>(null);
  useEffect(() => {
    const clear = () => setOpenConvKey(null);
    window.addEventListener('augmtd:home-reset', clear);
    window.addEventListener('aug:new-chat', clear);
    window.addEventListener('aug:dm-worker', clear);
    return () => {
      window.removeEventListener('augmtd:home-reset', clear);
      window.removeEventListener('aug:new-chat', clear);
      window.removeEventListener('aug:dm-worker', clear);
    };
  }, []);
  const openChat = (key: string) => {
    try { localStorage.setItem('aug-home-chat-key', key); sessionStorage.setItem('aug-open-chat-intent', '1'); } catch { /* no LS */ }
    setOpenConvKey(key);
    window.dispatchEvent(new CustomEvent('aug:open-chat', { detail: { key } }));
    if (pathname !== '/home') router.push('/home');
  };

  // THE TEAM FACEPILE (coherence slice #4, Aug 10) — presence in the footer, deliberately NOT
  // the island (the island shows views-of-here; the team is presence, not a view) and NOT nav
  // (one popover: live state · Chat · the Settings door). The last /workers job, rehomed.
  type TeamMate = { id: string; name: string; description: string | null; worker_role: string | null; state: string };
  const [team, setTeam] = useState<TeamMate[] | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const teamRef = useRef<HTMLDivElement>(null);
  // ONE PRESENCE READ, HYDRATE-THEN-REFRESH (the instant-load doctrine). The faces now carry the
  // WORKING RING on the resting sidebar, so the state cannot only refresh when the popover opens
  // — it hydrates from the cache instantly and always refreshes behind. `presenceRef` keeps the
  // one fetch site: the popover's open re-runs the SAME reader, never a second definition.
  const refreshTeam = useRef(() => {});
  refreshTeam.current = () => {
    fetch('/api/workers/presence').then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.team) && d.team.length) setTeam(d.team); })
      .catch(() => { /* the cached roster stands; the next open is the retry */ });
  };
  useEffect(() => {
    const cached = loadLS<TeamMate[]>('aug-team-presence-v1');
    if (cached?.length) setTeam(cached);
    refreshTeam.current();
  }, []);
  useEffect(() => {
    if (!teamOpen) return;
    refreshTeam.current();
    const onDown = (e: MouseEvent) => { if (teamRef.current && !teamRef.current.contains(e.target as Node)) setTeamOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [teamOpen]);
  useEffect(() => { if (team?.length) saveLS('aug-team-presence-v1', team); }, [team]);
  const dmWorker = (w: TeamMate) => {
    setTeamOpen(false);
    try { sessionStorage.setItem('aug-open-chat-intent', '1'); } catch { /* no LS */ }
    window.dispatchEvent(new CustomEvent('aug:dm-worker', { detail: { agentId: w.id, name: w.name } }));
    if (pathname !== '/home') router.push('/home');
  };

  // THE LENS MIRROR (owner, Aug 9 — "why is it all 'home'?"): the sidebar highlights the
  // ACTIVE LENS, not just the route. home-view announces every lens change (aug:view-changed);
  // init from the URL for direct loads.
  const [lens, setLens] = useState<string | null>(null);
  useEffect(() => {
    try { setLens(new URLSearchParams(window.location.search).get('view')); } catch { /* SSR */ }
    const onLens = (e: Event) => setLens(((e as CustomEvent).detail?.view as string) ?? null);
    window.addEventListener('aug:view-changed', onLens);
    return () => window.removeEventListener('aug:view-changed', onLens);
  }, []);
  const onHome = pathname === '/home';
  const lensIs = (...vs: string[]) => onHome && vs.includes(lens ?? 'dashboard');

  const item = (active: boolean) =>
    `flex items-center gap-2.5 px-2.5 py-[7px] mb-px rounded-lg text-[12.5px] transition-colors ${
      active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50'
    }`;
  // The quiet group's row — one step further back than a conversation (the modules whisper).
  const quiet = (active: boolean) =>
    `flex items-center gap-2.5 px-2.5 py-[6px] rounded-lg text-[12px] transition-colors ${
      active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50'
    }`;
  const sectionLabel = 'px-2.5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400 select-none';
  const userInitial = userEmail?.[0]?.toUpperCase() ?? '?';

  // ── THE CONVERSATIONS SECTION (the frozen boards' form) ───────────────────────────────────────
  // THREE GRAMMARS, THREE WEIGHTS: project threads (a judged state dot, ≤6) · the COWORKERS (one
  // row each, from the roster) · the chat sessions you have spoken in (≤3, italic, manageable in
  // place). Nothing is invented here — projects and chats come from /api/rooms/recent, which
  // already enforces the user-voice law (a room the user never spoke in is not a conversation; it
  // surfaces through the deck), and the coworkers come from the presence roster the facepile
  // already holds.
  const roomConvos = rooms.conversations.filter((c) => c.kind === 'room' && !c.key.includes(':'));
  // PROJECTS LEAD, CAPPED AT SIX — the order /api/rooms/recent already serves (pinned by reasoned
  // priority, then conversed-in). The rest live behind "All projects" on the section label.
  const PROJECT_ROWS_MAX = 6;
  const projectRows = [
    ...rooms.pinned.map((p) => ({ id: p.id, label: p.name })),
    ...roomConvos.map((c) => ({ id: c.key, label: c.label })),
  ].slice(0, PROJECT_ROWS_MAX);
  const projectIds = new Set(projectRows.map((p) => p.id));
  // THE TEAM IS ONE DOOR, NOT N ROWS (owner, Sep 7 — "wouldn't 'Your team' be a way to simplify
  // the nav instead of 3 extra rows? as we scale coworkers, having multiple rows is weirder").
  // The coworkers do NOT list in Conversations: the footer facepile is THE coworker door, and it
  // stays one row whether the team is three people or thirty. The `coworker` kind from
  // /api/rooms/recent (one row PER DM SESSION) stays excluded everywhere — a DM is one continuous
  // thread, so a session list would be a second, wrong grammar for the same relationship.
  // THE CHAT SESSIONS TRAIL, CAPPED AT THREE — the rest behind "All conversations →".
  const CHAT_ROWS_MAX = 3;
  const otherRows = rooms.conversations
    .filter((c) => c.kind !== 'coworker' && !(c.kind === 'room' && projectIds.has(c.key)))
    .slice(0, CHAT_ROWS_MAX);

  return (
    <div className="flex h-screen w-[212px] flex-col bg-neutral-50 flex-shrink-0 border-r border-neutral-200/60">
      {/* Wordmark — co-branded when the workspace carries a client logo (the sovereign door). */}
      <div className="flex h-12 items-center gap-2 px-4">
        <Image src="/augmtd-logo.png" alt="AUGMTD" width={18} height={18} className="w-[18px] h-[18px]" />
        <span className="text-[13px] font-semibold tracking-wide text-neutral-800 select-none">augmtd</span>
        {brandLogo && (
          <>
            <span className="text-neutral-300 text-[11px] select-none">×</span>
            {/* Client logos are user-supplied URLs — plain img, never next/image domain config. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brandLogo} alt={brandName ?? 'Workspace'} title={brandName ?? undefined}
              className="h-[18px] max-w-[64px] object-contain" />
          </>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2 [scrollbar-width:thin]">
        {/* HOME IS THE CHAT DOOR (owner, Aug 25 — "home and new chat isn't very intuitive, it's the
            same thing with a cursor... focus cursor on chat from home and remove the New chat").
            The two seats WERE one deed: both reset to the empty chief chat, and only one of them
            put the cursor there. So the nav keeps ONE door and it lands ready to type.

            THE FRESH FLOOR IS UNCHANGED: `augmtd:home-reset` still does the complete reset (DM
            mode · turns · scope · stored key) and still leaves the DECK as the default view — the
            focus rides ALONGSIDE it, it does not open the panel. Same-page clicks fire the event
            directly; a click from another route can't (this component unmounts nothing but the
            Home isn't mounted yet), so it leaves the one-shot intent the Home consumes on mount —
            the established `aug-*-intent` idiom. Ordinary loads carry no intent and never steal
            the caret. */}
        <Link href="/home" className={item(lensIs('dashboard', 'timeline') || pathname.startsWith('/item'))}
          onClick={(e) => {
            if (pathname !== '/home') {
              try { sessionStorage.setItem('aug-home-focus-intent', '1'); } catch { /* no storage */ }
              return;
            }
            // ALREADY HOME → THE CLICK IS THE RESET, NOT A NAVIGATION (owner: "the caret only
            // lands on the SECOND click"). /home is an async SERVER component (it awaits
            // guardFeaturePage), so a same-path <Link> click fires a real RSC round-trip; the
            // payload landed AFTER the focus did and the re-render took the caret with it. The
            // second click only "worked" because the router cache made that re-render instant.
            // Navigating to the page you are already on buys nothing, so we don't: the reset
            // event is the whole deed. THE URL still self-corrects — home-view's own reset
            // handler drops ?view= through its existing replaceState.
            // Modifier/middle clicks are left alone: those mean "open it over there".
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('augmtd:home-reset'));
          }}>
          <HomeIcon className={`w-[17px] h-[17px] flex-shrink-0 ${lensIs('dashboard', 'timeline') ? 'text-indigo-500' : 'text-neutral-400'}`} />
          Home
          {/* THE NEEDS-YOU BADGE — the deck's own count (dayProgress.needYou), never a decoration.
              No fresh served count → no badge (honest or absent). */}
          {needsYou !== null && (
            <span className="ml-auto min-w-[18px] rounded-full bg-indigo-50 px-1.5 py-0.5 text-center text-[10px] font-semibold text-indigo-700 tabular-nums">
              {needsYou > 9 ? '9+' : needsYou}
            </span>
          )}
        </Link>

        {/* ══ TWO LABELED SECTIONS, NOT ONE (owner walk, Sep 7 late: "should be a clearer
            separation of projects and actual conversations no?"). Projects are PLACES, chats are
            passing conversations — one shared header muddled two kinds that only italics told
            apart. Each kind now owns its label and its own "All →" trailer; PROJECTS is literally
            one of the five vocabulary words (threads-plan). The grid door stays on the label row,
            lit while the lens is open. */}
        <div className="flex items-baseline">
          <div className={`${sectionLabel} flex-1`}>Projects</div>
          <Link href="/home?view=projects"
            className={`pt-4 pb-1 pr-2.5 text-[10px] transition-colors ${lensIs('projects') ? 'text-indigo-600 font-semibold' : 'text-neutral-400 hover:text-neutral-700'}`}>
            All →
          </Link>
        </div>

        {/* PROJECT THREADS — the dot is the judged momentum (the ONE vocabulary), the address is
            the ONE producer's (/project/<id>), and the row stays lit while you are inside it. */}
        {projectRows.map((p) => {
          const href = projectHref(p.id);
          const active = pathname === href;
          // THE PROJECT RAISING ITS HAND — the same quiet indigo badge grammar as Home's needs-you
          // count, on the SAME honest-or-absent rule: a served count > 0, or nothing at all. The
          // room you are standing in never badges (you are reading it); the marker stamps on serve,
          // so the next read of this list agrees.
          const n = active ? 0 : (rooms.unread?.[p.id] ?? 0);
          return (
            // THE ROOM WARM ON THE SIDEBAR (owner walk, Sep 7 — "clicking across projects takes
            // so long"): the same warm the portfolio grid already uses (lib/room/warm-room — one
            // implementation, 160ms hover intent, serial queue), plus the route's own prefetch so
            // the RSC payload and the room's two payloads are both in hand before the click.
            // Cancel on leave, exactly as the grid does.
            <Link key={p.id} href={href} className={item(active)}
              onMouseEnter={() => { if (!active) { warmEntityRoom(p.id); router.prefetch(href); } }}
              onMouseLeave={() => cancelWarmEntityRoom(p.id)}
              onFocus={() => { if (!active) { warmEntityRoom(p.id); router.prefetch(href); } }}
              onBlur={() => cancelWarmEntityRoom(p.id)}>
              <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${momentumOf(momentum[p.id] ?? 'unknown').dot}`}
                title={momentumOf(momentum[p.id] ?? 'unknown').label} />
              <span className="truncate">{p.label}</span>
              {n > 0 && (
                <span className="ml-auto min-w-[18px] rounded-full bg-indigo-50 px-1.5 py-0.5 text-center text-[10px] font-semibold text-indigo-700 tabular-nums">
                  {n > 9 ? '9+' : n}
                </span>
              )}
            </Link>
          );
        })}

        {/* (THE COWORKERS DO NOT LIST HERE — the footer's "Your team" row is the one coworker
            door; see the note above `otherRows`. Conversations holds project threads and the
            chat sessions you have spoken in, and nothing else.) */}

        {otherRows.length > 0 && (
          <>
            {/* CHATS — its own label + its own "All →" trailer (the Sep 7 separation): passing
                conversations are a different KIND than the project places above. */}
            <div className="flex items-baseline">
              <div className={`${sectionLabel} flex-1`}>Chats</div>
              <Link href="/home?view=conversations"
                className={`pt-4 pb-1 pr-2.5 text-[10px] transition-colors ${lensIs('conversations') ? 'text-indigo-600 font-semibold' : 'text-neutral-400 hover:text-neutral-700'}`}>
                All →
              </Link>
            </div>
            {/* THE KIND GLYPH + THE HOVER EXPAND (owner, Aug 8): a subtle icon says what each
                conversation IS (chat · work room); hovering smoothly reveals the second line —
                "in Acme Corp" / the kind word. Plain chats stay quiet. */}
            {otherRows.map((c) => {
              const Glyph = c.kind === 'chat' ? ChatBubbleLeftEllipsisIcon : FolderIcon;
              const manageable = c.kind === 'chat';
              const inner = (
                <>
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Glyph className="w-[13px] h-[13px] flex-shrink-0 text-neutral-300" />
                    {convRenaming === c.key ? (
                      <input autoFocus value={convRenameVal} onChange={(e) => setConvRenameVal(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void renameConv(c); if (e.key === 'Escape') setConvRenaming(null); }}
                        onBlur={() => void renameConv(c)}
                        className="min-w-0 flex-1 rounded border border-indigo-200 bg-white px-1 py-0.5 text-[12px] not-italic text-neutral-800 outline-none" />
                    ) : (
                      <span className="truncate italic">{c.label}</span>
                    )}
                    {manageable && convRenaming !== c.key && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); menuAnchorRef.current = e.currentTarget; setConvMenu(convMenu === c.key ? null : c.key); }}
                        className="ml-auto flex-shrink-0 opacity-0 group-hover/conv:opacity-100 text-neutral-300 hover:text-neutral-600 text-[15px] leading-none px-0.5 transition-opacity"
                        title="Rename or delete"
                      >⋯</button>
                    )}
                  </span>
                  {c.sub && (
                    <span className="block overflow-hidden max-h-0 opacity-0 group-hover/conv:max-h-4 group-hover/conv:opacity-100 transition-all duration-200 ease-out pl-[23.5px] text-[10.5px] not-italic text-neutral-400">
                      {c.sub}
                    </span>
                  )}
                </>
              );
              const rowCls = `${item(onHome && openConvKey === c.key)} group/conv w-full text-left !flex-col !items-stretch !gap-0 cursor-pointer`;
              return manageable ? (
                <div key={c.key} role="button" tabIndex={0} onClick={() => { if (convRenaming !== c.key) openChat(c.key); }}
                  // W17 · HOVER WARMS THE NEXT PAGE: the conversation's turns are read (a peek — no
                  // read marker) on intent, so the click paints them instead of the skeleton.
                  onMouseEnter={() => prefetchChatTurns(c.key)} onFocus={() => prefetchChatTurns(c.key)}
                  onMouseDown={() => prefetchChatTurns(c.key, { immediate: true })}
                  className={rowCls}>{inner}</div>
              ) : (
                <Link key={c.key} href={c.href ?? '/home'} className={rowCls}>{inner}</Link>
              );
            })}
          </>
        )}

        {/* The one row menu (portaled — the overlay law); it serves BOTH manageable grammars. */}
        <AnchoredPopover anchorRef={menuAnchorRef} open={!!convMenu} onClose={() => setConvMenu(null)} align="left" width={150}>
              <div className="rounded-xl border border-neutral-200 bg-white shadow-lg py-1">
                {(() => {
                  const c = rooms.conversations.find((x) => x.key === convMenu);
                  if (!c) return null;
                  return (
                    <>
                      <button onClick={() => { setConvRenameVal(c.label); setConvRenaming(c.key); setConvMenu(null); }}
                        className="w-full px-3 py-1.5 text-left text-[12px] text-neutral-600 hover:bg-neutral-50">Rename</button>
                      <button onClick={() => { void removeConv(c); }}
                        className="w-full px-3 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50">Delete</button>
                    </>
                  );
                })()}
              </div>
        </AnchoredPopover>

        {/* ("All conversations →" moved onto the CHATS label row — one door per section, no
            trailing repeat; when no chats exist the door still needs a seat, so it renders alone.) */}
        {otherRows.length === 0 && rooms.conversations.length + projectRows.length > 0 && (
          <Link href="/home?view=conversations" className={`block px-2.5 py-[6px] text-[11.5px] transition-colors ${lensIs('conversations') ? 'text-indigo-600 font-medium' : 'text-neutral-400 hover:text-neutral-700'}`}>
            All conversations →
          </Link>
        )}
      </nav>

      {/* ══ THE QUIET GROUP — the modules, one step back. They are DOORS, not the shape of the
          product: the conversations above are the product. Feature-gated per the tier law (an
          email-off workspace never reads a mailbox door), and each count is a served fact. */}
      <div className="px-2 pt-2 pb-1 border-t border-neutral-200/70">
        {/* The ledger lives INSIDE the Home shell (the one-surface law); /workflows is only a
            redirect seat, so the door points at the real surface and skips the round-trip. */}
        {features.studio && (
          <Link href="/home?view=workflows" className={quiet(pathname.startsWith('/workflows') || pathname.startsWith('/studio') || lensIs('workflows', 'runs'))}>
            <BoltIcon className="w-[15px] h-[15px] flex-shrink-0 text-neutral-400" />
            <span className="flex-1 truncate">Workflows</span>
            {/* THE RUNS COUNT — deliveries you haven't opened; the same reviewed_at stamp that
                keeps auto-pause honest. Quiet, never an alarm: a delivered briefing is good news. */}
            {(rooms.workflowsUnread ?? 0) > 0 && (
              <span className="flex-shrink-0 text-[10.5px] text-neutral-400 tabular-nums">
                {rooms.workflowsUnread! > 99 ? '99+' : rooms.workflowsUnread}
              </span>
            )}
          </Link>
        )}
        {features.email && (
          <Link href="/inbox" className={quiet(pathname.startsWith('/inbox'))}>
            <EnvelopeIcon className="w-[15px] h-[15px] flex-shrink-0 text-neutral-400" />
            <span className="flex-1 truncate">Inbox</span>
          </Link>
        )}
        {features.meetings && (
          <Link href="/meetings" className={quiet(pathname.startsWith('/meetings'))}>
            <VideoCameraIcon className="w-[15px] h-[15px] flex-shrink-0 text-neutral-400" />
            <span className="flex-1 truncate">Meetings</span>
          </Link>
        )}
        {/* Documents = the library's own address (owner, Sep 15): /drive and /knowledge are
            redirect seats, so the door — and its active state — name the real path. */}
        {features.drive && (
          <Link href="/documents" className={quiet(pathname.startsWith('/documents'))}>
            <DocumentTextIcon className="w-[15px] h-[15px] flex-shrink-0 text-neutral-400" />
            <span className="flex-1 truncate">Documents</span>
          </Link>
        )}
        {isSuperAdmin && (
          <Link href="/platform-admin" className={quiet(pathname.startsWith('/platform-admin'))}>
            <ShieldCheckIcon className="w-[15px] h-[15px] flex-shrink-0 text-neutral-400" />
            <span className="flex-1 truncate">Platform Admin</span>
          </Link>
        )}
      </div>

      {/* Recording indicator */}
      {(recording.state === 'recording' || recording.state === 'uploading') && (
        <div className="px-2 pb-1">
          <button onClick={() => router.push('/meetings')}
            title={recording.state === 'uploading' ? 'Uploading recording…' : 'Recording — click to return'}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg hover:bg-neutral-200/60 transition-colors">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${recording.state === 'uploading' ? 'bg-amber-400' : 'bg-red-500 animate-pulse'}`} />
            {recording.state === 'recording' && <span className="text-[11px] font-semibold text-red-500 tabular-nums leading-none">{formatElapsed(recording.elapsed)}</span>}
            {recording.state === 'uploading' && <span className="text-[11px] font-semibold text-amber-500 leading-none">{recording.uploadProgress}%</span>}
          </button>
        </div>
      )}

      {/* ══ "YOUR TEAM" — THE ONE COWORKER DOOR (owner, Sep 7: one row instead of N rows, so the
          nav does not bloat as the roster grows). Quiet, global, always in the corner of your eye
          (like colleagues in an office). The faces wear THE KIT'S avatar grammar — the same
          working ring the threads use, off the same live presence signal, so a running coworker
          is visible without opening anything. Click = the roster: face · name · role · what
          they're doing, each row a DM door, plus the Settings manage door.
          NO BADGE HERE, deliberately: an aggregate needs-you number would need a per-DM read
          marker, and work_messages has none (see /api/rooms/recent's own note). Honest or absent. */}
      <div ref={teamRef} className="relative px-2 pt-1">
        {teamOpen && (
          <div className="absolute bottom-full left-2 mb-1.5 w-64 bg-white border border-neutral-200 shadow-lg z-50 rounded-xl overflow-hidden">
            <div className="py-1">
              {(team ?? []).map((w) => {
                const working = !!w.state?.startsWith('Running');
                return (
                  /* THE WHOLE ROW IS THE DM DOOR (the word is the deed — a name you click is a
                     conversation you open); the same `dmWorker` handler the nav rows used. */
                  <div key={w.id} role="button" tabIndex={0}
                    onClick={() => dmWorker(w)}
                    onKeyDown={(e) => { if (e.key === 'Enter') dmWorker(w); }}
                    className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-neutral-50">
                    <AvatarStatus name={w.name} actorId={w.id} size={28}
                      status={working ? 'working' : 'idle'} hint={w.state} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5 min-w-0">
                        <span className="text-[12.5px] font-medium text-neutral-800 leading-tight">{w.name.split(' ')[0]}</span>
                        {w.worker_role && ROLE_LABELS[w.worker_role] && (
                          <span className="truncate text-[10.5px] text-neutral-400 leading-tight">{ROLE_LABELS[w.worker_role]}</span>
                        )}
                      </span>
                      <span className={`block truncate text-[11px] leading-tight ${working ? 'text-indigo-600' : 'text-neutral-400'}`}>{w.state}</span>
                    </span>
                  </div>
                );
              })}
              {/* W17 · NO SPINNER WORDS: the roster not yet read holds its place in the rows' own
                  shape (face · name · state), pulsing, reduced-motion honoured. */}
              {team === null && [0, 1].map((i) => (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2" aria-hidden>
                  <span className="h-7 w-7 flex-shrink-0 rounded-full bg-neutral-100 animate-pulse motion-reduce:animate-none" />
                  <span className="flex-1 space-y-1.5">
                    <span className="block h-2.5 w-20 rounded bg-neutral-100 animate-pulse motion-reduce:animate-none" />
                    <span className="block h-2 w-14 rounded bg-neutral-100 animate-pulse motion-reduce:animate-none" />
                  </span>
                </div>
              ))}
              <div className="my-1 border-t border-neutral-100" />
              <Link href="/settings?tab=team" onClick={() => setTeamOpen(false)}
                className="block px-3 py-2 text-[12px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 transition-colors">
                Manage in Settings →
              </Link>
            </div>
          </div>
        )}
        <button onClick={() => setTeamOpen((v) => !v)}
          className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-neutral-200/50 transition-colors">
          {/* The pile keeps the overlap; each face is the kit's, so a live run rings THROUGH the
              collapsed row. The gap is the ring's room — overlapped faces would clip it. */}
          <span className="flex items-center gap-1">
            {(team ?? []).slice(0, 4).map((w) => (
              <AvatarStatus key={w.id} name={w.name} actorId={w.id} size={20}
                status={w.state?.startsWith('Running') ? 'working' : 'idle'} hint={w.state} />
            ))}
            {(team === null || team.length === 0) && <span className="w-5 h-5 rounded-full bg-neutral-200 ring-2 ring-neutral-50" />}
          </span>
          <span className="text-[12px] text-neutral-500">Your team</span>
          {(team?.length ?? 0) > 4 && (
            <span className="ml-auto flex-shrink-0 text-[11px] text-neutral-400 tabular-nums">+{team!.length - 4}</span>
          )}
        </button>
      </div>

      {/* THE SAFE-DATA MARK (the sovereign door) — quiet, always visible on corporate
          workspaces: this environment holds no third-party sign-in. Visual only. */}
      {sovereign && (
        <div className="px-4 pb-1.5"
          title="Private AI models · EU processing · No third-party sign-in">
          <span className="flex items-center gap-1.5 text-[10.5px] text-neutral-400 select-none">
            <ShieldCheckIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
            Private environment
          </span>
        </div>
      )}
      {/* Footer: identity + Settings (Team + Knowledge live inside Settings — the fold's doors). */}
      <div ref={menuRef} className="relative px-2 pb-3 pt-1">
        {showUserMenu && (
          <div className="absolute bottom-full left-2 mb-1.5 w-48 bg-white border border-neutral-200 shadow-lg z-50 rounded-lg overflow-hidden">
            <div className="py-1">
              <Link href="/settings" onClick={() => setShowUserMenu(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors">
                <Cog6ToothIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                Settings
              </Link>
              <div className="my-1 border-t border-neutral-100" />
              <form action="/auth/signout" method="post">
                <button type="submit" className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors">
                  <ArrowRightOnRectangleIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        )}
        <button onClick={() => setShowUserMenu((v) => !v)} title={userEmail ?? 'Account'}
          className={`flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg transition-colors ${showUserMenu ? 'bg-neutral-200/60' : 'hover:bg-neutral-200/50'}`}>
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-indigo-700 bg-indigo-100 overflow-hidden flex-shrink-0">
            {avatarUrl ? <Image src={avatarUrl} alt="" width={28} height={28} className="w-full h-full object-cover rounded-full" unoptimized /> : userInitial}
          </span>
          <span className="text-[12px] text-neutral-500 truncate min-w-0">{userEmail ?? 'Account'}</span>
        </button>
      </div>
    </div>
  );
}
