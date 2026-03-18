import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { getMyCompany } from '@/lib/company/get-my-company';
import { buildProcessSystemPrompt, getTeamMembers, PLAN_SEPARATOR } from '@/lib/process/process-planning-ai';

/**
 * Extract the JSON plan portion from a model response.
 * Tries separator-based split first, then falls back to detecting
 * a JSON block that starts with { and contains "steps".
 */
function extractJsonFromResponse(text: string, separator: string): string | null {
  // Primary: separator-based
  const sepIdx = text.indexOf(separator);
  if (sepIdx !== -1) {
    const raw = text.slice(sepIdx + separator.length).trim();
    return raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim() || null;
  }

  // Fallback: find a JSON block containing "steps"
  const jsonMatch = text.match(/(\{[\s\S]*"steps"[\s\S]*\})\s*$/);
  if (jsonMatch) return jsonMatch[1].trim();

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const company = await getMyCompany(user.id, supabase);
    if (!company) return NextResponse.json({ error: 'No company' }, { status: 404 });

    const body = await request.json();
    const { message, processId, history = [] } = body as {
      message: string;
      processId?: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!message?.trim()) return NextResponse.json({ error: 'Message required' }, { status: 400 });

    const [{ client: aiClient, model: chatModel }, userContext, teamMembers] = await Promise.all([
      getAIClient(user.id, 'planning', supabase),
      buildUserContextBlock(user.id, supabase),
      getTeamMembers(company.id, supabase),
    ]);

    let systemPrompt: string;

    // If chatting from a live process — inject full process state, use assistant mode
    if (processId) {
      const { createClient: createAdminClient } = await import('@supabase/supabase-js');
      const adminClient = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const [{ data: proc }, { data: steps }] = await Promise.all([
        adminClient.from('processes').select('*').eq('id', processId).single(),
        adminClient.from('process_steps').select('*').eq('process_id', processId).order('step_index'),
      ]);

      const stepLines = (steps ?? []).map((s: any) => {
        const assignee = teamMembers.find(m => m.id === s.assignee_id);
        const name = assignee?.full_name ?? s.department ?? 'Unassigned';
        const inputSummary = s.input_data
          ? ` | Submitted: ${JSON.stringify(s.input_data).slice(0, 120)}`
          : '';
        return `  Step ${s.step_index + 1}: [${s.status.toUpperCase()}] ${s.title} — ${name}${s.estimated_days ? ` (~${s.estimated_days}d)` : ''}${inputSummary}`;
      }).join('\n');

      const processContext = proc ? [
        `PROCESS: ${proc.title}`,
        `STATUS: ${proc.status}`,
        `PROGRESS: step ${proc.current_step + 1}/${(steps ?? []).length}`,
        proc.due_date ? `DUE: ${new Date(proc.due_date).toLocaleDateString()}` : '',
        `\nSTEPS:\n${stepLines}`,
      ].filter(Boolean).join('\n') : '';

      const teamBlock = teamMembers.length > 0
        ? 'TEAM MEMBERS:\n' + teamMembers.map(m => {
            const lines = [`  ${m.full_name}`];
            lines.push(`    Company role: ${m.role}${m.department ? ` | Department: ${m.department}` : ''}`);
            if (m.job_role) lines.push(`    Job title: ${m.job_role}`);
            if (m.authority && m.authority !== 'unknown') lines.push(`    Authority: ${m.authority}`);
            if (m.responsibilities?.length) lines.push(`    Responsibilities: ${m.responsibilities.slice(0, 4).join(', ')}`);
            return lines.join('\n');
          }).join('\n\n')
        : '';

      systemPrompt = `You are an AI process assistant embedded in AUGMTD. You help team members understand and manage a specific running process.

${processContext}

${userContext ? `${userContext}\n` : ''}${teamBlock}

Answer questions about this process specifically — reference actual step names, assignees, and statuses. Identify blockers and suggest concrete next actions. Be concise (2-4 sentences) unless more detail is requested. Do NOT output a plan or ---PLAN_UPDATE---.`;
    } else {
      systemPrompt = buildProcessSystemPrompt(userContext, company.name, teamMembers);
    }

    const messages = [
      ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user' as const, content: message },
    ];

    const createParams = {
      model: chatModel,
      messages: [{ role: 'system' as const, content: systemPrompt }, ...messages],
      stream: true as const,
      max_tokens: 2000,
    };

    let stream;
    let attempts = 0;
    while (true) {
      try {
        stream = await aiClient.chat.completions.create(createParams);
        break;
      } catch (err: any) {
        const retryable = err?.status === 503 || err?.status === 429 || err?.status === 529;
        if (retryable && attempts < 2) {
          attempts++;
          await new Promise(r => setTimeout(r, 1000 * attempts));
        } else {
          throw err;
        }
      }
    }

    const encoder = new TextEncoder();
    let fullText = '';

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? '';
            if (delta) {
              fullText += delta;
              controller.enqueue(encoder.encode(delta));
            }
          }

          // After stream closes, extract and save plan if processId provided
          if (processId) {
            const jsonText = extractJsonFromResponse(fullText, PLAN_SEPARATOR);
            if (jsonText) {
              try {
                const plan = JSON.parse(jsonText);
                if (plan?.steps?.length) {
                  await supabase
                    .from('processes')
                    .update({ plan })
                    .eq('id', processId);
                }
              } catch {
                // parse failed — skip save
              }
            }
          }
        } catch (err) {
          const status = (err as any)?.status;
          if (status === 503 || status === 429 || status === 529) {
            controller.enqueue(encoder.encode('\n\n[AI temporarily unavailable, please try again]'));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    console.error('[processes/chat]', err);
    const isRetryable = err?.status === 503 || err?.status === 429 || err?.status === 529;
    const msg = isRetryable
      ? 'AI is temporarily unavailable — please try again in a moment.'
      : 'Something went wrong. Please try again.';
    // Return as a plain text stream so the client renders it in the chat bubble
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(msg));
        controller.close();
      },
    });
    return new Response(body, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
