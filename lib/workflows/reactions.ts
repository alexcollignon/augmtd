// ════════════════════════════════════════════════════════════════════════════════════════════════
// STANDING REACTIONS (production arc step 6, Aug 8 — the brain becomes a trigger). Cron answers
// "when is it Wednesday?"; a reaction answers "did the thing happen?" — a workflow whose trigger
// is a JUDGED CONDITION over the event stream ("when a tender matching the client's profile
// lands, run this"). The reasoning sits at the TRIGGER edge; what fires is still the fixed,
// auditable pipeline (the deterministic-spine law).
//
// The seam: the sync tail, right after recognition (so entity links are fresh) — near-real-time
// on arrival, not an hourly poll. The judge is ONE cheap batched reasoned pass per workflow over
// the new inbound items, conservative by rule ("fire only when it CLEARLY satisfies the
// condition"). Structural floors FIRST: scope pre-filter through the entity edge (a
// project-scoped reaction only ever sees its project's items), bulk/own-mail excluded,
// exactly-once per (workflow, item) via a persisted fire record, and an honest DAILY CAP that
// logs what it skipped (no silent caps). A fire = a queued run row + an inline after() attempt;
// the hourly dispatcher re-fires any queued event-run older than 10 minutes (the backstop —
// a crashed tail never silently eats an event).
//
// ── THE GENERALIZATION (THE RELAY CANVAS W1, Aug 21) ────────────────────────────────────────────
// ONE JUDGE, ONE FIRE, N SOURCES. The mail path above is unchanged in behaviour; it is now the
// `mail` member of the registry in lib/workflows/trigger-sources.ts. `checkSourceReactions` is the
// source-agnostic entry every future fire door (file · meeting · workflow) calls: it shares the
// SAME judge, the SAME fireReaction, the SAME exactly-once record and the SAME daily cap. Workflow
// discovery reads normalizeTriggers (legacy single reaction trigger folds to a mail door), so a
// workflow authored with `triggers[]` and one authored before W1 are indistinguishable here.
//
// ⚠️ THE EXACTLY-ONCE TOKEN: the record's entity_id is `${wf.id}:${sourceToken}:${event.id}`, and
// MAIL KEEPS ITS HISTORICAL TOKEN `inbox` (never 'mail') — every fire record written before W1 uses
// it, and changing it would re-fire every already-handled email exactly once. Every other source
// uses its registry key.
//
// ⚠️ THE `workflow` SOURCE IS STRUCTURAL, NOT JUDGED: "another workflow delivers" is deterministic
// composition — the door matches when the delivering workflow's id equals `door.workflow_id`. No AI
// call is made for it. The judge exists for conditions over CONTENT.
//
// ── THE THROTTLE, NEVER A SHREDDER (W3b, Aug 24) ────────────────────────────────────────────────
// The old DAILY_CAP=5 SKIPPED a matched event at the ceiling: loud in a log, invisible to the user.
// For intake work that is a trust violation — the sixth job application of a busy day was dropped.
// THE LAW IS NOW: **the limit paces, it never loses.** At the limit a matched event still writes
// its exactly-once fire record and its `queued` event run — it simply does not START. The drain
// (`drainDeferredFires`, on the hourly dispatcher) starts deferred runs up to the day's remaining
// headroom, oldest first. A pathological composed cycle becomes a slow perpetual loop at throttle
// rate — visible in the ledger, catchable by auto-pause — never an explosion, never a silent stop.
//
// ⚠️ THE COUNTING FACT (chosen deliberately, W3b): the limit gates STARTS, not records. A fire
// record therefore counts against the day's limit ONLY when its run actually started, which is
// exactly `tasks.deferred !== true`. It is written that way round — rather than counting a
// `startedAt` stamp — because every fire record written BEFORE W3b has neither field, and those
// runs certainly started; `deferred !== true` reads them correctly with no backfill. `startedAt` is
// stamped too (audit + the drain's claim), but it is never the counting predicate.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import {
  normalizeTriggers, doorFiltersPass,
  type ReactionDoor, type TriggerSourceKey,
} from '@/lib/workflows/trigger-sources';
import { readFireLimits, FIRE_LIMIT_DEFAULT } from '@/lib/workflows/fire-limit';

