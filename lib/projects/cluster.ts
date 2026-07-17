// Project suggestion — derived from the ONE active-initiatives source (getActiveInitiatives), so Projects
// and the Home "In motion" can never diverge. Grouping is already done there (deterministic clustering by
// the normalized initiative label reasoned once at ingest; same label → same project, distinct clients →
// distinct keys → NEVER merge, by construction). Here we just pick the active initiatives that aren't yet a
// project, biggest first, and add ONE small batch call to write a nice purpose sentence per group. Zero
// clustering AI calls; automated/no-reply items and one-offs are already excluded upstream.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveInitiatives, type InitiativeState, type ActiveInitiative } from './active-initiatives';
import { normalizeInitiative } from '@/lib/inbox/item-understanding';

const projectKey = (name: string): string => (normalizeInitiative(name)?.replace(/\s+/g, '') || name.toLowerCase().replace(/\s+/g, ''));

export type SuggestionItemRef = { table: 'inbox_items' | 'commitments' | 'calendar_events' | 'meeting_transcripts'; id: string; title: string; who: string | null };
// `outreach` = cold outbound recipients you're awaiting a reply from (no DB row to attach — the project,
// once created with this name, adopts them live via the spine's initiative match). Counts toward the
// ≥2 threshold so a pure-outreach campaign (e.g. a hiring round) surfaces as a suggestion on its own.
// `key`/`state` ride along from the spine so Projects can show the same state + deep-link by key as In-motion.
export type ProjectSuggestion = { key: string; name: string; purpose: string; state: InitiativeState; stateLabel: string; stakeholders: string[]; items: SuggestionItemRef[]; outreach: string[] };

export async function suggestProjects(supabase: SupabaseClient, userId: string, opts?: { fresh?: boolean }): Promise<ProjectSuggestion[]> {
  // ONE SOURCE — the active-initiatives spine (email + commitments + calendar + outbound, all reasoned), so
  // Projects and the Home "In motion" can never diverge. Suggestions = EVERY active initiative NOT yet a
  // project (projectId null), in the spine's action-first order.
  //
  // INSTANT by default: reuse the spine the Home ALREADY computed + cached in profiles.home_brief.
  // activeInitiatives (the perf-fold). That makes the Projects page load immediately instead of recomputing
  // the ~1–2.5s (cold: much more) getActiveInitiatives on every visit. `opts.fresh` (a manual refresh) forces
  // a live recompute. No purpose AI call — it was a cosmetic one-line description shown only on row-expand and
  // added real latency; dropped so the page is instant.
  const todayStr = new Date().toISOString().slice(0, 10);
  let inits: ActiveInitiative[] | null = null;
  if (!opts?.fresh) {
    try {
      const { data: prof } = await supabase.from('profiles').select('home_brief').eq('id', userId).maybeSingle();
      const cached = (prof?.home_brief as { activeInitiatives?: ActiveInitiative[] } | null)?.activeInitiatives;
      if (Array.isArray(cached) && cached.length) inits = cached;
    } catch { /* fall through to a fresh compute */ }
  }
  if (!inits) inits = await getActiveInitiatives(supabase, userId, todayStr);

  // Cross-check against the LIVE projects list — the spine may be served from a stale cache
  // (home_brief.activeInitiatives) where a just-tracked initiative still reads projectId=null, so an
  // already-tracked project would otherwise linger as a suggestion (the "duplicated as project AND suggested"
  // bug). Excluding by matching project-name key is cheap and self-correcting regardless of cache freshness.
  const { data: projRows } = await supabase.from('projects').select('name').eq('user_id', userId).eq('status', 'active');
  const trackedKeys = new Set((projRows ?? []).map((p) => projectKey(p.name as string)));

  const chosen = inits.filter((i) => !i.projectId && !trackedKeys.has(i.key)).slice(0, 40);
  return chosen.map((i) => ({
    key: i.key,
    name: i.label.slice(0, 80),
    purpose: '',
    state: i.state,
    stateLabel: i.stateLabel,
    stakeholders: i.stakeholders,
    items: i.members.map((m) => ({ table: m.table, id: m.id, title: m.title, who: m.who })),
    outreach: i.outreach,
  }));
}
