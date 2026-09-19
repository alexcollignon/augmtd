// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DAY FRAME — the server derivation (docs/attention-plan.md, laws A4 · A5 · A6).
//
// The chat is the SPINE; the day is the FRAME around it. Two quiet zones beneath the whispers:
//   • TODAY     — the remaining calendar day, with the prep state the anticipation lane REALLY holds.
//   • IN MOTION — who is moving on my behalf right now.
//
// THREE LAWS, ENFORCED HERE AND ONLY HERE (never by the client — a client-side gate is a zone that
// exists and is being hidden, which is exactly what A5 outlaws):
//
//   A4 · A ZONE EARNS ITS SEAT. A zone is PRESENT IN THE PAYLOAD ONLY IF IT HAS SOMETHING TRUE TO
//        SAY. An empty calendar day means no `today` key at all — never an empty array, never
//        "No meetings today". Absence is the render.
//
//   A5 · THE FEATURE LADDER, three states per organ:
//        1. Feature OFF (the superadmin sits above everything) → the zone KEY IS ABSENT. No empty
//           object, no upsell hint, no vocabulary. The sovereign copy law, extended to every zone.
//        2. ON but not connected → ALSO ABSENT from this payload. The one-time connect offer is the
//           CoS's own voice in the thread; it is not this route's job and is not built here.
//        3. Connected with nothing true today → still absent (that is A4 again).
//        Only connected-with-content earns the render.
//
//   A6 · IN MOTION IS STATE, NEVER EVENTS. The zone answers one question — who is moving on my
//        behalf right now. Deliveries, coworker messages and notifications DO NOT ENTER: they
//        arrive in the thread as message-grammar cards. The single permitted arrival reference is
//        the quiet `delivered` tail pointer (A6's own "at most" clause), which is a POINTER — a
//        count and a door — never a row, never a list of what landed.
//
// ZERO AI. Every word here is derived from rows that already exist: calendar_events, the
// anticipation lane's own fire records, workflow_runs, workflows.next_run_at, custom_agents.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { anchorsForEvent, readDayAnchors, type DayAnchor } from '@/lib/home/day-anchors';
import { localNow, userTimezone } from '@/lib/utils/user-time';
import { parkedGateOf, GATE_WORDS, type GateKind } from '@/lib/workflows/process-state';
import type { WorkflowStep } from '@/lib/workflows/types';
import type { WorkspaceFeatures } from '@/lib/workspace/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

// ── THE ORGAN → FEATURE BINDING, stated once ────────────────────────────────────────────────────
// A5's "organ" is a workspace feature key. Named here so the ladder is one line to re-point, and so
// a reader can see WHICH flag silences WHICH zone without reading the derivation.
//
// ⚠️ NOTE FOR THE OWNER (reported, not decided here): `DEFAULT_FEATURES.meetings` is FALSE
// platform-wide (the bot infrastructure's flag), while calendar sync runs off any active
// gmail/outlook connection regardless. So gating Today on `meetings` means most workspaces get no
// Today zone even with a full calendar. That is the instruction's ladder, faithfully applied — if
// the calendar deserves its own organ, it is this constant plus a key in WorkspaceFeatures.
export const TODAY_ZONE_FEATURE = 'meetings' as const;
export const IN_MOTION_ZONE_FEATURE = 'studio' as const;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SERVED SHAPE
// ════════════════════════════════════════════════════════════════════════════════════════════════

export interface DayEvent {
  id: string;
  /** HH:MM in the USER'S OWN zone — the one clock law (lib/utils/user-time). '' for all-day. */
  time: string;
  allDay: boolean;
  /** The "tomorrow starts at 09:30" tail: the day is spent, so the frame points at the next one. */
  tomorrow: boolean;
  title: string;
  /** Counterpart display names (the user themself never appears in their own meeting's names). */
  with: string[];
  /** 'ready' ONLY when the anticipation lane actually wrote a prep for THIS start time. */
  prep: 'ready' | null;
  /** The room the prep landed in, when there is one — the prep's own door. */
  href: string | null;
  startIso: string;
  /** THE DAY ANCHOR (Sep 18): the served needs-you rows whose seat CAME FROM this meeting — the
   *  things these people will raise. Handed over by the attention layer (lib/home/day-anchors),
   *  never re-derived here: this is the Home's own served set, filed under its event. Absent when
   *  the meeting raises nothing, so the line renders exactly as it always did. */
  raised?: Array<{ itemId: string; title: string; whyNow: string; href: string }>;
}

