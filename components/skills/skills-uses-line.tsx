'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE "USES" LINE (W21) — the addressed actor's always-on skills, stated quietly: "uses: A, B +N".
// Hover lists them all; a name opens the composer's Skills list AT that skill (the one door). Nothing
// assigned → nothing rendered (no empty chrome). The data is the SAME read the composer's menu uses.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { usesLine, type ChatMenuSkill } from './skill-menu-model';
import { useSkillMenu, openSkillsMenuAt } from './use-skill-menu';

/** Pure render — the header line from a list (catalogue + tests mount this directly). */
export function SkillsUsesView({ skills, onOpen, className }: { skills: ChatMenuSkill[] | null | undefined; onOpen?: (skillId: string) => void; className?: string }) {
  const line = usesLine(skills);
  if (!line) return null;
  return (
    <span title={`Always on: ${line.all}`} data-skills-uses
      className={`inline-flex min-w-0 items-center gap-1 truncate text-[11px] text-neutral-400 ${className ?? ''}`}>
      <span>uses:</span>
      {line.shown.map((s, i) => (
        <span key={s.id} className="inline-flex min-w-0 items-center">
          <button type="button" onClick={() => onOpen?.(s.id)}
            className="truncate max-w-[140px] text-neutral-500 hover:text-neutral-800 hover:underline underline-offset-2 transition-colors">
            {s.name}
          </button>
          {i < line.shown.length - 1 && <span>,</span>}
        </span>
      ))}
      {line.more > 0 && (
        <button type="button" onClick={() => onOpen?.(line.shown[0].id)} className="text-neutral-400 hover:text-neutral-700">+{line.more}</button>
      )}
    </span>
  );
}

/** Live — reads the actor's menu and opens the composer's Skills list on a click. */
export function SkillsUsesLine({ actor, className }: { actor: string | null | undefined; className?: string }) {
  const menu = useSkillMenu(actor);
  return <SkillsUsesView skills={menu?.skills} onOpen={(id) => openSkillsMenuAt(id)} className={className} />;
}
