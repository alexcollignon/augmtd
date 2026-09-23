// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE USER GROUNDING (stabilization W2.2 — invariant 5 ONE READER PER OBJECT; threads-plan: the
// memory ladder's USER-GLOBAL layer). The user-scope twin of `assembleRoomGrounding`.
//
// WHY (found Sep 22, R1): the Home-ask lane built its OWN world — "REPLIES YOU OWE" from a raw
// `rule_type`/`understanding.relevance` read over the last 60 emails — bypassing the judge, the notice
// floors, the seat law and the deck's demotion set; the worker DMs carried a THIRD world
// (`renderWorldContext`). So the chat could assert a debt the deck had floored. Three assemblers,
// three truths.
//
// THE LAW: everything the brain knows about THE USER — not about one room — sits on ONE page, built
// ONLY from judged/served truth:
//   · WORK YOU OWE  = the SPINE (`buildWorkItems`, the one reader every surface paints from) gated
//                     by THE DECK FLOORS (`deckEligible` + `readJudgedNone` — the deck's own
//                     lane-entry law). A row the deck floored is not a debt here either.
//   · COMMITMENTS   = the spine's commitment lane on the ONE open-status constant
//                     (`OPEN_COMMITMENT_STATUSES`).
//   · CALENDAR      = the ONE today read + the 14-day window (lib/calendar) — code-computed weekdays.
//   · PROJECTS      = names + the state LINE only. Other projects' CONTENT never reaches a room; in a
//                     project thread pass `projectDepth: 'names'` and even the line stays home.
//   · PEOPLE / DEEDS = the person registry's attention set · the activity ledger (last 7 days).
// Refs use the ask lane's own [E#]/[C#]/[R#]/[W#] notation (lib/home/ask-refs.ts resolves them).
// Excerpt-honest (clipForPrompt) and BUDGETED: a section that cannot fit says how much it dropped.
// Adding a user-global knowledge source = one section here, visible to EVERY user-scope reasoner.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { leanSelect, foldLeanRows, rulesReadBody, CLASSIFY_KEYS } from '@/lib/home/lean-source';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clipForPrompt, clipLabel, EXCERPT_MARK, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { projectHref } from '@/lib/room/project-href';
import type { WorkItem } from '@/lib/work-items/model';

/** Same shape as lib/home/ask.ts `AskRef` (declared here to keep the import graph acyclic). */
export type GroundingRef = { id: string; kind: 'entity' | 'inbox_item' | 'commitment' | 'meeting' | 'file'; label: string; href: string | null; tag?: string };

export type UserGroundingOpts = {
  /** 'state' (default): name + state line. 'names': names only — a PROJECT thread never reads
   *  another project's state (the memory ladder's structural scoping). */
  projectDepth?: 'state' | 'names';
  /** Include today + the 14-day calendar window (default true — user-global reaches every thread). */
  calendar?: boolean;
  /** Include the recent-deeds ledger (default true). */
  deeds?: boolean;
  /** Character budget for the rendered page (default 6500). */
  budget?: number;
  /** READ-ONLY mode (gates/censuses): no reconcile heal, no echo-signature derivation (peek only). */
  readOnly?: boolean;
};

export type OwedRow = {
  id: string;                       // raw row id
  ref: 'inbox' | 'commitment' | 'meeting';
  kind: 'reply' | 'action' | 'meeting' | 'commitment';
  title: string;
  who: string | null;
  due: string | null;
  bucket: string;
  project: string | null;
  href: string;
  priority: number;
};
export type WaitingRow = { id: string; ref: 'inbox' | 'commitment'; title: string; who: string | null; due: string | null; href: string };
export type ProjectRow = { id: string; name: string; aliases: string[]; tracked: boolean; category: string | null; summary: string | null; momentum: string | null; quietDays: number | null; youOwe: string[]; nextMove: string | null };
export type PersonRow = { name: string; momentum: string; summary: string };
export type DeedRow = { at: string; type: string; title: string };

