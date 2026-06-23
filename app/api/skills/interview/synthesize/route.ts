import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

export const maxDuration = 45;

// POST /api/skills/interview/synthesize
// Step B of the skill-builder interview: turn the interview answers (+ optional writing
// samples) into a draft skill. The user reviews/edits the draft before it's saved.
// Body: { objective, kinds?: string[], answers: [{question, answer}], samples? }
// → { draft: { name, when_to_use, content, kind } }   (kind = primary concrete kind, or null)

const CONCRETE_KINDS = ['voice', 'domain', 'audience', 'method'];

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

  const body = (await request.json()) as {
    objective?: string;
    kinds?: string[];
    other?: string;
    answers?: Array<{ question: string; answer: string }>;
    samples?: string;
  };
  if (!body.objective?.trim()) return NextResponse.json({ error: 'objective is required' }, { status: 400 });

  const kinds = Array.isArray(body.kinds) ? body.kinds.filter(Boolean) : [];
  const concrete = kinds.filter((k) => CONCRETE_KINDS.includes(k));
  const storedKind = concrete[0] ?? null; // single column — keep the primary kind
  const kindBits = [...concrete];
  if (kinds.includes('other') && body.other?.trim()) kindBits.push(body.other.trim());
  const kindLine = kindBits.length ? `Kind(s): ${kindBits.join(', ')}.` : 'Kind: unspecified.';

  const qa = (body.answers ?? [])
    .filter((a) => a?.answer?.trim())
    .map((a) => `Q: ${a.question}\nA: ${a.answer.trim()}`)
    .join('\n\n');

  const samplesBlock = body.samples?.trim()
    ? `\n\nWriting samples the user provided — extract CONCRETE patterns from these (real words, sentence shapes, opener/closer habits); they matter more than adjectives:\n"""\n${body.samples.trim().slice(0, 6000)}\n"""`
    : '';

  const prompt = `Turn this interview into a reusable "skill" — a block of instructions a writing assistant follows when it applies.

What it should capture: ${body.objective.trim()}
${kindLine}

Interview:
${qa || '(no answers given — infer only from the objective and any samples)'}${samplesBlock}

Write the skill. Requirements:
- name: short and clear, max ~6 words.
- when_to_use: ONE line for when a coworker should apply this (used for auto-selection), e.g. "When drafting LinkedIn posts".
- content: the actual instruction block — imperative, concrete, scannable (short rules / bullets). For voice, derive specific do/don't from the samples and answers (real words, sentence shapes, opener/closer habits), NOT vague adjectives. For domain, state the facts plainly so they can be quoted. NEVER invent facts the user didn't give.
- Keep it tight — no preamble, no meta-commentary.

Return ONLY JSON, no prose:
{"name":"…","when_to_use":"…","content":"…"}`;

  try {
    const { client, model } = await getAIClient(user.id, 'generation', supabase);
    const res = await aiCreate(client, {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1400,
      temperature: 0.5,
    });
    const text = res.choices?.[0]?.message?.content ?? '';
    const parsed = parseJson(text);
    const name = String(parsed.name ?? '').trim();
    const content = String(parsed.content ?? '').trim();
    if (!name || !content) throw new Error('incomplete draft');
    return NextResponse.json({
      draft: {
        name,
        when_to_use: parsed.when_to_use ? String(parsed.when_to_use).trim() : '',
        content,
        kind: storedKind,
      },
    });
  } catch (err) {
    console.error('[Skills/interview/synthesize] error:', err);
    return NextResponse.json({ error: 'Failed to synthesize skill' }, { status: 500 });
  }
}
