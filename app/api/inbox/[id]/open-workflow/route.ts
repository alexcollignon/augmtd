import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import OpenAI from 'openai';
import { SYSTEM_PROMPT, parsePlanResponse } from '@/lib/work/planning-ai';

// POST /api/inbox/[id]/open-workflow
// Creates (or returns existing) work thread from an executable inbox item.
// Generates the plan server-side so the user lands on a pre-populated thread.
// Idempotent: returns the existing thread if work_thread_id is already set.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: itemId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load the inbox item (must belong to user and be executable)
    const { data: item, error: itemError } = await supabase
      .from('inbox_items')
      .select('id, work_title, work_thread_id, execution_plan, source_data')
      .eq('id', itemId)
      .eq('user_id', user.id)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Idempotent: if already linked, navigate directly to the existing thread
    if (item.work_thread_id) {
      return NextResponse.json({ threadId: item.work_thread_id });
    }

    const sd = item.source_data || {};
    const attachments: Array<{ filename: string; mimeType?: string; size?: number }> =
      sd.attachments || [];

    const attachmentMeta = attachments.map((a) => {
      const typeLabel = a.mimeType?.includes('pdf') ? 'PDF'
        : a.mimeType?.includes('wordprocessingml') ? 'Word document'
        : a.mimeType === 'text/plain' ? 'text file'
        : 'file';
      const sizeLabel = a.size ? `, ${Math.round(a.size / 1024)} KB` : '';
      return `- ${a.filename} (${typeLabel}${sizeLabel})`;
    }).join('\n');

    const attachmentBlock = attachmentMeta
      ? `\n\nAvailable attachments (already provided — include each as an input with status "provided" in the plan):\n${attachmentMeta}`
      : '';

    let basePrompt: string;
    let title: string;

    if (item.execution_plan?.workflow_prompt) {
      const seed = item.execution_plan;
      title = item.work_title || seed.deliverable_description || 'Untitled workflow';
      basePrompt = seed.workflow_prompt;
    } else {
      // No execution plan (e.g. NOTED item, or "Open fresh" from non-executable item)
      // Build a prompt from the email source data so the user lands on a useful planning thread
      const subject = sd.subject || '(no subject)';
      const from = sd.from_name ? `${sd.from_name} <${sd.from}>` : (sd.from || 'Unknown');
      const bodySnippet = (sd.body || '').slice(0, 800);
      title = item.work_title || subject || 'Untitled workflow';
      basePrompt = `I received an email from ${from} with subject "${subject}".\n\n${bodySnippet ? `Email content:\n${bodySnippet}\n\n` : ''}Help me plan what to do with this.`;
    }

    const workflowPrompt = basePrompt + attachmentBlock;

    // Use service role client for writes that bypass RLS
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Create the work thread
    const { data: thread, error: threadError } = await adminClient
      .from('work_threads')
      .insert({
        user_id: user.id,
        title: title.substring(0, 200),
        plan: null,
        status: 'active',
      })
      .select('id')
      .single();

    if (threadError || !thread) {
      console.error('[OpenWorkflow] Failed to create thread:', threadError);
      return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 });
    }

    // Link inbox item to the new thread
    await supabase
      .from('inbox_items')
      .update({ work_thread_id: thread.id })
      .eq('id', itemId);

    // Pre-generate the plan server-side — load user context for personalization
    try {
      const [{ data: identityProfile }, { data: workPatternsProfile }] = await Promise.all([
        supabase
          .from('context_profiles')
          .select('profile_data')
          .eq('user_id', user.id)
          .eq('profile_type', 'identity')
          .single(),
        supabase
          .from('context_profiles')
          .select('profile_data')
          .eq('user_id', user.id)
          .eq('profile_type', 'work_patterns')
          .single(),
      ]);

      const identity = identityProfile?.profile_data;
      const workPatterns = workPatternsProfile?.profile_data;

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

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + userContextNote },
          { role: 'user', content: workflowPrompt },
        ],
        temperature: 0.4,
        max_tokens: 2500,
      });

      const fullResponse = completion.choices[0]?.message?.content || '';
      const { conversationalText, planRaw } = parsePlanResponse(fullResponse);

      // Seed work_messages with the user prompt and AI response
      await adminClient.from('work_messages').insert([
        { thread_id: thread.id, role: 'user', content: workflowPrompt },
        { thread_id: thread.id, role: 'assistant', content: conversationalText },
      ]);

      // Save the parsed plan
      if (planRaw && planRaw !== 'null') {
        try {
          const plan = JSON.parse(planRaw);
          await adminClient
            .from('work_threads')
            .update({ plan, updated_at: new Date().toISOString() })
            .eq('id', thread.id);

          // KB enrichment — workflowPrompt is already email-specific
          const { enrichPlanWithKB } = await import('@/lib/knowledge/enrich-plan-with-kb');
          await enrichPlanWithKB(user.id, plan, workflowPrompt, adminClient);
          await adminClient.from('work_threads').update({ plan }).eq('id', thread.id);
        } catch {
          // Plan parse failed — leave plan as null, user can still interact
        }
      }
    } catch (aiError) {
      // AI call failed — thread exists, user lands on blank planning view
      console.error('[OpenWorkflow] AI pre-generation failed:', aiError);
    }

    return NextResponse.json({ threadId: thread.id });
  } catch (error) {
    console.error('[OpenWorkflow] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
