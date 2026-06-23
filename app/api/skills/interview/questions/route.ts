import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

export const maxDuration = 30;

// POST /api/skills/interview/questions
// Step A of the skill-builder interview: given a pre-qual (objective + kind), generate a
// short, tailored set of elicitation questions. Stateless — the client holds the answers.
// Body: { objective: string, kind?: 'voice'|'domain'|'audience'|'method', hasSamples?: boolean }
// → { questions: [{ id, question, hint, placeholder }] }

const KIND_HINT: Record<string, string> = {
  voice: "the user's writing voice and tone — how they sound",
  domain: "facts and context about the user's business / product / market",
  audience: 'who the user is writing for',
  method: 'how to structure or format a kind of output',
};

// Tolerant JSON extraction — models sometimes wrap output in ```json fences or prose.
function parseJson(text: string): any {
  let raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) raw = fenced[1].trim();
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
  throw new Error('no json found');
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { objective, kind, hasSamples } = (await request.json()) as {
    objective?: string; kind?: string; hasSamples?: boolean;
  };
  if (!objective?.trim()) return NextResponse.json({ error: 'objective is required' }, { status: 400 });

  const kindHint = KIND_HINT[kind ?? ''] ?? 'the topic described';

  const prompt = `You are helping a user build a reusable "skill" — a block of instructions a writing assistant will later follow. You interview the user to capture it well.

Right now, produce ONLY the interview questions.

What this skill should capture: ${objective.trim()}
Kind of skill: ${kind ?? 'unspecified'} — i.e. ${kindHint}.
${hasSamples ? 'The user has provided writing samples, so do NOT ask them to describe their style in the abstract — ask questions that complement examples.' : ''}

Write 5–8 sharp, concrete questions that draw out tacit knowledge. Rules:
- Specific over generic. Never ask "what is your tone?" — ask for examples, words they use/avoid, decisions, opinions.
- voice: audience, what they want to be known for, strong opinions/hot takes, words & phrases they use, things they never say, format habits.
- domain: what the business does, who it's for (ICP), what makes it different, the offers, the proof points.
- audience: who they are, what they care about, what they already know, what they're skeptical of.
- method: the steps, the structure, the must-haves, the common mistakes to avoid.
- Each question answerable in 1–3 sentences.

Return ONLY JSON, no prose:
{"questions":[{"id":"q1","question":"…","hint":"one short line on why this matters","placeholder":"a brief example answer"}]}`;

  try {
    const { client, model } = await getAIClient(user.id, 'generation', supabase);
    const res = await aiCreate(client, {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 900,
      temperature: 0.6,
    });
    const text = res.choices?.[0]?.message?.content ?? '';
    const parsed = parseJson(text);
    const questions = (parsed.questions ?? [])
      .slice(0, 8)
      .map((q: any, i: number) => ({
        id: String(q.id ?? `q${i + 1}`),
        question: String(q.question ?? '').trim(),
        hint: q.hint ? String(q.hint).trim() : '',
        placeholder: q.placeholder ? String(q.placeholder).trim() : '',
      }))
      .filter((q: any) => q.question);
    if (!questions.length) throw new Error('no questions produced');
    return NextResponse.json({ questions });
  } catch (err) {
    console.error('[Skills/interview/questions] error:', err);
    return NextResponse.json({ error: 'Failed to generate questions' }, { status: 500 });
  }
}
