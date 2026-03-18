import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { getSkillSystemPrompt, getSkillMaxTokens } from '@/lib/work/generate-pipeline';

export interface GeneratorArtifact {
  type: 'document' | 'email_draft';
  content: string;
  filename: string;
  generated_at: string;
}

function buildContextBrief(
  completedSteps: Array<{ title: string; input_label?: string | null; input_data: unknown }>
): string {
  if (!completedSteps.length) return 'No prior steps completed yet.';

  return completedSteps
    .filter(s => s.input_data != null)
    .map(s => {
      const data = s.input_data;
      let inputStr: string;

      if (typeof data === 'object' && data !== null) {
        const d = data as Record<string, unknown>;
        if ('text' in d) inputStr = String(d.text);
        else if ('approved' in d) inputStr = d.approved ? 'Approved' : 'Rejected';
        else if ('value' in d) inputStr = String(d.value);
        else if ('min' in d && 'max' in d) inputStr = `${d.min} – ${d.max}`;
        else inputStr = JSON.stringify(data, null, 2);
      } else {
        inputStr = String(data ?? '');
      }

      return `### ${s.title}${s.input_label ? `\n*Prompt: ${s.input_label}*` : ''}\n${inputStr}`;
    })
    .join('\n\n---\n\n');
}

async function fetchKBContext(
  query: string,
  companyId: string,
  userId: string,
  adminClient: unknown
): Promise<string> {
  try {
    // Get embedding for the query
    const { getAIClient: getClient } = await import('@/lib/ai/factory');
    const resolved = await getClient(userId, 'embeddings', adminClient as any);

    const embRes = await resolved.client.embeddings.create({
      model: resolved.model,
      input: query,
      ...(resolved.endpoint.provider === 'openai' ? { dimensions: 1024 } : {}),
    });
    const embedding = embRes.data[0]?.embedding;
    if (!embedding) return '';

    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const db = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: chunks } = await db.rpc('hybrid_search_knowledge', {
      p_company_id: companyId,
      p_query: query,
      p_embedding: embedding,
      p_match_count: 5,
    });

    if (!chunks?.length) return '';

    const context = (chunks as Array<{ content: string; heading?: string }>)
      .map(c => (c.heading ? `**${c.heading}**\n${c.content}` : c.content))
      .join('\n\n')
      .slice(0, 3000);

    return `KB CONTEXT:\n${context}`;
  } catch {
    return '';
  }
}

export async function runGeneratorStep(
  tool: string,
  step: { title: string; description?: string | null },
  completedSteps: Array<{ title: string; input_label?: string | null; input_data: unknown }>,
  userId: string,
  companyId?: string,
): Promise<GeneratorArtifact> {
  const { createClient: createAdminClient } = await import('@supabase/supabase-js');
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const resolved = await getAIClient(userId, 'generation', adminClient as any);
  const contextBrief = buildContextBrief(completedSteps);
  const isEmail = tool === 'generators__email_draft';

  // Skill-aware system prompt
  const skillPrompt = getSkillSystemPrompt(tool);
  const systemPrompt = skillPrompt ?? (isEmail
    ? `You are a professional business communication specialist. Write a complete, polished email using the context provided from completed workflow steps.

Output format (exactly):
SUBJECT: [subject line]

[full email body]

Be concise, professional, and specific to the context provided. Plain text only, no markdown.`
    : `You are a professional document writer embedded in a team workflow. Produce a complete, well-structured document using the context provided from completed workflow steps.

Use clear markdown formatting: ## headings, bullet points, **bold** for key terms, tables where data warrants it. Be thorough, professional, and directly address the task. Do not include meta-commentary — just the document.`);

  const maxTokens = getSkillMaxTokens(tool);

  // Optional KB retrieval
  const kbContext = companyId
    ? await fetchKBContext(`${step.title} ${step.description ?? ''}`.trim(), companyId, userId, adminClient)
    : '';

  const userPrompt = `TASK: ${step.title}${step.description ? `\n\n${step.description}` : ''}
${kbContext ? `\n${kbContext}\n` : ''}
CONTEXT FROM COMPLETED STEPS:
${contextBrief}

Produce the full ${isEmail ? 'email' : 'document'} now.`;

  const response = await aiCreate(resolved.client, {
    model: resolved.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.4,
  });

  const content = response.choices[0]?.message?.content ?? '(No content generated)';
  const slug = step.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);

  return {
    type: isEmail ? 'email_draft' : 'document',
    content,
    filename: isEmail ? `${slug}.txt` : `${slug}.md`,
    generated_at: new Date().toISOString(),
  };
}
