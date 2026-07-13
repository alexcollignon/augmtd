// Project suggestion — derived from the ONE active-initiatives source (getActiveInitiatives), so Projects
// and the Home "In motion" can never diverge. Grouping is already done there (deterministic clustering by
// the normalized initiative label reasoned once at ingest; same label → same project, distinct clients →
// distinct keys → NEVER merge, by construction). Here we just pick the active initiatives that aren't yet a
// project, biggest first, and add ONE small batch call to write a nice purpose sentence per group. Zero
// clustering AI calls; automated/no-reply items and one-offs are already excluded upstream.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { getActiveInitiatives, type InitiativeState } from './active-initiatives';

export type SuggestionItemRef = { table: 'inbox_items' | 'commitments' | 'calendar_events'; id: string; title: string; who: string | null };
// `outreach` = cold outbound recipients you're awaiting a reply from (no DB row to attach — the project,
// once created with this name, adopts them live via the spine's initiative match). Counts toward the
// ≥2 threshold so a pure-outreach campaign (e.g. a hiring round) surfaces as a suggestion on its own.
// `key`/`state` ride along from the spine so Projects can show the same state + deep-link by key as In-motion.
export type ProjectSuggestion = { key: string; name: string; purpose: string; state: InitiativeState; stateLabel: string; stakeholders: string[]; items: SuggestionItemRef[]; outreach: string[] };

export async function suggestProjects(supabase: SupabaseClient, userId: string): Promise<ProjectSuggestion[]> {
  // ONE SOURCE — derive from getActiveInitiatives (email + commitments + calendar + outbound, all reasoned),
  // so Projects and the Home "In motion" can never diverge. Suggestions = EVERY active initiative NOT yet a
  // project (projectId null), biggest first — so Projects (accepted cards + these suggestions) reconciles
  // 1:1 with In-motion, no hard cap dropping initiatives. A high safety bound only guards pathological cases.
  const todayStr = new Date().toISOString().slice(0, 10);
  const inits = await getActiveInitiatives(supabase, userId, todayStr);
  // Keep the spine's action-first order (needs_attention → active → waiting → awareness, then size) — do NOT
  // re-sort by size, so the compact Projects list leads with what needs attention, mirroring In-motion.
  const chosen = inits.filter((i) => !i.projectId).slice(0, 40);
  if (!chosen.length) return [];

  const suggestions: ProjectSuggestion[] = chosen.map((i) => ({
    key: i.key,
    name: i.label.slice(0, 80),
    purpose: '',
    state: i.state,
    stateLabel: i.stateLabel,
    stakeholders: i.stakeholders,
    items: i.members.map((m) => ({ table: m.table, id: m.id, title: m.title, who: m.who })),
    outreach: i.outreach,
  }));

  // ONE small batch call to write a one-line purpose per final group. Optional — on failure the cards still
  // read fine (name + items). NOT a clustering call; grouping is already done. Token budget scales with the
  // (now uncapped) group count so many initiatives don't truncate the JSON.
  try {
    const { client, model } = await getAIClient(userId, 'classification', supabase);
    const listing = suggestions.map((s, i) => {
      const items = s.items.slice(0, 4).map((it) => it.title.slice(0, 50)).join('; ');
      const reach = s.outreach.length ? ` [+${s.outreach.length} outreach emails awaiting a reply]` : '';
      return `${i + 1}. "${s.name}" — ${items || '(outreach campaign)'}${reach}`;
    }).join('\n');
    const res = await aiCreate(client, {
      model, response_format: { type: 'json_object' as const }, max_tokens: Math.min(3000, suggestions.length * 60 + 300), temperature: 0,
      messages: [{ role: 'user', content: `For each initiative below (a real deal/client/project and a few of its items), write ONE clear sentence describing what it is and its objective. Keep them distinct. Return ONLY JSON {"purposes":["...", "..."]} in the SAME order and count.\n\n${listing}` }],
    });
    const parsed = JSON.parse((res.choices?.[0]?.message?.content || '{}').replace(/```json/gi, '').replace(/```/g, '').trim());
    const purposes: string[] = Array.isArray(parsed.purposes) ? parsed.purposes : [];
    purposes.forEach((p, i) => { if (suggestions[i] && typeof p === 'string') suggestions[i].purpose = p.slice(0, 200); });
  } catch (e) { console.error('[cluster] purpose pass failed (non-fatal):', (e as Error).message); }

  return suggestions;
}
