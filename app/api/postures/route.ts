// THE POSTURE REGISTRY — the list door (A8). Postures ARE `inbox_rules` rows wearing a sentence;
// this route exists only because receipts are a server-side computation. Toggling, re-saying and
// deleting reuse the rules routes / the registry's own writers — one store, no second engine.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { defaultRulesForProvider } from '@/lib/inbox/rules/defaults';
import { createPosture, postureReceipts, toPosture, type PostureRow } from '@/lib/postures/registry';
import type { InboxRule } from '@/lib/inbox/rules/types';

export const maxDuration = 60;

function toRow(r: InboxRule, userId: string, connectionId: string) {
  return {
    user_id: userId, connection_id: connectionId,
    name: r.name, enabled: r.enabled, priority: r.priority, trigger: r.trigger,
    match_mode: r.match_mode, conditions: r.conditions, ai_match: r.ai_match, outcome: r.outcome, source: r.source,
  };
}

// GET ?connection_id=… → that inbox's postures + receipts (seeds the provider's defaults the first
// time, exactly as the rules route does — the two faces must never disagree about what exists).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const connectionId = new URL(request.url).searchParams.get('connection_id');

  let rows: PostureRow[] = [];
  if (connectionId) {
    const { data: conn } = await supabase.from('connections')
      .select('id, provider').eq('id', connectionId).eq('user_id', user.id).single();
    if (!conn) return NextResponse.json({ error: 'connection not found' }, { status: 404 });

    const read = async () => (await supabase.from('inbox_rules')
      .select('*').eq('user_id', user.id).eq('connection_id', connectionId).order('priority', { ascending: true })).data ?? [];
    rows = (await read()) as PostureRow[];
    if (!rows.length) {
      await supabase.from('inbox_rules').insert(defaultRulesForProvider(conn.provider).map(r => toRow(r, user.id, connectionId)));
      rows = (await read()) as PostureRow[];
    }
  } else {
    const { data } = await supabase.from('inbox_rules')
      .select('*').eq('user_id', user.id).order('priority', { ascending: true });
    rows = (data ?? []) as PostureRow[];
  }

  // W11.3 · the sentence names the mailbox only when the account chose the mirror (the ONE reader).
  const [{ getEmailSettings }, { augmtdLabelsOn }] = await Promise.all([
    import('@/lib/inbox/email-settings'), import('@/lib/inbox/rules/label-name'),
  ]);
  const mirrorOn = augmtdLabelsOn(await getEmailSettings(user.id, supabase));
  const postures = rows.map((r) => toPosture(r, { mirrorOn }));
  let receipts: Record<string, unknown> = {};
  try {
    const map = await postureReceipts(supabase, user.id, rows, { connectionId });
    receipts = Object.fromEntries(map);
  } catch { /* receipts are a read; a failure must never blank the list */ }

  return NextResponse.json({ postures, receipts });
}

// POST { sentence, connection_id, primitives? } → create through THE ONE WRITER.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const res = await createPosture(supabase, user.id, String(body.sentence ?? ''), {
    connectionId: body.connection_id ?? null,
    primitives: body.primitives,
  });
  if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason }, { status: 422 });
  return NextResponse.json({ ok: true, posture: res.posture, understood: res.understood });
}
