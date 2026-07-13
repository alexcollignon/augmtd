// THE ONE SOURCE of "what am I working on" — a single active-initiatives builder that BOTH the Home
// "In motion" glance and the Projects lens read, so they can never diverge (the initiative-in-one-not-the-other
// class of bug). It clusters ALL of an initiative's touchpoints — pending emails (incl. awareness), open
// commitments, calendar meetings, and cold outreach — by the normalized initiative key, then enriches each
// with its STATE (action-needed / waiting / awareness), its actionable members, people, recency, and the
// accepted project id (if any). Deterministic clustering (reason-once-match-cheap); calendar + outbound
// resolution reuse the existing modules. Read-only.
//
// The locked model: "In motion" shows these by STATE (not a re-list of actions); "What needs you" shows the
// actions themselves. State is the action-vs-awareness signal — so a quiet initiative (an awareness
// email + a past meeting, nothing to do) still surfaces as `awareness`, and one with open work as `active`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { coerceUnderstanding, normalizeInitiative } from '@/lib/inbox/item-understanding';
import { isAutomatedSender } from '@/lib/inbox/automated';
import { resolveCalendarInitiatives } from '@/lib/calendar/resolve-events';
import { resolveOutboundAwaiting } from '@/lib/outbound/resolve';
import { fetchAllRows } from '@/lib/utils/fetch-all';
import { readMutedMap } from './muted-initiatives';

// Clean a display name from a raw `who` ("Jane <j@x>" / "Jane (Acme)" → "Jane"). Local copy to avoid a
// circular import with cluster.ts (which now derives from this module).
const personName = (who: string): string => {
  const base = who.replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').replace(/["']/g, '').trim() || who.trim();
  // A bare email (no display name) → prettify the localpart: "ella.cullen1@x" → "Ella Cullen". Agnostic
  // (no name list) — just splits on separators, drops digits, title-cases. Falls back to the localpart.
  const m = base.match(/^([^\s@]+)@[^\s@]+$/);
  if (!m) return base;
  const pretty = m[1].replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim()
    .split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ').trim();
  return pretty || m[1];
};

export type InitiativeState = 'needs_attention' | 'active' | 'waiting' | 'awareness';
export type InitiativeActionKind = 'reply' | 'action' | 'commitment' | 'followup';
export type InitiativeAction = {
  id: string;
  entityId: string;
  kind: InitiativeActionKind;
  title: string;
  who: string | null; // the counterparty — who you reply to / owe / are waiting on. Powers the tile's "next" line.
  href: string;
  dueDate?: string | null;
};
export type InitiativeMemberRef = { table: 'inbox_items' | 'commitments' | 'calendar_events'; id: string; title: string; who: string | null };
export type ActiveInitiative = {
  key: string;
  label: string;
  total: number;               // all member touchpoints (emails incl. awareness + commitments + meetings + outreach)
  state: InitiativeState;
  stateLabel: string;
  actions: InitiativeAction[]; // the ACTIONABLE members only
  actionCount: number;         // to-dos (reply/action/commitment you-owe)
  waitingCount: number;        // ball-in-their-court (waiting_on / outreach)
  meetings: number;
  lastActivityAt: string | null;
  projectId: string | null;
  stakeholders: string[];
  members: InitiativeMemberRef[]; // attachable DB rows (for accept-suggestion) — outreach has no row
  outreach: string[];             // cold-outreach recipients (no DB row; the project adopts them live)
};

