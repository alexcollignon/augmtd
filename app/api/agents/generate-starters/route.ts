import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateStartersForAgent } from '@/lib/agents/generate-starters';

export const maxDuration = 20;

// POST /api/agents/generate-starters
// Called from the agent form "Generate" button — returns 4 starters as JSON.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, description, instructions } = await request.json() as {
      name?: string;
      description?: string;
      instructions?: string;
    };

    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    const starters = await generateStartersForAgent({ name, description, instructions, userId: user.id, supabase });
    if (!starters) return NextResponse.json({ error: 'Failed to generate starters' }, { status: 500 });

    return NextResponse.json({ starters });
  } catch (err) {
    console.error('[generate-starters] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
