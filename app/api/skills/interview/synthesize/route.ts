import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { synthesizeSkillDraft } from '@/lib/skills/synthesize';

export const maxDuration = 45;

// POST /api/skills/interview/synthesize
// Step B of the skill-builder interview: turn the interview answers (+ optional writing
// samples) into a draft skill. The user reviews/edits the draft before it's saved.
// Body: { objective, kinds?: string[], answers: [{question, answer}], samples? }
// → { draft: { name, when_to_use, content, kind } }   (kind = primary concrete kind, or null)
// The prompt + model call live in lib/skills/synthesize.ts — shared with W21's
// POST /api/skills/from-conversation, so both doors produce the same draft shape.

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as {
    objective?: string;
    kinds?: string[];
    other?: string;
    answers?: Array<{ question: string; answer: string }>;
    samples?: string;
  };
  if (!body.objective?.trim()) return NextResponse.json({ error: 'objective is required' }, { status: 400 });

  try {
    const draft = await synthesizeSkillDraft(supabase, user.id, {
      objective: body.objective,
      kinds: body.kinds,
      other: body.other,
      answers: body.answers,
      samples: body.samples,
    });
    return NextResponse.json({ draft });
  } catch (err) {
    console.error('[Skills/interview/synthesize] error:', err);
    return NextResponse.json({ error: 'Failed to synthesize skill' }, { status: 500 });
  }
}