const FIRE_KIND = 'reaction_fire';

/** `considered` = candidates the doors looked at · `fired` = runs STARTED now ·
 *  `deferred` = matched events recorded + queued at the limit, waiting for the drain. Never lost. */
export interface ReactionCheckResult { considered: number; fired: number; deferred: number }

/** The one shape a fire record's `tasks` carries. `deferred:true` means "queued, not started" — the
 *  drain's work-list AND the predicate the day's started-count excludes. */
interface FireTasks {
  runId: string | null;
  reason?: string;
  context?: string;
  firedAt?: string;
  /** Present and true ONLY while the run is queued but not started. */
  deferred?: boolean;
  /** Stamped the moment the run is actually kicked (inline or by the drain). Audit, not the count. */
  startedAt?: string;
  /** The drain's other ending: the queued run left the queue by another door, so this lane started
   *  nothing and simply released the flag. */
  resolvedAt?: string;
}

/** THE COUNTING PREDICATE — one definition, three readers (runDoors, the drain, the backstop). */
function fireStarted(tasks: unknown): boolean {
  return (tasks as FireTasks | null)?.deferred !== true;
}

/** Midnight of the local-server day the counters run on. */
function todayIso(): string {
  return new Date(new Date().toISOString().slice(0, 10)).toISOString();
}

/** One thing that arrived, in the shape every source reduces to. */
export interface ReactionEvent {
  /** The UNIQUE event token — the exactly-once key's tail. Mail: the inbox_item id. Workflow: the
   *  delivering RUN's id (never the workflow id, or a second delivery could never fire). */
  id: string;
  title: string;
  from?: string | null;
  gist: string;
  /** The entity this event belongs to, when known — the scope pre-filter's input. */
  entityId?: string | null;
  /** The STRUCTURAL match key for non-judged sources (`workflow`: the delivering workflow's id). */
  sourceId?: string | null;
  /** THE DETERMINISTIC FIELDS (W5) — what the DOOR FILTERS read, keyed by the source registry's
   *  `filterFields`. Mail: from_address · from_name · subject. File: filename · ext. Meeting: title.
   *  ADDITIVE and OPTIONAL: an absent field FAILS any filter naming it (fail closed, by law), so a
   *  seam that cannot supply a field simply cannot be filtered on it — it never passes by default. */
  fields?: Record<string, string>;
}

/** Mail keeps its historical token so pre-W1 fire records never double-fire. */
function sourceToken(source: TriggerSourceKey): string {
  return source === 'mail' ? 'inbox' : source;
}

/** The trigger-context block a fired run carries — every AI step (and the verify gate, for which
 *  this is legitimate source material) sees WHY it is running. */
function triggerBlock(item: { title: string; from?: string | null; gist: string }): string {
  return (
    `[THE TRIGGERING EVENT — this run fired because this arrived:]\n` +
    `${item.title}${item.from ? `\nFrom: ${item.from}` : ''}\n${item.gist}`.slice(0, 2400)
  );
}

type DoorWf = { id: string; name: string; doors: ReactionDoor[] };

/** Discover the workflows holding a door of `source`. ONE widened select: legacy rows (trigger
 *  ->>type = 'reaction') AND rows carrying event doors in `triggers`. The `triggers` column is
 *  additive — where it does not exist the widened select 42703s and we fall back to legacy only. */
