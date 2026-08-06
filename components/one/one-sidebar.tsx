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
  HomeIcon, EnvelopeIcon, VideoCameraIcon, PlusIcon,
  Cog6ToothIcon, ArrowRightOnRectangleIcon, ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useRecordingContext } from '@/context/recording-context';
import type { WorkspaceFeatures } from '@/lib/workspace/types';
import { DEFAULT_FEATURES } from '@/lib/workspace/types';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

type Conversation = { key: string; kind: 'room' | 'chat'; label: string; href: string | null };
type Rooms = { pinned: Array<{ id: string; name: string; href: string }>; conversations: Conversation[] };
const LS_KEY = 'aug-one-sidebar-v1';

function formatElapsed(secs: number) {
  const m = Math.floor(secs / 60); const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function OneSidebar({
  userEmail, avatarUrl = null, isSuperAdmin = false, features = DEFAULT_FEATURES,
}: { userEmail?: string; avatarUrl?: string | null; isSuperAdmin?: boolean; features?: WorkspaceFeatures }) {
  const pathname = usePathname();
  const router = useRouter();
  const recording = useRecordingContext();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rooms, setRooms] = useState<Rooms>({ pinned: [], conversations: [] });

  useEffect(() => {
    const cached = loadLS<Rooms>(LS_KEY);
    if (cached?.pinned) setRooms(cached);
    const refresh = () => {
      fetch('/api/rooms/recent').then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (d && Array.isArray(d.pinned)) {
          const next: Rooms = { pinned: d.pinned, conversations: Array.isArray(d.conversations) ? d.conversations : [] };
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

  const item = (active: boolean) =>
    `flex items-center gap-2.5 px-2.5 py-[7px] mb-px rounded-lg text-[12.5px] transition-colors ${
      active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50'
    }`;
  const sectionLabel = 'px-2.5 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400 select-none';
  const userInitial = userEmail?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="flex h-screen w-[212px] flex-col bg-neutral-50 flex-shrink-0 border-r border-neutral-200/60">
      {/* Wordmark */}
      <div className="flex h-12 items-center gap-2 px-4">
        <Image src="/augmtd-logo.png" alt="AUGMTD" width={18} height={18} className="w-[18px] h-[18px]" />
        <span className="text-[13px] font-semibold tracking-wide text-neutral-800 select-none">augmtd</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2 [scrollbar-width:thin]">
        <Link href="/home" className={item(pathname === '/home' || pathname.startsWith('/item'))}
          onClick={() => { if (pathname === '/home') window.dispatchEvent(new CustomEvent('augmtd:home-reset')); }}>
          <HomeIcon className={`w-[17px] h-[17px] flex-shrink-0 ${pathname === '/home' ? 'text-indigo-500' : 'text-neutral-400'}`} />
          Home
        </Link>
        <button onClick={newChat} className={`${item(false)} w-full text-left`}>
          <PlusIcon className="w-[17px] h-[17px] flex-shrink-0 text-neutral-400" />
          New chat
        </button>

        {/* ONE NAME EVERYWHERE (owner call): these ARE the tracked PROJECTS — the same word the
            product uses on every other surface (never "pinned"). */}
        {rooms.pinned.length > 0 && (
          <>
            <div className={sectionLabel}>Projects</div>
            {rooms.pinned.map((p) => (
              <Link key={p.id} href={p.href} className={item(false)}>
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 flex-shrink-0" />
                <span className="truncate">{p.name}</span>
              </Link>
            ))}
            <Link href="/home?view=projects" className="block px-2.5 py-[6px] text-[11.5px] text-neutral-400 hover:text-neutral-700 transition-colors">
              All projects →
            </Link>
          </>
        )}

        {rooms.conversations.length > 0 && (
          <>
            <div className={sectionLabel}>Recent</div>
            {rooms.conversations.slice(0, 5).map((c) => (
              c.kind === 'chat' ? (
                <button key={c.key} onClick={() => openChat(c.key)} className={`${item(false)} w-full text-left italic`}>
                  <span className="truncate">{c.label}</span>
                </button>
              ) : (
                <Link key={c.key} href={c.href ?? '/home'} className={`${item(false)} italic`}>
                  <span className="truncate">{c.label}</span>
                </Link>
              )
            ))}
            <Link href="/home?view=conversations" className="block px-2.5 py-[6px] text-[11.5px] text-neutral-400 hover:text-neutral-700 transition-colors">
              All conversations →
            </Link>
          </>
        )}

        <div className={sectionLabel}>Sources</div>
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
