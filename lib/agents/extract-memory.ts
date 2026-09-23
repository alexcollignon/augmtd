import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fileFact, routeFactScope, resolveThreadEntity, MEMORY_TEXT_MAX, type FactScope,
} from '@/lib/memory/file-fact';

/** The extraction contract in force — bump on any change to the prompt or its schema. NOT a
 *  `*_VERSION` registry key on purpose: no cache is keyed on this extraction (every pass runs
 *  fresh over the thread and dedupes at the home), so there is no sig for it to invalidate. If a
 *  cache ever keys on it, it moves into lib/core/versions.ts as a real VERSION. */
export const MEMORY_EXTRACTION_SCHEMA = 'scoped-facts-v2';

/**
 * THE MEMORY LADDER (W2.4, Sep 22) — extract durable facts from a DM thread and file EACH ONE at
 * ITS scope through `fileFact`, THE ONE WRITER:
 *
 *   coworker_method → this coworker's memory (how to work for this user)
 *   user            → the identity row (who the user is)
 *   project         → the thread's RECOGNIZED entity (never guessed; no entity → the fact DROPS)
 *
 * Before: every "client/project detail" landed in the HEARER's memory_text — filed to whoever
 * heard it — and reached every thread that coworker has, other projects' rooms included (a
 * cross-project leak by the identity law). Nothing about a client is ever written here now.
 *
 * Shared by the extract-memory API route (native loop, cookie-authed) and the AgentOS bridge
 * (service context) — both runtimes ride the one path. Pass the service-role admin client; AI
 * client resolution only reads config, so the admin client is fine for `aiSupabase`.
 */
