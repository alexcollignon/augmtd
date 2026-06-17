import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { extractAgentMemory } from '@/lib/agents/extract-memory';

type Params = { params: Promise<{ id: string }> };

// POST /api/agents/[id]/extract-memory
// Body: { threadId }
// Called fire-and-forget after each agent conversation turn (native chat loop).
// The AgentOS bridge calls extractAgentMemory() directly instead. Both share the
// same logic in lib/agents/extract-memory.ts.
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

    await extractAgentMemory(agentId, user.id, threadId, adminClient, supabase);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Agents/extract-memory] error:', err);
    return NextResponse.json({ error: 'Failed to extract memory' }, { status: 500 });
  }
}
