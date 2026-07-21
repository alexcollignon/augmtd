// POST /api/entities/[id]/ask — chat with ONE project's brain (Prepared-Work D2). Grounded in the
// entity's state + ledger + files; honest-or-silent; refs resolve to deep-dives.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { answerEntityQuestion, type EntityAskTurn } from '@/lib/entities/ask';

export const maxDuration = 30;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const { question, history } = await request.json().catch(() => ({} as { question?: string; history?: EntityAskTurn[] }));
    if (!question || typeof question !== 'string') return NextResponse.json({ error: 'question required' }, { status: 400 });
    const result = await answerEntityQuestion(supabase, user.id, id, question.slice(0, 600), Array.isArray(history) ? history : []);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[entities/ask]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
