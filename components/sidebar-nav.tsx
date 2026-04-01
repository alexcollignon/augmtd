'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  InboxIcon,
  BriefcaseIcon,
  CircleStackIcon,
  ClockIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  LockClosedIcon,
  GlobeAltIcon,
  ShieldCheckIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';

interface SidebarNavProps {
  userEmail?: string;
}

export default function SidebarNav({ userEmail }: SidebarNavProps) {
  const pathname = usePathname();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Tier toggle state
  const [tier, setTier] = useState<'standard' | 'private_shared' | null>(null);
  const [tierLoading, setTierLoading] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [processNotifCount, setProcessNotifCount] = useState(0);

  const navigation = [
    { name: 'Inbox', href: '/inbox', icon: InboxIcon },
    { name: 'Work', href: '/work', icon: BriefcaseIcon },
    { name: 'Meetings', href: '/meetings', icon: CalendarDaysIcon },
    { name: 'Drive', href: '/drive', icon: CircleStackIcon },
    ...(isSuperAdmin ? [{ name: 'Platform Admin', href: '/platform-admin', icon: ShieldCheckIcon }] : []),
  ];

  // Load current tier + super admin status on mount
  useEffect(() => {
    fetch('/api/settings/tier')
      .then((r) => r.json())
      .then((d) => setTier(d.tier ?? 'standard'))
      .catch(() => setTier('standard'));
    fetch('/api/platform-admin/me')
      .then((r) => r.json())
      .then((d) => setIsSuperAdmin(d.isSuperAdmin === true))
      .catch(() => {});
  }, []);

  // Poll process notifications every 30s
  useEffect(() => {
    const fetchCount = () => {
      fetch('/api/notifications/processes')
        .then((r) => r.json())
        .then((d) => setProcessNotifCount(d.count ?? 0))
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleTier = useCallback(async () => {
    if (tierLoading || tier === null) return;
    const next = tier === 'standard' ? 'private_shared' : 'standard';
    setTierLoading(true);
    try {
      const res = await fetch('/api/settings/tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: next }),
      });
      if (res.ok) setTier(next);
    } finally {
      setTierLoading(false);
    }
  }, [tier, tierLoading]);

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
  const isPrivate = tier === 'private_shared';

  return (
    <div className="flex h-screen w-14 flex-col bg-neutral-50 flex-shrink-0">

      {/* Logo */}
      <div className="flex h-12 items-center justify-center">
        <Link href="/" title="AUGMTD">
          <Image
            src="/augmtd-logo.png"
            alt="AUGMTD"
            width={20}
            height={20}
            className="w-5 h-5"
          />
        </Link>
      </div>

      {/* Tier toggle */}
      <div className="flex justify-center py-1.5">
        <button
          onClick={toggleTier}
          disabled={tierLoading || tier === null}
          title={isPrivate ? 'Private AI — click to switch' : 'Public AI — click to switch'}
          className={`p-2 rounded-lg transition-colors ${
            isPrivate
              ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
              : 'text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600'
          } ${tierLoading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
        >
          {isPrivate ? (
            <LockClosedIcon className="w-4 h-4" />
          ) : (
            <GlobeAltIcon className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 px-1.5">
        {navigation.map((item) => {
          const isActive = item.href === '/work'
            ? pathname.startsWith('/work') || pathname.startsWith('/processes')
            : pathname.startsWith(item.href);
          return (
            <div key={item.name}>
              <Link
                href={item.href}
                title={item.name}
                className={`
                  flex items-center justify-center w-full py-2.5 mb-px transition-colors rounded-lg
                  ${isActive
                    ? 'bg-indigo-50 text-indigo-500'
                    : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60'
                  }
                `}
              >
                <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
              </Link>
            </div>
          );
        })}
      </nav>

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
          className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-indigo-700 select-none transition-colors ${
            showUserMenu ? 'bg-indigo-200' : 'bg-indigo-100 hover:bg-indigo-200'
          }`}
        >
          {userInitial}
        </button>
      </div>
    </div>
  );
}
