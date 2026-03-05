import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import OpenAI from 'openai';

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

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 100,
      messages: [
        {
          role: 'system',
          content: `Convert a specific workflow description into a reusable template by replacing all specifics with generic placeholders.

Rules:
- Replace ALL specific names: people, companies, clients, products, topics, projects → use "a client", "a product or service", "the topic", "a project", etc.
- Keep the deliverable type and action verb
- 1 sentence max, starts with a verb (Draft, Create, Prepare, Summarize, etc.)
- Return ONLY the template sentence. No explanation, no quotes.

Example:
Input: Draft an email introducing AI Readiness Hub to Accenture's innovation team
Output: Draft an email introducing a product or service to a client's team`,
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
