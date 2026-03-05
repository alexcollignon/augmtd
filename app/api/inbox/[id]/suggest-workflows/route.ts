import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import OpenAI from 'openai';

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// POST /api/inbox/[id]/suggest-workflows
// Returns saved workflows ranked by relevance to this email + optional AI suggestion.
// Pure suggestion layer — no downstream effect on run/plan/KB.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: itemId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load inbox item
    const { data: item } = await supabase
      .from('inbox_items')
      .select('source_data')
      .eq('id', itemId)
      .eq('user_id', user.id)
      .single();

    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Load saved workflows
    const { data: workflows } = await supabase
      .from('saved_workflows')
      .select('id, name, prompt, deliverable_types')
      .eq('user_id', user.id)
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .limit(20);

    const savedWorkflows = workflows ?? [];

    const subject = item.source_data?.subject ?? '';
    const bodySnippet = (item.source_data?.body ?? item.source_data?.snippet ?? '').slice(0, 400);
    const emailQuery = [subject, bodySnippet].filter(Boolean).join(' — ');

    if (!emailQuery) {
      return NextResponse.json({ rankedWorkflows: savedWorkflows.map(wf => ({ ...wf, score: 0 })), aiSuggestion: null });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let rankedWorkflows: Array<(typeof savedWorkflows)[0] & { score: number }> = [];
    let topScore = 0;

    if (savedWorkflows.length > 0) {
      // Batch embed email + all workflow prompts in one call
      const inputs = [emailQuery, ...savedWorkflows.map(wf => wf.prompt)];
      const embeddingRes = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: inputs,
      });
      const embeddings = embeddingRes.data.map(d => d.embedding);
      const emailEmbedding = embeddings[0];

      rankedWorkflows = savedWorkflows
        .map((wf, i) => ({ ...wf, score: cosineSimilarity(emailEmbedding, embeddings[i + 1]) }))
        .sort((a, b) => b.score - a.score);

      topScore = rankedWorkflows[0]?.score ?? 0;
    }

    // AI suggestion: when no workflows exist, or best match is weak
    let aiSuggestion: string | null = null;
    if (savedWorkflows.length === 0 || topScore < 0.3) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 60,
        messages: [
          {
            role: 'system',
            content: `Given an email subject and body, suggest one specific workflow action the recipient should take. 1 sentence, starts with a verb (Draft, Prepare, Create, Summarize, etc.). Be specific to the email content. Return ONLY the suggestion, no explanation.`,
          },
          {
            role: 'user',
            content: `Subject: ${subject}\n\n${bodySnippet}`,
          },
        ],
      });
      aiSuggestion = completion.choices[0]?.message?.content?.trim() ?? null;
    }

    return NextResponse.json({ rankedWorkflows, aiSuggestion });
  } catch (err) {
    console.error('[SuggestWorkflows] error:', err);
    return NextResponse.json({ rankedWorkflows: [], aiSuggestion: null });
  }
}
