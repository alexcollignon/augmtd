'use client';

import Link from 'next/link';
import { UserIcon, BuildingOffice2Icon, SparklesIcon } from '@heroicons/react/24/outline';

const NAV_ITEMS = [
  { id: 'account', label: 'Account', icon: UserIcon },
  { id: 'company', label: 'Company', icon: BuildingOffice2Icon },
  { id: 'memory', label: 'Memory', icon: SparklesIcon },
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
                <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-indigo-500' : 'text-neutral-400'}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
