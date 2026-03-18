'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  InboxIcon,
  QueueListIcon,
  BookOpenIcon,
  ClockIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  ChevronUpIcon,
  LockClosedIcon,
  GlobeAltIcon,
  BuildingOfficeIcon,
  ShieldCheckIcon,
  ArrowPathIcon,
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
    { name: 'Work Inbox', href: '/inbox', icon: InboxIcon },
    { name: 'Workflows', href: '/work', icon: QueueListIcon },
    { name: 'Processes', href: '/processes', icon: ArrowPathIcon },
    { name: 'Knowledge', href: '/knowledge', icon: BookOpenIcon },
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
    <div className="flex h-screen w-52 flex-col bg-white border-r border-neutral-200 flex-shrink-0">

      {/* Logo */}
      <div className="flex h-12 items-center px-4 border-b border-neutral-100">
        <Link href="/" className="flex items-center gap-2 group">
          <Image
            src="/augmtd-logo.png"
            alt="AUGMTD"
            width={20}
            height={20}
            className="w-5 h-5 opacity-90"
          />
          <span className="text-[13px] font-bold tracking-widest text-neutral-900 uppercase">
            AUGMTD
          </span>
          <span className="text-[9px] font-semibold tracking-wider text-neutral-400 uppercase border border-neutral-200 rounded px-1 py-0.5 leading-none">
            beta
          </span>
        </Link>
      </div>

      {/* Tier toggle */}
      <div className="px-4 py-2 border-b border-neutral-100">
        <button
          onClick={toggleTier}
          disabled={tierLoading || tier === null}
          title={isPrivate ? 'Switch to Public AI' : 'Switch to Private AI'}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] font-medium transition-all duration-300 ${
            isPrivate
              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'bg-neutral-50 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
          } ${tierLoading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
        >
          {isPrivate ? (
            <LockClosedIcon className="w-3.5 h-3.5 flex-shrink-0 text-emerald-500" />
          ) : (
            <GlobeAltIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
          )}
          <span className="flex-1 text-left">
            {isPrivate ? 'Private AI' : 'Public AI'}
          </span>
          {/* Toggle pill */}
          <div className={`relative w-7 h-4 rounded-full transition-all duration-300 flex-shrink-0 ${isPrivate ? 'bg-emerald-400' : 'bg-neutral-200'}`}>
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-300 ${isPrivate ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </div>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 px-2">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const badge = item.href === '/processes' && processNotifCount > 0 ? processNotifCount : 0;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`
                flex items-center gap-2.5 px-3 py-2 mb-px text-[12.5px] font-medium transition-colors
                ${isActive
                  ? 'bg-indigo-50 text-indigo-700 border-l-2 border-indigo-500'
                  : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 border-l-2 border-transparent'
                }
              `}
            >
              <item.icon
                className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-indigo-500' : 'text-neutral-400'}`}
              />
              <span className="flex-1">{item.name}</span>
              {badge > 0 && (
                <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-semibold rounded-full flex items-center justify-center leading-none">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User profile + popover */}
      <div ref={menuRef} className="relative border-t border-neutral-100 p-2">

        {/* Popover — floats above the profile button */}
        {showUserMenu && (
          <div className="absolute bottom-full left-2 right-2 mb-1.5 bg-white border border-neutral-200 shadow-lg z-50">
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

        {/* Profile button */}
        <button
          onClick={() => setShowUserMenu((v) => !v)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
            showUserMenu ? 'bg-neutral-100' : 'hover:bg-neutral-50'
          }`}
        >
          {/* Avatar initial */}
          <div className="flex-shrink-0 w-6 h-6 bg-indigo-100 flex items-center justify-center text-[11px] font-semibold text-indigo-700 select-none">
            {userInitial}
          </div>
          <span className="flex-1 min-w-0 text-[12px] text-neutral-500 truncate">
            {userEmail ?? 'Account'}
          </span>
          <ChevronUpIcon
            className={`flex-shrink-0 w-3 h-3 text-neutral-400 transition-transform duration-150 ${
              showUserMenu ? '' : 'rotate-180'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
