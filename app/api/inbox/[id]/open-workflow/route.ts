import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { SYSTEM_PROMPT, parsePlanResponse } from '@/lib/work/planning-ai';
import { clipForPrompt, EXCERPT_MARK, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

// POST /api/inbox/[id]/open-workflow
// Creates (or returns existing) work thread from an executable inbox item.
// Generates the plan server-side so the user lands on a pre-populated thread.
// Idempotent: returns the existing thread if work_thread_id is already set.
// Body: { prompt?: string } — optional user intent to use instead of AI-inferred workflow
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: itemId } = await params;
  let userPrompt: string | null = null;
  try {
    const body = await _request.json().catch(() => ({}));
    userPrompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : null;
  } catch {
    // no body
  }

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

    const subject = sd.subject || '(no subject)';
    const from = sd.from_name ? `${sd.from_name} <${sd.from}>` : (sd.from || 'Unknown');
    // THE EXCERPT LAW: the email rides clipped at a boundary and declares itself when clipped.
    const bodySnippet = clipForPrompt(sd.body || '', 2400);
    const clippedNote = bodySnippet.includes(EXCERPT_MARK) ? `\n(${EXCERPT_RULE})` : '';
    const emailContext = `Email from ${from}, subject: "${subject}".\n\n${bodySnippet ? `Content:\n${bodySnippet}${clippedNote}` : ''}`;

    if (userPrompt) {
      // User typed their own intent — use it as the primary goal, email as context
      title = userPrompt.substring(0, 120);
      basePrompt = `${userPrompt}\n\nContext — ${emailContext}`;
    } else if (item.execution_plan?.workflow_prompt) {
      const seed = item.execution_plan;
      title = item.work_title || seed.deliverable_description || 'Untitled workflow';
      basePrompt = seed.workflow_prompt;
    } else {
      // No execution plan (e.g. NOTED item, or "Open fresh" from non-executable item)
      title = item.work_title || subject || 'Untitled workflow';
      basePrompt = `I received an email from ${from} with subject "${subject}".\n\n${bodySnippet ? `Email content:\n${bodySnippet}${clippedNote}\n\n` : ''}Help me plan what to do with this.`;
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

      // W37 — THE PLAN'S FLOOR for an email-born plan (found by the build.open-workflow eval: a plan for
      // "a proposal by next Friday" carried "Q1 2025" and deadline null — the prompt had no date — folded
      // the missing day rates into a step that "calculates pricing", and left the user's own act (signing
      // an NDA) out of the plan). Route-local: the shared planning prompt is untouched.
      const { userTimezone, localNow } = await import('@/lib/utils/user-time');
      const tz = await userTimezone(supabase, user.id).catch(() => 'UTC');
      const fmt = (d: Date) => `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: tz })} ${d.toLocaleDateString('en-CA', { timeZone: tz })}`;
      const strip = Array.from({ length: 15 }, (_, i) => fmt(new Date(Date.now() + i * 864e5))).join(' · ');
      const planFloor = `\n\nTODAY: ${localNow(tz).pretty} (${tz}). The next days: ${strip}.\n` +
        `Resolve relative dates in the email ("next Friday", "by Thursday", "Q1") with the days above and set "deadline" (YYYY-MM-DD) when the email states one — take the weekday's date from that list, never compute it ("this <weekday>" = the coming one; "next <weekday>" = the one in the following week); say in the chat message which date you read it as; never write a year the email or today does not give.\n` +
        weekdayFacts(`${subject}\n${sd.body || ''}`, tz) +
        `An input's "examples" describe the KIND of thing needed, never a value: no example prices, rates, dates or quantities. No step or input may plan to use default, market or estimated figures in place of the user's own.\n` +
        `Figures the email does not give (prices, day rates, budgets, quantities) are an input with status "pending" for the user to provide — no step may calculate or invent them, and the chat message names what is still missing instead of saying everything is ready.\n` +
        `The plan's steps are what the system runs. An act only the user can do (sign, pay, approve, decide) is therefore NEVER a step: make it a pending input the user provides (e.g. "Signed NDA", type "file"; or type "approval" for a decision) and let the later steps use it; no step signs, pays or sends anything. If a relative date is ambiguous (e.g. "by Thursday" when today is Thursday), say so in the chat message.\n` +
        `Write the chat message in the user's own language (the language of their request; English when they gave none) — the email's language matters only for a reply drafted to its sender.`;
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

      const { client, model } = await getAIClient(user.id, 'planning', supabase);
      const completion = await aiCreate(client, {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + userContextNote + planFloor },
          { role: 'user', content: workflowPrompt },
        ],
        temperature: 0.4,
        max_tokens: 2500,
      });

      const fullResponse = completion.choices[0]?.message?.content || '';
      const { conversationalText, planRaw } = parsePlanResponse(fullResponse);

      // Seed work_messages — display a clean user message, not the raw context blob
      const displayMessage = userPrompt
        ? userPrompt
        : `Opened from email: "${subject}"`;

      await adminClient.from('work_messages').insert([
        { thread_id: thread.id, role: 'user', content: displayMessage },
        { thread_id: thread.id, role: 'assistant', content: conversationalText },
      ]);

      // Save the parsed plan
      if (planRaw && planRaw !== 'null') {
        try {
          const plan = JSON.parse(planRaw);
          // TIME TRUTH, in code: a deadline whose weekday is none of the weekdays the email names is a
          // miscomputed date — no deadline beats a false one (the chat message still carries the words).
          if (plan && typeof plan.deadline === 'string' && !deadlineFitsWeekdays(plan.deadline, `${subject}\n${sd.body || ''}`)) plan.deadline = null;
          // THE USER'S OWN ACTS ARE NEVER SYSTEM STEPS, in code (W37: three of three plans had the system
          // "apply the signature and produce the signed PDF"). A step whose action signs or pays becomes a
          // pending input the user provides; the plan waits for it.
          if (plan && Array.isArray(plan.steps)) {
            const acts = plan.steps.filter((st: { action?: string; tool?: string }) => !st?.tool && USER_ACT.test(String(st?.action ?? '')));
            if (acts.length) {
              plan.steps = plan.steps.filter((st: unknown) => !acts.includes(st)).map((st: Record<string, unknown>, i: number) => ({ ...st, number: i + 1 }));
              plan.inputs = Array.isArray(plan.inputs) ? plan.inputs : [];
              acts.forEach((st: { action?: string }, i: number) => plan.inputs.push({
                id: `input_user_act_${i + 1}`, name: String(st.action ?? '').replace(/\s+/g, ' ').trim().slice(0, 90), type: 'approval', status: 'pending', required: true,
                description: 'Only you can do this — the plan waits for it, and nothing is signed or paid by the system.',
              }));
            }
          }
          await adminClient
            .from('work_threads')
            .update({ plan, updated_at: new Date().toISOString() })
            .eq('id', thread.id);

          // Mark email-content inputs as provided — email body is already in planning context
          if (Array.isArray(plan.inputs)) {
            let inputsUpdated = false;
            for (const input of plan.inputs) {
              const text = `${input.name || ''} ${input.description || ''}`.toLowerCase();
              if (
                input.status !== 'provided' &&
                text.includes('email') &&
                (text.includes('content') || text.includes('body') || text.includes('context') || text.includes('information') || text.includes('thread'))
              ) {
                input.status = 'provided';
                inputsUpdated = true;
              }
            }
            if (inputsUpdated) {
              await adminClient.from('work_threads').update({ plan }).eq('id', thread.id);
            }
          }

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

const WEEKDAY_WORDS: Array<RegExp> = [
  /\b(sunday|domingo|sonntag|dimanche)\b/i,
  /\b(monday|segunda|montag|lundi|lunes)\b/i,
  /\b(tuesday|terça|terca|dienstag|mardi|martes)\b/i,
  /\b(wednesday|quarta|mittwoch|mercredi|miércoles|miercoles)\b/i,
  /\b(thursday|quinta|donnerstag|jeudi|jueves)\b/i,
  /\b(friday|sexta|freitag|vendredi|viernes)\b/i,
  /\b(saturday|sábado|sabado|samstag|samedi)\b/i,
];
/** A YYYY-MM-DD deadline fits the email when the email names no weekday, or names the deadline's own. */
function deadlineFitsWeekdays(deadline: string, text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return false;
  const named = WEEKDAY_WORDS.map((re, i) => (re.test(text) ? i : -1)).filter((i) => i >= 0);
  if (!named.length) return true;
  return named.includes(new Date(`${deadline}T12:00:00Z`).getUTCDay());
}

const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** THE NAMED WEEKDAYS, RESOLVED IN CODE (W37: a planning model wrote "next Friday" as a Thursday's date).
 *  For each weekday the email names: the coming date and the one a week later, as facts the plan picks
 *  from. Empty when the email names none. Pure apart from the clock. */
function weekdayFacts(text: string, tz: string, now: Date = new Date()): string {
  const named = WEEKDAY_WORDS.map((re, i) => (re.test(text) ? i : -1)).filter((i) => i >= 0);
  if (!named.length) return '';
  const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: tz });
  const todayDow = new Date(`${ymd(now)}T12:00:00Z`).getUTCDay();
  const lines = named.map((dow) => {
    const ahead = (dow - todayDow + 7) % 7;
    const first = new Date(now.getTime() + ahead * 864e5);
    const second = new Date(first.getTime() + 7 * 864e5);
    return ahead === 0
      ? `${WEEKDAY_EN[dow]}: TODAY is ${WEEKDAY_EN[dow]} (${ymd(first)}) — "by ${WEEKDAY_EN[dow]}" may mean today or ${ymd(second)}; say which you read`
      : `${WEEKDAY_EN[dow]}: this coming one ${ymd(first)}; the one after ${ymd(second)} ("next ${WEEKDAY_EN[dow]}" usually means ${ahead <= 1 ? ymd(second) : `${ymd(first)} or ${ymd(second)}`})`;
  });
  return `WEEKDAYS THE EMAIL NAMES, resolved (use these dates, never compute your own): ${lines.join('; ')}.\n`;
}

/** An action only the user can perform: signing or paying (en · pt · de · fr · es). */
const USER_ACT = /\b(apply|add|insert|affix|aplicar|anwenden|appliquer)\b[^.]{0,40}\bsignatur|\b(sign|e-?sign|countersign)\s+(the|it|and|this|a)\b|\bassinar\b|\bunterschreiben\b|\bsigner\b|\bfirmar\b|\b(pay|make)\s+(the\s+)?(invoice|payment|it)\b|\bpagar\b|\bbezahlen\b|\bpayer\b/i;
