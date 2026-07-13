// Cached calendar-initiative resolver — the single entry point for "what initiative is each meeting about".
// DETERMINISTIC first (topic-join by title / person-bridge — free, confident), then REASONED for the
// leftovers: events that fall to topic-new get a canonical initiative from one cached AI pass
// (classify-events.ts), so a calendar-driven user's cohorts/series cluster cleanly instead of fragmenting on
// noisy titles. Mirrors the outbound resolver. Recurring same-title events are deduped to one member.

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildInitiativeMap } from '@/lib/projects/initiative-resolver';
import { normalizeInitiative } from '@/lib/inbox/item-understanding';
import { computeEventUnderstanding } from './event-understanding';
import { classifyCalendarEvents, type CalendarEventForClassify } from './classify-events';

const CAL_VERSION = 1; // bump to force re-classification (prompt/model change)
const keyOf = (l: string | null | undefined): string | null => normalizeInitiative(l)?.replace(/\s+/g, '') || null;

export type ResolvedEvent = {
  id: string;
  title: string;
  initiative: string | null;
  initiativeKey: string | null;
  people: string[];
  startTime: string;
  createdAt: string | null; // when the event was INGESTED (not when it's scheduled) — the mute-revive signal
  projectId: string | null;
  recurring: boolean;
  via: string; // topic-join | person | reasoned
};

export async function resolveCalendarInitiatives(
  supabase: SupabaseClient,
  userId: string,
  todayStr: string,
): Promise<ResolvedEvent[]> {
  const [initMap, { data: prof }, { data: conns }, { data: events }] = await Promise.all([
    buildInitiativeMap(supabase, userId),
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(), // '*' so a missing calendar_cache column (pre-migration) degrades gracefully instead of erroring
    supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
    supabase.from('calendar_events').select('id, title, attendees, status, is_all_day, recurring_event_id, start_time, created_at, project_id').eq('user_id', userId).limit(400),
  ]);

  const addrSet = new Set<string>();
  if (prof?.email) addrSet.add(String(prof.email).toLowerCase());
  for (const c of (conns ?? []) as Array<Record<string, unknown>>) {
    const e = String(((c.metadata as { email?: string } | null)?.email) || (c.provider_account_id as string) || '').toLowerCase();
    if (e) addrSet.add(e);
  }
  const userAddresses = [...addrSet];

  type Work = { e: Record<string, unknown>; u: ReturnType<typeof computeEventUnderstanding> };
  const work: Work[] = [];
  for (const e of (events ?? []) as Array<Record<string, unknown>>) {
    const u = computeEventUnderstanding(e, userAddresses, initMap);
    if (u.isWork) work.push({ e, u });
  }

  // Needs reasoning = not confidently resolved (title didn't join, attendee didn't bridge).
  const needsReason = work.filter((w) => w.u.via !== 'topic-join' && w.u.via !== 'person');
  const sig = `v${CAL_VERSION}|` + needsReason.map((w) => `${w.e.id}:${String(w.e.title || '').slice(0, 40)}`).sort().join('|');

  let reasoned: Record<string, string | null> = {};
  const cache = (prof?.calendar_cache ?? null) as { sig?: string; labels?: Record<string, string | null> } | null;
  if (cache?.sig === sig && cache.labels) {
    reasoned = cache.labels;
  } else if (needsReason.length) {
    const forClassify: CalendarEventForClassify[] = needsReason.map((w) => ({ id: String(w.e.id), title: String(w.e.title || ''), attendees: w.u.people, recurring: !!w.e.recurring_event_id }));
    reasoned = Object.fromEntries(await classifyCalendarEvents(supabase, userId, forClassify));
    try { await supabase.from('profiles').update({ calendar_cache: { sig, labels: reasoned } }).eq('id', userId); } catch { /* non-fatal */ }
  }

  const out: ResolvedEvent[] = [];
  const seen = new Set<string>();
  for (const w of work) {
    const confident = w.u.via === 'topic-join' || w.u.via === 'person';
    const initiative = confident ? w.u.initiative : (reasoned[String(w.e.id)] ?? null);
    if (!initiative) continue;
    const k = keyOf(initiative);
    if (!k) continue;
    const dedupe = `${k}|${normalizeInitiative(String(w.e.title || '')) || ''}`; // collapse identical recurring instances
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      id: String(w.e.id), title: String(w.e.title || ''), initiative, initiativeKey: k,
      people: w.u.people, startTime: String(w.e.start_time || todayStr),
      createdAt: w.e.created_at ? String(w.e.created_at) : null,
      projectId: w.e.project_id ? String(w.e.project_id) : null, recurring: !!w.e.recurring_event_id,
      via: confident ? w.u.via : 'reasoned',
    });
  }
  return out;
}
