'use client';

import { useWorkflowNotifCount } from '@/hooks/use-workflow-notif-count';

interface WorkTabBarProps {
  activeSection: 'chat' | 'studio';
  onSwitch: (section: 'chat' | 'studio') => void;
}

export function WorkTabBar({ activeSection, onSwitch }: WorkTabBarProps) {
  const notifCount = useWorkflowNotifCount();
  const isStudio = activeSection === 'studio';

  return (
    <div className="flex items-center px-3 h-11 border-b border-neutral-100 flex-shrink-0">
      <div className="relative grid grid-cols-2 bg-neutral-100 rounded-full p-0.5 w-full">
        {/* Sliding pill */}
        <div
          className="absolute inset-y-0.5 w-[calc(50%-2px)] rounded-full bg-white shadow-sm pointer-events-none"
          style={{
            left: isStudio ? '50%' : '2px',
            transition: 'left 180ms ease-in-out',
          }}
        />
        <button
          onClick={() => onSwitch('chat')}
          className={`relative z-10 px-2.5 py-0.5 text-[11px] font-medium rounded-full text-center transition-colors duration-150 ${
            !isStudio ? 'text-neutral-800' : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => onSwitch('studio')}
          className={`relative z-10 flex items-center justify-center gap-1 px-2.5 py-0.5 text-[11px] font-medium rounded-full text-center transition-colors duration-150 ${
            isStudio ? 'text-neutral-800' : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          Studio
          {notifCount > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
          )}
        </button>
      </div>
    </div>
  );
}
