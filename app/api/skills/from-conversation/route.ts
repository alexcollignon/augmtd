import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { draftSkillFromConversation } from '@/lib/skills/from-conversation';
import type { FromConversationResponse } from '@/lib/skills/chat-contract';

export const maxDuration = 45;

// POST /api/skills/from-conversation { roomKey } → { draft: { name, whenToUse, instructions } }
// W21 "Save as skill" (contract: lib/skills/chat-contract.ts). The conversation is turned into a DRAFT
// through the interview builder's own synthesis (lib/skills/synthesize.ts). THIS DOOR WRITES NOTHING —
// the user reviews the draft in the skill editor and saves it through POST /api/skills (HUMAN IN THE
// LOOP: a skill is never auto-created).
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { roomKey?: unknown };
    const roomKey = typeof body.roomKey === 'string' ? body.roomKey.trim() : '';
    if (!roomKey) return NextResponse.json({ error: 'roomKey required' }, { status: 400 });

    const draft = await draftSkillFromConversation(supabase, user.id, roomKey);
    if (!draft) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    const res: FromConversationResponse = { draft };
    return NextResponse.json(res);
  } catch (err) {
    console.error('[Skills/from-conversation] POST error:', err);
    return NextResponse.json({ error: 'Failed to draft a skill from this conversation' }, { status: 500 });
  }
}