export type UserGroundingFacts = {
  todayStr: string;
  owed: OwedRow[];
  waiting: WaitingRow[];
  projects: ProjectRow[];
  people: PersonRow[];
  /** Pre-rendered by the ONE calendar readers (lib/calendar) — code-computed weekdays, never ours. */
  scheduleBlock: string | null;
  calendarWindowBlock: string | null;
  deeds: DeedRow[];
  /** What the collector itself could not include (a saturated spine cap, a failed read). */
  notes: string[];
};

export type UserGrounding = {
  text: string;
  refs: Map<string, GroundingRef>;
  facts: UserGroundingFacts;
  /** Per-section counts the budget dropped — declared in the text too. */
  omitted: Record<string, number>;
};

const BUCKET_RANK: Record<string, number> = { overdue: 0, today: 1, this_week: 2, soon: 3, later: 4, someday: 5 };

/** THE ONE FILTER on the spine: which WorkItems are the user's LIVE work (what the day-state and
 *  every deck-shaped consumer already read as live). Pure; exported for the gate. */
export function isLiveWorkItem(w: Pick<WorkItem, 'state' | 'automated' | 'actor'>): boolean {
  return (w.state === 'todo' || w.state === 'waiting' || w.state === 'in_progress') && !w.automated && w.actor === 'you';
}

/** Sort rule for what is owed: time first (overdue → today → …), then the judged priority. Pure. */
export function sortOwed(a: OwedRow, b: OwedRow): number {
  const ra = BUCKET_RANK[a.bucket] ?? 9, rb = BUCKET_RANK[b.bucket] ?? 9;
  if (ra !== rb) return ra - rb;
  return b.priority - a.priority;
}

// ── THE COLLECTOR (IO) ────────────────────────────────────────────────────────────────────────────
export async function collectUserGroundingFacts(
  client: SupabaseClient, userId: string, opts: UserGroundingOpts = {},
): Promise<UserGroundingFacts> {
  const notes: string[] = [];
  const depth = opts.projectDepth ?? 'state';
  const wantCalendar = opts.calendar !== false;
  const wantDeeds = opts.deeds !== false;
  const readOnly = !!opts.readOnly;

  // The ONE today read anchors the day (user tz, code-computed weekday) — every other read keys on it.
  const { getTodaySchedule, renderScheduleBlock } = await import('@/lib/calendar/today-schedule');
  let sched: Awaited<ReturnType<typeof getTodaySchedule>> | null = null;
  try { sched = await getTodaySchedule(client, userId); } catch { notes.push('calendar unreadable'); }
  const todayStr = sched?.dayStr ?? new Date().toISOString().slice(0, 10);

  const [spine, projects, people, calendarWindowBlock, deeds] = await Promise.all([
    readOwedFromSpine(client, userId, todayStr, readOnly, notes),
    readProjects(client, userId, depth),
    readPeople(client, userId),
    wantCalendar && sched ? readCalendarWindow(client, userId, sched.dayStr, sched.userTz) : Promise.resolve(null),
    wantDeeds ? readDeeds(client, userId) : Promise.resolve([] as DeedRow[]),
  ]);

  return {
    todayStr,
    owed: spine.owed, waiting: spine.waiting,
    projects, people,
    scheduleBlock: wantCalendar && sched ? renderScheduleBlock(sched) : null,
    calendarWindowBlock,
    deeds, notes,
  };
}

/** THE SPINE ∩ THE DECK FLOORS. The spine is the one reader of live work (kinds, buckets, the
 *  commitment fold, entity names); the floors are the deck's own lane-entry law. Neither is
 *  re-derived here — a row is owed iff the spine holds it live AND the deck would seat it. */
