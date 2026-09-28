'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SKILLS LIST (W21) — the "Skills" page of the composer's ONE @ menu (and what "/" opens directly).
// Presentational: every decision comes from components/skills/skill-menu-model.ts, so the Home chat,
// a coworker DM and an item/project room render the SAME rows with the SAME meaning.
//   · the addressed actor's assigned skills first, CHECKED — "always on for <Name>"
//   · unchecking one = skip it for this message; the rest of the library below, unchecked
//   · checking one = this message only
//   · each row's quiet secondary action — Always use for <Name> / Remove from <Name> — is the only
//     in-chat assignment change
//   · footer: Save this chat as a skill (when the chat has an address) · Manage skills
// ════════════════════════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { AcademicCapIcon, CheckIcon, ChevronLeftIcon } from '@heroicons/react/24/outline';
import {
  assignLabel, isChecked, rowHint, MANAGE_SKILLS_HREF,
  type ChatMenuSkill, type SkillChip, type SkillPick,
} from './skill-menu-model';

export const skillRowDomId = (id: string) => `aug-skill-row-${id}`;

export function SkillMenu({
  actorName, skills, pick, activeIdx, loading, onToggle, onAssign, onBack, onSaveAsSkill,
}: {
  actorName: string;
  /** Already ordered + filtered (filterMenu). */
  skills: ChatMenuSkill[];
  pick: SkillPick;
  activeIdx: number;
  loading?: boolean;
  onToggle: (s: ChatMenuSkill) => void;
  onAssign: (s: ChatMenuSkill) => void;
  /** Present when the list was reached through the @ categories (a way back to them). */
  onBack?: () => void;
  /** Present when the conversation has an address a draft can be made from. */
  onSaveAsSkill?: () => void;
}) {
  const firstAssignedless = skills.findIndex((s) => !s.assigned);
  return (
    <div data-skill-menu>
      {onBack ? (
        <button onMouseDown={(e) => { e.preventDefault(); onBack(); }}
          className="w-full flex items-center gap-2 px-3 py-2 border-b border-neutral-100 hover:bg-neutral-50 text-left">
          <ChevronLeftIcon className="w-3.5 h-3.5 text-neutral-400" />
          <span className="text-[12px] font-medium text-neutral-500">Skills</span>
        </button>
      ) : (
        <div className="px-3 py-2 border-b border-neutral-100"><p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Skills</p></div>
      )}
      <div className="max-h-[260px] overflow-y-auto" role="listbox" aria-multiselectable="true">
        {loading && skills.length === 0 && <div className="px-3 py-3 text-[12px] text-neutral-400">Loading…</div>}
        {!loading && skills.length === 0 && <div className="px-3 py-3 text-[12px] text-neutral-400">No skills yet</div>}
        {skills.map((s, i) => {
          const on = isChecked(s, pick);
          const hint = rowHint(s, pick, actorName);
          return (
            <div key={s.id}>
              {i === firstAssignedless && i > 0 && <div className="mx-3 border-t border-neutral-100" aria-hidden />}
              <div id={skillRowDomId(s.id)} role="option" aria-selected={on} data-checked={on ? 'true' : 'false'} data-assigned={s.assigned ? 'true' : 'false'}
                className={`group flex items-center gap-2.5 px-3 py-2 ${i === activeIdx ? 'bg-indigo-50' : 'hover:bg-neutral-50'}`}>
                <button onMouseDown={(e) => { e.preventDefault(); onToggle(s); }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors motion-reduce:transition-none ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-neutral-300 bg-white'}`}>
                    {on && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-neutral-800">{s.name}</span>
                    {(hint || s.whenToUse) && (
                      <span className="block truncate text-[11px] text-neutral-400">{hint || s.whenToUse}</span>
                    )}
                  </span>
                </button>
                <button onMouseDown={(e) => { e.preventDefault(); onAssign(s); }}
                  className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] text-neutral-400 transition-opacity motion-reduce:transition-none hover:bg-white hover:text-neutral-700 focus:opacity-100 ${i === activeIdx ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  {assignLabel(s, actorName)}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-t border-neutral-100 px-3 py-2">
        {onSaveAsSkill && (
          <button onMouseDown={(e) => { e.preventDefault(); onSaveAsSkill(); }}
            className="text-[11.5px] text-neutral-500 hover:text-neutral-800 transition-colors">Save this chat as a skill</button>
        )}
        <Link href={MANAGE_SKILLS_HREF} onMouseDown={(e) => e.stopPropagation()}
          className="ml-auto text-[11.5px] text-neutral-400 hover:text-neutral-700 transition-colors">Manage skills</Link>
      </div>
    </div>
  );
}

/** THE CHIPS — what rides with the next message (an addition, or "skip <skill>"), each removable. */
export function SkillChips({ chips, onRemove }: { chips: SkillChip[]; onRemove: (c: SkillChip) => void }) {
  return (
    <>
      {chips.map((c) => (
        <div key={`${c.kind}:${c.id}`} data-skill-chip={c.kind}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[12px] ${c.kind === 'add' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-neutral-50 text-neutral-500 border-neutral-200'}`}>
          <AcademicCapIcon className="w-3 h-3" />
          <span className="max-w-[160px] truncate">{c.label}</span>
          <button onClick={() => onRemove(c)} aria-label={`Remove ${c.label}`} className="opacity-60 hover:opacity-100 ml-0.5">×</button>
        </div>
      ))}
    </>
  );
}
