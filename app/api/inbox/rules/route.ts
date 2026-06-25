import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { defaultRulesForProvider } from '@/lib/inbox/rules/defaults';
import type { InboxRule } from '@/lib/inbox/rules/types';

function toRow(r: InboxRule, userId: string, connectionId: string) {
  return {
    user_id: userId, connection_id: connectionId,
    name: r.name, enabled: r.enabled, priority: r.priority, trigger: r.trigger,
    match_mode: r.match_mode, conditions: r.conditions, ai_match: r.ai_match, outcome: r.outcome, source: r.source,
  };
}

// GET ?connection_id=… → that inbox's rules (seeds the provider's defaults the first time).
// GET with no connection_id → all the user's rules (for the render-time classifier cache).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const connectionId = new URL(request.url).searchParams.get('connection_id');

  if (connectionId) {
    const { data: conn } = await supabase.from('connections')
      .select('id, provider').eq('id', connectionId).eq('user_id', user.id).single();
    if (!conn) return NextResponse.json({ error: 'connection not found' }, { status: 404 });

    let { data: rules } = await supabase.from('inbox_rules')
      .select('*').eq('user_id', user.id).eq('connection_id', connectionId).order('priority', { ascending: true });
    if (!rules || rules.length === 0) {
      await supabase.from('inbox_rules').insert(defaultRulesForProvider(conn.provider).map(r => toRow(r, user.id, connectionId)));
      const re = await supabase.from('inbox_rules')
        .select('*').eq('user_id', user.id).eq('connection_id', connectionId).order('priority', { ascending: true });
      rules = re.data ?? [];
    }
    return NextResponse.json({ rules });
  }

  const { data: rules } = await supabase.from('inbox_rules')
    .select('*').eq('user_id', user.id).order('priority', { ascending: true });
  return NextResponse.json({ rules: rules ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const connectionId = body.connection_id ?? null;

  let q = supabase.from('inbox_rules').select('priority').eq('user_id', user.id);
  q = connectionId ? q.eq('connection_id', connectionId) : q.is('connection_id', null);
  const { data: maxRow } = await q.order('priority', { ascending: false }).limit(1).maybeSingle();
  const priority = body.priority ?? ((maxRow?.priority ?? 100) + 10);

  const { data, error: insErr } = await supabase.from('inbox_rules').insert({
    user_id: user.id,
    connection_id: connectionId,
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
