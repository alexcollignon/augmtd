import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 });
    }

    const { client, model } = await getAIClient(user.id, 'summarization', supabase);
    const completion = await aiCreate(client, {
      model,
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content: `Convert a specific workflow description into a reusable template by replacing all specifics with generic placeholders.

Rules:
- Replace EVERY specific: people, companies, clients, products, projects, places, dates, periods and the specific subject matter → "a client", "a contact", "a product or service", "a topic", "a project", "a date", "a period", etc.
- Keep the deliverable type, its shape (e.g. one-page memo) and the action verb
- 1 sentence max, starts with a verb (Draft, Create, Prepare, Summarize, etc.)
- Write it in the same language as the input
- Return ONLY the template sentence. No explanation, no quotes.

Example:
Input: Draft an email introducing our onboarding service to Acme's operations team about the March pilot
Output: Draft an email introducing a product or service to a client's team about a project`,
        },
        { role: 'user', content: prompt },
      ],
    });

    const generalized = completion.choices[0]?.message?.content?.trim() ?? null;
    return NextResponse.json({ generalized });
  } catch (err) {
    console.error('[Generalize] error:', err);
    return NextResponse.json({ generalized: null });
  }
}
