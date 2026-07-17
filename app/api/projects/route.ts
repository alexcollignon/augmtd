import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkItems } from '@/lib/work-items/model';
import { computeProjectHealth } from '@/lib/projects/health';
import { reconcileProjectMembership } from '@/lib/projects/associate';

// GET  /api/projects        → the user's projects (active first), each with an AUTO-DERIVED HEALTH rollup
//                             (on track / needs attention / stalled / clear) + counts, computed from the
//                             same task spine the timeline uses. One spine build, grouped by project.
// POST /api/projects { name, description?, goals?[], rules?[], color? } → create a manual project.

const cleanList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // ?basic=1 — a FAST list (id/name/status only), skipping the magnet + full spine build + health. Used by
    // pickers/chips (the meetings project control, row menu) that only need names; the enriched path is heavy.
    const basic = new URL(request.url).searchParams.get('basic') === '1';
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, description, status, goals, rules, color, auto, sort_order, created_at, updated_at')
      .eq('user_id', user.id)
      .order('status', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    // basic mode: return the projects straight from the DB (id/name/etc) without the magnet/spine/health.
    if (basic) return NextResponse.json({ projects: (projects ?? []).filter((p) => p.status === 'active') });

    // MAGNET: before computing health, pull any unclustered items whose initiative matches an active
    // project's name (so a new email about "Acme" flows into the Acme project automatically). Idempotent.
    const active = (projects ?? []).filter((p) => p.status === 'active').map((p) => ({ id: p.id as string, name: p.name as string }));
    if (active.length) await reconcileProjectMembership(supabase, user.id, active).catch(() => ({}));

    // Health + counts: one spine build, grouped by project_id (the SAME tasks the timeline shows).
    const todayStr = new Date().toISOString().slice(0, 10);
    const spine = await buildWorkItems(supabase, user.id, { todayStr, includeDoneWithinDays: 30, includeOutbound: true });
    const byProject = new Map<string, typeof spine>();
    for (const w of spine) if (w.projectId) (byProject.get(w.projectId) ?? byProject.set(w.projectId, []).get(w.projectId)!).push(w);

    const enriched = (projects ?? []).map((p) => {
      const items = byProject.get(p.id) ?? [];
      const health = computeProjectHealth(items, todayStr);
      const next = items
        .filter((w) => w.state !== 'done' && w.state !== 'dismissed')
        .sort((a, b) => {
          const rank = (bucket: string) => ({ overdue: 0, today: 1, this_week: 2, soon: 3, later: 4, someday: 5 }[bucket] ?? 6);
          return rank(a.when.bucket) - rank(b.when.bucket) || b.at.localeCompare(a.at);
        })[0];
      return {
        ...p,
        itemCount: health.open,
        health,
        nextItem: next ? { title: next.title, href: next.href, who: next.who, bucket: next.when.bucket, explicit: next.when.explicit } : null,
      };
    });

    return NextResponse.json({ projects: enriched });
  } catch (e) {
    console.error('[projects GET] error:', e);
    return NextResponse.json({ error: 'Could not load projects.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as { name?: string; description?: string; goals?: unknown; rules?: unknown; color?: string };
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'A project name is required.' }, { status: 400 });

    const { data, error: insErr } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        name: name.slice(0, 120),
        description: body.description ? String(body.description).slice(0, 2000) : null,
        goals: cleanList(body.goals),
        rules: cleanList(body.rules),
        color: body.color ? String(body.color).slice(0, 24) : null,
        auto: false,
      })
      .select('id, name, description, status, goals, rules, color, auto, sort_order, created_at, updated_at')
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    // MAGNET on create: immediately pull in existing items whose initiative matches this name — even a
    // single one (you named it, so no ≥2 threshold). Generous match here (explicit intent). If the
    // deterministic pass finds NOTHING, fall back to ONE cheap AI reconcile (the name↔label mismatch
    // edge — e.g. a project named differently from how items were labeled).
    const counts = await reconcileProjectMembership(supabase, user.id, [{ id: data.id as string, name: data.name as string }], false).catch(() => ({} as Record<string, number>));
    let itemCount = counts[data.id as string] || 0;
    if (itemCount === 0) {
      const { aiMatchProjectName } = await import('@/lib/projects/ai-match');
      itemCount = await aiMatchProjectName(supabase, user.id, data.id as string, data.name as string).catch(() => 0);
    }
    return NextResponse.json({ project: { ...data, itemCount } });
  } catch (e) {
    console.error('[projects POST] error:', e);
    return NextResponse.json({ error: 'Could not create the project.' }, { status: 500 });
  }
}
