import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readFollowedForRoom } from '@/lib/skills/followed-store';
import type { FollowedByTurnResponse } from '@/lib/skills/chat-contract';

// GET /api/skills/followed?roomKey=<key> → { byTurnId: { [turnId]: [{ id, name }] } }
// W21 (contract: lib/skills/chat-contract.ts): the skills each persisted ROOM answer followed. Room turns
// carry no metadata column, so the fact lives in ONE companion record per turn (lib/skills/followed-store.ts).
// Coworker DM messages carry theirs in work_messages.metadata.skillsFollowed instead. Reads only.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const roomKey = (request.nextUrl.searchParams.get('roomKey') ?? '').trim();
    if (!/^[A-Za-z0-9:_.-]{3,200}$/.test(roomKey)) return NextResponse.json({ error: 'roomKey required' }, { status: 400 });

    const res: FollowedByTurnResponse = { byTurnId: await readFollowedForRoom(supabase, user.id, roomKey) };
    return NextResponse.json(res);
  } catch (err) {
    console.error('[Skills/followed] GET error:', err);
    return NextResponse.json({ error: 'Failed to load followed skills' }, { status: 500 });
  }
}
