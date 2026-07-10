// Project suggestion — DETERMINISTIC grouping by the `initiative` label the understanding already
// extracted per email (see lib/inbox/item-understanding.ts + email-processor computeUnderstanding). We
// do NOT re-cluster with AI: the categorization was done ONCE, at ingest, in a layer that already runs —
// here we just group by the normalized initiative key. Same label → same project; different clients
// (two different clients) → different keys → NEVER merge, by construction. Stable, explainable, and cheap
// (zero clustering AI calls; one small batch call only to write nice purpose sentences for the final
// groups). Automated/no-reply items and one-offs (no initiative) are excluded — not project material.

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeInitiative, coerceUnderstanding } from '@/lib/inbox/item-understanding';
import { isAutomatedSender } from '@/lib/inbox/automated';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

export type SuggestionItemRef = { table: 'inbox_items' | 'commitments'; id: string; title: string; who: string | null };
export type ProjectSuggestion = { name: string; purpose: string; stakeholders: string[]; items: SuggestionItemRef[] };
type Candidate = SuggestionItemRef & { initiative: string };

// Extract a clean person name from a raw `who` ("Jane Doe <j@example.com>" / "Jane (Acme)" → the name).
export function personName(who: string): string {
  return who.replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').replace(/["']/g, '').trim() || who.trim();
}

export async function suggestProjects(supabase: SupabaseClient, userId: string): Promise<ProjectSuggestion[]> {
  // Query candidates DIRECTLY (not via the actionable spine) — a project spans ALL of a deal's
  // correspondence, including `noted`/awareness threads you're only cc'd on. Any UNCLUSTERED pending
  // email carrying an initiative (from the understanding) + not automated is a candidate.
  const [{ data: inbox }, { data: commits }] = await Promise.all([
    supabase.from('inbox_items').select('id, work_title, source_data')
      .eq('user_id', userId).eq('source', 'email').eq('status', 'pending').is('project_id', null).limit(2000),
    supabase.from('commitments').select('id, description, counterparty, initiative')
      .eq('user_id', userId).in('status', ['open', 'pending']).is('project_id', null).not('initiative', 'is', null).limit(500),
  ]);

  const candidates: Candidate[] = [];
  for (const it of (inbox ?? []) as Array<{ id: string; work_title: string | null; source_data: Record<string, unknown> }>) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const u = coerceUnderstanding(sd.understanding);
    if (!u?.initiative) continue;
    const fromEmail = String((sd.from_address as string) || (sd.from as string) || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
    if (u.bulk === true || isAutomatedSender(fromEmail, (sd.from_name as string) || null, String(it.work_title || sd.subject || ''))) continue; // automated → not project material
    candidates.push({ table: 'inbox_items', id: it.id, title: String(it.work_title || sd.subject || 'Email'), who: (sd.from_name as string) || (sd.from as string) || null, initiative: u.initiative });
  }
  // Commitments carry their own initiative (Slice B) — a commitment-heavy deal groups its commitments too.
  for (const c of (commits ?? []) as Array<{ id: string; description: string | null; counterparty: string | null; initiative: string | null }>) {
    if (!c.initiative) continue;
    candidates.push({ table: 'commitments', id: c.id, title: String(c.description || 'Commitment'), who: c.counterparty, initiative: c.initiative });
  }

  // Group by the normalized initiative key. Track the most descriptive original label for display.
  const groups = new Map<string, { label: string; items: Candidate[]; seen: Set<string> }>();
  for (const w of candidates) {
    const key = normalizeInitiative(w.initiative);
    if (!key) continue;
    const g = groups.get(key) ?? { label: w.initiative, items: [], seen: new Set<string>() };
    // De-dupe near-identical items within an initiative (same sender + subject).
    const dk = `${(w.who || '').toLowerCase()}|${w.title.toLowerCase().slice(0, 60)}`;
    if (g.seen.has(dk)) continue;
    g.seen.add(dk);
    if (w.initiative.length > g.label.length) g.label = w.initiative; // prefer the fuller label
    g.items.push(w);
    groups.set(key, g);
  }

  // A project needs ≥2 items sharing an initiative. Biggest first; cap.
  const chosen = [...groups.values()].filter((g) => g.items.length >= 2).sort((a, b) => b.items.length - a.items.length).slice(0, 6);
  if (!chosen.length) return [];

  const suggestions: ProjectSuggestion[] = chosen.map((g) => {
    const stake = new Set<string>();
    for (const w of g.items) if (w.who) stake.add(personName(w.who));
    return { name: g.label.slice(0, 80), purpose: '', stakeholders: [...stake].slice(0, 6), items: g.items.map(({ table, id, title, who }) => ({ table, id, title, who })) };
  });

  // ONE small batch call to write a one-line purpose per final group (≤6). Optional — on failure the
  // cards still read fine (name + items). NOT a clustering call; grouping is already done.
  try {
    const { client, model } = await getAIClient(userId, 'classification', supabase);
    const listing = suggestions.map((s, i) => `${i + 1}. "${s.name}" — ${s.items.slice(0, 4).map((it) => it.title.slice(0, 50)).join('; ')}`).join('\n');
    const res = await aiCreate(client, {
      model, response_format: { type: 'json_object' as const }, max_tokens: 700, temperature: 0,
      messages: [{ role: 'user', content: `For each initiative below (a real deal/client/project and a few of its items), write ONE clear sentence describing what it is and its objective. Keep them distinct. Return ONLY JSON {"purposes":["...", "..."]} in the SAME order and count.\n\n${listing}` }],
    });
    const parsed = JSON.parse((res.choices?.[0]?.message?.content || '{}').replace(/```json/gi, '').replace(/```/g, '').trim());
    const purposes: string[] = Array.isArray(parsed.purposes) ? parsed.purposes : [];
    purposes.forEach((p, i) => { if (suggestions[i] && typeof p === 'string') suggestions[i].purpose = p.slice(0, 200); });
  } catch (e) { console.error('[cluster] purpose pass failed (non-fatal):', (e as Error).message); }

  return suggestions;
}