async function doorWorkflows(
  admin: SupabaseClient, userId: string, source: TriggerSourceKey,
): Promise<DoorWf[]> {
  const base = () => admin.from('workflows')
    .select('id, name, trigger, triggers')
    .eq('user_id', userId).eq('status', 'active');

  let rows: Array<Record<string, unknown>> = [];
  const wide = await base().or('trigger->>type.eq.reaction,triggers.not.is.null').limit(40);
  if (wide.error) {
    const legacy = await admin.from('workflows')
      .select('id, name, trigger')
      .eq('user_id', userId).eq('status', 'active')
      .eq('trigger->>type', 'reaction').limit(20);
    rows = (legacy.data ?? []) as Array<Record<string, unknown>>;
  } else {
    rows = (wide.data ?? []) as Array<Record<string, unknown>>;
  }

  const out: DoorWf[] = [];
  for (const r of rows) {
    const { doors } = normalizeTriggers(r as { trigger?: unknown; triggers?: unknown });
    const mine = doors.filter((d) => d.source === source && doorIsUsable(d));
    if (mine.length) out.push({ id: String(r.id), name: String(r.name ?? 'Workflow'), doors: mine });
  }
  return out;
}

/** A door that cannot be judged, filtered or bound can never fire honestly — readiness says so on
 *  the row; here it is simply skipped.
 *  W5: a door with ≥1 valid filter and NO `when` is fireable and FULLY DETERMINISTIC. */
function doorIsUsable(d: ReactionDoor): boolean {
  if (d.source === 'workflow') return !!(d.workflow_id ?? '').trim();
  return (d.when ?? '').trim().length > 3 || !!d.filters?.length;
}

/** Check the user's standing reactions against inbound items that arrived since `sinceIso`.
 *  Called from the sync tail (after recognition). Non-fatal by contract. */
export async function checkReactions(
  admin: SupabaseClient, userId: string, sinceIso: string,
): Promise<ReactionCheckResult | null> {
  try {
    // Reactions are rare — the cheap existence read gates everything else.
    const reactions = await doorWorkflows(admin, userId, 'mail');
    if (!reactions.length) return null;

    // Fresh INBOUND items only — the user's own sent mail and judged bulk never trigger production.
    const { data: touched } = await admin.from('inbox_items')
      .select('id, work_title, source_data, created_at')
      .eq('user_id', userId).eq('source', 'email')
      .gte('created_at', sinceIso).limit(30);
    const items = ((touched ?? []) as Array<Record<string, unknown>>)
      .filter((it) => {
        const sd = (it.source_data ?? {}) as Record<string, unknown>;
        if (sd.is_from_user === true) return false;
        const u = (sd.understanding ?? {}) as { bulk?: boolean };
        return u.bulk !== true;
      })
      .map((it) => {
        const sd = (it.source_data ?? {}) as Record<string, unknown>;
        // THE DETERMINISTIC FIELDS (W5). ⚠️ `from` is the SPOKEN sender (display name when there is
        // one) — a filter must never read it: `from_address` is the REAL address, and it is the
        // only thing `is`/`domain_is` may see. A missing address simply omits the field, and every
        // sender filter then fails closed.
        const fromAddress = typeof sd.from_address === 'string' ? sd.from_address.trim() : '';
        const fromName = typeof sd.from_name === 'string' ? sd.from_name.trim() : '';
        const subject = String(sd.subject ?? it.work_title ?? '').trim();
        const fields: Record<string, string> = {};
        if (fromAddress) fields.from_address = fromAddress;
        if (fromName) fields.from_name = fromName;
        if (subject) fields.subject = subject;
        return {
          id: String(it.id),
          title: String(it.work_title ?? sd.subject ?? 'Email').slice(0, 120),
          from: fromName || fromAddress || null,
          gist: String(sd.snippet ?? sd.body_preview ?? sd.body ?? '').replace(/\s+/g, ' ').slice(0, 500),
          fields,
        };
      });
    if (!items.length) return { considered: 0, fired: 0, deferred: 0 };

    // The entity edge = the scope: a project-scoped reaction only sees its project's items.
    const { data: links } = await admin.from('entity_links').select('item_id, entity_id')
      .eq('user_id', userId).eq('item_kind', 'inbox_item')
      .in('item_id', items.map(i => i.id)).not('entity_id', 'is', null);
    const entityByItem = new Map<string, string>();
    for (const l of (links ?? []) as Array<{ item_id: string; entity_id: string }>) entityByItem.set(l.item_id, l.entity_id);

    return await runDoors(admin, userId, 'mail',
      items.map((i) => ({ ...i, entityId: entityByItem.get(i.id) ?? null })), reactions);
  } catch (e) {
    console.error('[reactions] check failed:', e);
    return null;
  }
}