async function readOwedFromSpine(
  client: SupabaseClient, userId: string, todayStr: string, readOnly: boolean, notes: string[],
): Promise<{ owed: OwedRow[]; waiting: WaitingRow[] }> {
  const owed: OwedRow[] = [];
  const waiting: WaitingRow[] = [];
  try {
    const { buildWorkItems } = await import('@/lib/work-items/model');
    // The deck heals (reconcile) on every load; the read-only mode never writes.
    const items = (await buildWorkItems(client, userId, { todayStr, skipReconcile: readOnly })).filter(isLiveWorkItem);

    // THE DECK FLOORS on the inbox side: the same predicate the deck-truth gate asserts the world
    // against (`deckEligible`), fed by the same demotion set (`readJudgedNone`) and echo floor.
    const inboxLive = items.filter((w) => w.id.startsWith('inbox:') && w.source === 'email');
    const admitted = new Set<string>();
    if (inboxLive.length) {
      const [{ deckEligible, noticeIsDemoted, readJudgedNone }, { classifyItem }, { loadUserRules }, echo] = await Promise.all([
        import('@/lib/home/deck-floors'),
        import('@/lib/inbox/classify-item'),
        import('@/lib/inbox/rules/load'),
        import('@/lib/inbox/campaign-echo'),
      ]);
      const ids = inboxLive.map((w) => w.entityId);
      const [judgedNone, rules, sig] = await Promise.all([
        readJudgedNone(client, userId, ids),
        loadUserRules(userId, client).catch(() => []),
        // The echo signature is a day-keyed cache the deck derives; read-only callers only peek.
        readOnly ? Promise.resolve(echo.peekCampaignSignature(userId)) : echo.getCampaignSignature(client, userId).catch(() => null),
      ]);
      const floors = { judgedNone, isEcho: (it: { id: string }) => echo.isCampaignEcho(it as never, sig) };
      const CHUNK = 100;
      // THE HOT-PATH LAW (event-spine P0): the classification facts only — the deck door's floors
      // read nothing else; a user rule with a `body_*` condition brings `body` back.
      const withBody = rulesReadBody(rules);
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data: raw } = await client.from('inbox_items')
          .select(leanSelect('id, user_id, work_title, work_state, rule_type, type_override, status, source', { keys: CLASSIFY_KEYS, withBody }))
          .eq('user_id', userId).in('id', ids.slice(i, i + CHUNK));
        const data = foldLeanRows((raw ?? []) as unknown as Array<Record<string, unknown>>, { keys: CLASSIFY_KEYS, withBody });
        for (const row of data as unknown as Array<{ id: string }>) {
          const w = inboxLive.find((x) => x.entityId === row.id);
          if (!w) continue;
          // A reply/action row must pass the whole deck door; a waiting row (its own deck lane,
          // never re-promoted) passes the notice/judged floors alone.
          const ok = w.kind === 'followup'
            ? !noticeIsDemoted(row as never, floors)
            : deckEligible(row as never, classifyItem(row as never, rules), floors);
          if (ok) admitted.add(row.id);
        }
      }
    }

    for (const w of items) {
      const isInboxMail = w.id.startsWith('inbox:') && w.source === 'email';
      if (isInboxMail && !admitted.has(w.entityId)) continue;
      const ref: OwedRow['ref'] = w.id.startsWith('commit:') ? 'commitment' : w.source === 'meeting' ? 'meeting' : 'inbox';
      if (w.state === 'waiting' || w.kind === 'followup') {
        if (ref === 'meeting') continue;
        waiting.push({ id: w.entityId, ref, title: w.title, who: w.who, due: w.when.explicit, href: w.href });
        continue;
      }
      if (w.kind === 'deliverable' || w.kind === 'event') continue;
      owed.push({
        id: w.entityId, ref,
        kind: w.kind === 'reply' ? 'reply' : w.kind === 'meeting' ? 'meeting' : w.kind === 'commitment' ? 'commitment' : 'action',
        title: w.title, who: w.who, due: w.when.explicit, bucket: w.when.bucket,
        project: w.entity?.name ?? null, href: w.href, priority: w.priority,
      });
    }
    owed.sort(sortOwed);
  } catch (e) {
    notes.push(`live work unreadable (${e instanceof Error ? e.message : 'error'})`);
  }
  return { owed, waiting };
}

