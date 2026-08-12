'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE-SURFACE SIDEBAR (Arc 3 THE SHELL, S1 — docs/one-surface-plan.md; the settled design,
// mockup rev 4). THE FOLD HAPPENS HERE, WHOLESALE: this frame is owned by the CONVERSATIONAL
// dimension — New chat · Pinned rooms · Recent conversations · All conversations — with the two
// untouched SOURCES (Inbox · Meetings) and the team/Settings footer. Workers / Chat / Drive have
// NO seats (their routes survive; Settings carries the Team + Knowledge doors). The ladder's laws:
// the sidebar lists CONVERSATIONS, attention stays on the deck; nothing here is ever the item
// firehose. This is lawful NOW (unlike the killed Aug-6 interims) because the fold ships WITH it.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  HomeIcon, EnvelopeIcon, VideoCameraIcon, PlusIcon, FolderIcon,
  Cog6ToothIcon, ArrowRightOnRectangleIcon, ShieldCheckIcon,
  ChatBubbleLeftEllipsisIcon, UserCircleIcon, BoltIcon,
} from '@heroicons/react/24/outline';
import { useRecordingContext } from '@/context/recording-context';
import type { WorkspaceFeatures } from '@/lib/workspace/types';
import { DEFAULT_FEATURES } from '@/lib/workspace/types';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { ROLE_AVATARS, ROLE_LABELS } from '@/lib/workers/roles';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { toast } from 'sonner';

