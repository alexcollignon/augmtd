import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/projects/accept-suggestion — turn an AI suggestion into a real project. Creates the project
// (auto=true) and sets project_id on the referenced atoms (inbox_items / commitments). Idempotent-ish:
// re-assigning an item just moves it. Returns the created project.
//
// Body: { name, items: [{ table:'inbox_items'|'commitments', id }], why?, goals?[], rules?[] }

const VALID_TABLES = new Set(['inbox_items', 'commitments']);

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

    return NextResponse.json({ project: { ...project, itemCount: assigned } });
  } catch (e) {
    console.error('[projects/accept-suggestion] error:', e);
    return NextResponse.json({ error: 'Could not accept the suggestion.' }, { status: 500 });
  }
}