export async function extractAgentMemory(
  agentId: string,
  userId: string,
  threadId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  aiSupabase?: SupabaseClient,
): Promise<{ ok: true; updated: boolean; filed?: Partial<Record<FactScope, number>>; dropped?: number }> {
  const { data: agent } = await adminClient
    .from('custom_agents')
    .select('id, user_id, name, memory_text')
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

  const ordered = [...(messages as Array<{ role: string; content: string }>)].reverse();
  const conversation = ordered
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  const userTexts = ordered.filter((m) => m.role === 'user').map((m) => String(m.content ?? ''));

  // THE USER-CONTEXT LANE (Aug 14): the sovereign INTERVIEW — role/responsibilities on
  // context-poor accounts (poverty-gated inside). Its writes ride the same identity merge.
  void import('@/lib/context/intake-memory')
    .then(({ extractUserContext }) => extractUserContext(adminClient, userId, userTexts))
    .catch(() => {});

  // The coworker's METHOD memory — the only memory this extractor shows as "existing".
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

  // THE THREAD'S ENTITY — recognized by the same focus law the worker grounding reads (the
  // coworker's own name stripped as the envelope). Null = no known project: project facts drop.
  const entity = await resolveThreadEntity(adminClient, userId, userTexts, { excludeName: (agent as { name?: string | null }).name ?? null });

  const extractPrompt = `You are a memory extractor. Review this conversation and identify durable facts worth remembering for future sessions, and FILE EACH ONE AT ITS SCOPE.

Scopes — exactly one per fact:
- "coworker_method": how the assistant should WORK for this user — format, tone, length, channel, standing preferences ("always CC me", "keep it under 200 words", "no emojis", "use the formal register"). NEVER a fact about a client, a deal, a project or a person.
- "user": a durable fact about the USER themself — role, team, company, market, working constraints, personal style.
- "project": a fact about a client, a deal, a project, a counterparty, a date, a decision or a state of work${entity ? ` (this conversation is about the project "${entity.name}")` : ' (this conversation names no known project — project facts will be dropped, so include only what is clearly durable)'}.

Rules:
- Be extremely terse — one short factual line per fact, no elaboration.
- Only NEW information not already in the existing method memory.
- Never file a client/project detail as "coworker_method".
- One-off task requests ("draft an agenda") are work, not memory — skip them.
If there is nothing new worth remembering, respond with exactly: NO_UPDATE

EXISTING METHOD MEMORY (how this assistant works for this user):
${existingMemory || '(none yet)'}

CONVERSATION:
${conversation.slice(0, 6000)}

Respond with ONLY JSON: {"facts":[{"fact":"...","scope":"coworker_method|user|project"}]} (or NO_UPDATE):`;

  const { client: aiClient, model, endpoint, tier } = await getAIClient(userId, 'summarization', (aiSupabase ?? adminClient));

  const result = await aiCreate(aiClient, {
    model,
    messages: [{ role: 'user', content: extractPrompt }],
    max_tokens: 400,
    temperature: 0.2,
  });
  logAIUsage(adminClient, {
    userId, agentId, source: 'memory_extraction', provider: endpoint.provider, model, tier, taskType: 'summarization', usage: result.usage,
  }).catch(() => {});

  const extracted = (result.choices?.[0]?.message?.content ?? '').trim();
  if (!extracted || extracted === 'NO_UPDATE') return { ok: true, updated: false };

  const facts = parseFacts(extracted);
  if (!facts.length) return { ok: true, updated: false };

  // THE SCOPE ROUTE — code decides the home; the model only proposes. A project fact with no
  // recognized entity DROPS (never the coworker, never a guessed entity).
  const byScope: Record<FactScope, string[]> = { user: [], project: [], coworker_method: [] };
  let dropped = 0;
  for (const f of facts) {
    const scope = routeFactScope(f.scope, { entityId: entity?.id ?? null });
    if (scope === 'drop') { dropped++; continue; }
    byScope[scope].push(f.fact);
  }

  // THE HEAD-KEEP COMPRESSION: when the coworker memory overflows, only its TAIL (the newer,
  // less-settled lines) is compressed by AI; the head is never touched (fileFact enforces).
  const compressTail = async (tail: string, maxChars: number): Promise<string> => {
    const compressPrompt = `Compress these memory notes into the most important facts only. Max ${Math.max(200, maxChars - 100)} characters. Keep bullet format, be ruthless about what to cut:

${tail}`;
    const compressed = await aiCreate(aiClient, {
      model,
      messages: [{ role: 'user', content: compressPrompt }],
      max_tokens: Math.min(400, Math.ceil(MEMORY_TEXT_MAX / 3)),
      temperature: 0.1,
    });
    logAIUsage(adminClient, {
      userId, agentId, source: 'memory_extraction', provider: endpoint.provider, model, tier, taskType: 'summarization', usage: compressed.usage,
    }).catch(() => {});
    return (compressed.choices?.[0]?.message?.content ?? tail).trim();
  };

  const filed: Partial<Record<FactScope, number>> = {};
  const source = 'agent_memory_extraction';
  if (byScope.coworker_method.length) {
    const r = await fileFact(adminClient, userId, byScope.coworker_method, { scope: 'coworker_method', source, agentId, compressTail });
    filed.coworker_method = r.filed.length;
  }
  if (byScope.user.length) {
    const r = await fileFact(adminClient, userId, byScope.user, { scope: 'user', source });
    filed.user = r.filed.length;
  }
  if (byScope.project.length && entity) {
    const r = await fileFact(adminClient, userId, byScope.project, { scope: 'project', source, entityId: entity.id });
    filed.project = r.filed.length;
  }

  const updated = Object.values(filed).some((n) => (n ?? 0) > 0);
  return { ok: true, updated, filed, dropped };
}

/** Parse the extractor's JSON (fenced or bare). A legacy bullet list (no scopes) yields NOTHING —
 *  an unscoped fact has no home, and the coworker is never the default. */
export function parseFacts(raw: string): Array<{ fact: string; scope: string }> {
  const s = String(raw ?? '').replace(/```(?:json)?/g, '').trim();
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(s.slice(start, end + 1)) as { facts?: Array<{ fact?: unknown; scope?: unknown }> };
    return (parsed.facts ?? [])
      .map((f) => ({ fact: String(f?.fact ?? '').trim(), scope: String(f?.scope ?? '').trim() }))
      .filter((f) => f.fact);
  } catch { return []; }
}
