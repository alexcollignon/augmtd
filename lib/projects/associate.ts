// The project "magnet" — associate unclustered items to a project by matching the project's NAME against
// the `initiative` label already on each item (understanding for emails, the column for commitments). A
// project named "Galp" pulls in its Galp email even if it's the ONLY one (you declared the initiative —
// no ≥2 threshold needed), and NEW items whose initiative matches flow in automatically (a live magnet).
// Deterministic + cheap: no AI — pure normalized-label matching. ON DELETE SET NULL keeps this reversible.

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeInitiative, coerceUnderstanding } from '@/lib/inbox/item-understanding';

// A project key matches an item key. `strict` (the PASSIVE auto-attach, which moves items silently) only
// matches EXACT or when the item is a MORE-SPECIFIC extension ("Galp" → "Galp pilot"), never a looser
// reverse/mid-string overlap — so a silent move needs a confident match. `generous` (used only on
// EXPLICIT create, where you declared intent) also allows whole-token containment either direction.
// Guards against too-generic names (need ≥3 chars of signal).
export function initiativeKeyMatch(projKey: string | null, itemKey: string | null, strict = false): boolean {
  if (!projKey || !itemKey || projKey.length < 3) return false;
  if (projKey === itemKey) return true;
  if (strict) return itemKey.startsWith(`${projKey} `); // item is a more-specific instance of the project
  return ` ${itemKey} `.includes(` ${projKey} `) || ` ${projKey} `.includes(` ${itemKey} `);
}

/**
 * Attach every UNCLUSTERED item whose initiative matches one of `projects` (by name). Returns per-project
 * counts of newly-attached items. Idempotent: once attached (project_id set) an item is no longer
 * unclustered, so it's skipped next time. Non-fatal per project. `strict` (default true) is the
 * conservative passive magnet; pass false on explicit create for a more generous grab.
 */
export async function reconcileProjectMembership(
  supabase: SupabaseClient,
  userId: string,
  projects: Array<{ id: string; name: string }>,
  strict = true,
): Promise<Record<string, number>> {
  const keyed = projects.map((p) => ({ id: p.id, key: normalizeInitiative(p.name) })).filter((p) => p.key && p.key.length >= 3);
  if (!keyed.length) return {};

  const [{ data: inbox }, { data: commits }] = await Promise.all([
    supabase.from('inbox_items').select('id, source_data')
      .eq('user_id', userId).eq('source', 'email').eq('status', 'pending').is('project_id', null).limit(2000),
    supabase.from('commitments').select('id, initiative')
      .eq('user_id', userId).in('status', ['open', 'pending']).is('project_id', null).not('initiative', 'is', null).limit(500),
  ]);

  const attach = new Map<string, { inbox: string[]; commit: string[] }>();
  const bucket = (pid: string) => attach.get(pid) ?? attach.set(pid, { inbox: [], commit: [] }).get(pid)!;

  for (const it of (inbox ?? []) as Array<{ id: string; source_data: Record<string, unknown> }>) {
    const init = coerceUnderstanding((it.source_data ?? {}).understanding)?.initiative;
    if (!init) continue;
    const ik = normalizeInitiative(init);
    const m = keyed.find((p) => initiativeKeyMatch(p.key, ik, strict));
    if (m) bucket(m.id).inbox.push(it.id);
  }
  for (const c of (commits ?? []) as Array<{ id: string; initiative: string | null }>) {
    const ik = normalizeInitiative(c.initiative);
    const m = keyed.find((p) => initiativeKeyMatch(p.key, ik, strict));
    if (m) bucket(m.id).commit.push(c.id);
  }

  const counts: Record<string, number> = {};
  for (const [pid, ids] of attach) {
    try {
      if (ids.inbox.length) await supabase.from('inbox_items').update({ project_id: pid }).in('id', ids.inbox).eq('user_id', userId);
      if (ids.commit.length) await supabase.from('commitments').update({ project_id: pid }).in('id', ids.commit).eq('user_id', userId);
      counts[pid] = ids.inbox.length + ids.commit.length;
    } catch (e) { console.error('[associate] attach failed for', pid, (e as Error).message); }
  }
  return counts;
}
