import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkItems } from '@/lib/work-items/model';
import { ganttMarkerOf, type GanttMarker } from '@/lib/work-items/gantt-date';
import { computeProjectHealth, type ProjectHealthStatus } from '@/lib/projects/health';

export const maxDuration = 20;

// GET /api/projects/gantt — the PORTFOLIO timeline: one swimlane per project with its active span
// (first activity → furthest due/today) + item MARKERS. Each marker carries the item's STATE (done /
// needs-you / waiting) + WHO + WHEN, so the portfolio reads "what happened, what's outstanding, and
// what's coming, by whom" — the same story as the per-project Gantt, one level up. Read-only over the
// spine; item placement uses the SHARED `ganttDateOf` so the two Gantts never disagree.

type GItem = { title: string; who: string | null; state: string; marker: GanttMarker; date: string; arrival: string; overdue: boolean; href: string | null };
type GanttProject = { id: string; name: string; status: ProjectHealthStatus; start: string; end: string; items: GItem[] };

const dstr = (s: string) => s.slice(0, 10);

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const todayStr = new Date().toISOString().slice(0, 10);
    const [{ data: projects }, spine] = await Promise.all([
      supabase.from('projects').select('id, name, created_at').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: true }),
      // includeOutbound so the portfolio shows the SAME items as each project's detail Gantt (cold outreach
      // you're awaiting a reply to attaches to its project by initiative) — the two must not disagree.
      // skipReconcile: this is a read-only visual; the Home/board already self-heal replies (keeps it fast).
      buildWorkItems(supabase, user.id, { todayStr, includeDoneWithinDays: 60, includeOutbound: true, skipReconcile: true }),
    ]);

    const byProject = new Map<string, typeof spine>();
    for (const w of spine) if (w.projectId) (byProject.get(w.projectId) ?? byProject.set(w.projectId, []).get(w.projectId)!).push(w);

    const out: GanttProject[] = (projects ?? []).map((p) => {
      const items = byProject.get(p.id as string) ?? [];
      const health = computeProjectHealth(items, todayStr);
      let start: string, end: string;
      const gitems: GItem[] = [];
      if (items.length) {
        // Every non-dismissed item becomes a timeline EVENT: done → its completion date, due → its real
        // deadline, else → when it arrived. The user reads "what was done + when" and "what's due + when".
        for (const w of items) {
          if (w.state === 'dismissed') continue;
          const m = ganttMarkerOf(w, todayStr);
          gitems.push({ title: w.title, who: w.who, state: w.state, marker: m.marker, date: m.date, arrival: m.arrival, overdue: m.overdue, href: w.href && w.href !== '/' ? w.href : null });
        }
        gitems.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
        start = gitems.reduce((m, g) => (g.arrival < m ? g.arrival : (g.date < m ? g.date : m)), todayStr);
        end = gitems.reduce((m, g) => (g.date > m ? g.date : m), todayStr);
      } else {
        start = end = dstr(p.created_at as string) || todayStr; // a just-created empty project = a point
      }
      return { id: p.id as string, name: p.name as string, status: health.status, start, end, items: gitems };
    });

    return NextResponse.json({ today: todayStr, projects: out });
  } catch (e) {
    console.error('[projects/gantt] error:', e);
    return NextResponse.json({ today: new Date().toISOString().slice(0, 10), projects: [] });
  }
}