export type InMotionKind = 'running' | 'waiting' | 'scheduled';

export interface InMotionRow {
  id: string;
  kind: InMotionKind;
  /** The work's name — the workflow, never the step. */
  name: string;
  /** The muted state words. A STATE, never an event ("running · step 3 of 9", "waiting for your
   *  approval", "runs at 08:00 tomorrow"). */
  state: string;
  /** A6: EVERY row leads with its OWNER's face — the author-on-speech law reaching the day frame.
   *  `name` is what WorkerFace renders (a seeded coworker's headshot, anyone else's initial chip). */
  owner: { name: string; role: string | null } | null;
  href: string;
}

/** A6's one permitted arrival reference: a POINTER, not a row. */
export interface DeliveredPointer { count: number; href: string }

export interface DayFrame {
  today?: { events: DayEvent[] };
  inMotion?: { rows: InMotionRow[]; delivered?: DeliveredPointer };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PURE DERIVATIONS — exported so the gate can assert the laws on the functions that own them,
// never on a rendered page.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type RawEvent = {
  id: string;
  title: string | null;
  start_time: string;
  end_time: string | null;
  is_all_day: boolean | null;
  attendees: unknown;
  status: string | null;
};

/** A calendar-CANCELLATION row whose title is the raw provider string is not an upcoming meeting
 *  even when its status still reads 'confirmed'. These ARE the literal provider-generated titles,
 *  so a small prefix list is the right tool (the same list the Home brief carries). */
export function isCancelledEventTitle(title: string | null | undefined): boolean {
  const t = (title || '').trimStart().toLowerCase();
  return t.startsWith('canceled event:') || t.startsWith('cancelled event:') ||
    t.startsWith('canceled:') || t.startsWith('cancelled:');
}

