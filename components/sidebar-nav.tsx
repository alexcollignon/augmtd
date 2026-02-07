'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  InboxIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';

interface SidebarNavProps {
  userEmail?: string;
}

export default function SidebarNav({ userEmail }: SidebarNavProps) {
  const pathname = usePathname();

  const navigation = [
    { name: 'Prepared Work', href: '/inbox', icon: InboxIcon },
    { name: 'Settings', href: '/settings', icon: Cog6ToothIcon },
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

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
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

      {/* User Section */}
      <div className="border-t border-gray-200 p-4 space-y-2">
        {userEmail && (
          <div className="flex items-center space-x-2 px-2 py-1.5 text-sm text-gray-600">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
              <SparklesIcon className="w-4 h-4 text-white" />
            </div>
            <span className="truncate text-xs">{userEmail}</span>
          </div>
        )}
        <form action="/auth/signout" method="post" className="w-full">
          <button
            type="submit"
            className="flex items-center space-x-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-all"
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5 text-gray-500" />
            <span>Sign Out</span>
          </button>
        </form>
      </div>
    </div>
  );
}