/** THE SOURCE-AGNOSTIC ENTRY (W1) — the door seams (a file lands in Knowledge · a meeting is
 *  recorded · another workflow delivers) call THIS with the one thing that arrived. Same judge,
 *  same fire, same exactly-once record, same daily cap as mail. Non-fatal by contract. */
export async function checkSourceReactions(
  admin: SupabaseClient, userId: string, source: TriggerSourceKey, events: ReactionEvent[],
): Promise<ReactionCheckResult | null> {
  try {
    if (!events.length) return null;
    const wfs = await doorWorkflows(admin, userId, source);
    if (!wfs.length) return null;
    return await runDoors(admin, userId, source, events, wfs);
  } catch (e) {
    console.error(`[reactions] ${source} check failed:`, e);
    return null;
  }
}

/** THE ONE LOOP — scope · exactly-once · (structural match | one batched judgment) · fire OR DEFER.
 *  Identical for every source; only the candidate builder above differs.
 *  ⚠️ THE THROTTLE SITS AFTER THE JUDGE, NOT BEFORE IT (W3b): to queue a matched event you must
 *  know it matched, so the limit can no longer skip candidates unjudged. Judging is one batched
 *  cheap pass per door either way, and a deferred event costs NO second judge — its verdict, its
 *  reason and its context are stored on the fire record the drain replays. */