type Conversation = { key: string; kind: 'room' | 'chat' | 'coworker'; label: string; href: string | null; sub?: string };
type Rooms = { pinned: Array<{ id: string; name: string; href: string }>; conversations: Conversation[]; workflowsUnread?: number };
const LS_KEY = 'aug-one-sidebar-v1';

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
          const next: Rooms = { pinned: d.pinned, conversations: Array.isArray(d.conversations) ? d.conversations : [], workflowsUnread: typeof d.workflowsUnread === 'number' ? d.workflowsUnread : 0 };
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

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowUserMenu(false); };
    if (showUserMenu) document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showUserMenu]);

  // New chat: land on the Home with a fresh chat room OPEN (the composer focuses; HomeAsk
  // listens; the sessionStorage intent covers the cross-page mount).
  const newChat = () => {
    try { localStorage.removeItem('aug-home-chat-key'); sessionStorage.setItem('aug-open-chat-intent', '1'); } catch { /* no LS */ }
    window.dispatchEvent(new CustomEvent('aug:new-chat'));
    if (pathname !== '/home') router.push('/home');
  };
  // Opening a past chat: set the key, open the panel (same-page via the event; cross-page via
  // the intent flag — a click must never load turns into a CLOSED card).
  const openChat = (key: string) => {
    try { localStorage.setItem('aug-home-chat-key', key); sessionStorage.setItem('aug-open-chat-intent', '1'); } catch { /* no LS */ }
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
  useEffect(() => {
    if (!teamOpen) return;
    fetch('/api/workers/presence').then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.team)) setTeam(d.team); })
      .catch(() => setTeam((t) => t ?? []));
    const onDown = (e: MouseEvent) => { if (teamRef.current && !teamRef.current.contains(e.target as Node)) setTeamOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [teamOpen]);
  // Cached roster for the collapsed facepile (avatars need no live state).
  useEffect(() => {
    const cached = loadLS<TeamMate[]>('aug-team-presence-v1');
    if (cached?.length) setTeam(cached);
  }, []);
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
  const sectionLabel = 'px-2.5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400 select-none';
  const userInitial = userEmail?.[0]?.toUpperCase() ?? '?';

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
        <Link href="/home" className={item(lensIs('dashboard', 'timeline') || pathname.startsWith('/item'))}
          onClick={() => { if (pathname === '/home') window.dispatchEvent(new CustomEvent('augmtd:home-reset')); }}>
          <HomeIcon className={`w-[17px] h-[17px] flex-shrink-0 ${lensIs('dashboard', 'timeline') ? 'text-indigo-500' : 'text-neutral-400'}`} />
          Home
        </Link>
        <button onClick={newChat} className={`${item(false)} w-full text-left`}>
          <PlusIcon className="w-[17px] h-[17px] flex-shrink-0 text-neutral-400" />
          New chat
        </button>

        {/* ONE NAME EVERYWHERE (owner call, refined Aug 7): Projects is ONE menu item — the
            portfolio lens is the destination; the sidebar never carries the project LIST
            (the roster lives on its own page, not the nav). */}
        <Link href="/home?view=projects" className={item(lensIs('projects'))}>
          <FolderIcon className={`w-[17px] h-[17px] flex-shrink-0 ${lensIs('projects') ? 'text-indigo-500' : 'text-neutral-400'}`} />
          Projects
        </Link>

        {/* THE PRODUCTION DOOR (production arc step 5): Workflows is the LEDGER — what stands,
            what ran, what waits on your approval; creation is describe→confirm; Studio stays
            one click deep as the method editor. Coworkers = ad hoc; workflows = production. */}
        <Link href="/home?view=workflows" className={item(lensIs('workflows', 'runs'))}>
          <BoltIcon className={`w-[17px] h-[17px] flex-shrink-0 ${lensIs('workflows', 'runs') ? 'text-indigo-500' : 'text-neutral-400'}`} />
          Workflows
          {/* THE RUNS BADGE — deliveries you haven't opened; clears on opening Runs/a deliverable
              (the same stamp that keeps auto-pause honest). Quiet count, never a red alarm —
              a successful briefing is good news, not debt. */}
          {(rooms.workflowsUnread ?? 0) > 0 && (
            <span className="ml-auto rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 tabular-nums">
              {rooms.workflowsUnread! > 9 ? '9+' : rooms.workflowsUnread}
            </span>
          )}
        </Link>

        {/* Inbox + Meetings sit WITH the primary nav (owner call, Aug 12 — a separate "Sources"
            category read as taxonomy, not navigation; two items don't earn a section). */}
        {features.email && (
          <Link href="/inbox" className={item(pathname.startsWith('/inbox'))}>
            <EnvelopeIcon className={`w-[17px] h-[17px] flex-shrink-0 ${pathname.startsWith('/inbox') ? 'text-indigo-500' : 'text-neutral-400'}`} />
            Inbox
          </Link>
        )}
        {features.meetings && (
          <Link href="/meetings" className={item(pathname.startsWith('/meetings'))}>
            <VideoCameraIcon className={`w-[17px] h-[17px] flex-shrink-0 ${pathname.startsWith('/meetings') ? 'text-indigo-500' : 'text-neutral-400'}`} />
            Meetings
          </Link>
        )}

        {rooms.conversations.length > 0 && (
          <>
            <div className={sectionLabel}>Recent</div>
            {/* THE KIND GLYPH + THE HOVER EXPAND (owner, Aug 8): a subtle icon says what each
                conversation IS (chat · coworker DM · work room); hovering smoothly reveals the
                second line — "with Clara" / "in EG Bank" / the kind word. Plain chats stay
                quiet (nothing worth expanding). */}
            {rooms.conversations.slice(0, 5).map((c) => {
              const Glyph = c.kind === 'coworker' ? UserCircleIcon : c.kind === 'chat' ? ChatBubbleLeftEllipsisIcon : FolderIcon;
              const manageable = c.kind === 'chat' || c.kind === 'coworker';
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
              const rowCls = `${item(false)} group/conv w-full text-left !flex-col !items-stretch !gap-0 cursor-pointer`;
              return manageable ? (
                <div key={c.key} role="button" tabIndex={0} onClick={() => { if (convRenaming !== c.key) openChat(c.key); }} className={rowCls}>{inner}</div>
              ) : (
                <Link key={c.key} href={c.href ?? '/home'} className={rowCls}>{inner}</Link>
              );
            })}
            {/* The one row menu (portaled — the overlay law). */}
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
            <Link href="/home?view=conversations" className="block px-2.5 py-[6px] text-[11.5px] text-neutral-400 hover:text-neutral-700 transition-colors">
              All conversations →
            </Link>
          </>
        )}

        {isSuperAdmin && (
          <Link href="/platform-admin" className={item(pathname.startsWith('/platform-admin'))}>
            <ShieldCheckIcon className="w-[17px] h-[17px] flex-shrink-0 text-neutral-400" />
            Platform Admin
          </Link>
        )}
      </nav>

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

      {/* THE TEAM FACEPILE — quiet, global, always in the corner of your eye (like colleagues
          in an office). Click = the one popover: live state per coworker · Chat · Settings. */}
      <div ref={teamRef} className="relative px-2 pt-1">
        {teamOpen && (
          <div className="absolute bottom-full left-2 mb-1.5 w-64 bg-white border border-neutral-200 shadow-lg z-50 rounded-xl overflow-hidden">
            <div className="py-1">
              {(team ?? []).map((w) => (
                <div key={w.id} className="flex items-center gap-2.5 px-3 py-2">
                  {w.worker_role && ROLE_AVATARS[w.worker_role] ? (
                    <Image src={ROLE_AVATARS[w.worker_role]} alt="" width={28} height={28} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-[12px] font-semibold flex-shrink-0">{w.name[0]}</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5 min-w-0">
                      <span className="text-[12.5px] font-medium text-neutral-800 leading-tight">{w.name.split(' ')[0]}</span>
                      {w.worker_role && ROLE_LABELS[w.worker_role] && (
                        <span className="truncate text-[10.5px] text-neutral-400 leading-tight">{ROLE_LABELS[w.worker_role]}</span>
                      )}
                    </span>
                    <span className={`block truncate text-[11px] leading-tight ${w.state.startsWith('Running') ? 'text-indigo-600' : 'text-neutral-400'}`}>{w.state}</span>
                  </span>
                  <button onClick={() => dmWorker(w)}
                    className="flex-shrink-0 rounded-lg px-2 py-1 text-[11.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors">
                    Chat
                  </button>
                </div>
              ))}
              {team === null && <div className="px-3 py-2 text-[12px] text-neutral-400">Loading…</div>}
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
          <span className="flex -space-x-1.5">
            {(team ?? []).slice(0, 4).map((w) => (
              w.worker_role && ROLE_AVATARS[w.worker_role]
                ? <Image key={w.id} src={ROLE_AVATARS[w.worker_role]} alt="" width={20} height={20} className="w-5 h-5 rounded-full object-cover ring-2 ring-neutral-50" />
                : <span key={w.id} className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 ring-2 ring-neutral-50 flex items-center justify-center text-[9px] font-semibold">{w.name[0]}</span>
            ))}
            {(team === null || team.length === 0) && <span className="w-5 h-5 rounded-full bg-neutral-200 ring-2 ring-neutral-50" />}
          </span>
          <span className="text-[12px] text-neutral-500">Your team</span>
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
