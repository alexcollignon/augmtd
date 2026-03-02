import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { DocumentArtifact } from '@/lib/types/inbox';
import { runFullPipeline } from '@/lib/work/generate-pipeline';

// POST /api/work/threads/[id]/generate
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, title, plan, user_attachments')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    if (!thread.plan) {
      return NextResponse.json({ error: 'Thread has no plan yet' }, { status: 400 });
    }

    const [{ data: recentMessages }, { data: linkedItem }, { data: identityProfile }] = await Promise.all([
      supabase
        .from('work_messages')
        .select('role, content')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('inbox_items')
        .select('source_data')
        .eq('work_thread_id', threadId)
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('context_profiles')
        .select('profile_data')
        .eq('user_id', user.id)
        .eq('profile_type', 'identity')
        .single(),
    ]);

    const identity = identityProfile?.profile_data;
    const plan = thread.plan;

    const conversationContext = (recentMessages || [])
      .reverse()
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join('\n');

    const emailAttachments = (linkedItem?.source_data?.attachments || []) as Array<{
      filename: string;
      extractedText: string | null;
    }>;
    const userAttachments = ((thread as any).user_attachments || []) as Array<{
      filename: string;
      mimeType: string;
      storagePath: string;
      extractedText: string | null;
    }>;

    const userContext = identity
      ? `${identity.jobRole || 'Professional'}${identity.department ? ` at ${identity.department}` : ''}`
      : 'Professional';

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Run all steps — intermediate steps feed into each generator step sequentially
    const newArtifacts = await runFullPipeline({
      userId: user.id,
      threadId,
      plan,
      emailAttachments,
      userAttachments,
      conversationContext,
      userContext,
      adminClient,
    });

    // Title each artifact: use the matching plan output name if available,
    // fall back to plan.deliverable_description, then thread title.
    const planOutputs: Array<{ name?: string; deliverableType?: string }> = (plan as any)?.outputs ?? [];
    newArtifacts.forEach((a, i) => {
      // Match by position first, then by deliverableType if available
      const matchByType = planOutputs.find((o) => o.deliverableType === a.type);
      const matchByIndex = planOutputs[i];
      const output = matchByType ?? matchByIndex;
      a.title = output?.name ?? (plan as any)?.deliverable_description ?? thread.title;
    });

    // Merge: replace existing artifacts of the same type, keep the rest
    const { data: freshThread } = await adminClient
      .from('work_threads')
      .select('artifacts')
      .eq('id', threadId)
      .single();
    const existingArtifacts = (freshThread?.artifacts as DocumentArtifact[]) || [];
    const regeneratedTypes = new Set(newArtifacts.map((a) => a.type));
    const kept = existingArtifacts.filter((a) => !regeneratedTypes.has(a.type));
    const updatedArtifacts = [...kept, ...newArtifacts];
    const latestArtifact = updatedArtifacts[updatedArtifacts.length - 1];

    await adminClient
      .from('work_threads')
      .update({
        artifact: latestArtifact,
        artifacts: updatedArtifacts,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);

    return NextResponse.json({ artifacts: newArtifacts, artifact: newArtifacts[newArtifacts.length - 1] });
  } catch (error) {
    console.error('[Generate] Error:', error);
    return NextResponse.json({ error: 'Failed to generate document' }, { status: 500 });
  }
}
