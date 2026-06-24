import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_RULES } from '@/lib/inbox/rules/defaults';

// GET — the user's triage rules (seeds the defaults on first use). POST — create a new rule.
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let { data: rules } = await supabase.from('inbox_rules')
    .select('*').eq('user_id', user.id).order('priority', { ascending: true });

  // Seed the defaults the first time.
  if (!rules || rules.length === 0) {
    const rows = DEFAULT_RULES.map(r => ({
      user_id: user.id, name: r.name, enabled: r.enabled, priority: r.priority,
      trigger: r.trigger, match_mode: r.match_mode, conditions: r.conditions,
      ai_match: r.ai_match, outcome: r.outcome, source: r.source,
    }));
    await supabase.from('inbox_rules').insert(rows);
    const reread = await supabase.from('inbox_rules')
      .select('*').eq('user_id', user.id).order('priority', { ascending: true });
    rules = reread.data ?? [];
  }

  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  // Place new rules just below the AI-match block by default.
  const { data: maxRow } = await supabase.from('inbox_rules')
    .select('priority').eq('user_id', user.id).order('priority', { ascending: false }).limit(1).maybeSingle();
  const priority = body.priority ?? ((maxRow?.priority ?? 100) + 10);

  const { data, error: insErr } = await supabase.from('inbox_rules').insert({
    user_id: user.id,
    name: body.name || 'Untitled rule',
    enabled: body.enabled ?? true,
    priority,
    trigger: body.trigger || 'received',
    match_mode: body.match_mode || 'all',
    conditions: body.conditions || [],
    ai_match: body.ai_match ?? null,
    outcome: body.outcome || {},
    source: 'user',
  }).select('*').single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ rule: data });
}
