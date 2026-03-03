import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import OpenAI from 'openai';
import { SYSTEM_PROMPT, parsePlanResponse } from '@/lib/work/planning-ai';

// POST /api/work/saved-workflows/[id]/run
// Creates a new thread from a saved workflow with a pre-generated plan.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workflowId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load the saved workflow (ownership check via user_id)
    const { data: workflow, error: workflowError } = await supabase
      .from('saved_workflows')
      .select('id, name, prompt, deliverable_types, usage_count')
      .eq('id', workflowId)
      .eq('user_id', user.id)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    // Load user identity + work_patterns for personalized planning
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

    // Use service role client for writes
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Create the work thread linked to this saved workflow
    const { data: thread, error: threadError } = await adminClient
      .from('work_threads')
      .insert({
        user_id: user.id,
        title: workflow.name,
        plan: null,
        status: 'active',
        saved_workflow_id: workflow.id,
      })
      .select('id, title, plan, artifact, artifacts, status, auto_generated, saved_workflow_id, created_at, updated_at')
      .single();

    if (threadError || !thread) {
      console.error('[RunSavedWorkflow] Failed to create thread:', threadError);
      return NextResponse.json({ error: 'Failed to create workflow thread' }, { status: 500 });
    }

    // Generate plan from the saved prompt.
    // Append required output types so the AI doesn't drop generator steps during re-planning.
    const promptWithTypes = workflow.deliverable_types.length > 0
      ? `${workflow.prompt}\n\nRequired output formats: ${workflow.deliverable_types.join(', ')} — include one generator step for each.`
      : workflow.prompt;

    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + userContextNote },
          { role: 'user', content: promptWithTypes },
        ],
        temperature: 0.4,
        max_tokens: 2500,
      });

      const fullResponse = completion.choices[0]?.message?.content || '';
      const { conversationalText, planRaw } = parsePlanResponse(fullResponse);

      // Seed work_messages
      await adminClient.from('work_messages').insert([
        { thread_id: thread.id, role: 'user', content: workflow.prompt },
        { thread_id: thread.id, role: 'assistant', content: conversationalText },
      ]);

      // Save the parsed plan
      let savedPlan = null;
      if (planRaw && planRaw !== 'null') {
        try {
          savedPlan = JSON.parse(planRaw);
          await adminClient
            .from('work_threads')
            .update({ plan: savedPlan, updated_at: new Date().toISOString() })
            .eq('id', thread.id);
          thread.plan = savedPlan;
          thread.updated_at = new Date().toISOString();
        } catch {
          // Plan parse failed — thread exists, user can still interact
        }
      }

      // Increment usage_count and set last_used_at
      await adminClient
        .from('saved_workflows')
        .update({
          usage_count: (workflow.usage_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', workflow.id);

      const messages = [
        { id: `u-${Date.now()}`, role: 'user' as const, content: workflow.prompt, created_at: new Date().toISOString() },
        { id: `a-${Date.now()}`, role: 'assistant' as const, content: conversationalText, created_at: new Date().toISOString() },
      ];

      return NextResponse.json({ threadId: thread.id, thread, messages });
    } catch (aiError) {
      console.error('[RunSavedWorkflow] AI pre-generation failed:', aiError);
      // Return the bare thread — user lands on blank planning view
      return NextResponse.json({ threadId: thread.id, thread, messages: [] });
    }
  } catch (error) {
    console.error('[RunSavedWorkflow] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
