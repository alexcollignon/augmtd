// The project "magnet" — associate unclustered items to a project by matching the project's NAME against
// the `initiative` label already on each item (understanding for emails, the column for commitments). A
// a named project pulls in its matching email even if it's the ONLY one (you declared the initiative —
// no ≥2 threshold needed), and NEW items whose initiative matches flow in automatically (a live magnet).
// Deterministic + cheap: no AI — pure normalized-label matching. ON DELETE SET NULL keeps this reversible.

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeInitiative, coerceUnderstanding } from '@/lib/inbox/item-understanding';
import { buildInitiativeMap } from './initiative-resolver';
import { computeEventUnderstanding } from '@/lib/calendar/event-understanding';

// A project key matches an item key. `strict` (the PASSIVE auto-attach, which moves items silently) only
// matches EXACT or when the item is a MORE-SPECIFIC extension (a name → that name + a qualifier), never a looser
// reverse/mid-string overlap — so a silent move needs a confident match. `generous` (used only on
// EXPLICIT create, where you declared intent) also allows whole-token containment either direction.
// Guards against too-generic names (need ≥3 chars of signal).
export function initiativeKeyMatch(projKey: string | null, itemKey: string | null, strict = false): boolean {
  if (!projKey || !itemKey || projKey.length < 3) return false;
  if (projKey === itemKey) return true;
  // Despaced equality — identical token CONTENT modulo spacing (a spaced vs unspaced spelling of one name). This is a
  // strict, non-widening add (same content, just formatted differently), so a future variant attaches to
  // its project without ever merging distinct initiatives. Mirrors cluster.ts's despaced grouping key.
  if (projKey.replace(/\s+/g, '') === itemKey.replace(/\s+/g, '')) return true;
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

  // Only LOOSE, UNLOCKED atoms are eligible for auto-attach: project_id null (not already placed) AND NOT
  // project_locked (the user hasn't manually decided this one). project_locked lets a manual detach STICK.
  const [{ data: inbox }, { data: commits }] = await Promise.all([
    supabase.from('inbox_items').select('id, source_data')
      .eq('user_id', userId).eq('source', 'email').eq('status', 'pending').is('project_id', null).eq('project_locked', false).limit(2000),
    supabase.from('commitments').select('id, initiative')
      .eq('user_id', userId).in('status', ['open', 'pending']).is('project_id', null).eq('project_locked', false).not('initiative', 'is', null).limit(500),
  ]);

  const attach = new Map<string, { inbox: string[]; commit: string[]; cal: string[]; mtg: string[] }>();
  const bucket = (pid: string) => attach.get(pid) ?? attach.set(pid, { inbox: [], commit: [], cal: [], mtg: [] }).get(pid)!;

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

  // Calendar events (Phase 4) — a named project also adopts its MEETINGS. Resolved read-time (confident
  // topic-join / person-bridge only). Guarded so it's a no-op pre-migration (no project_id column).
  try {
    const initMap = await buildInitiativeMap(supabase, userId);
    const addrSet = new Set<string>();
    const [{ data: prof }, { data: conns }] = await Promise.all([
      supabase.from('profiles').select('email').eq('id', userId).maybeSingle(),
      supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
    ]);
    if (prof?.email) addrSet.add(String(prof.email).toLowerCase());
    for (const c of (conns ?? []) as Array<Record<string, unknown>>) {
      const e = String(((c.metadata as { email?: string } | null)?.email) || (c.provider_account_id as string) || '').toLowerCase();
      if (e) addrSet.add(e);
    }
    const userAddresses = [...addrSet];
    const { data: events, error: evErr } = await supabase.from('calendar_events')
      .select('id, title, attendees, status, is_all_day, recurring_event_id, start_time')
      .eq('user_id', userId).is('project_id', null).eq('project_locked', false).limit(400);
    if (evErr) throw evErr;
    for (const e of (events ?? []) as Array<Record<string, unknown>>) {
      const u = computeEventUnderstanding(e, userAddresses, initMap);
      if (!u.isWork || !u.initiative || (u.via !== 'topic-join' && u.via !== 'person')) continue;
      const ik = normalizeInitiative(u.initiative);
      const m = keyed.find((p) => initiativeKeyMatch(p.key, ik, strict));
      if (m) bucket(m.id).cal.push(String(e.id));
    }
  } catch (e) {
    console.warn('[associate] calendar adoption skipped (pre-migration or error):', (e as Error).message);
  }

  // Meetings (July 2026) — a named project also adopts its MEETINGS by the grounded `initiative` on the
  // transcript (stamped at insight time from the attendees), so the deal's notes become first-class project
  // context. Same initiative-match as everything else. Guarded → no-op pre-migration (column absent).
  try {
    const { data: mtgs } = await supabase.from('meeting_transcripts')
      .select('id, initiative').eq('user_id', userId).is('project_id', null).eq('project_locked', false).not('initiative', 'is', null).limit(500);
    for (const m of (mtgs ?? []) as Array<{ id: string; initiative: string | null }>) {
      const ik = normalizeInitiative(m.initiative);
      const proj = keyed.find((p) => initiativeKeyMatch(p.key, ik, strict));
      if (proj) bucket(proj.id).mtg.push(m.id);
    }
  } catch (e) {
    console.warn('[associate] meeting adoption skipped (pre-migration or error):', (e as Error).message);
  }

  const counts: Record<string, number> = {};
  for (const [pid, ids] of attach) {
    try {
      if (ids.inbox.length) await supabase.from('inbox_items').update({ project_id: pid }).in('id', ids.inbox).eq('user_id', userId);
      if (ids.commit.length) await supabase.from('commitments').update({ project_id: pid }).in('id', ids.commit).eq('user_id', userId);
      if (ids.cal.length) await supabase.from('calendar_events').update({ project_id: pid }).in('id', ids.cal).eq('user_id', userId);
      if (ids.mtg.length) {
        await supabase.from('meeting_transcripts').update({ project_id: pid }).in('id', ids.mtg).eq('user_id', userId);
        // Propagate to the indexed transcript's knowledge_file so project-scoped KB retrieval (a coworker /
        // AI working this project) surfaces the meeting notes as context. Link = provider_file_id transcript::<id>.
        await supabase.from('knowledge_files').update({ project_id: pid }).eq('user_id', userId).in('provider_file_id', ids.mtg.map((id) => `transcript::${id}`)).then(() => {}, () => {});
      }
      counts[pid] = ids.inbox.length + ids.commit.length + ids.cal.length + ids.mtg.length;
    } catch (e) { console.error('[associate] attach failed for', pid, (e as Error).message); }
  }
  return counts;
}
