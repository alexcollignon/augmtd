'use client';

import type { WorkItem } from '@/lib/work-items/model';
import { ganttMarkerOf } from '@/lib/work-items/gantt-date';
import GanttChart, { type GanttItem } from '@/components/projects/gantt-chart';

// ── Project Gantt — one project's work on the shared event timeline. A thin map of the project's WorkItems
// into GanttChart's shape: each task is a dated event (done → its completion date, due → its deadline, else
// → when it arrived). Same visual language as the portfolio timeline.

export default function ProjectGantt({ items, todayStr, name = 'Timeline' }: { items: WorkItem[]; todayStr: string; name?: string }) {
  const ganttItems: GanttItem[] = items
    .filter((w) => w.state !== 'dismissed')
    .map((w) => {
      const m = ganttMarkerOf(w, todayStr);
      return { title: w.title, who: w.who, state: w.state, marker: m.marker, date: m.date, arrival: m.arrival, overdue: m.overdue, href: w.href && w.href !== '/' ? w.href : null };
    });
  const groups = [{ id: 'project', name, items: ganttItems }];
  return <GanttChart groups={groups} today={todayStr} emptyLine="This project's work will appear on the timeline as items are captured." />;
}
