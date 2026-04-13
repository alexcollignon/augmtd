import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

type Params = { params: Promise<{ id: string }> };

const MAX_MEMORY_CHARS = 2000;
const COMPRESS_THRESHOLD = 1800;

// POST /api/agents/[id]/extract-memory
// Body: { threadId }
// Called fire-and-forget after each agent conversation turn.
// Extracts key facts from the conversation and appends to agent.memory_text.
export async function POST(request: NextRequest, { params }: Params) {
  const { id: agentId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { threadId } = await request.json() as { threadId: string };
    if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Load agent
    const { data: agent } = await supabase
      .from('custom_agents')
      .select('id, memory_text')
      .eq('id', agentId)
      .eq('user_id', user.id)
      .single();
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    // Load last 20 messages from this thread
    const { data: messages } = await adminClient
      .from('work_messages')
      .select('role, content')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!messages?.length) return NextResponse.json({ ok: true });

    const conversation = messages
      .reverse()
      .map((m: { role: string; content: string }) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const existingMemory = agent.memory_text ?? '';

    const extractPrompt = `You are a memory extractor. Review this conversation and identify key facts worth remembering for future sessions with this user.

Focus on: user preferences, decisions made, client/project details, constraints, personal style preferences.
Be extremely terse — one short bullet per fact, no elaboration.
Only add genuinely NEW information not already in the existing memory.
If there is nothing new worth remembering, respond with exactly: NO_UPDATE

EXISTING MEMORY:
${existingMemory || '(none yet)'}

CONVERSATION:
${conversation.slice(0, 6000)}

Respond with only new bullet points (or NO_UPDATE):`;

    const { client: aiClient, model } = await getAIClient(user.id, 'summarization', supabase);

    const result = await aiCreate(aiClient, {
      model,
      messages: [{ role: 'user', content: extractPrompt }],
      max_tokens: 300,
      temperature: 0.2,
    });

    const extracted = (result.choices?.[0]?.message?.content ?? '').trim();
    if (!extracted || extracted === 'NO_UPDATE') return NextResponse.json({ ok: true });

    let newMemory = existingMemory
      ? `${existingMemory}\n${extracted}`
      : extracted;

    // Compress if too long
    if (newMemory.length > COMPRESS_THRESHOLD) {
      const compressPrompt = `Compress these memory notes into the most important facts only. Max ${MAX_MEMORY_CHARS - 200} characters. Keep bullet format, be ruthless about what to cut:

${newMemory}`;

      const compressed = await aiCreate(aiClient, {
        model,
        messages: [{ role: 'user', content: compressPrompt }],
        max_tokens: 400,
        temperature: 0.1,
      });
      newMemory = (compressed.choices?.[0]?.message?.content ?? newMemory).trim();
    }

    await supabase
      .from('custom_agents')
      .update({ memory_text: newMemory.slice(0, MAX_MEMORY_CHARS) })
      .eq('id', agentId)
      .eq('user_id', user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Agents/extract-memory] error:', err);
    return NextResponse.json({ error: 'Failed to extract memory' }, { status: 500 });
  }
}
