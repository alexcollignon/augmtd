'use client';

import { useState, useRef, useEffect } from 'react';
import { CpuChipIcon, UserCircleIcon, ChevronDownIcon, StarIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarSolid } from '@heroicons/react/24/solid';
import type { ProcessPlanStep } from '@/lib/types/process';

// ── Shared types ──────────────────────────────────────────────────────────────
export interface TeamMember {
  id: string;
  full_name: string;
  role: string;
  department?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── Plan parsing helpers ──────────────────────────────────────────────────────
export const PLAN_SEPARATOR = '---PLAN_UPDATE---';
const THINKING_OPEN = '<THINKING>';

export function getDisplayText(full: string): string {
  let text = full.replace(/<THINKING>[\s\S]*?<\/THINKING>\n?/g, '');
  const openIdx = text.indexOf(THINKING_OPEN);
  if (openIdx !== -1) text = text.slice(0, openIdx);
  const sepIdx = text.indexOf(PLAN_SEPARATOR);
  if (sepIdx !== -1) return text.slice(0, sepIdx).trim();
  const jsonMatch = text.match(/(\n|^)\{/);
  if (jsonMatch && jsonMatch.index !== undefined) {
    const fromIdx = jsonMatch.index + (text[jsonMatch.index] === '\n' ? 1 : 0);
    const tail = text.slice(fromIdx);
    if (tail.includes('"steps"') && tail.includes('"description"')) {
      return text.slice(0, fromIdx).trim();
    }
  }
  return text.trim();
}

export function hasReachedJson(full: string): boolean {
  if (full.includes(PLAN_SEPARATOR)) return true;
  const jsonMatch = full.match(/(\n|^)\{/);
  if (jsonMatch && jsonMatch.index !== undefined) {
    const tail = full.slice(jsonMatch.index);
    if (tail.includes('"steps"') && tail.includes('"description"')) return true;
  }
  return false;
}

export function extractPlanJson(full: string): string | null {
  const sepIdx = full.indexOf(PLAN_SEPARATOR);
  if (sepIdx !== -1) {
    const raw = full.slice(sepIdx + PLAN_SEPARATOR.length).trim();
    return raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim() || null;
  }
  const jsonMatch = full.match(/(\{[\s\S]*"steps"[\s\S]*\})\s*$/);
  return jsonMatch ? jsonMatch[1].trim() : null;
}

// ── Step type icon ────────────────────────────────────────────────────────────
export function StepTypeIcon({ type }: { type: 'human' | 'generator' }) {
  if (type === 'generator') return <CpuChipIcon className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />;
  return <UserCircleIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />;
}

// ── Assignee picker ───────────────────────────────────────────────────────────
export function AssigneePicker({
  step,
  teamMembers,
  originalSuggestion,
  onAssign,
}: {
  step: ProcessPlanStep;
  teamMembers: TeamMember[];
  originalSuggestion: string | null;
  onAssign: (memberId: string | null, department?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentName = step.assignee_id
    ? (teamMembers.find(m => m.id === step.assignee_id)?.full_name ?? 'Unknown')
    : step.department
    ? `${step.department} (dept)`
    : null;

  const suggestedMember = originalSuggestion
    ? teamMembers.find(m => m.id === originalSuggestion)
    : null;

  const isUnassigned = !step.assignee_id && !step.department;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 text-[11px] border rounded px-2 py-0.5 bg-white hover:bg-neutral-50 focus:outline-none ${
          isUnassigned ? 'border-amber-300 text-amber-700' : 'border-neutral-200 text-neutral-700'
        }`}
      >
        {currentName ?? 'Unassigned'}
        <ChevronDownIcon className="w-3 h-3 opacity-60" />
      </button>

      {open && (
        <div className="absolute z-20 top-full mt-1 left-0 min-w-[200px] bg-white border border-neutral-200 rounded shadow-lg py-1 text-[12px]">
          {suggestedMember && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Suggested</div>
              <button
                onClick={() => { onAssign(suggestedMember.id); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 hover:bg-indigo-50 flex items-center gap-2 ${
                  step.assignee_id === suggestedMember.id ? 'text-indigo-700 font-medium' : 'text-neutral-700'
                }`}
              >
                <StarSolid className="w-3 h-3 text-amber-400 flex-shrink-0" />
                {suggestedMember.full_name}
                {suggestedMember.department && <span className="text-neutral-400 text-[10px]">{suggestedMember.department}</span>}
              </button>
              {teamMembers.length > 1 && <div className="border-t border-neutral-100 my-1" />}
            </>
          )}
          {teamMembers.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Team</div>
              {teamMembers.filter(m => m.id !== originalSuggestion).map(m => (
                <button
                  key={m.id}
                  onClick={() => { onAssign(m.id); setOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-indigo-50 flex items-center gap-2 ${
                    step.assignee_id === m.id ? 'text-indigo-700 font-medium' : 'text-neutral-700'
                  }`}
                >
                  <StarIcon className="w-3 h-3 text-transparent flex-shrink-0" />
                  {m.full_name}
                  {m.department && <span className="text-neutral-400 text-[10px]">{m.department}</span>}
                </button>
              ))}
            </>
          )}
          {(step.assignee_id || step.department) && (
            <>
              <div className="border-t border-neutral-100 my-1" />
              <button
                onClick={() => { onAssign(null); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-neutral-400 hover:text-red-600"
              >
                Unassign
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