async function runDoors(
  admin: SupabaseClient, userId: string, source: TriggerSourceKey,
  events: ReactionEvent[], wfs: DoorWf[],
): Promise<ReactionCheckResult> {
  const token = sourceToken(source);

  const { data: scopes } = await admin.from('item_plans').select('entity_id, tasks')
    .eq('user_id', userId).eq('kind', 'workflow_scope')
    .in('entity_id', wfs.map(r => r.id));
  const scopeByWf = new Map<string, string>();
  for (const s of (scopes ?? []) as Array<{ entity_id: string; tasks: { entityId?: string } }>) {
    if (s.tasks?.entityId) scopeByWf.set(s.entity_id, s.tasks.entityId);
  }

  // Exactly-once (ALL of today's records) + the day's STARTED count (the throttle's input).
  const { data: fires } = await admin.from('item_plans').select('entity_id, tasks, created_at')
    .eq('user_id', userId).eq('kind', FIRE_KIND)
    .gte('created_at', todayIso()).limit(400);
  const firedKeys = new Set(((fires ?? []) as Array<{ entity_id: string }>).map(f => f.entity_id));
  const startedToday = new Map<string, number>();
  for (const f of (fires ?? []) as Array<{ entity_id: string; tasks: unknown }>) {
    if (!fireStarted(f.tasks)) continue; // queued-but-not-started buys no headroom back
    const wfId = f.entity_id.split(':')[0];
    startedToday.set(wfId, (startedToday.get(wfId) ?? 0) + 1);
  }

  // ONE extra read per pass (never per event): the per-workflow throttle, absent = the default.
  const limits = await readFireLimits(admin, userId, wfs.map(w => w.id));
  const limitOf = (wfId: string) => limits.get(wfId)?.dailyFires ?? FIRE_LIMIT_DEFAULT;

  let fired = 0, deferred = 0, considered = 0;
  for (const wf of wfs) {
    const scopeEntity = scopeByWf.get(wf.id) ?? null;
    const candidates = events.filter(i =>
      !firedKeys.has(`${wf.id}:${token}:${i.id}`) &&
      (!scopeEntity || (i.entityId ?? null) === scopeEntity));
    if (!candidates.length) continue;
    considered += candidates.length;

    // A workflow may hold several doors of the same source; the FIRST that matches an event fires
    // it (the exactly-once key is per event, so a second door can never double-fire the same one).
    const firedHere = new Set<string>();
    for (const door of wf.doors) {
      // ── THE DOOR FILTERS GATE CANDIDACY (W5) ────────────────────────────────────────────────
      // Deterministic, in code, BEFORE the judge: an event a filter rejects never reaches an AI
      // call (the spend win) and never fires. AND semantics; a field the event doesn't carry
      // fails its filter. A door with NO filters is unchanged (everything passes through).
      const passed = (door.filters?.length ?? 0)
        ? candidates.filter((c) => doorFiltersPass(door, c))
        : candidates;
      if (!passed.length) continue;

      // A content door with filters and NO judged condition is FULLY DETERMINISTIC: the filters
      // ARE the match, so there is nothing left to judge and no AI call is made.
      const deterministic = (door.when ?? '').trim().length <= 3;
      const matched = door.source === 'workflow'
        // STRUCTURAL, NOT JUDGED: composition is deterministic — no AI call.
        // THE SELF-LOOP FLOOR (W1 fire doors): a workflow whose own door names ITSELF must never be
        // fired by its own delivery. The exactly-once key carries the delivering RUN's id (a new
        // one every time), so without this the chain would be infinite — bounded only by DAILY_CAP,
        // which is a cap, not a floor.
        ? passed
            .filter(c => (c.sourceId ?? '') === (door.workflow_id ?? '') && (c.sourceId ?? '') !== wf.id)
            .map(c => ({ id: c.id, reason: 'the upstream workflow delivered' }))
        : deterministic
          // The reason is THE ENGINE'S OWN WORDS, never a model's.
          ? passed.map(c => ({ id: c.id, reason: "matched the door's filters" }))
          // The judged door: filters (if any) already narrowed the batch; the condition refines.
          : await judgeCandidates(admin, userId, door.when!.trim(), passed);

      let deferredHere = 0;
      for (const m of matched) {
        if (firedHere.has(m.id) || firedKeys.has(`${wf.id}:${token}:${m.id}`)) continue;
        const item = candidates.find(c => c.id === m.id);
        if (!item) continue;
        // THE THROTTLE: at the limit the event is DEFERRED, never dropped — same fire record, same
        // queued run, just no start. The drain picks it up when tomorrow's headroom opens.
        const defer = (startedToday.get(wf.id) ?? 0) >= limitOf(wf.id);
        const res = await fireReaction(admin, userId, wf, item, m.reason, token, defer);
        if (!res) continue;
        firedHere.add(m.id); firedKeys.add(`${wf.id}:${token}:${m.id}`);
        if (res === 'started') {
          fired++;
          startedToday.set(wf.id, (startedToday.get(wf.id) ?? 0) + 1);
        } else {
          deferred++; deferredHere++;
        }
      }
      if (deferredHere) {
        // THE HONEST LINE — a limit that paces says what is waiting, never what it lost.
        console.log(`[reactions] "${wf.name}" is at its daily limit (${limitOf(wf.id)}) — ${deferredHere} event(s) queued for the drain`);
      }
    }
  }
  return { considered, fired, deferred };
}

