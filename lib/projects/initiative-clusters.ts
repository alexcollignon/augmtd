// The initiative CLUSTER map — "which initiatives are real (≥2 total items) and how big are they?" — shared
// so the Home (grouping/annotation) and the suggestion engine agree on what counts as a cluster. A cluster
// spans ALL of an initiative's correspondence (pending emails + commitments + confident calendar meetings),
// NOT just its actionable items, so a deal with 1 current action but 9 related threads still reads as a real
// initiative. Deterministic + cheap (no clustering AI): group by the normalized initiative key, exclude
// automated/bulk (not initiative material), dedupe recurring meetings. Mirrors cluster.ts's candidate rules.

import type { SupabaseClient } from '@supabase/supabase-js';
import { coerceUnderstanding, normalizeInitiative } from '@/lib/inbox/item-understanding';
import { isAutomatedSender } from '@/lib/inbox/automated';
import { buildInitiativeMap } from './initiative-resolver';
import { computeEventUnderstanding } from '@/lib/calendar/event-understanding';
import { fetchAllRows } from '@/lib/utils/fetch-all';

export type InitiativeCluster = { key: string; label: string; total: number };
export type ClusterMap = Map<string, InitiativeCluster>; // normalized key → cluster (only clusters with total ≥ 2)

const emailOf = (raw: string): string | null => String(raw || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
const keyOf = (label: string | null | undefined): string | null => normalizeInitiative(label)?.replace(/\s+/g, '') || null;

/** Resolve the normalized cluster key + display label for one actionable item's understanding. null = no initiative. */
export function itemClusterKey(understanding: { initiative?: string | null } | null): string | null {
  return understanding?.initiative ? keyOf(understanding.initiative) : null;
}

/**
 * Build the real-cluster map for a user. `includeCalendar` folds confident calendar meetings into the
 * totals (so a meeting-heavy deal clusters). Returns only clusters with total ≥ 2. Read-only.
 */
export async function buildInitiativeClusters(
  supabase: SupabaseClient,
  userId: string,
  opts: { includeCalendar?: boolean; outbound?: Array<{ initiative: string | null }> } = {},
): Promise<ClusterMap> {
  const counts = new Map<string, { label: string; n: number }>();
  const bump = (key: string, label: string) => {
    const g = counts.get(key) ?? { label, n: 0 };
    g.n++;
    if (label.length > g.label.length) g.label = label; // keep the fullest label for display
    counts.set(key, g);
  };

  const [inbox, { data: commits }] = await Promise.all([
    fetchAllRows<{ work_title: string | null; source_data: Record<string, unknown> }>((from, to) =>
      supabase.from('inbox_items').select('work_title, source_data')
        .eq('user_id', userId).eq('source', 'email').eq('status', 'pending')
        .order('created_at', { ascending: false }).range(from, to)),
    supabase.from('commitments').select('initiative')
      .eq('user_id', userId).in('status', ['open', 'pending']).not('initiative', 'is', null).limit(1000),
  ]);

  for (const it of inbox as Array<{ work_title: string | null; source_data: Record<string, unknown> }>) {
    const sd = it.source_data ?? {};
    const u = coerceUnderstanding(sd.understanding);
    if (!u?.initiative || u.bulk === true) continue;
    const from = emailOf(String((sd.from_address as string) || (sd.from as string) || ''));
    if (isAutomatedSender(from, (sd.from_name as string) || null, String(it.work_title || sd.subject || ''))) continue;
    const k = keyOf(u.initiative);
    if (k) bump(k, u.initiative);
  }
  for (const c of (commits ?? []) as Array<{ initiative: string | null }>) {
    const k = keyOf(c.initiative);
    if (k) bump(k, String(c.initiative));
  }

  if (opts.includeCalendar) {
    try {
      const [initMap, addrs] = await Promise.all([buildInitiativeMap(supabase, userId), userAddresses(supabase, userId)]);
      const { data: events, error } = await supabase.from('calendar_events')
        .select('id, title, attendees, status, is_all_day, recurring_event_id, start_time')
        .eq('user_id', userId).limit(400);
      if (error) throw error;
      const seen = new Set<string>();
      for (const e of (events ?? []) as Array<Record<string, unknown>>) {
        const u = computeEventUnderstanding(e, addrs, initMap);
        if (!u.isWork || !u.initiativeKey || (u.via !== 'topic-join' && u.via !== 'person')) continue;
        const dedupe = `${u.initiativeKey}|${normalizeInitiative(String(e.title || '')) || ''}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        bump(u.initiativeKey, u.initiative || u.initiativeKey);
      }
    } catch { /* pre-migration / error → totals just exclude calendar, still valid */ }
  }

  // Fold in OUTBOUND-awaiting initiatives (cold outreach) — a pure-outreach effort (a hiring round) counts
  // toward its cluster so it surfaces on the Home like any other active initiative.
  for (const o of opts.outbound ?? []) {
    const k = keyOf(o.initiative);
    if (k) bump(k, String(o.initiative));
  }

  const out: ClusterMap = new Map();
  for (const [key, g] of counts) if (g.n >= 2) out.set(key, { key, label: g.label, total: g.n });
  return out;
}

async function userAddresses(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const set = new Set<string>();
  const [{ data: prof }, { data: conns }] = await Promise.all([
    supabase.from('profiles').select('email').eq('id', userId).maybeSingle(),
    supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
  ]);
  if (prof?.email) set.add(String(prof.email).toLowerCase());
  for (const c of (conns ?? []) as Array<Record<string, unknown>>) {
    const e = String(((c.metadata as { email?: string } | null)?.email) || (c.provider_account_id as string) || '').toLowerCase();
    if (e) set.add(e);
  }
  return [...set];
}
