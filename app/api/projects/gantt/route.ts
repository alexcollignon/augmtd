import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkItems } from '@/lib/work-items/model';
import { computeProjectHealth, type ProjectHealthStatus } from '@/lib/projects/health';

export const maxDuration = 20;

// GET /api/projects/gantt — the PORTFOLIO timeline: one swimlane per project with its active span
// (first activity → furthest due/today) + dated milestones. This is the Gantt-style visual — meaningful
// at the PROJECT level (projects have spans; individual point-tasks don't). Read-only over the spine.

type Milestone = { date: string; title: string; kind: string; done: boolean };
type GanttProject = { id: string; name: string; status: ProjectHealthStatus; start: string; end: string; milestones: Milestone[] };

const dstr = (s: string) => s.slice(0, 10);

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const todayStr = new Date().toISOString().slice(0, 10);
    const [{ data: projects }, spine] = await Promise.all([
      supabase.from('projects').select('id, name, created_at').eq('user_id', user.id).eq('status', 'active').order('created_at', { ascending: true }),
      buildWorkItems(supabase, user.id, { todayStr, includeDoneWithinDays: 60 }),
    ]);

    const byProject = new Map<string, typeof spine>();
    for (const w of spine) if (w.projectId) (byProject.get(w.projectId) ?? byProject.set(w.projectId, []).get(w.projectId)!).push(w);

    const out: GanttProject[] = (projects ?? []).map((p) => {
      const items = byProject.get(p.id as string) ?? [];
      const health = computeProjectHealth(items, todayStr);
      let start: string, end: string;
      const milestones: Milestone[] = [];
      if (items.length) {
        const ats = items.map((w) => dstr(w.at)).filter(Boolean);
        const dues = items.map((w) => w.when.explicit).filter(Boolean) as string[];
        start = ats.reduce((m, d) => (d < m ? d : m), ats[0]);
        end = [...ats, ...dues, todayStr].reduce((m, d) => (d > m ? d : m), todayStr);
        for (const w of items) if (w.when.explicit) milestones.push({ date: w.when.explicit, title: w.title, kind: w.kind, done: w.state === 'done' });
      } else {
        start = end = dstr(p.created_at as string) || todayStr; // a just-created empty project = a point
      }
      return { id: p.id as string, name: p.name as string, status: health.status, start, end, milestones };
    });

    return NextResponse.json({ today: todayStr, projects: out });
  } catch (e) {
    console.error('[projects/gantt] error:', e);
    return NextResponse.json({ today: new Date().toISOString().slice(0, 10), projects: [] });
  }
}