async function judgeCandidates(
  admin: SupabaseClient, userId: string, when: string,
  candidates: ReactionEvent[],
): Promise<Array<{ id: string; reason: string }>> {
  try {
    const { client, model } = await getAIClient(userId, 'classification', admin);
    const list = candidates.map((c, i) =>
      `[${i + 1}] id=${c.id}\nSubject: ${c.title}${c.from ? `\nFrom: ${c.from}` : ''}\nPreview: ${c.gist}`).join('\n\n');
    const res = await aiCreate(client, {
      model,
      messages: [
        { role: 'system', content:
          'You gate an automated production workflow. The user defined a trigger condition; you decide which of the new ' +
          'events CLEARLY satisfy it. Be conservative: a maybe is a no — a missed event costs a delay, a false fire runs ' +
          'production on noise. Judge only from the event\'s own words. Respond with ONLY JSON: ' +
          '{"matches": [{"id": "<event id>", "reason": "<one short sentence quoting the event\'s own words>"}]} — empty array if none.' },
        { role: 'user', content: `TRIGGER CONDITION: ${when}\n\nNEW EVENTS:\n${list}` },
      ],
      max_tokens: 500,
      temperature: 0,
    });
    const parsed = parseModelJSON<{ matches?: Array<{ id?: string; reason?: string }> }>(res.choices[0]?.message?.content ?? '', {});
    return (parsed.matches ?? [])
      .filter(m => m.id && candidates.some(c => c.id === m.id))
      .map(m => ({ id: String(m.id), reason: String(m.reason ?? '').slice(0, 200) }));
  } catch (e) {
    // AI failure ≠ a fire and ≠ a permanent skip: no fire record is written, so the next sync
    // (or the bootstrap read) re-judges the same items honestly.
    console.error('[reactions] judge failed:', e);
    return [];
  }
}

/** ONE fire, TWO endings (W3b): `started` (the run was kicked) or `deferred` (recorded + queued at
 *  the limit, waiting for the drain). `false` = nothing was written at all. The record and the run
 *  row are IDENTICAL in both endings — deferral changes when work happens, never whether it is
 *  remembered. */
async function fireReaction(
  admin: SupabaseClient, userId: string,
  wf: { id: string; name: string },
  item: ReactionEvent,
  reason: string,
  token: string,
  defer: boolean,
): Promise<'started' | 'deferred' | false> {
  try {
    const context = triggerBlock(item) + (reason ? `\n(Judged match: ${reason})` : '');
    // The queued run row FIRST — the ledger sees it, and the dispatcher backstop can re-fire it.
    const { data: run, error: runErr } = await admin.from('workflow_runs').insert({
      workflow_id: wf.id, user_id: userId, status: 'queued', triggered_by: 'event',
    }).select('id').single();
    if (runErr || !run) { console.error(`[reactions] enqueue failed for "${wf.name}":`, runErr); return false; }
    const runId = (run as { id: string }).id;

    const nowIso = new Date().toISOString();
    const tasks: FireTasks = {
      runId, reason, context, firedAt: nowIso,
      ...(defer ? { deferred: true } : { startedAt: nowIso }),
    };
    // The exactly-once record — carries the context so the BACKSTOP and the DRAIN can rebuild it.
    await admin.from('item_plans').insert({
      // ⚠️ `token` is the SOURCE token — 'inbox' for mail (historical, never changed) else the
      // registry key. Changing mail's would re-fire every already-handled email.
      user_id: userId, kind: FIRE_KIND, entity_id: `${wf.id}:${token}:${item.id}`,
      tasks,
    });

    // AT THE LIMIT WE STOP HERE. The event is durable (record + queued run); the drain owns its
    // start. No after(), no inline run — and the stale-run backstop skips it BY THE SAME FLAG, so
    // exactly one lane can ever start it.
    if (defer) return 'deferred';

    // Inline attempt — after() outlives the sync response; reaction pipelines are short by
    // design (the event rides in; they don't re-fetch the world). The backstop covers a crash.
    try {
      const { after } = await import('next/server');
      const { runWorkflow } = await import('@/lib/workflows/run-workflow');
      after(async () => {
        await runWorkflow({ workflowId: wf.id, runId, triggerSource: 'event', triggerContext: context })
          .catch((e) => console.error(`[reactions] run failed for "${wf.name}":`, e));
      });
    } catch {
      // No request scope (scripts/tests): leave the queued row — the backstop fires it.
    }
    return 'started';
  } catch (e) {
    console.error('[reactions] fire failed:', e);
    return false;
  }
}

// ── THE DRAIN ────────────────────────────────────────────────────────────────────────────────────

