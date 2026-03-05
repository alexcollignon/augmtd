import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import OpenAI from 'openai';
import { SYSTEM_PROMPT, parsePlanResponse } from '@/lib/work/planning-ai';

// POST /api/work/saved-workflows/[id]/run
// Creates a new thread from a saved workflow with a pre-generated plan.
// Accepts optional inboxItemId to inject email context into the plan prompt.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workflowId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const inboxItemId: string | undefined = body.inboxItemId;

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

    // Optionally load inbox item source_data when running from an email
    let emailContextBlock = '';
    let attachmentMetaBlock = '';
    let inboxItem: { id: string; source_data: any } | null = null;

    if (inboxItemId) {
      const { data: fetchedItem } = await supabase
        .from('inbox_items')
        .select('id, source_data')
        .eq('id', inboxItemId)
        .eq('user_id', user.id)
        .single();

      if (fetchedItem) {
        inboxItem = fetchedItem;
        const sd = fetchedItem.source_data || {};

        // Build email body block (first 2000 chars)
        const rawBody = (sd.body || '').slice(0, 2000);
        const bodyTruncated = (sd.body || '').length > 2000 ? rawBody + '...' : rawBody;

        emailContextBlock = `\nEmail context:\nFrom: ${sd.from_name ? `${sd.from_name} <${sd.from}>` : (sd.from || 'Unknown')}\nSubject: ${sd.subject || '(no subject)'}\n\n${bodyTruncated}`;

        // Thread history (max 3, newest first, 500 chars each)
        const history: any[] = Array.isArray(sd.thread_history) ? sd.thread_history : [];
        if (history.length > 0) {
          const sorted = [...history]
            .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
            .slice(0, 3);
          const historyLines = sorted.map(entry => {
            const date = new Date(entry.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const snippet = (entry.snippet || '').slice(0, 500);
            return `[${date}] ${entry.from_name || entry.from || 'Unknown'}: ${snippet}`;
          });
          emailContextBlock += `\n\nThread history:\n${historyLines.join('\n')}`;
        }

        // Attachment metadata
        const attachments: any[] = Array.isArray(sd.attachments) ? sd.attachments : [];
        if (attachments.length > 0) {
          const formatSize = (bytes: number) => {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
          };
          const attLines = attachments.map(att => {
            const ext = (att.filename || '').split('.').pop()?.toUpperCase() || 'FILE';
            return `- ${att.filename} (${ext}, ${formatSize(att.size || 0)})`;
          });
          const filenameList = attachments.map(att => att.filename).join('", "');
          attachmentMetaBlock = `\n\nAvailable attachments (already provided):\n${attLines.join('\n')}\nGroup ALL these files into ONE single input in the plan with status "provided" and providedFilenames: ["${filenameList}"] — do NOT create a separate input per file.`;
        }
      }
    }

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

    // Link the inbox item to the new thread so generate/route picks up email attachments
    if (inboxItem) {
      await adminClient
        .from('inbox_items')
        .update({ work_thread_id: thread.id })
        .eq('id', inboxItem.id);
    }

    // Assemble prompt: workflow base + deliverable types + email context + attachments
    const typesHint = workflow.deliverable_types.length > 0
      ? `\n\nRequired output formats: ${workflow.deliverable_types.join(', ')} — include one generator step for each.`
      : '';

    const fullPrompt = `${workflow.prompt}${typesHint}${emailContextBlock}${attachmentMetaBlock}`;

    // Standalone: use a neutral seed so the saved prompt doesn't anchor the AI when the user replies.
    // Inbox: include the full prompt since email context is the real anchor.
    const userMessageContent = inboxItemId
      ? `${workflow.prompt}${typesHint}`
      : `Run workflow: ${workflow.name}${typesHint}`;

    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      let conversationalText: string;
      let savedPlan = null;

      if (!inboxItemId) {
        // Standalone run: no context available yet.
        // Generate only a conversational opener asking for context — no plan JSON.
        // The plan will be generated after the user's first reply via the messages route.
        const CONTEXT_PROMPT =
          `You are a work planning assistant. A user has triggered a saved workflow. ` +
          `Do NOT generate a plan yet — you do not have enough context for this specific run. ` +
          `Instead, write 1-2 sentences: briefly confirm what type of work you will produce, ` +
          `then ask for BOTH: (1) who this is for (recipient, client, audience) AND (2) what specifically it should cover (topic, subject, goal, key points). ` +
          `Combine both into one natural question — do not list them as bullet points. ` +
          `Be direct and conversational. No step breakdowns.`;

        const openerCompletion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: CONTEXT_PROMPT + userContextNote },
            { role: 'user', content: workflow.prompt },
          ],
          temperature: 0.5,
          max_tokens: 150,
        });
        conversationalText = openerCompletion.choices[0]?.message?.content?.trim() || '';
      } else {
        // Inbox run: email provides context — generate a full plan immediately.
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT + userContextNote },
            { role: 'user', content: fullPrompt },
          ],
          temperature: 0.4,
          max_tokens: 2500,
        });

        const fullResponse = completion.choices[0]?.message?.content || '';
        const parsed = parsePlanResponse(fullResponse);
        conversationalText = parsed.conversationalText;

        if (parsed.planRaw && parsed.planRaw !== 'null') {
          try {
            savedPlan = JSON.parse(parsed.planRaw);
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

        // KB enrichment — email provides specific per-run context
        if (savedPlan) {
          const { enrichPlanWithKB } = await import('@/lib/knowledge/enrich-plan-with-kb');
          const kbQuery = [emailContextBlock.slice(0, 800), workflow.prompt].filter(Boolean).join(' — ');
          await enrichPlanWithKB(user.id, savedPlan, kbQuery, adminClient);
          await adminClient.from('work_threads').update({ plan: savedPlan }).eq('id', thread.id);
          thread.plan = savedPlan;
        }
      }

      // Seed work_messages
      await adminClient.from('work_messages').insert([
        { thread_id: thread.id, role: 'user', content: userMessageContent },
        { thread_id: thread.id, role: 'assistant', content: conversationalText },
      ]);

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
        { id: `u-${Date.now()}`, role: 'user' as const, content: userMessageContent, created_at: new Date().toISOString() },
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
