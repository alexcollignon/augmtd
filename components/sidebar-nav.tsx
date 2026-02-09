'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  InboxIcon,
  ClockIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon
} from '@heroicons/react/24/outline';

interface SidebarNavProps {
  userEmail?: string;
}

export default function SidebarNav({ userEmail }: SidebarNavProps) {
  const pathname = usePathname();

  const mainNavigation = [
    { name: 'Prepared Work', href: '/inbox', icon: InboxIcon },
    { name: 'Activity Log', href: '/activity', icon: ClockIcon },
  ];

  return (
    <div className="flex h-screen w-64 flex-col bg-white border-r border-gray-200">
      {/* Logo */}
      <div className="flex h-16 items-center px-6 border-b border-gray-200">
        <Link href="/" className="flex items-center space-x-2.5 group">
          <Image
            src="/augmtd-logo.png"
            alt="AUGMTD"
            width={28}
            height={28}
            className="w-7 h-7 group-hover:scale-105 transition-transform duration-200"
          />
          <span className="text-lg font-bold text-gray-900">AUGMTD</span>
        </Link>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {mainNavigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`
                flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                ${isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                }
              `}
            >
              <item.icon className={`w-5 h-5 ${isActive ? 'text-primary-600' : 'text-gray-500'}`} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom Section - User + Settings + Sign Out */}
      <div className="border-t border-gray-200 p-3 space-y-1">
        {/* User Info */}
        {userEmail && (
          <div className="flex items-center space-x-2.5 px-3 py-2 text-xs text-gray-600">
            <UserCircleIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <span className="truncate">{userEmail}</span>
          </div>
        )}

        {/* Settings */}
        <Link
          href="/settings"
          className={`
            flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
            ${pathname === '/settings'
              ? 'bg-primary-50 text-primary-700'
              : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
            }
          `}
        >
          <Cog6ToothIcon className={`w-5 h-5 ${pathname === '/settings' ? 'text-primary-600' : 'text-gray-500'}`} />
          <span>Settings</span>
        </Link>

        {/* Sign Out */}
        <form action="/auth/signout" method="post" className="w-full">
          <button
            type="submit"
            className="flex items-center space-x-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-all"
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5 text-gray-500" />
            <span>Sign Out</span>
          </button>
        </form>
      </div>
    </div>
  );
}
