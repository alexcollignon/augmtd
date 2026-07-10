// AI FALLBACK for the project magnet — used ONLY when deterministic name↔initiative matching found
// NOTHING on an explicit create. Handles the mismatch edge (a project named differently from how items
// were labeled, e.g. "the refinery client" vs items labeled "Galp"). One cheap classification-tier call
// over the DISTINCT unmatched initiative labels; attaches items whose label the model says refers to the
// same deal. Reasoning where deterministic fails — not on every match.

import type { SupabaseClient } from '@supabase/supabase-js';
import { coerceUnderstanding } from '@/lib/inbox/item-understanding';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

export async function aiMatchProjectName(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  projectName: string,
): Promise<number> {
  // Gather unclustered items + their initiative labels.
  const [{ data: inbox }, { data: commits }] = await Promise.all([
    supabase.from('inbox_items').select('id, source_data')
      .eq('user_id', userId).eq('source', 'email').eq('status', 'pending').is('project_id', null).limit(2000),
    supabase.from('commitments').select('id, initiative')
      .eq('user_id', userId).in('status', ['open', 'pending']).is('project_id', null).not('initiative', 'is', null).limit(500),
  ]);

  // label → item ids (grouped so we ask the model about each DISTINCT label once).
  const byLabel = new Map<string, { inbox: string[]; commit: string[] }>();
  const bucket = (l: string) => byLabel.get(l) ?? byLabel.set(l, { inbox: [], commit: [] }).get(l)!;
  for (const it of (inbox ?? []) as Array<{ id: string; source_data: Record<string, unknown> }>) {
    const init = coerceUnderstanding((it.source_data ?? {}).understanding)?.initiative;
    if (init) bucket(init).inbox.push(it.id);
  }
  for (const c of (commits ?? []) as Array<{ id: string; initiative: string | null }>) {
    if (c.initiative) bucket(c.initiative).commit.push(c.id);
  }
  const labels = [...byLabel.keys()];
  if (!labels.length) return 0;

  // ONE call: which of these labels refer to the SAME deal/client/project as the project name?
  let matched: string[] = [];
  try {
    const { client, model } = await getAIClient(userId, 'classification', supabase);
    const res = await aiCreate(client, {
      model, response_format: { type: 'json_object' as const }, max_tokens: 300, temperature: 0,
      messages: [{ role: 'user', content:
        `A user created a project named "${projectName}". Below are initiative labels on their unfiled items. Return ONLY the labels that refer to the SAME deal/client/project as "${projectName}" (a synonym, parent, or clearly the same thing). Be STRICT — do not include a label that's merely related or a different client. If none match, return an empty list.\n\nLabels:\n${labels.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nReturn ONLY JSON: {"matches":["<exact label>", ...]}` }],
    });
    const parsed = JSON.parse((res.choices?.[0]?.message?.content || '{}').replace(/```json/gi, '').replace(/```/g, '').trim());
    const set = new Set(labels);
    matched = (Array.isArray(parsed.matches) ? parsed.matches : []).map(String).filter((l: string) => set.has(l));
  } catch (e) { console.error('[ai-match] failed (non-fatal):', (e as Error).message); return 0; }

  // Attach the items under the matched labels.
  const inboxIds: string[] = [], commitIds: string[] = [];
  for (const l of matched) { const b = byLabel.get(l); if (b) { inboxIds.push(...b.inbox); commitIds.push(...b.commit); } }
  if (inboxIds.length) await supabase.from('inbox_items').update({ project_id: projectId }).in('id', inboxIds).eq('user_id', userId);
  if (commitIds.length) await supabase.from('commitments').update({ project_id: projectId }).in('id', commitIds).eq('user_id', userId);
  return inboxIds.length + commitIds.length;
}