/** THE DRAIN (W3b) — the throttle's other half, wired into the hourly dispatcher. Deferred fires
 *  (record + queued run, never started) are started oldest-first, up to each workflow's remaining
 *  headroom for the day. A queue that only ever fills is a shredder with extra steps; this is what
 *  makes "the limit paces, it never loses" true.
 *
 *  THE ATOMIC START CLAIM: the flip `deferred:true → {deferred:false, startedAt}` is a CONDITIONAL
 *  update filtered on `tasks->>deferred = 'true'` — the insert-first idiom's update twin. Only one
 *  caller can win it, and the stale-run backstop refuses every record still wearing `deferred:true`,
 *  so the two lanes partition the world by that single flag: the drain owns unstarted runs, the
 *  backstop owns runs whose START was lost. They cannot double-start one run. */
export async function drainDeferredFires(admin: SupabaseClient): Promise<{ started: number }> {
  let started = 0;
  try {
    const { data: waiting } = await admin.from('item_plans')
      .select('user_id, entity_id, tasks, created_at')
      .eq('kind', FIRE_KIND).eq('tasks->>deferred', 'true')
      .order('created_at', { ascending: true }).limit(50);
    const rows = (waiting ?? []) as Array<{ user_id: string; entity_id: string; tasks: FireTasks; created_at: string }>;
    if (!rows.length) return { started: 0 };

    // Group by (user, workflow) — the throttle's unit. Order within a group is preserved from the
    // oldest-first read above, so the queue drains in arrival order.
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = `${r.user_id}::${String(r.entity_id).split(':')[0]}`;
      const arr = groups.get(key) ?? [];
      arr.push(r); groups.set(key, arr);
    }

    // The day's started counts, one read per user (not per group).
    const countsByUser = new Map<string, Map<string, number>>();
    for (const userId of new Set(rows.map(r => r.user_id))) {
      const { data: fires } = await admin.from('item_plans').select('entity_id, tasks')
        .eq('user_id', userId).eq('kind', FIRE_KIND).gte('created_at', todayIso()).limit(400);
      const m = new Map<string, number>();
      for (const f of (fires ?? []) as Array<{ entity_id: string; tasks: unknown }>) {
        if (!fireStarted(f.tasks)) continue;
        const wfId = String(f.entity_id).split(':')[0];
        m.set(wfId, (m.get(wfId) ?? 0) + 1);
      }
      countsByUser.set(userId, m);
    }

    const limitCache = new Map<string, number>();
    for (const [key, queue] of groups) {
      const [userId, wfId] = key.split('::');
      let limit = limitCache.get(key);
      if (limit === undefined) {
        limit = (await readFireLimits(admin, userId, [wfId])).get(wfId)?.dailyFires ?? FIRE_LIMIT_DEFAULT;
        limitCache.set(key, limit);
      }
      let startedForWf = countsByUser.get(userId)?.get(wfId) ?? 0;
      for (const row of queue) {
        if (startedForWf >= limit) break; // still throttled — it waits, it is not lost
        const runId = row.tasks?.runId;
        if (!runId) continue;
        // The run must still be waiting: a cancelled/deleted run is not resurrected by the drain.
        const { data: runRow } = await admin.from('workflow_runs')
          .select('id, status, workflow_id').eq('id', runId).maybeSingle();
        const run = runRow as { id: string; status: string; workflow_id: string } | null;
        if (!run || run.status !== 'queued') {
          // The run left the queue by another door (started elsewhere, cancelled, deleted). Clear
          // the flag — through the SAME atomic claim — so a dead row never blocks the queue's head
          // forever. `resolvedAt`, not `startedAt`: this lane started nothing.
          await admin.from('item_plans')
            .update({ tasks: { ...row.tasks, deferred: false, resolvedAt: new Date().toISOString() } })
            .eq('user_id', row.user_id).eq('kind', FIRE_KIND).eq('entity_id', row.entity_id)
            .eq('tasks->>deferred', 'true');
          continue;
        }
        // THE ATOMIC START CLAIM.
        const { data: claimed } = await admin.from('item_plans')
          .update({ tasks: { ...row.tasks, deferred: false, startedAt: new Date().toISOString() } })
          .eq('user_id', row.user_id).eq('kind', FIRE_KIND).eq('entity_id', row.entity_id)
          .eq('tasks->>deferred', 'true')
          .select('entity_id');
        if (!claimed?.length) continue; // someone else drained it
        startedForWf++; started++;
        const context = row.tasks?.context;
        const go = async () => {
          try {
            const { runWorkflow } = await import('@/lib/workflows/run-workflow');
            await runWorkflow({
              workflowId: run.workflow_id, runId, triggerSource: 'event', triggerContext: context,
            });
          } catch (e) { console.error('[reactions] drained run failed:', e); }
        };
        try {
          const { after } = await import('next/server');
          after(go);
        } catch {
          // No request scope (scripts): run inline — the record is already claimed either way.
          await go();
        }
      }
    }
  } catch (e) {
    console.error('[reactions] drain failed:', e);
  }
  return { started };
}

