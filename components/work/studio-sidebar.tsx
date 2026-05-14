'use client';

import { useState } from 'react';
import {
  PlusIcon, PencilIcon, TrashIcon, CheckIcon, XMarkIcon,
  BoltIcon, ClockIcon, EnvelopeIcon, CalendarDaysIcon, DocumentTextIcon,
  MagnifyingGlassIcon, ChartBarIcon, ArrowPathIcon, NewspaperIcon, GlobeAltIcon,
  TableCellsIcon, InboxIcon, MegaphoneIcon, FunnelIcon, PresentationChartLineIcon,
  BriefcaseIcon, CpuChipIcon, BookOpenIcon, DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import type { Workflow } from '@/lib/workflows/types';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'bolt': BoltIcon, 'clock': ClockIcon, 'envelope': EnvelopeIcon,
  'calendar-days': CalendarDaysIcon, 'document-text': DocumentTextIcon,
  'magnifying-glass': MagnifyingGlassIcon, 'chart-bar': ChartBarIcon,
  'arrow-path': ArrowPathIcon, 'newspaper': NewspaperIcon, 'globe-alt': GlobeAltIcon,
  'table-cells': TableCellsIcon, 'inbox': InboxIcon, 'megaphone': MegaphoneIcon,
  'funnel': FunnelIcon, 'presentation-chart-line': PresentationChartLineIcon,
  'briefcase': BriefcaseIcon, 'cpu-chip': CpuChipIcon, 'book-open': BookOpenIcon,
};

const COLOR_MAP: Record<string, string> = {
  'indigo': 'bg-indigo-500', 'violet': 'bg-violet-500', 'blue': 'bg-blue-500',
  'emerald': 'bg-emerald-500', 'amber': 'bg-amber-500', 'rose': 'bg-rose-500',
  'neutral': 'bg-neutral-500',
};

interface Props {
  workflows: Workflow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClone: (id: string) => void;
}

function WorkflowIcon({ icon, color }: { icon: string; color: string }) {
  const Icon = ICON_MAP[icon] ?? BoltIcon;
  const bg = COLOR_MAP[color] ?? 'bg-indigo-500';
  return (
    <span className={`w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center ${bg}`}>
      <Icon className="w-3 h-3 text-white" />
    </span>
  );
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function StudioSidebar({ workflows, selectedId, onSelect, onCreate, onRename, onDelete, onClone }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startEdit(w: Workflow, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(w.id);
    setEditName(w.name);
    setConfirmDeleteId(null);
  }

  function commitEdit(id: string) {
    if (editName.trim()) onRename(id, editName.trim());
    setEditingId(null);
  }

  const mine = workflows.filter(w => w.is_owned_by_me !== false);
  const team = workflows.filter(w => w.is_owned_by_me === false);

  const sortOwn = (arr: Workflow[]) => {
    const grouped = {
      active: arr.filter(w => w.status === 'active'),
      paused: arr.filter(w => w.status === 'paused'),
      draft:  arr.filter(w => w.status === 'draft'),
    };
    return [...grouped.active, ...grouped.paused, ...grouped.draft];
  };

  function WorkflowRow({ w, isTeam }: { w: Workflow; isTeam?: boolean }) {
    return (
      <div
        className="relative"
        onMouseEnter={() => setHoveredId(w.id)}
        onMouseLeave={() => { setHoveredId(null); setConfirmDeleteId(null); }}
      >
        {!isTeam && editingId === w.id ? (
          <div className="flex items-center gap-1 px-2 py-1.5">
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit(w.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              onBlur={() => commitEdit(w.id)}
              className="flex-1 min-w-0 text-[12px] bg-neutral-50 border border-neutral-200 rounded-md px-2 py-1 outline-none focus:border-indigo-400"
            />
            <button
              onMouseDown={(e) => { e.preventDefault(); commitEdit(w.id); }}
              className="p-1 rounded text-green-600 hover:bg-green-50 flex-shrink-0"
            >
              <CheckIcon className="w-3.5 h-3.5" />
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); setEditingId(null); }}
              className="p-1 rounded text-neutral-400 hover:bg-neutral-100 flex-shrink-0"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect(w.id)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(w.id)}
            className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${
              selectedId === w.id
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            <div className="flex items-center gap-2 pr-10">
              <WorkflowIcon icon={w.icon} color={w.color} />
              <span className="text-[12.5px] font-medium truncate leading-snug">{w.name}</span>
            </div>
            <div className="text-[11px] text-neutral-400 mt-0.5 pl-7">
              {isTeam && w.owner_name
                ? <span className="text-neutral-400">by {w.owner_name}</span>
                : relativeTime(w.updated_at)
              }
            </div>

            {/* Hover actions */}
            {hoveredId === w.id && editingId !== w.id && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {isTeam ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onClone(w.id); }}
                    className="p-1 rounded text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                    title="Clone to my workspace"
                  >
                    <DocumentDuplicateIcon className="w-3 h-3" />
                  </button>
                ) : confirmDeleteId === w.id ? (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(w.id); setConfirmDeleteId(null); }}
                      className="p-1 rounded text-red-500 hover:bg-red-50 transition-colors"
                      title="Confirm delete"
                    >
                      <CheckIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                      className="p-1 rounded text-neutral-400 hover:bg-neutral-100 transition-colors"
                    >
                      <XMarkIcon className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={(e) => startEdit(w, e)}
                      className="p-1 rounded text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
                      title="Rename"
                    >
                      <PencilIcon className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(w.id); }}
                      className="p-1 rounded text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <TrashIcon className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {/* New workflow button */}
      <div className="px-2 flex-shrink-0">
        <button
          onClick={onCreate}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          <PlusIcon className="w-3.5 h-3.5 flex-shrink-0" />
          New workflow
        </button>
      </div>

      {/* Workflow list */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {mine.length === 0 && team.length === 0 && (
          <p className="px-3 py-4 text-[12px] text-neutral-400 text-center">No workflows yet</p>
        )}

        {sortOwn(mine).map((w) => <WorkflowRow key={w.id} w={w} />)}

        {team.length > 0 && (
          <>
            <div className="px-1.5 pt-3 pb-1">
              <span className="text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wider">Team</span>
            </div>
            {team.map((w) => <WorkflowRow key={w.id} w={w} isTeam />)}
          </>
        )}
      </div>
    </>
  );
}
