import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { answerHomeQuestion, type AskTurn } from '@/lib/home/ask';

export const maxDuration = 30;

// POST /api/home/ask — the Home's grounded Q&A over the brain. { question, history? } → { answer, refs }.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { question?: string; history?: AskTurn[] };
    const q = String(body.question ?? '').trim().slice(0, 500);
    if (!q) return NextResponse.json({ error: 'question required' }, { status: 400 });
    const res = await answerHomeQuestion(supabase, user.id, q, Array.isArray(body.history) ? body.history : []);
    return NextResponse.json(res);
  } catch (e) {
    console.error('[home/ask] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