async function readProjects(client: SupabaseClient, userId: string, depth: 'state' | 'names'): Promise<ProjectRow[]> {
  try {
    const { data } = await client.from('work_entities')
      .select('id, name, aliases, tracked, state, next_move, priority, last_event_at')
      .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active')
      .order('last_event_at', { ascending: false }).limit(80);
    const nowMs = Date.now();
    const rows = ((data ?? []) as Array<Record<string, unknown>>)
      // An untracked entity with no synthesized state is a machine draft — it does not claim a seat.
      .filter((e) => e.tracked === true || !!e.state)
      .map((e): ProjectRow => {
        const st = ((e.state ?? {}) as { summary?: string; momentum?: string; category?: string; whoOwes?: { you?: string[] } });
        const nm = (e.next_move ?? null) as { title?: string } | null;
        const q = e.last_event_at ? Math.floor((nowMs - new Date(e.last_event_at as string).getTime()) / 86400000) : null;
        return {
          id: String(e.id), name: String(e.name), tracked: e.tracked === true,
          aliases: Array.isArray(e.aliases) ? (e.aliases as unknown[]).map(String) : [],
          category: depth === 'state' ? (st.category ?? null) : null,
          summary: depth === 'state' ? (st.summary ?? null) : null,
          momentum: depth === 'state' ? (st.momentum ?? null) : null,
          quietDays: q,
          youOwe: depth === 'state' && Array.isArray(st.whoOwes?.you) ? st.whoOwes!.you!.slice(0, 3) : [],
          nextMove: depth === 'state' ? (nm?.title ?? null) : null,
        };
      });
    const weight = new Map(((data ?? []) as Array<Record<string, unknown>>).map((e) => [String(e.id), Number((e.priority as { weight?: number } | null)?.weight ?? 0)]));
    // TRACKED FIRST (a human pin outranks the machine), then the reasoned priority.
    return rows.sort((a, b) => Number(b.tracked) - Number(a.tracked) || (weight.get(b.id) ?? 0) - (weight.get(a.id) ?? 0));
  } catch { return []; }
}

async function readPeople(client: SupabaseClient, userId: string): Promise<PersonRow[]> {
  try {
    const { getPersonEntities } = await import('@/lib/entities/people');
    return (await getPersonEntities(client, userId))
      .filter((p) => p.state?.summary && (p.state.momentum === 'you_owe' || p.state.momentum === 'gone_quiet' || p.state.momentum === 'needs_you'))
      .sort((a, b) => (b.lastEventAt || '').localeCompare(a.lastEventAt || ''))
      .map((p) => ({ name: p.name, momentum: String(p.state!.momentum), summary: String(p.state!.summary) }));
  } catch { return []; }
}