/** THE BACKSTOP — called by the hourly dispatcher: any event-run still queued after 10 minutes
 *  lost its inline attempt (crash, cold script, missing request scope). Re-fire with the stored
 *  context. Exactly-once at the run row: the atomic queued→running claim loses gracefully.
 *
 *  ⚠️ THE BACKSTOP LEARNED THE THROTTLE (W3b): a queued run whose fire record still says
 *  `deferred:true` is NOT a lost start — it is a run that was deliberately never started, and
 *  flushing it here would push the day past its limit (the backstop would silently undo the
 *  throttle). The drain owns those; this lane owns runs whose START was lost. */
export async function refireStaleEventRuns(admin: SupabaseClient): Promise<string[]> {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: stale } = await admin.from('workflow_runs')
    .select('id, workflow_id, user_id')
    .eq('status', 'queued').eq('triggered_by', 'event')
    .lt('created_at', cutoff).limit(5);
  const refired: string[] = [];
  for (const r of (stale ?? []) as Array<{ id: string; workflow_id: string; user_id: string }>) {
    // Read the record BEFORE any claim — a deferred run must not even be touched here.
    const { data: fireRow } = await admin.from('item_plans').select('tasks')
      .eq('user_id', r.user_id).eq('kind', FIRE_KIND).eq('tasks->>runId', r.id).maybeSingle();
    if (fireRow && !fireStarted(fireRow.tasks)) continue; // throttled, waiting for the drain
    const { data: claimed } = await admin.from('workflow_runs')
      .update({ status: 'running' }).eq('id', r.id).eq('status', 'queued').select('id');
    if (!claimed?.length) continue; // someone else took it
    // Put it back to queued — runWorkflow owns the running transition; the claim only fenced racers.
    await admin.from('workflow_runs').update({ status: 'queued' }).eq('id', r.id);
    let context = (fireRow?.tasks as { context?: string } | undefined)?.context;
    if (!context) {
      // A SUBPROCESS CHILD writes a `subprocess_link` row, not a reaction_fire — its BATON (the
      // parent's handed-over context) lives on that row. Without this lookup a stale child
      // re-fires context-less: it still runs and still resumes its parent, but the parent's
      // material is silently lost in that rare path (W3 engine's noted gap, closed here).
      const { data: linkRow } = await admin.from('item_plans').select('tasks')
        .eq('user_id', r.user_id).eq('kind', 'subprocess_link')
        .eq('tasks->>childRunId', r.id).maybeSingle();
      context = (linkRow?.tasks as { context?: string } | undefined)?.context;
    }
    refired.push(r.id);
    const go = async () => {
      const { runWorkflow } = await import('@/lib/workflows/run-workflow');
      await runWorkflow({ workflowId: r.workflow_id, runId: r.id, triggerSource: 'event', triggerContext: context })
        .catch((e) => console.error('[reactions] backstop run failed:', e));
    };
    try {
      const { after } = await import('next/server');
      after(go);
    } catch {
      // No request scope (cron-less contexts, scripts): run inline — the run row is already claimed.
      await go();
    }
  }
  return refired;
}
