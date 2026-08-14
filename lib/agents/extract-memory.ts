import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import type { SupabaseClient } from '@supabase/supabase-js';

const MAX_MEMORY_CHARS = 2000;
const COMPRESS_THRESHOLD = 1800;

/**
 * Extract key facts from a thread's recent conversation and append them to the
 * agent's memory (custom_agents.memory_text for the owner, agent_memories for a
 * non-owner). Shared by the extract-memory API route (cookie-authed) and the
 * AgentOS bridge (service context) so both produce identical learning behavior.
 *
 * Pass the service-role admin client; AI client resolution only reads config, so
 * the admin client is fine for `aiSupabase`.
 */
export async function extractAgentMemory(
  agentId: string,
  userId: string,
  threadId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  aiSupabase?: SupabaseClient,
): Promise<{ ok: true; updated: boolean }> {
  const { data: agent } = await adminClient
    .from('custom_agents')
    .select('id, user_id, memory_text')
    .eq('id', agentId)
    .single();
  if (!agent) return { ok: true, updated: false };

  const isOwner = (agent as { user_id: string }).user_id === userId;

  const { data: messages } = await adminClient
    .from('work_messages')
    .select('role, content')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!messages?.length) return { ok: true, updated: false };

  const conversation = messages
    .reverse()
    .map((m: { role: string; content: string }) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  // THE USER-CONTEXT LANE (Aug 14): durable facts the user states about THEMSELF must reach
  // user-level memory (context_profiles identity → the ABOUT-YOU block every prompt reads),
  // never only this coworker's private memory. Self-gated (context-poor accounts only),
  // fire-and-forget — rides the same seam both runtimes already call.
  {
    const userTexts = (messages as Array<{ role: string; content: string }>)
      .filter((m) => m.role === 'user').map((m) => String(m.content ?? ''));
    void import('@/lib/context/intake-memory')
      .then(({ extractUserContext }) => extractUserContext(adminClient, userId, userTexts))
      .catch(() => {});
  }

  let existingMemory = '';
  if (isOwner) {
    existingMemory = (agent as { memory_text: string | null }).memory_text ?? '';
  } else {
    const { data: memRow } = await adminClient
      .from('agent_memories')
      .select('memory_text')
      .eq('agent_id', agentId)
      .eq('user_id', userId)
      .single();
    existingMemory = (memRow as { memory_text: string | null } | null)?.memory_text ?? '';
  }

  const extractPrompt = `You are a memory extractor. Review this conversation and identify key facts worth remembering for future sessions with this user.

Focus on: user preferences, decisions made, client/project details, constraints, personal style preferences.
Be extremely terse — one short bullet per fact, no elaboration.
Only add genuinely NEW information not already in the existing memory.
If there is nothing new worth remembering, respond with exactly: NO_UPDATE

EXISTING MEMORY:
${existingMemory || '(none yet)'}

CONVERSATION:
${conversation.slice(0, 6000)}

Respond with only new bullet points (or NO_UPDATE):`;

  const { client: aiClient, model, endpoint, tier } = await getAIClient(userId, 'summarization', (aiSupabase ?? adminClient));

  const result = await aiCreate(aiClient, {
    model,
    messages: [{ role: 'user', content: extractPrompt }],
    max_tokens: 300,
    temperature: 0.2,
  });
  logAIUsage(adminClient, {
    userId, agentId, source: 'memory_extraction', provider: endpoint.provider, model, tier, taskType: 'summarization', usage: result.usage,
  }).catch(() => {});

  const extracted = (result.choices?.[0]?.message?.content ?? '').trim();
  if (!extracted || extracted === 'NO_UPDATE') return { ok: true, updated: false };

  let newMemory = existingMemory ? `${existingMemory}\n${extracted}` : extracted;

  if (newMemory.length > COMPRESS_THRESHOLD) {
    const compressPrompt = `Compress these memory notes into the most important facts only. Max ${MAX_MEMORY_CHARS - 200} characters. Keep bullet format, be ruthless about what to cut:

${newMemory}`;
    const compressed = await aiCreate(aiClient, {
      model,
      messages: [{ role: 'user', content: compressPrompt }],
      max_tokens: 400,
      temperature: 0.1,
    });
    logAIUsage(adminClient, {
      userId, agentId, source: 'memory_extraction', provider: endpoint.provider, model, tier, taskType: 'summarization', usage: compressed.usage,
    }).catch(() => {});
    newMemory = (compressed.choices?.[0]?.message?.content ?? newMemory).trim();
  }

  if (isOwner) {
    await adminClient
      .from('custom_agents')
      .update({ memory_text: newMemory.slice(0, MAX_MEMORY_CHARS) })
      .eq('id', agentId);
  } else {
    await adminClient
      .from('agent_memories')
      .upsert({
        agent_id: agentId,
        user_id: userId,
        memory_text: newMemory.slice(0, MAX_MEMORY_CHARS),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent_id,user_id' });
  }

  return { ok: true, updated: true };
}
