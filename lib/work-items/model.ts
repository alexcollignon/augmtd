// The unified WORK-ITEM spine — a read-time normalizer that maps AUGMTD's scattered atoms (commitments,
// actionable inbox_items, meeting action items, coworker deliverables) into ONE shape. This is the single
// substrate the Timeline (Phase 2), Projects (Phase 3), and the Status board (Phase 4) all read — one
// spine, many lenses, so they can never drift. NO new table: the existing rows stay the source of truth;
// this just projects them. Cheap + synchronous over already-cheap queries; the timeframe bucket is
// deterministic (see timeframe.ts). AGNOSTIC to kind — every view treats a WorkItem uniformly.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getUnderstanding } from '@/lib/inbox/item-understanding';
import { isAutomatedSender } from '@/lib/inbox/automated';
import { buildInitiativeMap } from '@/lib/projects/initiative-resolver';
import { normalizeInitiative } from '@/lib/inbox/item-understanding';
import { computeEventUnderstanding } from '@/lib/calendar/event-understanding';
import { resolveOutboundAwaiting } from '@/lib/outbound/resolve';
import { reconcileRepliedItems } from '@/lib/inbox/reconcile-replied';
import { inferBucket, type TimeBucket } from './timeframe';

// 'event' = a scheduled calendar meeting — a dated CONTEXT point, never an action (no done/dismiss). It
// rides the same spine so the Timeline shows real meetings, and (Phase 4) projects see them as activity.
export type WorkItemKind = 'commitment' | 'reply' | 'action' | 'followup' | 'meeting' | 'deliverable' | 'event';
export type WorkItemState = 'todo' | 'waiting' | 'in_progress' | 'done' | 'dismissed';
export type WorkItemActor = 'you' | 'team' | 'system';
export type WorkItemSource = 'email' | 'meeting' | 'commitment' | 'deliverable';

export type WorkItem = {
  id: string;                 // stable, source-prefixed: 'commit:<id>' | 'inbox:<id>' | 'deliv:<id>'
  entityId: string;           // the raw row id (for actions / deep-dive)
  kind: WorkItemKind;
  title: string;
  who: string | null;         // counterparty / sender / coworker name
  actor: WorkItemActor;       // you own it · your team did/does it · a system notice
  state: WorkItemState;
  when: { explicit: string | null; bucket: TimeBucket };
  source: WorkItemSource;
  href: string;               // where a click opens (deep-dive / worker chat)
  at: string;                 // reference timestamp for ordering (explicit date || activity || created)
  startAt: string;            // ARRIVAL/creation timestamp — the Gantt bar START (the span is startAt →
                              // ganttDateOf(item): open-since-arrival until due/resolved/now)
  projectId: string | null;   // null until Phase 3 (auto-clustering)
  automated: boolean;         // an automated/no-reply/transactional item (security alert, billing notice,
                              // marketing) — a real task, but NOT project/initiative material.
  initiative: string | null;  // the deal/client/initiative this is about (from the understanding) —
                              // groups items into projects deterministically. null = one-off.
  effort: 'quick' | 'medium' | 'deep' | null; // rough effort to handle (from the understanding) — powers
                              // a "feels doable" cue on the Home. null = unknown.
};

const CONTENT_RULE = new Set(['needs_reply', 'to_do', 'waiting_on']);
const ACTION_WS = new Set(['work_prepared', 'decision_required', 'action_required']);

function ageDaysOf(iso: string | null, todayMs: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.round((todayMs - t) / 86_400_000));
}

export type BuildOpts = {
  todayStr: string;              // YYYY-MM-DD — caller controls "now"
  includeDoneWithinDays?: number; // history window for the timeline's left side (default 7)
  includeCalendar?: boolean;     // add scheduled calendar meetings as dated CONTEXT items (Timeline only)
  includeOutbound?: boolean;     // add cold outreach you're awaiting a reply to as 'followup' items (Timeline)
  skipReconcile?: boolean;       // skip the read-time reply reconcile (a purely-visual read path — e.g. the
                                 // Gantt — where the Home/board already heals; trims 2 queries + any writes)
};

