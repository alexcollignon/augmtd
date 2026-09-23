// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE READ BUDGET (W2.7 — THE CONTEXT BUDGET, invariant 13). The chat loop's four data reads used
// to hand the model `text.slice(0, 3000)` — a raw cut with no mark, so the loop's own later
// clipForPrompt had nothing to declare. Two of them lied STRUCTURALLY:
//   · check_calendar appends its FREE SLOTS last, so on a busy window the verified slots — the
//     whole point of the call — were the first thing the budget ate;
//   · search_knowledge_base / get_meeting_context render a CARD from the full read, so the card
//     could list files/meetings the model never saw ("the card and the prompt disagree").
// Each read now packs by ITS OWN structure through packContext: the load-bearing block survives
// longest, every cut declares itself, and the rows a card may show are the rows the model saw.
// Pure — unit-tested in tests/unit/pack-context.test.ts.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { packContext, type ContextSection } from '@/lib/utils/pack-context';
import type { CalendarRead } from '@/lib/tools/check-calendar';
import type { MeetingReadBlock } from '@/lib/tools/get-meeting-context';

/** Every data read's model-text budget (the loop's tool-message ceiling is 4000 — headroom for
 *  the registry pointer a KB hit may append). */
export const READ_BUDGET = 3000;

/** get_emails: a header then one block per email, newest/most relevant first → earlier survive. */
export function packEmailsRead(text: string, budget = READ_BUDGET): string {
  const blocks = String(text ?? '').split(/\n\n(?=• )/);
  const [head, ...emails] = blocks;
  return packContext([
    { id: 'header', text: head, priority: 1000 },
    ...emails.map((e, i) => ({ id: `email:${i}`, label: `email ${i + 1}`, text: e, priority: emails.length - i, minChars: 160 })),
  ], budget).text;
}

/** get_meeting_context: packed BY MEETING. Returns the ids the model saw, so the card shows them. */
export function packMeetingRead(blocks: MeetingReadBlock[], budget = READ_BUDGET): { text: string; seen: Set<string> } {
  const n = blocks.length;
  const sections: ContextSection[] = blocks.map((b, i) => ({
    id: `${b.kind}:${b.id ?? i}`,
    label: b.kind === 'header' ? 'a section header' : b.kind === 'meeting' ? 'a recorded meeting' : 'an upcoming meeting',
    text: b.text,
    // Headers stand; upcoming lines are one short line each (and the future is what's asked most);
    // recorded meetings yield oldest-first (the read lists them newest-first).
    priority: b.kind === 'header' ? 1000 : b.kind === 'upcoming' ? 500 + (n - i) : n - i,
    minChars: b.kind === 'meeting' ? 200 : undefined,
  }));
  const packed = packContext(sections, budget);
  const seen = new Set<string>();
  blocks.forEach((b, i) => {
    if (b.id && packed.report[sections[i].id]?.status !== 'dropped') seen.add(b.id);
  });
  return { text: packed.text, seen };
}

/** check_calendar: THE FREE SLOTS SURVIVE FIRST (they are the verified answer), then the reach
 *  statements (freshness, the clamp line, the window header that states the exact reach), then the
 *  day lines — earliest days last to go. Returns the days the model saw, so the card shows them. */
export function packCalendarRead(read: Pick<CalendarRead, 'blocks' | 'win'>, budget = READ_BUDGET): { text: string; seenDays: Set<string> } {
  const { window, freshness, clamp, slots } = read.blocks;
  const lines = window.split('\n');
  // With no calendar the window is ONE honest paragraph (availability UNKNOWN) — it never splits.
  const perDay = read.win.hasCalendar && lines.length === read.win.days.length + 1;
  const dayLines = perDay ? lines.slice(1) : [];
  const sections: ContextSection[] = [
    { id: 'window-head', text: perDay ? lines[0] : window, priority: 900 },
    ...dayLines.map((l, i) => ({
      id: `day:${read.win.days[i].dayStr}`, label: `${read.win.days[i].weekday} ${read.win.days[i].dayStr}`,
      text: l, glue: '\n', priority: 100 + (dayLines.length - i), minChars: 80,
    })),
    { id: 'freshness', text: freshness ?? '', priority: 950 },
    { id: 'clamp', text: clamp ?? '', priority: 950 },
    { id: 'slots', text: slots ?? '', priority: 1000 },
  ];
  const packed = packContext(sections, budget);
  const seenDays = new Set<string>(
    perDay
      ? read.win.days.filter((d) => packed.report[`day:${d.dayStr}`]?.status !== 'dropped').map((d) => d.dayStr)
      : read.win.days.map((d) => d.dayStr),
  );
  return { text: packed.text, seenDays };
}
