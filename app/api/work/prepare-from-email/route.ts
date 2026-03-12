import { NextRequest, NextResponse } from 'next/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { SYSTEM_PROMPT, parsePlanResponse } from '@/lib/work/planning-ai';
import { runGeneratePipeline } from '@/lib/work/generate-pipeline';

// POST /api/work/prepare-from-email
// Internal endpoint — authenticated via x-internal-secret header.
// Called fire-and-forget from the email sync pipeline after an executable
// inbox item is saved. Runs the full pipeline:
//   plan generation → message seeding → deliverable generation → artifact saved
// Updates execution_status on the inbox item throughout.
export async function POST(request: NextRequest) {
  // Auth: shared secret
  const secret = request.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { inboxItemId, userId } = await request.json();
  if (!inboxItemId || !userId) {
    return NextResponse.json({ error: 'Missing inboxItemId or userId' }, { status: 400 });
  }

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Mark as preparing immediately so the UI can show the loading state
  await adminClient
    .from('inbox_items')
    .update({ execution_status: 'preparing' })
    .eq('id', inboxItemId);

  try {
    // Load inbox item
    const { data: item, error: itemError } = await adminClient
      .from('inbox_items')
      .select('id, work_title, execution_plan, source_data')
      .eq('id', inboxItemId)
      .eq('user_id', userId)
      .single();

    if (itemError || !item?.execution_plan?.workflow_prompt) {
      throw new Error('Inbox item not found or missing workflow prompt');
    }

    // Load user context profiles
    const [{ data: identityProfile }, { data: workPatternsProfile }] = await Promise.all([
      adminClient
        .from('context_profiles')
        .select('profile_data')
        .eq('user_id', userId)
        .eq('profile_type', 'identity')
        .single(),
      adminClient
        .from('context_profiles')
        .select('profile_data')
        .eq('user_id', userId)
        .eq('profile_type', 'work_patterns')
        .single(),
    ]);

    const identity = identityProfile?.profile_data;
    const workPatterns = workPatternsProfile?.profile_data;

    const userContextStr = identity
      ? `${identity.jobRole || 'Professional'}${identity.department ? ` at ${identity.department}` : ''}`
      : 'Professional';

    let userContextNote = identity
      ? `\n\nUser context: ${identity.jobRole || ''} ${identity.department ? `in ${identity.department}` : ''}`.trim()
      : '';

    if (workPatterns?.deliverableTypes && Object.keys(workPatterns.deliverableTypes).length > 0) {
      const typesSummary = Object.entries(workPatterns.deliverableTypes as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type} (${count}x)`)
        .join(', ');
      userContextNote += `\n\nDeliverable types this user typically creates: ${typesSummary}`;
    }
    if (workPatterns?.commonSkills?.length) {
      userContextNote += `\n\nMost-used skills: ${workPatterns.commonSkills.join(', ')}`;
    }

    // Build workflow prompt with attachment metadata
    const seed = item.execution_plan;
    const attachments: Array<{ filename: string; mimeType?: string; size?: number; extractedText?: string | null }> =
      item.source_data?.attachments || [];

    const attachmentMeta = attachments.map((a) => {
      const typeLabel = a.mimeType?.includes('pdf') ? 'PDF'
        : a.mimeType?.includes('wordprocessingml') ? 'Word document'
        : a.mimeType === 'text/plain' ? 'text file'
        : 'file';
      const sizeLabel = a.size ? `, ${Math.round(a.size / 1024)} KB` : '';
      return `- ${a.filename} (${typeLabel}${sizeLabel})`;
    }).join('\n');

    const workflowPrompt = attachmentMeta
      ? `${seed.workflow_prompt}\n\nAvailable attachments (already provided — include each as an input with status "provided" in the plan):\n${attachmentMeta}`
      : seed.workflow_prompt;

    // Create work thread
    const title = item.work_title || seed.deliverable_description || 'Untitled workflow';
    const { data: thread, error: threadError } = await adminClient
      .from('work_threads')
      .insert({
        user_id: userId,
        title: title.substring(0, 200),
        plan: null,
        status: 'active',
        auto_generated: true,
      })
      .select('id')
      .single();

    if (threadError || !thread) throw new Error('Failed to create work thread');

    // Link thread to inbox item immediately
    await adminClient
      .from('inbox_items')
      .update({ work_thread_id: thread.id })
      .eq('id', inboxItemId);

    // Generate plan
    const { client, model } = await getAIClient(userId, 'planning', adminClient);
    const planCompletion = await aiCreate(client, {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + userContextNote },
        { role: 'user', content: workflowPrompt },
      ],
      temperature: 0.4,
      max_tokens: 2500,
    });

    const fullPlanResponse = planCompletion.choices[0]?.message?.content || '';
    const { conversationalText, planRaw } = parsePlanResponse(fullPlanResponse);

    // Seed conversation
    await adminClient.from('work_messages').insert([
      { thread_id: thread.id, role: 'user', content: workflowPrompt },
      { thread_id: thread.id, role: 'assistant', content: conversationalText },
    ]);

    // Save plan to thread
    let plan = seed; // fallback: use the inbox item's execution_plan as seed
    if (planRaw && planRaw !== 'null') {
      try {
        plan = JSON.parse(planRaw);
      } catch {
        // keep seed plan
      }
    }

    await adminClient
      .from('work_threads')
      .update({ plan, updated_at: new Date().toISOString() })
      .eq('id', thread.id);

    // Generate the deliverable
    const emailAttachments = attachments.map((a) => ({
      filename: a.filename,
      extractedText: a.extractedText ?? null,
    }));

    const artifact = await runGeneratePipeline({
      userId,
      threadId: thread.id,
      plan,
      emailAttachments,
      conversationContext: `user: ${workflowPrompt}\nassistant: ${conversationalText}`,
      userContext: userContextStr,
      adminClient,
    });

    // Append to artifacts array
    const { data: freshThread } = await adminClient
      .from('work_threads')
      .select('artifacts')
      .eq('id', thread.id)
      .single();
    const existingArtifacts = (freshThread?.artifacts as typeof artifact[]) || [];
    const updatedArtifacts = [...existingArtifacts, artifact];
    await adminClient
      .from('work_threads')
      .update({
        artifact,
        artifacts: updatedArtifacts,
        updated_at: new Date().toISOString(),
      })
      .eq('id', thread.id);

    // Mark as ready
    await adminClient
      .from('inbox_items')
      .update({ execution_status: 'ready' })
      .eq('id', inboxItemId);

    console.log(`[PrepareFromEmail] ✓ Done for inbox item ${inboxItemId}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[PrepareFromEmail] Error:', error);
    await adminClient
      .from('inbox_items')
      .update({ execution_status: 'failed' })
      .eq('id', inboxItemId);
    return NextResponse.json({ error: 'Preparation failed' }, { status: 500 });
  }
}
