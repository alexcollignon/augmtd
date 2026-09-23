// ════════════════════════════════════════════════════════════════════════════════════════════════
// SETTINGS → TEAM · "PEOPLE YOU WORK WITH" (W11.2 THE WORKING CIRCLE — lib/evidence/circle.ts).
//
// GET  — the circle as the user sees it: workspace members (read-only), then every inferred or
//        decided collaborator with its state (confirmed · inferred · suggested · removed) and whether
//        it COUNTS as a teammate for evidence. `?refresh=1` recomputes the inference now (zero AI).
// POST — the user's click: { address, action: 'confirm' | 'remove' | 'add' | 'reset', name? }.
//        One row per address in the typed store; returns the refreshed view.
//
// RLS client only (the user's own rows). Zero AI. The user's hand wins: a removed address never
// counts, whatever its evidence.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadActorContext } from '@/lib/evidence/actor';
import {
  loadCircle, circleRows, decideCircle,
  CIRCLE_SUGGEST_MIN_THREADS, CIRCLE_AUTO_MIN_THREADS, CIRCLE_AUTO_MIN_ALONGSIDE, CIRCLE_WINDOW_DAYS,
} from '@/lib/evidence/circle';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function view(supabase: any, userId: string, refresh: boolean) {
  const base = await loadActorContext(supabase, userId, { circle: false });
  const c = await loadCircle(supabase, userId, base, { refresh });
  return {
    members: base.teammates.map((a) => ({ address: a, name: base.teammateNames?.[a] ?? null })),
    rows: circleRows(c.inference?.candidates ?? [], c.decisions),
    computedAt: c.inference?.at ?? null,
    read: c.inference?.read ?? 0,
    capped: c.inference?.capped ?? false,
    rule: {
      windowDays: CIRCLE_WINDOW_DAYS, suggestMinThreads: CIRCLE_SUGGEST_MIN_THREADS,
      autoMinThreads: CIRCLE_AUTO_MIN_THREADS, autoMinAlongside: CIRCLE_AUTO_MIN_ALONGSIDE,
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const refresh = req.nextUrl.searchParams.get('refresh') === '1';
    return NextResponse.json(await view(supabase, user.id, refresh));
  } catch {
    return NextResponse.json({ error: 'Could not read the people you work with' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await req.json().catch(() => null)) as { address?: unknown; action?: unknown; name?: unknown } | null;
    const action = String(body?.action ?? '');
    if (!['confirm', 'remove', 'add', 'reset'].includes(action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    const name = typeof body?.name === 'string' ? body.name.slice(0, 120) : null;
    const r = await decideCircle(supabase, user.id, String(body?.address ?? ''), action as 'confirm' | 'remove' | 'add' | 'reset', name);
    if (r.error) return NextResponse.json({ error: r.error === 'not an email address' ? 'That is not an email address' : 'Could not save that' }, { status: r.error === 'not an email address' ? 400 : 500 });
    return NextResponse.json(await view(supabase, user.id, false));
  } catch {
    return NextResponse.json({ error: 'Could not save that' }, { status: 500 });
  }
}