export function clipTitle(s: string | null | undefined, max = 64): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/[\s,;:–—-]+$/, '')}…`;
}

/** An attendee's human name: their stated name, else a humanised localpart. Never an email. */
export function attendeeDisplayName(a: unknown): string | null {
  const o = (a && typeof a === 'object') ? a as Record<string, unknown> : null;
  if (!o) return null;
  const name = String(o.name ?? '').trim();
  if (name && !name.includes('@')) return name.slice(0, 40);
  const email = String(o.email ?? '').trim().toLowerCase();
  if (!email.includes('@')) return null;
  const local = email.split('@')[0].replace(/[._+-]+/g, ' ').trim();
  if (!local) return null;
  return local.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, 40);
}

/**
 * Who this meeting is WITH — the user is never a counterpart in their own meeting; a room resource
 * is not a person. Capped, because a 40-attendee all-hands is a title, not a facepile.
 *
 * THE SUBSUMED-NAME RULE (found live on the reference account: one person on the invite twice, once
 * with a full display name and once as a bare address whose localpart humanised to their first
 * name, so the row read "Jordan Lee, Jordan"). A single-token name that IS the first token of a
 * fuller kept name is the same person written shorter — it is dropped. Two genuinely different
 * people sharing a first name both keep their own rendering, because the fuller one wins and the
 * bare one only ever loses to a name it is a prefix of.
 */
export function counterpartsOf(attendees: unknown, selfEmail: string | null, max = 3): string[] {
  const list = Array.isArray(attendees) ? attendees : [];
  const self = (selfEmail ?? '').toLowerCase();
  const names: string[] = [];
  const seenEmail = new Set<string>();
  const seenName = new Set<string>();
  for (const a of list) {
    const o = (a && typeof a === 'object') ? a as Record<string, unknown> : null;
    const email = String(o?.email ?? '').toLowerCase();
    if (email && email === self) continue;
    if (/resource\.calendar\.google\.com$/.test(email)) continue;
    if (email && seenEmail.has(email)) continue;
    if (email) seenEmail.add(email);
    const name = attendeeDisplayName(a);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenName.has(key)) continue;
    seenName.add(key);
    names.push(name);
  }
  // Fuller renderings first, so a bare first name can be recognised as subsumed by one of them.
  const ordered = [...names].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const n of ordered) {
    const solo = !n.includes(' ');
    if (solo && kept.some((k) => k.toLowerCase().split(' ')[0] === n.toLowerCase())) continue;
    kept.push(n);
  }
  // Back to the invite's own order — the list is a fact about the meeting, not a ranking.
  return names.filter((n) => kept.includes(n)).slice(0, max);
}

/** HH:MM in the user's own zone. ONE CLOCK PER SURFACE (the anticipation lane's law) — the row's
 *  label and any prompt that ever quotes it read the SAME resolved value. */
export function localTimeLabel(startIso: string, tz: string): string {
  return localNow(tz, new Date(startIso)).hhmm;
}

/**
 * THE DAY'S WINDOW (A4). Which events the frame may speak about:
 *   • what is LEFT of the user's local day — an event still in progress counts (it is what is
 *     happening), an event already over does not (the day frame is a glance forward),
 *   • and, when the day holds nothing more, the NEXT day's FIRST event as the tail
 *     ("tomorrow starts at 09:30"), because a spent day still has a true thing to say.
 * Nothing else. An empty result is how the zone comes to be absent.
 */
export function selectDayEvents(
  events: RawEvent[], tz: string, now: Date, selfEmail: string | null,
): Array<RawEvent & { tomorrow: boolean }> {
  const todayStr = localNow(tz, now).dateStr;
  const live = events.filter((e) =>
    (e.status ?? 'confirmed') !== 'cancelled' && !isCancelledEventTitle(e.title) && !!e.start_time);

  const remaining = live
    .filter((e) => {
      if (localNow(tz, new Date(e.start_time)).dateStr !== todayStr) return false;
      if (e.is_all_day) return true; // an all-day marker is true all day
      const endsAt = e.end_time ? new Date(e.end_time).getTime() : new Date(e.start_time).getTime();
      return endsAt >= now.getTime();
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((e) => ({ ...e, tomorrow: false }));
  if (remaining.length) return remaining;

  // THE TAIL — one event, the next day's first. Never a list: the frame is not a calendar.
  const future = live
    .filter((e) => new Date(e.start_time).getTime() > now.getTime())
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const next = future[0];
  if (!next) return [];
  const nextDay = localNow(tz, new Date(next.start_time)).dateStr;
  // Only a genuinely NEXT-day event is the tail; something a week out is not "tomorrow starts…".
  const tomorrowStr = localNow(tz, new Date(now.getTime() + 86_400_000)).dateStr;
  if (nextDay !== tomorrowStr) return [];
  return [{ ...next, tomorrow: true }];
}

/**
 * THE PREP STATE IS READ, NEVER GUESSED (A4's "something TRUE to say", applied to a chip).
 *
 * The anticipation lane stamps one fire record per (event, start-minute) — `item_plans` kind
 * 'anticipation', entity_id `meeting:<eventId>:<start_time sliced to the minute>`. A record whose
 * tasks carry `silent: true` means the lane looked and found NOTHING WORTH PREPARING; it wrote no
 * prep turn. So:
 *   • a record with a room and no `silent` flag → 'ready' (a prep really is waiting in that room),
 *   • a silent record, or no record at all      → null (never "brief ready").
 * The key carries the START TIME on purpose: a rescheduled meeting's old brief does not count as
 * this meeting's prep (the reschedule re-brief law, read from the consumer's side).
 */
export type PrepRecord = { entity_id: string; tasks: { silent?: boolean; entityId?: string } | null };

export function prepStateOf(
  ev: Pick<RawEvent, 'id' | 'start_time'>, preps: PrepRecord[],
): { prep: 'ready' | null; entityId: string | null } {
  const key = `meeting:${ev.id}:${String(ev.start_time).slice(0, 16)}`;
  const hit = preps.find((p) => p.entity_id === key);
  if (!hit) return { prep: null, entityId: null };
  if (hit.tasks?.silent) return { prep: null, entityId: hit.tasks?.entityId ?? null };
  return { prep: 'ready', entityId: hit.tasks?.entityId ?? null };
}

export function toDayEvent(
  e: RawEvent & { tomorrow: boolean }, tz: string, selfEmail: string | null, preps: PrepRecord[],
  anchors: DayAnchor[] = [],
): DayEvent {
  const { prep, entityId } = prepStateOf(e, preps);
  // THE RAISED ROWS: the attention layer's own anchored set, filed under this event. `anchorsForEvent`
  // owns the cap; an event with none carries NO key (A4's absence, one level down).
  const raised = anchorsForEvent(anchors, String(e.id))
    .map((a) => ({ itemId: a.itemId, title: a.title, whyNow: a.whyNow, href: a.href }));
  return {
    ...(raised.length ? { raised } : {}),
    id: e.id,
    time: e.is_all_day ? '' : localTimeLabel(e.start_time, tz),
    allDay: !!e.is_all_day,
    tomorrow: e.tomorrow,
    title: clipTitle(e.title) || 'Untitled',
    with: counterpartsOf(e.attendees, selfEmail),
    prep,
    // The prep's own door is the ROOM it landed in — a chip that points nowhere is chrome.
    href: prep === 'ready' && entityId ? `/home?view=${entityId}` : null,
    startIso: e.start_time,
  };
}

// ── IN MOTION ───────────────────────────────────────────────────────────────────────────────────

export type RawRun = {
  id: string;
  workflow_id: string;
  status: string;
  step_outputs: unknown[] | null;
  started_at: string | null;
  created_at: string;
};

export type RawWorkflow = {
  id: string;
  name: string;
  agent_id: string | null;
  steps: unknown[] | null;
  status: string | null;
  trigger: { type?: string } | null;
  next_run_at: string | null;
};

export type Agent = { id: string; name: string; worker_role: string | null };

/** The running row's state words — the presence idiom, stated once ("step 3 of 9"). */
export function runningStateOf(run: RawRun, wf: RawWorkflow | undefined): string {
  const total = Array.isArray(wf?.steps) ? wf!.steps!.length : 0;
  const done = Array.isArray(run.step_outputs) ? run.step_outputs.length : 0;
  if (run.status === 'queued') return 'queued';
  return total ? `running · step ${Math.min(done + 1, total)} of ${total}` : 'running';
}

/** A parked run's state words come from THE ONE GATE WORD TABLE — a surface that invents its own
 *  word is the drift class that table exists to kill. A handoff names the person it waits on. */
export function waitingStateOf(kind: GateKind, assigneeName?: string | null): string {
  if (kind === 'handoff' && assigneeName) return `waiting on ${assigneeName.split(' ')[0]}`;
  return GATE_WORDS[kind].waiting;
}

/** "runs at 08:00" / "runs at 08:00 tomorrow" — a STATE (a standing promise's next moment), never
 *  an event. Only ever spoken for a next_run_at inside the horizon. */
export function scheduledStateOf(nextRunAt: string, tz: string, now: Date): string {
  const at = new Date(nextRunAt);
  const label = localNow(tz, at).hhmm;
  const sameDay = localNow(tz, at).dateStr === localNow(tz, now).dateStr;
  return sameDay ? `runs at ${label}` : `runs at ${label} tomorrow`;
}

export const SCHEDULED_HORIZON_MS = 24 * 60 * 60_000;

/**
 * THE IN-MOTION DERIVATION (A6). Pure: rows in, rows out.
 *
 * WHAT ENTERS — state only:
 *   1. runs actually moving (queued/running),
 *   2. runs PARKED on a gate (the wait is a state of the work; the DECISION itself is a needs-you
 *      row elsewhere, so this row carries words and a door, never a verb),
 *   3. the next scheduled standing run inside the 24h horizon — and only for a workflow that has
 *      no live run already speaking for it (one work, one row).
 *
 * WHAT NEVER ENTERS: deliveries, coworker messages, notifications. They are the thread's business.
 */
export function deriveInMotionRows(
  runs: RawRun[], wfById: Map<string, RawWorkflow>, agentById: Map<string, Agent>,
  stepsOf: (wf: RawWorkflow | undefined) => WorkflowStep[] | null,
  tz: string, now: Date,
): InMotionRow[] {
  const ownerOf = (wf: RawWorkflow | undefined): { name: string; role: string | null } | null => {
    const a = wf?.agent_id ? agentById.get(wf.agent_id) : null;
    return a ? { name: a.name, role: a.worker_role } : null;
  };
  // ── ONE WORK, ONE ROW (the glance law, found live: six parked runs of the SAME workflow drew six
  // identical "waiting for your approval" lines — a wall, which is precisely the notification
  // tragedy this arc exists to reverse). The frame names the WORK, never each run; siblings are
  // COUNTED into the state word ("3 waiting for your approval") and the row's door becomes the
  // workflow's. A count that stands for real rows is information; a repeated row is noise.
  const byWorkflow = new Map<string, RawRun[]>();
  for (const r of runs) {
    if (!['running', 'queued', 'awaiting_approval'].includes(r.status)) continue;
    byWorkflow.set(r.workflow_id, [...(byWorkflow.get(r.workflow_id) ?? []), r]);
  }

  const rows: InMotionRow[] = [];
  const spokenFor = new Set<string>();

  for (const [workflowId, group] of byWorkflow) {
    const wf = wfById.get(workflowId);
    const name = clipTitle(wf?.name ?? 'Workflow', 48);
    spokenFor.add(workflowId);
    // MOVING OUTRANKS WAITING: if anything of this work is actually running, that is its state.
    const moving = group.filter((r) => r.status === 'running' || r.status === 'queued');
    const parked = group.filter((r) => r.status === 'awaiting_approval');
    if (moving.length) {
      const lead = moving[0];
      const extra = group.length - 1;
      rows.push({
        id: `run:${lead.id}`, kind: 'running', name,
        state: runningStateOf(lead, wf) + (extra > 0 ? ` · +${extra} more` : ''),
        owner: ownerOf(wf),
        href: extra > 0 ? `/workflows?workflow=${workflowId}` : `/workflows?run=${lead.id}`,
      });
      continue;
    }
    const lead = parked[0];
    const gate = parkedGateOf({ step_outputs: lead.step_outputs as never }, stepsOf(wf));
    // A HANDOFF'S OWNER IS THE PERSON HOLDING IT (the author-on-speech law): the row leads with
    // the teammate who owes the move, not with the coworker who authored the run.
    const owner = gate.kind === 'handoff' && gate.assigneeName
      ? { name: gate.assigneeName, role: null }
      : ownerOf(wf);
    const base = waitingStateOf(gate.kind, gate.assigneeName);
    rows.push({
      id: `run:${lead.id}`, kind: 'waiting', name,
      state: parked.length > 1 ? `${parked.length} ${base}` : base,
      owner,
      href: parked.length > 1 ? `/workflows?workflow=${workflowId}` : `/workflows?run=${lead.id}`,
    });
  }

  // THE STANDING PROMISES — a scheduled workflow whose next moment is inside the horizon.
  const horizon = now.getTime() + SCHEDULED_HORIZON_MS;
  const scheduled = [...wfById.values()]
    .filter((w) => w.status === 'active' && w.trigger?.type === 'schedule' && !!w.next_run_at)
    .filter((w) => !spokenFor.has(w.id))
    .filter((w) => {
      const t = new Date(w.next_run_at!).getTime();
      return Number.isFinite(t) && t > now.getTime() && t <= horizon;
    })
    .sort((a, b) => a.next_run_at!.localeCompare(b.next_run_at!));
  for (const w of scheduled) {
    rows.push({
      id: `wf:${w.id}`, kind: 'scheduled', name: clipTitle(w.name, 48),
      state: scheduledStateOf(w.next_run_at!, tz, now), owner: ownerOf(w),
      href: `/workflows?workflow=${w.id}`,
    });
  }

  // Attention order within the glance: what is moving, then what is waiting, then what is coming.
  // THE GLANCE CAP: the frame is a glance, never a second inbox (A6). Same density the calm Home
  // holds itself to — past it, the Workflows surface is the ledger and this zone does not pretend
  // to be one.
  const order: Record<InMotionKind, number> = { running: 0, waiting: 1, scheduled: 2 };
  return rows.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, IN_MOTION_MAX_ROWS);
}

/** The glance's density law, stated once (the calm Home's CALM_MAX_WHISPERS, same number, same
 *  reason: a page that can grow without bound is a queue). */
export const IN_MOTION_MAX_ROWS = 5;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ASSEMBLY — one function, both zones, every absence earned.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Is the calendar organ CONNECTED? Calendar events ride the same gmail/outlook connections email
 *  does (lib/calendar/sync-calendar) — an active one is what "connected" means here. */
export async function calendarConnected(client: DBClient, userId: string): Promise<boolean> {
  try {
    const { data } = await client.from('connections').select('id')
      .eq('user_id', userId).in('provider', ['gmail', 'outlook']).eq('status', 'active').limit(1);
    return !!(data ?? []).length;
  } catch { return false; }
}

/** THE TODAY ZONE, or nothing. Every `return undefined` below is a law, named at its site. */
export async function buildTodayZone(
  client: DBClient, userId: string, features: WorkspaceFeatures, selfEmail: string | null, now = new Date(),
): Promise<DayFrame['today'] | undefined> {
  // A5.1 — FEATURE OFF: the organ does not exist for this user. No key, no vocabulary.
  if (features[TODAY_ZONE_FEATURE] === false) return undefined;
  // A5.2 — ON, NOT CONNECTED: still absent. The connect offer is the CoS's voice in the thread.
  if (!await calendarConnected(client, userId)) return undefined;

  const tz = await userTimezone(client, userId);
  // The read window: from the start of the user's local day out to +48h (the tail needs tomorrow).
  // Bounded and indexed (user_id, start_time) — no full listing, so no 1000-row cap to page around.
  const from = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const to = new Date(now.getTime() + 48 * 60 * 60_000).toISOString();
  let raw: RawEvent[] = [];
  try {
    const { data } = await client.from('calendar_events')
      .select('id, title, start_time, end_time, is_all_day, attendees, status')
      .eq('user_id', userId)
      .gte('start_time', from).lte('start_time', to)
      .order('start_time', { ascending: true }).limit(200);
    raw = (data ?? []) as RawEvent[];
  } catch { return undefined; } // a failed read is not a claim about the day

  const chosen = selectDayEvents(raw, tz, now, selfEmail);
  // A4 — NOTHING TRUE TO SAY: an empty day is an absent zone, never "No meetings today".
  if (!chosen.length) return undefined;

  // The prep lane's own records, read for exactly these events (never a guess, never a full scan).
  let preps: PrepRecord[] = [];
  try {
    const keys = chosen.map((e) => `meeting:${e.id}:${String(e.start_time).slice(0, 16)}`);
    const { data } = await client.from('item_plans').select('entity_id, tasks')
      .eq('user_id', userId).eq('kind', 'anticipation').in('entity_id', keys).limit(keys.length);
    preps = (data ?? []) as PrepRecord[];
  } catch { /* no records → no prep claim, which is the honest default */ }

  // THE DAY ANCHOR (Sep 18): the attention layer's OWN served rows, recorded by the brief at the one
  // choke point and read here — never re-derived (see lib/home/day-anchors' header for why a second
  // derivation would be a second budget). A missing or stale record is simply no raised rows.
  const anchors = await readDayAnchors(client, userId, now);

  return { events: chosen.map((e) => toDayEvent(e, tz, selfEmail, preps, anchors)) };
}

/** THE IN-MOTION ZONE, or nothing. */
export async function buildInMotionZone(
  client: DBClient, userId: string, features: WorkspaceFeatures, now = new Date(),
): Promise<DayFrame['inMotion'] | undefined> {
  // A5.1 — FEATURE OFF: workflows do not exist for this user, so neither does the zone.
  if (features[IN_MOTION_ZONE_FEATURE] === false) return undefined;

  const tz = await userTimezone(client, userId);
  let runs: RawRun[] = [];
  let wfs: RawWorkflow[] = [];
  try {
    // Live runs only. A parked run can be old, so no time floor on those; the statuses ARE the
    // filter (the indexed ones), and the cap is far above any real live-run count.
    const [runsRes, wfRes] = await Promise.all([
      client.from('workflow_runs')
        .select('id, workflow_id, status, step_outputs, started_at, created_at')
        .eq('user_id', userId).in('status', ['queued', 'running', 'awaiting_approval'])
        .order('created_at', { ascending: false }).limit(50),
      client.from('workflows')
        .select('id, name, agent_id, steps, status, trigger, next_run_at')
        .eq('user_id', userId).limit(500),
    ]);
    runs = (runsRes.data ?? []) as RawRun[];
    wfs = (wfRes.data ?? []) as RawWorkflow[];
  } catch { return undefined; }

  const wfById = new Map(wfs.map((w) => [w.id, w]));
  // The owning coworker's face — the same agent_id → custom_agents resolution the presence route
  // uses. When the agents organ is off there simply are no coworkers, and rows go face-less.
  let agents: Agent[] = [];
  if (features.agents !== false) {
    try {
      const { data } = await client.from('custom_agents')
        .select('id, name, worker_role')
        .eq('user_id', userId).eq('is_worker', true).eq('is_active', true).limit(50);
      agents = (data ?? []) as Agent[];
    } catch { /* face-less rows are honest; an invented face is not */ }
  }
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const rows = deriveInMotionRows(
    runs, wfById, agentById,
    (wf) => (Array.isArray(wf?.steps) ? wf!.steps as WorkflowStep[] : null),
    tz, now,
  );

  // A6's ONE permitted arrival reference — a POINTER, never a row: the newest delivered runs that
  // have not been reviewed. Same predicate as the nav badge and the ledger's row pills (status
  // succeeded · reviewed_at null · last 30 days), so three surfaces can never disagree.
  let delivered: DeliveredPointer | undefined;
  try {
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const { count } = await client.from('workflow_runs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'succeeded').is('reviewed_at', null)
      .gte('created_at', since);
    if (count && count > 0) delivered = { count, href: '/workflows' };
  } catch { /* no pointer is better than a wrong one */ }

  // A4 — the zone earns its seat: no rows AND no pointer is an absent zone.
  if (!rows.length && !delivered) return undefined;
  return { rows, ...(delivered ? { delivered } : {}) };
}

/** THE ONE ASSEMBLY the route serves. Both zones independently earned; a payload may be `{}`. */
export async function buildDayFrame(
  client: DBClient, userId: string, features: WorkspaceFeatures, selfEmail: string | null, now = new Date(),
): Promise<DayFrame> {
  const [today, inMotion] = await Promise.all([
    buildTodayZone(client, userId, features, selfEmail, now).catch(() => undefined),
    buildInMotionZone(client, userId, features, now).catch(() => undefined),
  ]);
  return { ...(today ? { today } : {}), ...(inMotion ? { inMotion } : {}) };
}
