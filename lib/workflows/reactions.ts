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
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { normalizeTriggers, type ReactionDoor, type TriggerSourceKey } from '@/lib/workflows/trigger-sources';

const FIRE_KIND = 'reaction_fire';
const DAILY_CAP = 5;

export interface ReactionCheckResult { considered: number; fired: number; capped: number }

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

/** A door that cannot be judged (or bound) can never fire honestly — readiness says so on the row;
 *  here it is simply skipped. */
function doorIsUsable(d: ReactionDoor): boolean {
  if (d.source === 'workflow') return !!(d.workflow_id ?? '').trim();
  return (d.when ?? '').trim().length > 3;
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
        return {
          id: String(it.id),
          title: String(it.work_title ?? sd.subject ?? 'Email').slice(0, 120),
          from: (sd.from_name as string) ?? (sd.from_address as string) ?? null,
          gist: String(sd.snippet ?? sd.body_preview ?? sd.body ?? '').replace(/\s+/g, ' ').slice(0, 500),
        };
      });
    if (!items.length) return { considered: 0, fired: 0, capped: 0 };

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

/** THE ONE LOOP — scope · exactly-once · daily cap · (structural match | one batched judgment) ·
 *  fire. Identical for every source; only the candidate builder above differs. */
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

  // Exactly-once + the honest daily cap.
  const todayIso = new Date(new Date().toISOString().slice(0, 10)).toISOString();
  const { data: fires } = await admin.from('item_plans').select('entity_id, created_at')
    .eq('user_id', userId).eq('kind', FIRE_KIND)
    .gte('created_at', todayIso).limit(400);
  const firedKeys = new Set(((fires ?? []) as Array<{ entity_id: string }>).map(f => f.entity_id));
  const todayCount = new Map<string, number>();
  for (const f of (fires ?? []) as Array<{ entity_id: string }>) {
    const wfId = f.entity_id.split(':')[0];
    todayCount.set(wfId, (todayCount.get(wfId) ?? 0) + 1);
  }

  let fired = 0, capped = 0, considered = 0;
  for (const wf of wfs) {
    const scopeEntity = scopeByWf.get(wf.id) ?? null;
    const candidates = events.filter(i =>
      !firedKeys.has(`${wf.id}:${token}:${i.id}`) &&
      (!scopeEntity || (i.entityId ?? null) === scopeEntity));
    if (!candidates.length) continue;
    considered += candidates.length;

    if ((todayCount.get(wf.id) ?? 0) >= DAILY_CAP) {
      capped += candidates.length;
      console.warn(`[reactions] "${wf.name}" hit the daily cap (${DAILY_CAP}) — ${candidates.length} event(s) not judged today`);
      continue;
    }

    // A workflow may hold several doors of the same source; the FIRST that matches an event fires
    // it (the exactly-once key is per event, so a second door can never double-fire the same one).
    const firedHere = new Set<string>();
    for (const door of wf.doors) {
      const matched = door.source === 'workflow'
        // STRUCTURAL, NOT JUDGED: composition is deterministic — no AI call.
        // THE SELF-LOOP FLOOR (W1 fire doors): a workflow whose own door names ITSELF must never be
        // fired by its own delivery. The exactly-once key carries the delivering RUN's id (a new
        // one every time), so without this the chain would be infinite — bounded only by DAILY_CAP,
        // which is a cap, not a floor.
        ? candidates
            .filter(c => (c.sourceId ?? '') === (door.workflow_id ?? '') && (c.sourceId ?? '') !== wf.id)
            .map(c => ({ id: c.id, reason: 'the upstream workflow delivered' }))
        : await judgeCandidates(admin, userId, door.when!, candidates);

      for (const m of matched) {
        if (firedHere.has(m.id) || firedKeys.has(`${wf.id}:${token}:${m.id}`)) continue;
        if ((todayCount.get(wf.id) ?? 0) >= DAILY_CAP) {
          capped++;
          console.warn(`[reactions] "${wf.name}" daily cap reached mid-batch — skipping further fires`);
          break;
        }
        const item = candidates.find(c => c.id === m.id);
        if (!item) continue;
        const ok = await fireReaction(admin, userId, wf, item, m.reason, token);
        if (ok) {
          fired++; firedHere.add(m.id); firedKeys.add(`${wf.id}:${token}:${m.id}`);
          todayCount.set(wf.id, (todayCount.get(wf.id) ?? 0) + 1);
        }
      }
      if ((todayCount.get(wf.id) ?? 0) >= DAILY_CAP) break;
    }
  }
  return { considered, fired, capped };
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

async function fireReaction(
  admin: SupabaseClient, userId: string,
  wf: { id: string; name: string },
  item: ReactionEvent,
  reason: string,
  token: string,
): Promise<boolean> {
  try {
    const context = triggerBlock(item) + (reason ? `\n(Judged match: ${reason})` : '');
    // The queued run row FIRST — the ledger sees it, and the dispatcher backstop can re-fire it.
    const { data: run, error: runErr } = await admin.from('workflow_runs').insert({
      workflow_id: wf.id, user_id: userId, status: 'queued', triggered_by: 'event',
    }).select('id').single();
    if (runErr || !run) { console.error(`[reactions] enqueue failed for "${wf.name}":`, runErr); return false; }
    const runId = (run as { id: string }).id;

    // The exactly-once record — carries the context so the BACKSTOP path can rebuild it.
    await admin.from('item_plans').insert({
      // ⚠️ `token` is the SOURCE token — 'inbox' for mail (historical, never changed) else the
      // registry key. Changing mail's would re-fire every already-handled email.
      user_id: userId, kind: FIRE_KIND, entity_id: `${wf.id}:${token}:${item.id}`,
      tasks: { runId, reason, context, firedAt: new Date().toISOString() },
    });

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
    return true;
  } catch (e) {
    console.error('[reactions] fire failed:', e);
    return false;
  }
}

/** THE BACKSTOP — called by the hourly dispatcher: any event-run still queued after 10 minutes
 *  lost its inline attempt (crash, cold script, missing request scope). Re-fire with the stored
 *  context. Exactly-once at the run row: the atomic queued→running claim loses gracefully. */
export async function refireStaleEventRuns(admin: SupabaseClient): Promise<string[]> {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: stale } = await admin.from('workflow_runs')
    .select('id, workflow_id, user_id')
    .eq('status', 'queued').eq('triggered_by', 'event')
    .lt('created_at', cutoff).limit(5);
  const refired: string[] = [];
  for (const r of (stale ?? []) as Array<{ id: string; workflow_id: string; user_id: string }>) {
    const { data: claimed } = await admin.from('workflow_runs')
      .update({ status: 'running' }).eq('id', r.id).eq('status', 'queued').select('id');
    if (!claimed?.length) continue; // someone else took it
    // Put it back to queued — runWorkflow owns the running transition; the claim only fenced racers.
    await admin.from('workflow_runs').update({ status: 'queued' }).eq('id', r.id);
    const { data: fireRow } = await admin.from('item_plans').select('tasks')
      .eq('user_id', r.user_id).eq('kind', FIRE_KIND).eq('tasks->>runId', r.id).maybeSingle();
    const context = (fireRow?.tasks as { context?: string } | undefined)?.context;
    refired.push(r.id);
    const { after } = await import('next/server');
    const { runWorkflow } = await import('@/lib/workflows/run-workflow');
    after(async () => {
      await runWorkflow({ workflowId: r.workflow_id, runId: r.id, triggerSource: 'event', triggerContext: context })
        .catch((e) => console.error('[reactions] backstop run failed:', e));
    });
  }
  return refired;
}