// ganttDateOf lives in ./gantt-date (pure, client-safe) so the client Gantts can import it without
// dragging this server-only module's graph into the browser bundle. Re-exported here for server callers.
export { ganttDateOf } from './gantt-date';

/**
 * Build the unified WorkItem[] for a user from the live tables. Pending items get a future bucket;
 * recently-resolved items are included (state done/dismissed) so the timeline can show a short history.
 */
export async function buildWorkItems(
  supabase: SupabaseClient,
  userId: string,
  opts: BuildOpts,
): Promise<WorkItem[]> {
  const todayStr = opts.todayStr;
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  const doneSince = new Date(todayMs - (opts.includeDoneWithinDays ?? 7) * 86_400_000).toISOString();
  const items: WorkItem[] = [];

  // SELF-HEAL before we read: re-derive reply state from the actual threads and resolve any "reply
  // needed" item the user has already answered. Runs first so the queries below see the corrected status
  // (a just-resolved item lands in DONE, never lingers in TO DO). Non-fatal; a no-op when nothing changed.
  // Skipped on purely-visual read paths (the Gantt) where the Home/board already heals — keeps them fast.
  if (!opts.skipReconcile) await reconcileRepliedItems(supabase, userId);

  // ── Commitments (you_owe → todo · awaiting → waiting) ─────────────────────────────────────────────
  const [{ data: commits }, { data: inbox }, { data: threads }] = await Promise.all([
    supabase.from('commitments')
      // Active commitments use status 'open' (some legacy 'pending'); resolved = done/dismissed.
      .select('id, description, counterparty, direction, source, source_id, due_date, status, resolved_at, created_at, resolved_reason, project_id, initiative')
      .eq('user_id', userId)
      .or(`status.in.(open,pending),and(status.in.(done,dismissed),resolved_at.gte.${doneSince})`)
      .limit(500),
    supabase.from('inbox_items')
      .select('id, work_title, work_state, rule_type, type_override, source, source_data, status, created_at, last_activity_at, project_id')
      .eq('user_id', userId)
      .or(`and(status.eq.pending,or(work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on),source.eq.meeting)),and(status.in.(completed,dismissed),source_data->>resolved_at.gte.${doneSince})`)
      .limit(800),
    // Coworker deliverables — recent worker-thread artifacts (the "ready for you" pool), team-authored.
    supabase.from('work_threads')
      .select('id, agent_id, artifacts, updated_at, project_id, custom_agents!inner(id, name, is_worker)')
      .eq('user_id', userId)
      .eq('custom_agents.is_worker', true)
      .not('artifacts', 'is', null)
      .gte('updated_at', doneSince)
      .order('updated_at', { ascending: false })
      .limit(60),
  ]);

  // Commitments → work items.
  for (const c of (commits ?? []) as Array<Record<string, unknown>>) {
    const status = String(c.status || 'pending');
    const dir = String(c.direction || 'you_owe');
    const waiting = dir === 'awaiting';
    const state: WorkItemState = status === 'done' ? 'done' : status === 'dismissed' ? 'dismissed' : waiting ? 'waiting' : 'todo';
    const explicit = (c.due_date as string) || null;
    const at = explicit || (c.resolved_at as string) || (c.created_at as string) || todayStr;
    items.push({
      id: `commit:${c.id}`, entityId: String(c.id), kind: waiting ? 'followup' : 'commitment',
      title: String(c.description || 'Commitment'),
      who: (c.counterparty as string) || null,
      actor: 'you', state,
      when: { explicit, bucket: inferBucket({ explicit, waiting, ageDays: ageDaysOf((c.created_at as string) || null, todayMs), todayStr }) },
      source: 'commitment', href: '/', at, startAt: ((c.created_at as string) || at).slice(0, 10), projectId: (c.project_id as string) || null, automated: false, initiative: (c.initiative as string) || null, effort: null,
    });
  }

  // Inbox actionable items → work items (reply / action / followup / meeting).
  for (const it of (inbox ?? []) as Array<Record<string, unknown>>) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const status = String(it.status || 'pending');
    const ws = String(it.work_state || '');
    const ruleType = String(it.rule_type || '');
    const override = String(it.type_override || '');
    const u = getUnderstanding(it);
    const isMeeting = it.source === 'meeting';
    const isWaiting = override === 'waiting_on' || (!override && (ruleType === 'waiting_on' || ws === 'waiting'));
    const isReply = override === 'needs_reply' || (!override && (ruleType === 'needs_reply' || (u?.relevance === 'reply')));
    const kind: WorkItemKind = isMeeting ? 'meeting' : isWaiting ? 'followup' : isReply ? 'reply' : 'action';
    const state: WorkItemState = status === 'completed' ? 'done' : status === 'dismissed' ? 'dismissed' : isWaiting ? 'waiting' : 'todo';
    const activity = (it.last_activity_at as string) || (sd.received_at as string) || (it.created_at as string) || todayStr;
    // A REAL stated deadline (from the understanding) becomes the explicit date — so a "pay by Fri" item
    // gets a proper timeline placement + overdue detection, instead of being treated as undated.
    const explicit = (u?.deadline as string) || null;
    const subj = String(it.work_title || sd.subject || '');
    const fromEmail = String((sd.from_address as string) || (sd.from as string) || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
    const automated = isMeeting ? false : (isAutomatedSender(fromEmail, (sd.from_name as string) || null, subj) || u?.bulk === true);
    items.push({
      id: `inbox:${it.id}`, entityId: String(it.id), kind,
      title: String(it.work_title || sd.subject || 'Email'),
      who: (sd.from_name as string) || (sd.from as string) || null,
      actor: 'you', state,
      when: { explicit, bucket: inferBucket({ explicit, waiting: isWaiting, ageDays: ageDaysOf(activity, todayMs), todayStr, automated }) },
      source: isMeeting ? 'meeting' : 'email',
      href: isMeeting ? `/item/${it.id}?kind=meeting` : `/item/${it.id}`,
      at: (status === 'completed' && (sd.resolved_at as string)) ? (sd.resolved_at as string) : activity,
      startAt: String((sd.received_at as string) || (it.created_at as string) || activity).slice(0, 10),
      projectId: (it.project_id as string) || null, automated, initiative: (u?.initiative as string) || null,
      effort: (u?.effort as 'quick' | 'medium' | 'deep') || null,
    });
  }

  // Coworker deliverables → work items (team-authored, already produced = done, placed by recency).
  for (const t of (threads ?? []) as Array<Record<string, unknown>>) {
    const worker = (t.custom_agents as { name?: string } | null) || null;
    const arts = Array.isArray(t.artifacts) ? (t.artifacts as Array<{ id?: string; title?: string; generated_at?: string }>) : [];
    for (const a of arts) {
      if (!a.id) continue;
      const at = a.generated_at || (t.updated_at as string) || todayStr;
      items.push({
        id: `deliv:${a.id}`, entityId: String(a.id), kind: 'deliverable',
        title: String(a.title || 'Deliverable'),
        who: worker?.name || null,
        actor: 'team', state: 'done',
        when: { explicit: null, bucket: inferBucket({ explicit: null, waiting: false, ageDays: ageDaysOf(at, todayMs), todayStr }) },
        source: 'deliverable', href: t.agent_id ? `/workers?worker=${t.agent_id}` : '/workers',
        at, startAt: String(at).slice(0, 10), projectId: (t.project_id as string) || null, automated: false, initiative: null, effort: null,
      });
    }
  }

  // ── Calendar events → dated CONTEXT items (opt-in; Timeline only) ──────────────────────────────────
  // A scheduled meeting is context, NOT an action: kind 'event', no done/dismiss. Past events are marked
  // 'done' so they land in history (never falsely "overdue"); today/future keep their real time bucket.
  // The initiative is resolved deterministically (event-understanding) so a meeting carries its project
  // signal; project_id stays null until the magnet attaches it (Phase 3/4). Recurring instances are kept
  // as distinct dated occurrences (each is a real point on the timeline; clustering-dedupe is Phase 4).
  if (opts.includeCalendar) {
    const [{ data: prof }, { data: conns }, initMap] = await Promise.all([
      supabase.from('profiles').select('email').eq('id', userId).maybeSingle(),
      supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
      buildInitiativeMap(supabase, userId),
    ]);
    const addrSet = new Set<string>();
    if (prof?.email) addrSet.add(String(prof.email).toLowerCase());
    for (const c of (conns ?? []) as Array<Record<string, unknown>>) {
      const e = String(((c.metadata as { email?: string } | null)?.email) || (c.provider_account_id as string) || '').toLowerCase();
      if (e) addrSet.add(e);
    }
    const userAddresses = [...addrSet];

    const { data: events } = await supabase.from('calendar_events')
      .select('id, title, attendees, status, is_all_day, recurring_event_id, start_time, end_time')
      .eq('user_id', userId)
      .gte('start_time', new Date(todayMs - (opts.includeDoneWithinDays ?? 7) * 86_400_000).toISOString())
      .order('start_time', { ascending: true })
      .limit(200);

    for (const e of (events ?? []) as Array<Record<string, unknown>>) {
      const u = computeEventUnderstanding(e, userAddresses, initMap);
      if (!u.isWork) continue;
      const startIso = String(e.start_time || '');
      const startDate = startIso.slice(0, 10) || todayStr;
      const endMs = Date.parse(String(e.end_time || e.start_time || ''));
      const past = !Number.isNaN(endMs) && endMs < todayMs;
      items.push({
        id: `event:${e.id}`, entityId: String(e.id), kind: 'event',
        title: String(e.title || 'Meeting'),
        who: u.people[0] || null,
        actor: 'you',
        state: past ? 'done' : 'todo',
        when: { explicit: startDate, bucket: inferBucket({ explicit: startDate, waiting: false, ageDays: 0, todayStr }) },
        source: 'meeting', href: '/meetings',
        at: startIso || todayStr,
        startAt: startDate,
        projectId: null, automated: false, initiative: u.initiative, effort: null,
      });
    }
  }

  // ── Outbound-awaiting → 'followup' items ("waiting on them"; opt-in; Timeline) ────────────────────
  // Cold outreach you sent that got no reply — invisible today (no inbox_item). Reasoned {awaiting,
  // initiative} (cached). Undated → a waiting bucket by age; carries its initiative so it clusters. No
  // deep-dive target (the thread lives in your mailbox), so it links to the inbox.
  if (opts.includeOutbound) {
    try {
      const outbound = await resolveOutboundAwaiting(supabase, userId, todayStr);
      for (const o of outbound) {
        items.push({
          id: `outbound:${o.recipient}`, entityId: o.recipient, kind: 'followup',
          title: o.subject || `Reached out to ${o.who || 'someone'}`,
          who: o.who, actor: 'you', state: 'waiting',
          when: { explicit: null, bucket: inferBucket({ explicit: null, waiting: true, ageDays: o.ageDays, todayStr }) },
          source: 'email', href: '/inbox', at: o.lastSentAt, startAt: String(o.lastSentAt).slice(0, 10),
          projectId: null, automated: false, initiative: o.initiative, effort: null,
        });
      }
    } catch (e) {
      console.warn('[spine] outbound skipped:', (e as Error).message);
    }
  }

  return items;
}

/** Convenience: split into the timeline's two sides — history (done/dismissed) vs upcoming (pending). */
export function partitionByTime(items: WorkItem[]): { history: WorkItem[]; upcoming: WorkItem[] } {
  const history: WorkItem[] = [];
  const upcoming: WorkItem[] = [];
  for (const w of items) (w.state === 'done' || w.state === 'dismissed' ? history : upcoming).push(w);
  history.sort((a, b) => b.at.localeCompare(a.at)); // most-recent first
  return { history, upcoming };
}
