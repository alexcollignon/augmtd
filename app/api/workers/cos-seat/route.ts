import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveCosSeat } from '@/lib/workers/cos-seat';

// THE CoS SEAT, served (docs/threads-plan.md — the identity law). One tiny door so a client
// surface can wear the seat-holder's face: it resolves through `lib/workers/cos-seat.ts` and
// returns exactly what that module decided — no second ladder, no defaulting here. `seat: null`
// means a worker-less account (pre-seed); the caller renders without a face rather than
// inventing one. Identity is ambient, so callers cache it ageless.
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const seat = await resolveCosSeat(supabase, user.id);
  return NextResponse.json({ seat });
}
