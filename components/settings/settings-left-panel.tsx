'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { UserIcon, BuildingOffice2Icon, Squares2X2Icon, EnvelopeIcon, FolderIcon, UserGroupIcon } from '@heroicons/react/24/outline';

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
  { id: 'email', label: 'Email', Icon: EnvelopeIcon },
  { id: 'company', label: 'Company', Icon: BuildingOffice2Icon },
  { id: 'connections', label: 'Connections', Icon: Squares2X2Icon },
  // THE DRIVE DEMOTION (Arc 3): Knowledge is a real SETTINGS SECTION (owner correction, Aug 6 —
  // the door must stay GROUNDED in the Settings nav, never eject to a standalone page). The slim
  // panel renders inside this shell; /drive survives only as a redirect here.
  { id: 'knowledge', label: 'Knowledge', Icon: FolderIcon },
  // THE FOLD's config door (Arc 3, grounded Aug 6): team CONFIG (roster · per-worker tools ·
  // skills) is a real Settings section — coworkers themselves are executors IN the work, talked
  // to from any conversation, never a destination.
  { id: 'team', label: 'Team', Icon: UserGroupIcon },
  { id: 'memory', label: 'Memory', Icon: BrainIcon },
];

const EMAIL_SECTIONS = [
  { id: 'connections', label: 'Connections' },
  { id: 'rules', label: 'Rules' },
  { id: 'drafting', label: 'Drafting & labels' },
  { id: 'todo', label: 'To-do capture' },
];

export default function SettingsLeftPanel({ activeTab, companyRole }: { activeTab: string; companyRole?: string | null }) {
  const searchParams = useSearchParams();
  const section = searchParams.get('section') || 'connections';
  const companySection = searchParams.get('section') || 'members';
  const [emailHover, setEmailHover] = useState(false);
  const [companyHover, setCompanyHover] = useState(false);

  const isCompanyAdmin = companyRole === 'owner' || companyRole === 'admin';
  const companySections = [
    { id: 'members', label: 'Members' },
    ...(isCompanyAdmin ? [{ id: 'ai-operations', label: 'AI Operations' }, { id: 'strategy', label: 'Strategy' }] : []),
  ];

  const itemClass = (isActive: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
      isActive ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900'
    }`;

  return (
    <div className="w-[200px] flex-shrink-0 flex flex-col bg-neutral-50 p-2 pl-0">
      <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
        <div className="flex-shrink-0 px-4 py-4 border-b border-neutral-100">
          <h2 className="text-[13px] font-semibold text-neutral-700">Settings</h2>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map(item => {
            const isActive = activeTab === item.id;

            // Email: clicking defaults to Connections; hovering (or being active) reveals sub-items.
            if (item.id === 'email') {
              const showSub = emailHover || isActive;
              return (
                <div key="email" onMouseEnter={() => setEmailHover(true)} onMouseLeave={() => setEmailHover(false)}>
                  <Link href="/settings?tab=email&section=connections" className={itemClass(isActive)}>
                    <item.Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-indigo-500' : 'text-neutral-400'}`} />
                    {item.label}
                  </Link>
                  {/* Smooth open/close: grid-rows 0fr→1fr animates to natural height. */}
                  <div className={`grid transition-all duration-200 ease-out ${showSub ? 'grid-rows-[1fr] opacity-100 mt-0.5' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden">
                      <div className="ml-[26px] space-y-0.5 border-l border-neutral-100 pl-2">
                        {EMAIL_SECTIONS.map(s => {
                          const subActive = isActive && section === s.id;
                          return (
                            <Link
                              key={s.id}
                              href={`/settings?tab=email&section=${s.id}`}
                              className={`block px-2.5 py-1.5 rounded-md text-[12.5px] transition-colors ${
                                subActive ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800'
                              }`}
                            >
                              {s.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            // Company: clicking defaults to Members; hovering (or being active) reveals sub-items.
            // AI Operations only appears for owner/admin roles (isCompanyAdmin above).
            if (item.id === 'company') {
              const showSub = companyHover || isActive;
              return (
                <div key="company" onMouseEnter={() => setCompanyHover(true)} onMouseLeave={() => setCompanyHover(false)}>
                  <Link href="/settings?tab=company&section=members" className={itemClass(isActive)}>
                    <item.Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-indigo-500' : 'text-neutral-400'}`} />
                    {item.label}
                  </Link>
                  <div className={`grid transition-all duration-200 ease-out ${showSub ? 'grid-rows-[1fr] opacity-100 mt-0.5' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden">
                      <div className="ml-[26px] space-y-0.5 border-l border-neutral-100 pl-2">
                        {companySections.map(s => {
                          const subActive = isActive && companySection === s.id;
                          return (
                            <Link
                              key={s.id}
                              href={`/settings?tab=company&section=${s.id}`}
                              className={`block px-2.5 py-1.5 rounded-md text-[12.5px] transition-colors ${
                                subActive ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800'
                              }`}
                            >
                              {s.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <Link key={item.id} href={'href' in item && item.href ? item.href : `/settings?tab=${item.id}`} className={itemClass(isActive)}>
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
