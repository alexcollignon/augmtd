import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';
import { normalizeInitiative } from '@/lib/inbox/item-understanding';

// POST /api/projects/accept-suggestion — turn an AI suggestion into a real project. Creates the project
// (auto=true) and sets project_id on the referenced atoms (inbox_items / commitments). Idempotent-ish:
// re-assigning an item just moves it. Returns the created project.
//
// Body: { name, items: [{ table:'inbox_items'|'commitments', id }], why?, goals?[], rules?[] }

const VALID_TABLES = new Set(['inbox_items', 'commitments', 'calendar_events']);

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as { name?: string; items?: Array<{ table?: string; id?: string }>; purpose?: string; goals?: unknown; rules?: unknown };
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'A project name is required.' }, { status: 400 });

    const items = (body.items ?? []).filter((it) => it && VALID_TABLES.has(String(it.table)) && it.id);

    // Create the project (AI-clustered → auto=true). description carries the suggestion's purpose.
    const cleanList = (v: unknown) => (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
    const { data: project, error: pErr } = await supabase
      .from('projects')
      .insert({ user_id: user.id, name: name.slice(0, 120), description: body.purpose ? String(body.purpose).slice(0, 300) : null, goals: cleanList(body.goals), rules: cleanList(body.rules), auto: true })
      .select('id, name, description, status, goals, rules, color, auto, sort_order, created_at, updated_at')
      .single();
    if (pErr || !project) return NextResponse.json({ error: pErr?.message || 'Could not create the project.' }, { status: 500 });

    // Assign the atoms (batched per table). RLS + user_id scope keep it safe.
    const byTable: Record<string, string[]> = {};
    for (const it of items) (byTable[String(it.table)] ??= []).push(String(it.id));
    let assigned = 0;
    for (const [table, ids] of Object.entries(byTable)) {
      const { error: uErr, count } = await supabase.from(table).update({ project_id: project.id }, { count: 'exact' }).in('id', ids).eq('user_id', user.id);
      if (!uErr) assigned += count ?? ids.length;
      else console.error(`[accept-suggestion] assign ${table} failed:`, uErr.message);
    }

    // Log the "tracked as project" curation (the other half of the initiative decision) + feed the brain's
    // learning layer. entityId = the initiative key so it lines up with mute/unmute. Both non-fatal.
    const initiativeKey = normalizeInitiative(name)?.replace(/\s+/g, '') || name.toLowerCase().replace(/\s+/g, '');
    await logActivity(supabase, user.id, {
      type: 'initiative_tracked',
      title: `Tracking "${name}" as a project`,
      entityType: 'initiative',
      entityId: initiativeKey,
      metadata: { projectId: project.id, label: name },
    });
    await supabase.from('learning_signals').insert({
      user_id: user.id, inbox_item_id: null, signal_type: 'action_taken',
      signal_data: { action: 'initiative_tracked', initiative_key: initiativeKey, label: name, project_id: project.id },
    }).then(() => {}, () => {});

    // Bust the cached Home brief so In-motion recomputes activeInitiatives WITH the new project_id on the
    // atoms — otherwise the tracked tile keeps showing untracked (a cache-hit serves the stale set). Same
    // as the mute route. Non-fatal.
    try { await supabase.from('profiles').update({ home_brief: null }).eq('id', user.id); } catch { /* non-fatal */ }

    return NextResponse.json({ project: { ...project, itemCount: assigned } });
  } catch (e) {
    console.error('[projects/accept-suggestion] error:', e);
    return NextResponse.json({ error: 'Could not accept the suggestion.' }, { status: 500 });
  }
}