async function readCalendarWindow(client: SupabaseClient, userId: string, dayStr: string, tz: string): Promise<string | null> {
  try {
    const { getScheduleWindow, renderCalendarWindow } = await import('@/lib/calendar/schedule-window');
    const win = await getScheduleWindow(client, userId, {
      fromDayStr: dayStr,
      toDayStr: new Date(Date.parse(`${dayStr}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10),
      tz,
    });
    return renderCalendarWindow(win, { tz });
  } catch { return null; }
}

async function readDeeds(client: SupabaseClient, userId: string): Promise<DeedRow[]> {
  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data } = await client.from('activity_events').select('type, title, created_at')
      .eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(24);
    return ((data ?? []) as Array<{ type: string; title: string; created_at: string }>)
      .map((a) => ({ at: String(a.created_at).slice(0, 10), type: String(a.type || '').replace(/_/g, ' '), title: String(a.title || '') }));
  } catch { return []; }
}

// ── THE RENDERER (pure) ───────────────────────────────────────────────────────────────────────────
type Caps = { owed: number; waiting: number; projects: number; people: number; deeds: number };
const DEFAULT_CAPS: Caps = { owed: 30, waiting: 12, projects: 24, people: 8, deeds: 8 };
// THE FLOORS: what is OWED is the page's reason to exist — it yields LAST and keeps the most seats
// (found by the live census: an 80-project · 380-person account squeezed the debt to six rows).
const MIN_CAPS: Caps = { owed: 12, waiting: 3, projects: 6, people: 3, deeds: 3 };
const YIELDS_LAST: keyof Caps = 'owed';
export const USER_GROUNDING_BUDGET = 6500;

const hrefOfOwed = (r: { ref: OwedRow['ref']; id: string; href: string }): string =>
  r.ref === 'commitment' ? `/item/${r.id}?kind=commitment` : r.href;

function renderOnce(f: UserGroundingFacts, caps: Caps, opts: UserGroundingOpts): { text: string; refs: Map<string, GroundingRef>; omitted: Record<string, number> } {
  const refs = new Map<string, GroundingRef>();
  const omitted: Record<string, number> = {};
  const parts: string[] = [];
  const more = (k: keyof Caps, total: number) => {
    const n = Math.max(0, total - caps[k]);
    if (n) omitted[k] = n;
    return n ? `\n(+${n} more not shown — never claim this list is everything)` : '';
  };

  // WORK YOU OWE — refs: replies [R#], commitments [C#], everything else [W#].
  if (f.owed.length) {
    let r = 0, c = 0, w = 0;
    const lines = f.owed.slice(0, caps.owed).map((row) => {
      const tag = row.kind === 'reply' ? `R${++r}` : row.kind === 'commitment' ? `C${++c}` : `W${++w}`;
      refs.set(tag, {
        id: row.id, kind: row.ref === 'commitment' ? 'commitment' : row.ref === 'meeting' ? 'meeting' : 'inbox_item',
        label: clipLabel(row.title, 60), href: hrefOfOwed(row),
      });
      const verb = row.kind === 'reply' ? 'reply owed' : row.kind === 'commitment' ? 'you promised' : row.kind === 'meeting' ? 'meeting follow-up' : 'action owed';
      return `[${tag}] ${verb}${row.who ? ` · ${clipLabel(row.who, 40)}` : ''} · "${clipLabel(row.title, 90)}"` +
        `${row.bucket === 'overdue' ? ' · OVERDUE' : row.due ? ` · due ${row.due.slice(0, 10)}` : row.bucket === 'today' ? ' · today' : ''}` +
        `${row.project ? ` · project: ${clipLabel(row.project, 40)}` : ''}`;
    });
    const overdue = f.owed.filter((x) => x.bucket === 'overdue').length;
    parts.push(`WORK YOU OWE (${f.owed.length} judged live item${f.owed.length === 1 ? '' : 's'}${overdue ? `, ${overdue} overdue` : ''} — the SAME rows the Home deck shows; reference replies as [R#], promises as [C#], other work as [W#]):\n${lines.join('\n')}${more('owed', f.owed.length)}`);
  } else {
    parts.push('WORK YOU OWE: nothing judged live right now (the deck is clear).');
  }

  if (f.waiting.length) {
    const lines = f.waiting.slice(0, caps.waiting).map((row) =>
      `- ${row.who ? `${clipLabel(row.who, 40)} owes: ` : ''}"${clipLabel(row.title, 90)}"${row.due ? ` · due ${row.due.slice(0, 10)}` : ''}`);
    parts.push(`WAITING ON OTHERS (their court, not a debt of the user's):\n${lines.join('\n')}${more('waiting', f.waiting.length)}`);
  }

  if (f.projects.length) {
    const lines = f.projects.slice(0, caps.projects).map((p, i) => {
      const id = `E${i + 1}`;
      refs.set(id, { id: p.id, kind: 'entity', label: p.name, href: projectHref(p.id) });
      const quiet = p.momentum && (p.momentum === 'gone_quiet' || p.momentum === 'stalled') && p.quietDays != null ? ` ${p.quietDays}d` : '';
      return `[${id}] ${p.name}${p.tracked ? '' : ' (recognized, untracked)'}${p.category ? ` (${p.category})` : ''}` +
        `${p.summary ? ` — ${clipForPrompt(p.summary, 220)}` : ''}${p.momentum ? ` [${p.momentum}${quiet}]` : ''}` +
        `${p.youOwe.length ? ` · you owe: ${p.youOwe.map((s) => clipLabel(s, 80)).join('; ')}` : ''}${p.nextMove ? ` · next: ${clipLabel(p.nextMove, 80)}` : ''}`;
    });
    const head = (opts.projectDepth ?? 'state') === 'names'
      ? 'YOUR PROJECTS (names only — another project\'s content never enters this room; reference as [E#]):'
      : 'YOUR PROJECTS (the bodies of work — one state line each; reference as [E#]):';
    parts.push(`${head}\n${lines.join('\n')}${more('projects', f.projects.length)}`);
  }

  if (f.people.length) {
    const lines = f.people.slice(0, caps.people).map((p) => `- ${p.name} [${p.momentum}]: ${clipForPrompt(p.summary, 160)}`);
    parts.push(`PEOPLE NEEDING ATTENTION:\n${lines.join('\n')}${more('people', f.people.length)}`);
  }

  if (f.scheduleBlock) parts.push(f.scheduleBlock);
  if (f.calendarWindowBlock) parts.push(f.calendarWindowBlock);

  if (f.deeds.length) {
    const lines = f.deeds.slice(0, caps.deeds).map((d) => `- ${d.at} · ${d.type}: ${clipLabel(d.title, 80)}`);
    parts.push(`RECENT DEEDS (the user's own actions, last 7 days — settled things are not owed):\n${lines.join('\n')}${more('deeds', f.deeds.length)}`);
  }

  if (f.notes.length) parts.push(`NOTE: ${f.notes.join(' · ')}.`);

  // THE EXCERPT-HONESTY LAW rides the page itself: a clipped line carries the mark, and the page
  // carries the rule — every reasoner that reads it (Home chat, DMs, converse) inherits both.
  let text = parts.join('\n\n');
  if (text.includes(EXCERPT_MARK)) text += `\n\n${EXCERPT_RULE}`;
  return { text, refs, omitted };
}

/** THE BUDGET: render, and while the page overruns, halve the fullest section's cap (never below
 *  its floor) and render again. Every drop is DECLARED in the text. Pure. */
export function renderUserGrounding(facts: UserGroundingFacts, opts: UserGroundingOpts = {}): { text: string; refs: Map<string, GroundingRef>; omitted: Record<string, number> } {
  const budget = opts.budget ?? USER_GROUNDING_BUDGET;
  const caps: Caps = { ...DEFAULT_CAPS };
  const totals: Caps = { owed: facts.owed.length, waiting: facts.waiting.length, projects: facts.projects.length, people: facts.people.length, deeds: facts.deeds.length };
  for (let i = 0; i < 12; i++) {
    const out = renderOnce(facts, caps, opts);
    if (out.text.length <= budget) return out;
    // The fullest section (by rows actually rendered) yields first; the owed section only when
    // every other section already sits at its floor.
    const above = (Object.keys(caps) as Array<keyof Caps>).filter((k) => Math.min(caps[k], totals[k]) > MIN_CAPS[k]);
    if (!above.length) return out;
    const keys = above.filter((k) => k !== YIELDS_LAST).length ? above.filter((k) => k !== YIELDS_LAST) : above;
    const k = keys.sort((a, b) => Math.min(caps[b], totals[b]) - Math.min(caps[a], totals[a]))[0];
    caps[k] = Math.max(MIN_CAPS[k], Math.floor(Math.min(caps[k], totals[k]) / 2));
  }
  return renderOnce(facts, caps, opts);
}

// ── THE ONE DOOR ──────────────────────────────────────────────────────────────────────────────────
export async function assembleUserGrounding(
  client: SupabaseClient, userId: string, opts: UserGroundingOpts = {},
): Promise<UserGrounding> {
  const facts = await collectUserGroundingFacts(client, userId, opts);
  const { text, refs, omitted } = renderUserGrounding(facts, opts);
  return { text, refs, facts, omitted };
}