const emailOf = (raw: string): string | null => String(raw || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
const keyOf = (label: string | null | undefined): string | null => normalizeInitiative(label)?.replace(/\s+/g, '') || null;
const ACTION_WS = new Set(['work_prepared', 'decision_required', 'action_required']);
const REPLY_RT = new Set(['needs_reply']);
const TODO_RT = new Set(['to_do']);
const WAIT_RT = new Set(['waiting_on']);

const STATE_LABEL: Record<InitiativeState, string> = {
  needs_attention: 'Needs attention',
  active: 'Active',
  waiting: 'Waiting',
  awareness: 'Awareness',
};

type Bucket = {
  label: string;
  memberRefs: InitiativeMemberRef[];
  outreach: string[];
  meetings: number;
  actions: InitiativeAction[];
  people: Set<string>;
  projectId: string | null;
  lastAt: string;        // freshest touchpoint incl. FUTURE calendar meetings — for display/sort
  lastArrivalAt: string; // freshest thing that ACTUALLY ARRIVED (email/commitment/outbound, NOT scheduled
                         // meetings) — the mute-revive signal, so a future meeting doesn't block a mute
};

export async function getActiveInitiatives(
  supabase: SupabaseClient,
  userId: string,
  todayStr: string,
): Promise<ActiveInitiative[]> {
  const [outbound, inbox, { data: commits }, muted] = await Promise.all([
    resolveOutboundAwaiting(supabase, userId, todayStr),
    fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase.from('inbox_items').select('id, work_title, rule_type, work_state, source, source_data, project_id')
        .eq('user_id', userId).eq('status', 'pending').order('created_at', { ascending: false }).range(from, to)),
    supabase.from('commitments').select('id, description, counterparty, initiative, direction, due_date, created_at, project_id')
      .eq('user_id', userId).in('status', ['open', 'pending']).limit(1000),
    readMutedMap(supabase, userId), // the persistent, revive-able "not relevant" set
  ]);

  const buckets = new Map<string, Bucket>();
  // `at` = the touchpoint's date for DISPLAY/sort (incl. future meeting start times). `arrivalAt` = when we
  // actually LEARNED of it (ingest/received time) — the mute-revive signal, so a pre-existing future meeting
  // (old createdAt) can't block a mute, but a newly-synced one (recent createdAt) revives it. Defaults to
  // `at` for things whose date IS their arrival (emails=received, outbound=sent); calendar passes createdAt.
  const bump = (key: string, label: string, at: string, arrivalAt: string | null = at): Bucket => {
    const b = buckets.get(key) ?? { label, memberRefs: [], outreach: [], meetings: 0, actions: [], people: new Set<string>(), projectId: null, lastAt: '', lastArrivalAt: '' };
    if (label.length > b.label.length) b.label = label;
    if (at > b.lastAt) b.lastAt = at;
    if (arrivalAt && arrivalAt > b.lastArrivalAt) b.lastArrivalAt = arrivalAt;
    buckets.set(key, b);
    return b;
  };

  // ── Emails (incl. awareness — they count toward the cluster, but aren't actions) ──
  for (const it of inbox as Array<Record<string, unknown>>) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const u = coerceUnderstanding(sd.understanding);
    if (!u?.initiative || u.bulk === true) continue;
    const from = emailOf(String((sd.from_address as string) || (sd.from as string) || ''));
    if (isAutomatedSender(from, (sd.from_name as string) || null, String(it.work_title || sd.subject || ''))) continue;
    const key = keyOf(u.initiative);
    if (!key) continue;
    const at = String((it as { last_activity_at?: string }).last_activity_at || (sd.received_at as string) || todayStr);
    const b = bump(key, u.initiative, at);
    b.memberRefs.push({ table: 'inbox_items', id: String(it.id), title: String(it.work_title || sd.subject || 'Email'), who: (sd.from_name as string) || (sd.from as string) || null });
    if ((sd.from_name as string) || (sd.from as string)) b.people.add(personName(String((sd.from_name as string) || (sd.from as string))));
    if (it.project_id && !b.projectId) b.projectId = String(it.project_id);
    // Is this an ACTION?
    const rt = String(it.rule_type || '');
    const ws = String(it.work_state || '');
    const isMeeting = it.source === 'meeting';
    const kind: InitiativeActionKind | null =
      REPLY_RT.has(rt) ? 'reply' : WAIT_RT.has(rt) ? 'followup' : (TODO_RT.has(rt) || ACTION_WS.has(ws)) ? 'action' : null;
    if (isMeeting) b.meetings++;
    if (kind) b.actions.push({ id: `inbox:${it.id}`, entityId: String(it.id), kind, title: String(it.work_title || sd.subject || 'Email'), who: personName(String((sd.from_name as string) || (sd.from as string) || '')) || null, href: `/item/${it.id}`, dueDate: (u.deadline as string) ?? null });
  }

  // ── Commitments ──
  for (const c of (commits ?? []) as unknown as Array<Record<string, unknown>>) {
    const key = keyOf(c.initiative as string);
    if (!key) continue;
    const at = String((c as { created_at?: string }).created_at || todayStr);
    const b = bump(key, String(c.initiative), at);
    b.memberRefs.push({ table: 'commitments', id: String(c.id), title: String(c.description || 'Commitment'), who: c.counterparty ? String(c.counterparty) : null });
    if (c.counterparty) b.people.add(personName(String(c.counterparty)));
    if (c.project_id && !b.projectId) b.projectId = String(c.project_id);
    const waiting = String(c.direction || 'you_owe') === 'awaiting';
    b.actions.push({ id: `commit:${c.id}`, entityId: String(c.id), kind: waiting ? 'followup' : 'commitment', title: String(c.description || 'Commitment'), who: c.counterparty ? personName(String(c.counterparty)) : null, href: `/item/${c.id}?kind=commitment`, dueDate: (c.due_date as string) ?? null });
  }

  // ── Calendar meetings (members + recency; NOT actions — meetings are context). Resolved via the shared
  // resolver: deterministic join first, then a cached REASONED canonical label for the leftovers — so a
  // calendar-driven user's cohorts/series cluster cleanly instead of fragmenting on noisy titles. ──
  try {
    const cal = await resolveCalendarInitiatives(supabase, userId, todayStr);
    for (const ev of cal) {
      if (!ev.initiativeKey) continue;
      // Display date = start time (may be future); arrival = when the event was INGESTED (createdAt), so a
      // pre-existing future meeting doesn't block a mute but a newly-synced one revives it.
      const b = bump(ev.initiativeKey, ev.initiative || ev.initiativeKey, ev.startTime, ev.createdAt);
      b.memberRefs.push({ table: 'calendar_events', id: ev.id, title: ev.title || 'Meeting', who: ev.people[0] || null });
      b.meetings++;
      if (ev.people[0]) b.people.add(personName(ev.people[0]));
      if (ev.projectId && !b.projectId) b.projectId = ev.projectId;
    }
  } catch (e) { console.warn('[active-initiatives] calendar skipped:', (e as Error).message); }

  // ── Outbound-awaiting (members + a waiting action) ──
  for (const o of outbound) {
    if (!o.initiative) continue;
    const key = keyOf(o.initiative);
    if (!key) continue;
    const b = bump(key, o.initiative, o.lastSentAt);
    if (!b.outreach.includes(o.recipient)) b.outreach.push(o.recipient);
    if (o.who) b.people.add(personName(o.who));
    b.actions.push({ id: `outbound:${o.recipient}`, entityId: o.recipient, kind: 'followup', title: o.subject || `Reached out to ${o.who || 'someone'}`, who: o.who ? personName(o.who) : null, href: '/inbox', dueDate: null });
  }

  // ── Keep real clusters (≥2 members), compute state, sort action-first ──
  const out: ActiveInitiative[] = [];
  for (const [key, b] of buckets) {
    const total = b.memberRefs.length + b.outreach.length;
    if (total < 2) continue;
    // Muted ("not relevant") → suppress the CLUSTER, but REVIVE it the moment something new ARRIVES
    // (email/commitment/outbound) post-dating the mute. Uses lastArrivalAt (NOT lastAt) so a pre-existing
    // future meeting can't keep it un-mutable. Cluster-only: the underlying items are untouched.
    const mutedAt = muted.get(key);
    if (mutedAt && (b.lastArrivalAt || '') <= mutedAt) continue;
    const overdue = b.actions.some((a) => a.dueDate && a.dueDate < todayStr);
    const toDos = b.actions.filter((a) => a.kind === 'reply' || a.kind === 'action' || a.kind === 'commitment').length;
    const waiting = b.actions.filter((a) => a.kind === 'followup').length;
    const state: InitiativeState = overdue ? 'needs_attention' : toDos > 0 ? 'active' : waiting > 0 ? 'waiting' : 'awareness';
    // Sort actions so actions[0] is the "next" the tile shows: overdue → due-soon → your to-dos (reply/
    // action/commitment) before waiting (followup). Deterministic, no AI.
    const actRank = (a: InitiativeAction): number => {
      if (a.dueDate && a.dueDate < todayStr) return 0;           // overdue
      const isToDo = a.kind === 'reply' || a.kind === 'action' || a.kind === 'commitment';
      if (a.dueDate) return isToDo ? 1 : 2;                       // dated (to-do before waiting)
      return isToDo ? 3 : 4;                                      // undated (to-do before waiting)
    };
    b.actions.sort((x, y) => actRank(x) - actRank(y) || (x.dueDate || '￿').localeCompare(y.dueDate || '￿'));
    out.push({
      key, label: b.label, total, state, stateLabel: STATE_LABEL[state],
      actions: b.actions, actionCount: toDos, waitingCount: waiting, meetings: b.meetings,
      lastActivityAt: b.lastAt || null, projectId: b.projectId, stakeholders: [...b.people].slice(0, 6),
      members: b.memberRefs, outreach: b.outreach,
    });
  }
  // Action-needed first (needs_attention > active > waiting > awareness), then by size, then recency.
  const rank: Record<InitiativeState, number> = { needs_attention: 0, active: 1, waiting: 2, awareness: 3 };
  out.sort((a, b) => rank[a.state] - rank[b.state] || b.total - a.total || (b.lastActivityAt || '').localeCompare(a.lastActivityAt || ''));
  return out;
}
