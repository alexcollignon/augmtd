'use client';

import { useState, useRef, useEffect } from 'react';
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
} from '@heroicons/react/24/outline';

interface SidebarNavProps {
  userEmail?: string;
}

export default function SidebarNav({ userEmail }: SidebarNavProps) {
  const pathname = usePathname();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const navigation = [
    { name: 'Work Inbox', href: '/inbox', icon: InboxIcon },
    { name: 'Workflows', href: '/work', icon: QueueListIcon },
    { name: 'Knowledge', href: '/knowledge', icon: BookOpenIcon },
  ];

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

      {/* Navigation */}
      <nav className="flex-1 py-2 px-2">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
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
              {item.name}
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
