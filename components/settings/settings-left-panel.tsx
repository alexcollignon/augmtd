'use client';

import Link from 'next/link';
import { UserIcon, BuildingOffice2Icon, Squares2X2Icon } from '@heroicons/react/24/outline';

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5c0-1.1-.9-2-2-2a2 2 0 0 0-2 2c-.6 0-2 .4-2 2.5C4.5 8 3 9.2 3 11c0 1.4.8 2.6 2 3.2V15a3 3 0 0 0 3 3h4" />
      <path d="M12 5c0-1.1.9-2 2-2a2 2 0 0 1 2 2c.6 0 2 .4 2 2.5 1.5.5 3 1.7 3 3.5 0 1.4-.8 2.6-2 3.2V15a3 3 0 0 1-3 3h-4" />
      <path d="M12 5v13" />
      <path d="M7 10c0 1 .5 2 1.5 2.5" />
      <path d="M17 10c0 1-.5 2-1.5 2.5" />
      <path d="M9 18a3 3 0 0 0 6 0" />
    </svg>
  );
}

const NAV_ITEMS = [
  { id: 'account', label: 'Account', Icon: UserIcon },
  { id: 'company', label: 'Company', Icon: BuildingOffice2Icon },
  { id: 'connections', label: 'Connections', Icon: Squares2X2Icon },
  { id: 'memory', label: 'Memory', Icon: BrainIcon },
];

export default function SettingsLeftPanel({ activeTab }: { activeTab: string }) {
  return (
    <div className="w-[200px] flex-shrink-0 flex flex-col bg-neutral-50 p-2 pl-0">
      <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
        <div className="flex-shrink-0 px-4 py-4 border-b border-neutral-100">
          <h2 className="text-[13px] font-semibold text-neutral-700">Settings</h2>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map(item => {
            const isActive = activeTab === item.id;
            return (
              <Link
                key={item.id}
                href={`/settings?tab=${item.id}`}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900'
                }`}
              >
                <item.Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-indigo-500' : 'text-neutral-400'}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
