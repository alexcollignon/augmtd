'use client';

import Link from 'next/link';
import { UserIcon, BuildingOfficeIcon } from '@heroicons/react/24/outline';

interface Props {
  activeTab: string;
}

const tabs = [
  { id: 'account', label: 'Account', icon: UserIcon },
  { id: 'company', label: 'Company', icon: BuildingOfficeIcon },
];

export default function SettingsTabsClient({ activeTab }: Props) {
  return (
    <div className="flex gap-1 border-b border-neutral-200 mb-8">
      {tabs.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <Link
            key={tab.id}
            href={`/settings?tab=${tab.id}`}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors -mb-px ${
              isActive
                ? 'border-indigo-500 text-indigo-700'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 hover:border-neutral-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
