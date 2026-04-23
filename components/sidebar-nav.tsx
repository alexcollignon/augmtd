'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  EnvelopeIcon,
  Squares2X2Icon,
  VideoCameraIcon,
  FolderIcon,
  ClockIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useRecordingContext } from '@/context/recording-context';
import type { MyWorkspace, WorkspaceFeatures } from '@/lib/workspace/types';
import { DEFAULT_FEATURES } from '@/lib/workspace/types';
import WorkspaceSwitcher from '@/components/workspace-switcher';

interface SidebarNavProps {
  userEmail?: string;
  avatarUrl?: string | null;
  isSuperAdmin?: boolean;
  features?: WorkspaceFeatures;
  allWorkspaces?: MyWorkspace[];
  activeWorkspace?: MyWorkspace | null;
}

function formatElapsed(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function SidebarNav({
  userEmail,
  avatarUrl: avatarUrlProp = null,
  isSuperAdmin: isSuperAdminProp = false,
  features = DEFAULT_FEATURES,
  allWorkspaces = [],
  activeWorkspace = null,
}: SidebarNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const recording = useRecordingContext();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(avatarUrlProp);

  const menuRef = useRef<HTMLDivElement>(null);

  const [isSuperAdmin] = useState(isSuperAdminProp);
  const [workflowNotifCount, setWorkflowNotifCount] = useState(0);

  const navigation = [
    ...(features.email    ? [{ name: 'Inbox',    href: '/inbox',    icon: EnvelopeIcon }]    : []),
    { name: 'Work', href: '/work', icon: Squares2X2Icon, badgeCount: workflowNotifCount }, // core — always shown
    ...(features.meetings ? [{ name: 'Meetings', href: '/meetings', icon: VideoCameraIcon }] : []),
    ...(features.drive    ? [{ name: 'Drive',    href: '/drive',    icon: FolderIcon }]      : []),
    ...(isSuperAdmin ? [{ name: 'Platform Admin', href: '/platform-admin', icon: ShieldCheckIcon }] : []),
  ];

  // Poll workflow notifications every 30s
  useEffect(() => {
    const fetchCount = () => {
      fetch('/api/notifications/workflows')
        .then((r) => r.json())
        .then((d) => setWorkflowNotifCount(d.count ?? 0))
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close popover on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu]);

  const userInitial = userEmail?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="flex h-screen w-14 flex-col bg-neutral-50 flex-shrink-0">

      {/* Logo / workspace switcher */}
      <div className="flex h-12 items-center justify-center">
        {allWorkspaces.length > 0 ? (
          <WorkspaceSwitcher activeWorkspace={activeWorkspace} allWorkspaces={allWorkspaces} />
        ) : (
          <Image
            src="/augmtd-logo.png"
            alt="AUGMTD"
            width={20}
            height={20}
            className="w-5 h-5"
          />
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 px-1.5">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const badgeCount = 'badgeCount' in item ? item.badgeCount : 0;
          return (
            <div key={item.name}>
              <Link
                href={item.href}
                title={item.name}
                className={`
                  relative flex items-center justify-center w-full py-2.5 mb-px transition-colors rounded-lg
                  ${isActive
                    ? 'bg-indigo-50 text-indigo-500'
                    : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60'
                  }
                `}
              >
                <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
                {badgeCount && badgeCount > 0 ? (
                  <span className="absolute top-1.5 right-2.5 w-1.5 h-1.5 rounded-full bg-indigo-500" />
                ) : null}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Recording indicator */}
      {(recording.state === 'recording' || recording.state === 'uploading') && (
        <div className="flex justify-center pb-2">
          <button
            onClick={() => router.push('/meetings')}
            title={recording.state === 'uploading' ? 'Uploading recording…' : `Recording — ${formatElapsed(recording.elapsed)} — click to return`}
            className="flex flex-col items-center gap-0.5 p-1.5 rounded-lg hover:bg-neutral-200/60 transition-colors"
          >
            <span className={`w-2 h-2 rounded-full ${recording.state === 'uploading' ? 'bg-amber-400' : 'bg-red-500 animate-pulse'}`} />
            {recording.state === 'recording' && (
              <span className="text-[9px] font-semibold text-red-500 tabular-nums leading-none">
                {formatElapsed(recording.elapsed)}
              </span>
            )}
            {recording.state === 'uploading' && (
              <span className="text-[9px] font-semibold text-amber-500 leading-none">
                {recording.uploadProgress}%
              </span>
            )}
          </button>
        </div>
      )}

      {/* User profile + popover */}
      <div ref={menuRef} className="relative flex justify-center pb-3 pt-1">

        {/* Popover — floats above the profile button */}
        {showUserMenu && (
          <div className="absolute bottom-full left-1 mb-1.5 w-44 bg-white border border-neutral-200 shadow-lg z-50 rounded-lg overflow-hidden">
            <div className="py-1">
              <Link
                href="/activity"
                onClick={() => setShowUserMenu(false)}
                className={`flex items-center gap-2.5 px-3 py-2 text-[12.5px] transition-colors ${
                  pathname === '/activity'
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                }`}
              >
                <ClockIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                Activity Log
              </Link>
              <Link
                href="/settings"
                onClick={() => setShowUserMenu(false)}
                className={`flex items-center gap-2.5 px-3 py-2 text-[12.5px] transition-colors ${
                  pathname === '/settings'
                    ? 'text-indigo-700 bg-indigo-50'
                    : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                }`}
              >
                <Cog6ToothIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                Settings
              </Link>
              <div className="my-1 border-t border-neutral-100" />
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors"
                >
                  <ArrowRightOnRectangleIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Profile button — avatar only */}
        <button
          onClick={() => setShowUserMenu((v) => !v)}
          title={userEmail ?? 'Account'}
          className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-indigo-700 select-none transition-colors overflow-hidden ${
            showUserMenu ? 'bg-indigo-200' : 'bg-indigo-100 hover:bg-indigo-200'
          }`}
        >
          {avatarUrl ? (
            <Image src={avatarUrl} alt="" width={32} height={32} className="w-full h-full object-cover rounded-full" unoptimized />
          ) : (
            userInitial
          )}
        </button>
      </div>
    </div>
  );
}
