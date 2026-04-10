'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChatBubbleLeftIcon, RectangleStackIcon } from '@heroicons/react/24/outline';

export function WorkspaceTabBar() {
  const pathname = usePathname();
  const isStudio = pathname.startsWith('/work');
  const isProcesses = pathname.startsWith('/processes');

  return (
    <div className="flex items-center gap-0.5 px-3 py-2 border-b border-neutral-100 bg-white flex-shrink-0">
      <Link
        href="/work"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-colors ${
          isStudio
            ? 'bg-indigo-50 text-indigo-700'
            : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50'
        }`}
      >
        <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
        Chat
      </Link>
      <Link
        href="/processes"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-colors ${
          isProcesses
            ? 'bg-indigo-50 text-indigo-700'
            : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50'
        }`}
      >
        <RectangleStackIcon className="w-3.5 h-3.5" />
        Processes
      </Link>
    </div>
  );
}
