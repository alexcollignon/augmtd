// ═══ THE USER-CONTEXT LANE (the sovereign intake, Aug 14) ═══════════════════════════════════
// Durable facts the user STATES about themself in conversation land in USER-LEVEL memory —
// the `context_profiles` identity row every prompt renders as ABOUT YOU — never only in the
// interviewing coworker's private memory (Clara learning something Sofia never hears is the
// failure mode this module exists to prevent).
//
// THE POVERTY GATE: runs only where there is nothing to infer from — an email-off (sovereign)
// workspace, or an account with zero mail connections. A warm mailbox account is never
// interviewed and never re-extracted here (the mailbox bootstrap owns that); the gate also
// caps spend structurally (one classification-tier call per qualifying message).
//
// Conservative by construction: only facts the user STATED, never inferences; merge-only
// writes (existing knowledge is never clobbered); every failure swallows — this lane must
// never break a conversation.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';

const MIN_TEXT_CHARS = 40;
const MAX_TEXT_CHARS = 6000;

// THE ONE IDENTITY-NOTES WRITER lives in the memory ladder (W2.4): this lane is the INTERVIEW
// (the AI pass), and it files what it learns through the same merge every other rung uses.
import { mergeUserIdentity, type IdentityData } from '@/lib/memory/file-fact';

/** True when this account has nothing ambient to learn from (the gate). */
async function contextPoor(admin: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { getWorkspaceFeatures } = await import('@/lib/workspace/features');
    const feats = await getWorkspaceFeatures(userId, admin);
    if (feats.email === false) return true;
    const { count } = await admin.from('connections')
      .select('id', { count: 'exact', head: true }).eq('user_id', userId);
    return (count ?? 0) === 0;
  } catch { return false; } // gate failure → do nothing (never spend on uncertainty)
}

/** Extract user-stated durable facts from their own words and merge them into the identity
 *  context profile. `userTexts` = the user's OWN messages (never the assistant's). */
export async function extractUserContext(
  admin: SupabaseClient, userId: string, userTexts: string[],
): Promise<void> {
  try {
    const text = userTexts.map((t) => String(t ?? '').trim()).filter(Boolean).join('\n').slice(0, MAX_TEXT_CHARS);
    if (text.length < MIN_TEXT_CHARS) return;
    if (!(await contextPoor(admin, userId))) return;

    const { data: existing } = await admin.from('context_profiles')
      .select('profile_data').eq('user_id', userId).eq('profile_type', 'identity').maybeSingle();
    const cur = (existing?.profile_data ?? {}) as IdentityData;

    const { client, model, endpoint, tier } = await getAIClient(userId, 'classification', admin);
    const prompt = `You extract durable facts a person STATED about themself or their work from their own chat messages.

Extract ONLY what is explicitly stated — never infer, never embellish. Ignore one-off task requests ("draft an agenda") — those are work, not identity. Capture:
- role: their job/role IF they stated it (else null)
- responsibilities: what their work involves, as short phrases (only if stated)
- notes: other durable context about them, their team, company, market, clients, or constraints — one short factual line each

Already known (do NOT repeat these): role=${cur.role || 'unknown'}; responsibilities=${(cur.responsibilities ?? []).join('; ') || 'none'}; notes=${(cur.notes ?? []).slice(-6).join('; ') || 'none'}

Their messages:
"""
${text}
"""

Respond with ONLY JSON: {"role": string|null, "responsibilities": string[], "notes": string[]}
If nothing new and durable was stated, respond with exactly: NOTHING`;

    const result = await aiCreate(client, {
      model, messages: [{ role: 'user', content: prompt }], max_tokens: 300, temperature: 0.1,
    });
    logAIUsage(admin, {
      userId, source: 'memory_extraction', provider: endpoint.provider, model, tier,
      taskType: 'classification', usage: result.usage,
    }).catch(() => {});

    const raw = (result.choices?.[0]?.message?.content ?? '').trim();
    if (!raw || raw === 'NOTHING') return;
    // Bedrock models fence JSON — strip fences and slice to the outer object (house pattern).
    const jsonStr = raw.replace(/```(?:json)?/g, '').trim();
    const start = jsonStr.indexOf('{'); const end = jsonStr.lastIndexOf('}');
    if (start < 0 || end <= start) return;
    const parsed = JSON.parse(jsonStr.slice(start, end + 1)) as { role?: string | null; responsibilities?: string[]; notes?: string[] };

    // Fill-if-empty role, deduped + capped responsibilities/notes — the merge semantics are the
    // writer's (one implementation for every user-scope fact; W2.4).
    await mergeUserIdentity(admin, userId, {
      role: parsed.role ?? null, responsibilities: parsed.responsibilities ?? [], notes: parsed.notes ?? [],
    }, { source: 'intake' });
  } catch { /* the lane never breaks a conversation */ }
}

/** Thread flavor: pull the user's own recent messages from a DM thread and run the lane.
 *  Called beside the coworker-memory extraction — same seam, user-level store. */
export async function extractUserContextFromThread(
  admin: SupabaseClient, userId: string, threadId: string,
): Promise<void> {
  try {
    const { data: msgs } = await admin.from('work_messages')
      .select('role, content').eq('thread_id', threadId)
      .order('created_at', { ascending: false }).limit(12);
    const userTexts = (msgs ?? []).filter((m) => m.role === 'user').map((m) => String(m.content ?? '')).reverse();
    await extractUserContext(admin, userId, userTexts);
  } catch { /* swallow */ }
}
