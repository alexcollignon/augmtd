// ─── GET /api/home/day — THE DAY FRAME, in one read ─────────────────────────────────────────────
// docs/attention-plan.md laws A4 (the day frame) · A5 (the feature ladder) · A6 (in motion is
// state, never events). The chat is the spine; this is the frame around it.
//
// ZERO AI. Two zones, each PRESENT ONLY IF EARNED — and earned AT THE SERVE, never by the client:
// a zone the client has to hide is a zone that exists, which is exactly what A5 outlaws. A
// feature-OFF organ's key is ABSENT (no empty object, no upsell hint); an ON-but-unconnected organ
// is absent from THIS payload too (the one-time connect offer is the CoS's own voice in the
// thread, not this route's job); a connected organ with nothing true today is absent as well.
//
// The whole derivation lives in lib/home/day.ts so the route stays thin and the laws stay testable
// on the pure functions that own them.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildDayFrame, type DayFrame } from '@/lib/home/day';

export const maxDuration = 20;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { getWorkspaceFeatures } = await import('@/lib/workspace/features');
    const features = await getWorkspaceFeatures(user.id, supabase);
    const frame = await buildDayFrame(supabase, user.id, features, user.email ?? null);
    return NextResponse.json(frame satisfies DayFrame);
  } catch (err) {
    // THE FRAME NEVER BREAKS THE HOME: a failure is an absent frame (the same thing an empty day
    // looks like), never an error the page has to render.
    console.error('[home/day] derivation failed:', err);
    return NextResponse.json({} satisfies DayFrame);
  }
}
