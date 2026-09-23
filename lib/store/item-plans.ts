// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE TYPED DOOR FOR `item_plans` (stabilization W2.6 TYPED STORES, R4 — docs/stabilization-plan.md).
//
// R4, verbatim: "`item_plans` = 36 kinds, no retention". The table began as the Identified-tasks plan
// cache (one row per (user, item-kind, item-id)) and became the house's zero-migration key/value store:
// verdict caches, exactly-once fire records, rotation markers, staging rows, per-workflow config. Every
// caller hand-wrote `.from('item_plans')…eq('kind', '…')`, so "which kinds exist, what shape is each
// `tasks` blob, and which ones may be pruned" had no answer but a grep.
//
// THIS MODULE IS THAT ANSWER:
//   • `ITEM_PLAN_REGISTRY` — ONE row per kind found in code (and the live orphans the census found),
//     each with a zod schema for its `tasks` jsonb, its role, what its KEY means, its home file and its
//     retention. A kind not in the registry cannot be read or written through the door (a type error).
//   • `readPlan` / `readPlans` (paged — NO SILENT CAPS) / `upsertPlan` / `insertPlan` / `updatePlan` /
//     `deletePlans` — the typed helpers. They never throw (store reads degrade to "absent", writes
//     report `{ error }`), matching what every raw call site already did.
//   • `ITEM_PLANS_RETENTION` — the per-kind retention table the retention cron reads (null = permanent).
//
// ⚠️ THE NAMING COLLISION, NAMED: the column is `entity_id`, but for almost every kind it holds an ITEM
// key (`inbox:<id>`, `commitment:<id>`, a workflow id, a room key, a literal like `user`) — NOT a
// `work_entities` id. The door calls it `key` everywhere; only this file spells the column.
//
// SCHEMA POLICY (deliberately permissive this wave — the goal is ONE door + a registry, not a data
// migration): unknown fields never fail a schema, and every known field is optional + nullable.
// A stored row that fails its schema is NEVER dropped on read (it predates its schema, or a writer
// drifted) — it is served as stored and warned once per kind per process. A write that fails its schema
// is warned, then written (the caller's behaviour is unchanged; the warning is the drift signal).
//
// THE GATE: scripts/smoke-typed-stores.ts — every raw `.from('item_plans')` outside this file is on an
// explicit allowlist naming its kind(s); the allowlist can only shrink.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/utils/fetch-all';

/** Any Supabase client (user-scoped or admin). Call sites hold several client shapes; the door only
 *  needs the query builder. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StoreClient = SupabaseClient | any;

const TABLE = 'item_plans';
const ON_CONFLICT = 'user_id,kind,entity_id';

// ── Schemas ─────────────────────────────────────────────────────────────────────────────────────
// `z.object` (not strict): unknown fields are NOT a failure — and the door never serves the parsed
// OUTPUT (it validates, then returns the stored value untouched), so nothing is ever stripped. The
// inferred types carry no index signature on purpose: interface-typed records stay assignable.
const obj = <T extends z.ZodRawShape>(shape: T) => z.object(shape);
/** Any JSON object — the permissive schema for kinds whose shape is owned by one home module. */
const anyObj = z.custom<object>((v) => typeof v === 'object' && v !== null, { message: 'expected an object' });
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();
const str = opt(z.string());
const num = opt(z.number());
const bool = opt(z.boolean());

/** The Identified-tasks plan (the table's original use): an array of graded steps. */
const planSteps = z.array(obj({ id: str, text: str, actor: str, done: bool, dismissed: bool, detail: str, status: str, capability: str }));

/** Verdict caches: `{ sig, verdict }`. */
const sigVerdict = obj({ sig: str, verdict: z.unknown().optional() });

export type PlanRole =
  | 'plan'      // the Identified-tasks step list (key = the item id)
  | 'cache'     // a recomputable AI/law answer — losing it costs a re-spend, never correctness
  | 'record'    // durable state a surface or law reads (config, ledgers, manifests) — never prune
  | 'token'     // an exactly-once dedupe / claim — losing it lets something RE-FIRE; never prune
  | 'marker'    // a rotation / last-served stamp (one row per user)
  | 'staging'   // a short-lived row between a card and its commit door
  | 'orphan';   // present in the live table, no code reads or writes it (census, Sep 23)

export interface PlanKindSpec {
  schema: z.ZodTypeAny;
  role: PlanRole;
  /** What the `entity_id` column holds for this kind. */
  key: string;
  /** The module that owns the kind's semantics. */
  home: string;
  /** Days after `created_at` the retention sweep may prune a row; null = permanent. */
  retentionDays: number | null;
}

const spec = <S extends z.ZodTypeAny = typeof anyObj>(
  role: PlanRole, key: string, home: string, schema?: S, retentionDays: number | null = null,
): PlanKindSpec & { schema: S } => ({ schema: (schema ?? anyObj) as S, role, key, home, retentionDays });

/**
 * THE REGISTRY — every kind, one row. Adding a kind = one row here (the gate fails a raw write of an
 * unregistered kind literal). Retention: only rows whose evidence is written in
 * app/api/cron/retention/route.ts's header carry a number.
 */
export const ITEM_PLAN_REGISTRY = {
  // ── the Identified-tasks plans (the table's first tenant) ──
  email:       spec('plan', 'inbox item id', 'lib/home/item-plan.ts', planSteps),
  meeting:     spec('plan', 'meeting transcript id', 'lib/home/item-plan.ts', planSteps),
  commitment:  spec('plan', 'commitment id', 'lib/home/item-plan.ts + lib/commitments/extract.ts', planSteps),
  awareness:   spec('plan', 'inbox item id', 'lib/home/item-plan.ts', planSteps),
  followup:    spec('plan', 'commitment id', 'lib/home/item-plan.ts', planSteps),

  // ── the brain's verdict caches ──
  // `ev` (W7.1): the evidence set the verdict was judged against — the re-judgment's prior-vs-new-evidence read.
  judgment:             spec('cache', '`inbox:<id>` | `commitment:<id>`', 'lib/work/judge.ts', obj({ sig: str, verdict: z.unknown().optional(), ev: str })),
  fulfillment:          spec('cache', '`<kind>:<obligation id>`', 'lib/commitments/fulfillment.ts', sigVerdict),
  expiry:               spec('cache', '`commitment:<id>`', 'lib/commitments/expiry.ts', sigVerdict),
  room_brief:           spec('cache', 'room key (entity id | `<kind>:<id>`)', 'lib/room/brief.ts',
    obj({ v: num, sig: str, text: str, move: z.unknown().optional(), offers: opt(z.array(z.unknown())), at: str })),
  reply_directions:     spec('cache', 'inbox item id', 'app/api/items/reply-directions/route.ts', obj({ v: num, sig: str, directions: opt(z.array(z.unknown())) })),
  conversation_pair:    spec('cache', '`conv:<v>:<threadA>|<threadB>`', 'lib/inbox/conversation-identity.ts',
    obj({ v: num, same: bool, evidence: str, reason: str })),
  judgment_nomination:  spec('cache', 'judgment key', 'lib/inbox/conversation-identity.ts'),
  conversation_cascade: spec('cache', '`cascade:<threadId>`', 'lib/inbox/conversation-identity.ts'),
  campaign_signature:   spec('cache', '`campaign:signature`', 'lib/inbox/campaign-echo.ts'),
  date_stated:          spec('cache', '`date_stated:<iso>:<hash>`', 'lib/utils/user-time.ts', obj({ iso: str, stated: bool })),
  day_state:            spec('cache', '`global`', 'lib/home/day-state.ts'),
  day_anchors:          spec('cache', '`attention`', 'lib/home/day-anchors.ts'),
  outcome_facts:        spec('cache', '`user`', 'lib/prepare/outcome-facts.ts'),
  timeline_cache:       spec('cache', '`home`', 'app/api/home/timeline/route.ts'),
  held_cache:           spec('cache', '`home`', 'lib/deeds/held-cache.ts'),

  // ── the preparation ledger + queues ──
  prep_outcome:  spec('record', 'judgment key', 'lib/prepare/pass.ts',
    obj({ did: str, reason: str, worker: str, lane: str, at: str }), 180),
  prep_requeue:  spec('marker', 'judgment key', 'lib/prepare/requeue.ts', obj({ at: str, by: str, verdict: str })),
  proof_of_life: spec('token', 'judgment key', 'lib/work/proof-of-life.ts'),
  anticipation:  spec('token', 'fire key (`meeting:<id>:<start>` | `due:<key>` | `last_run` …)', 'lib/home/anticipation.ts'),
  verdict_resolve_roll: spec('record', 'judgment key', 'lib/work/apply-verdict.ts'),
  catch_up:      spec('token', 'claim key', 'lib/work/catch-up.ts'),

  // ── sweep rotation + claims ──
  sweep_claim:    spec('token', 'lane (`judgment` | `draft` | `evidence`)', 'lib/work/sweep-fanout.ts', obj({ at: str })),
  judgment_sweep: spec('marker', '`user`', 'lib/work/sweep-users.ts', obj({ at: str })),
  draft_sweep:    spec('marker', '`user`', 'lib/work/sweep-users.ts', obj({ at: str })),
  label_sweep:    spec('marker', '`user`', 'lib/work/sweep-users.ts', obj({ at: str })),
  evidence_sweep: spec('marker', '`user`', 'lib/work/sweep-users.ts', obj({ at: str })),

  // ── staging between a card and its commit door ──
  chat_email:     spec('staging', 'draft id', 'lib/prepare/chat-email-store.ts', anyObj, 180),
  chat_invite:    spec('staging', 'invite id', 'lib/prepare/chat-invite-store.ts', anyObj, 180),
  pending_change: spec('staging', 'change id', 'lib/work/pending-change.ts',
    obj({ id: str, tool: str, status: str, expiresAt: str, createdAt: str })),
  bulk_deed:      spec('token', 'bulk deed id', 'lib/deeds/bulk.ts'),

  // ── rooms ──
  room_scope: spec('record', 'room key', 'app/api/rooms/adopt/route.ts', obj({ at: str, entityId: str, entityName: str })),
  room_title: spec('record', 'room key', 'app/api/rooms/title/route.ts'),
  room_read:  spec('record', 'room key', 'lib/room/read-marker.ts', obj({ at: str, prevAt: str, stampedAt: str })),
  dm_present: spec('record', 'thread key', 'lib/present/dm-channel.ts'),
  cos_seat:   spec('record', 'seat key', 'lib/workers/cos-seat.ts'),

  // ── workflows ──
  workflow_inputs:  spec('record', 'workflow id', 'lib/workflows/inputs.ts',
    obj({ docs: opt(z.array(z.unknown())), acceptMaterial: bool })),
  workflow_owner:   spec('record', 'workflow id', 'lib/workflows/owner.ts'),
  workflow_scope:   spec('record', 'workflow id', 'lib/workflows/entity-edge.ts'),
  workflow_limit:   spec('record', 'workflow id', 'lib/workflows/fire-limit.ts'),
  workflow_case:    spec('record', '`<workflowId>:<case>`', 'lib/workflows/case-step.ts'),
  run_case:         spec('record', 'run id', 'lib/workflows/case-step.ts'),
  reaction_fire:    spec('token', '`<workflowId>:<source>:<event>`', 'lib/workflows/reactions.ts'),
  subprocess_link:  spec('token', '`<parentRunId>:<stepId>`', 'lib/workflows/subprocess.ts'),
  handoff_override: spec('record', 'run id', 'lib/workflows/handoffs.ts'),
  handoff_nudge:    spec('token', '`<runId>:<day>`', 'lib/workflows/handoffs.ts', z.array(z.unknown())),
  frame_share:      spec('record', 'frame id', 'lib/frames/share.ts'),

  // ── documents · matching · tenders ──
  doc_theme:                spec('record', 'theme scope', 'lib/documents/theme.ts'),
  profile_manifest:         spec('record', 'folder name', 'lib/matching/manifest.ts'),
  match_seen:               spec('record', 'workflow scope', 'lib/matching/match-profiles.ts'),
  tender_member_manifest:   spec('record', '`me`', 'lib/tenders/member-directory.ts'),
  tender_member_enrichment: spec('record', '`me`', 'lib/tenders/enrich-members.ts'),

  // ── platform ──
  status_alert: spec('token', 'problem-set key', 'app/api/cron/status-alerts/route.ts'),
  autonomy:     spec('record', 'ledger key', 'lib/autonomy/ledger.ts (PARKED design record)'),

  // ── live orphans (census Sep 23: rows exist, no code references the kind) ──
  tender_seen: spec('orphan', '`me`', '(none — superseded by match_seen)'),
} as const satisfies Record<string, PlanKindSpec>;

export type ItemPlanStoreKind = keyof typeof ITEM_PLAN_REGISTRY;
export type PlanTasks<K extends ItemPlanStoreKind> = z.infer<(typeof ITEM_PLAN_REGISTRY)[K]['schema']>;

export const ITEM_PLAN_KINDS = Object.keys(ITEM_PLAN_REGISTRY) as ItemPlanStoreKind[];
export const isItemPlanKind = (k: string): k is ItemPlanStoreKind => Object.prototype.hasOwnProperty.call(ITEM_PLAN_REGISTRY, k);

/** THE RETENTION TABLE — kind → days after created_at (only kinds with a number; the rest are permanent).
 *  Read by app/api/cron/retention/route.ts. */
export const ITEM_PLANS_RETENTION: Readonly<Partial<Record<ItemPlanStoreKind, number>>> = Object.freeze(
  Object.fromEntries(
    Object.entries(ITEM_PLAN_REGISTRY)
      .filter(([, s]) => (s as PlanKindSpec).retentionDays != null)
      .map(([k, s]) => [k, (s as PlanKindSpec).retentionDays as number]),
  ),
);

// ── Validation (warn, never drop) ───────────────────────────────────────────────────────────────
const warned = new Set<string>();
function checkTasks<K extends ItemPlanStoreKind>(kind: K, tasks: unknown, dir: 'read' | 'write'): PlanTasks<K> {
  const res = (ITEM_PLAN_REGISTRY[kind].schema as z.ZodTypeAny).safeParse(tasks);
  if (!res.success && !warned.has(`${dir}:${kind}`)) {
    warned.add(`${dir}:${kind}`);
    console.warn(`[item-plans] schema drift on ${dir} of kind '${kind}': ${res.error.issues.slice(0, 2).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  return tasks as PlanTasks<K>;
}

/** Validate a candidate `tasks` value against its kind's schema (for gates and callers that want it). */
export function planTasksValid(kind: ItemPlanStoreKind, tasks: unknown): boolean {
  return (ITEM_PLAN_REGISTRY[kind].schema as z.ZodTypeAny).safeParse(tasks).success;
}

// ── The helpers ─────────────────────────────────────────────────────────────────────────────────
export interface PlanRow<K extends ItemPlanStoreKind> {
  id: string;
  key: string;
  tasks: PlanTasks<K>;
  created_at: string | null;
  updated_at: string | null;
}

const ROW_COLS = 'id, entity_id, tasks, created_at, updated_at';
type RawRow = { id: string; entity_id: string; tasks: unknown; created_at: string | null; updated_at: string | null };
const toRow = <K extends ItemPlanStoreKind>(kind: K, r: RawRow): PlanRow<K> => ({
  id: String(r.id), key: String(r.entity_id), tasks: checkTasks(kind, r.tasks ?? null, 'read'),
  created_at: r.created_at ?? null, updated_at: r.updated_at ?? null,
});

/** One row by (user, kind, key). `null` = absent OR unreadable (a store read never throws). */
export async function readPlan<K extends ItemPlanStoreKind>(
  client: StoreClient, userId: string, kind: K, key: string,
): Promise<PlanRow<K> | null> {
  try {
    const { data, error } = await client.from(TABLE).select(ROW_COLS)
      .eq('user_id', userId).eq('kind', kind).eq('entity_id', key).maybeSingle();
    if (error || !data) return null;
    return toRow(kind, data as RawRow);
  } catch { return null; }
}

export interface ReadPlansOpts {
  /** Only these keys (chunked internally — never one giant `in()`). */
  keys?: string[];
  /** Only keys starting with this prefix. */
  keyPrefix?: string;
  /** Sort column + direction. Default `key` ascending (stable, unique per user+kind — safe paging). */
  order?: { by: 'key' | 'updated_at' | 'created_at'; ascending?: boolean };
  /** An EXPLICIT newest/oldest-N read (a stated bound, never a silent cap). Omit = every row, paged. */
  limit?: number;
  /** false = metadata only (key + timestamps; `tasks` reads as null) — for age/ledger scans over
   *  heavy blobs (the judgment verdicts). Default true. */
  withTasks?: boolean;
}

/** Many rows of one kind for one user — PAGED through fetchAllRows (NO SILENT CAPS) unless the caller
 *  states an explicit `limit`. An unreadable store reads as empty. */
export async function readPlans<K extends ItemPlanStoreKind>(
  client: StoreClient, userId: string, kind: K, opts: ReadPlansOpts = {},
): Promise<PlanRow<K>[]> {
  const col = opts.order?.by === 'key' || !opts.order ? 'entity_id' : opts.order.by;
  const ascending = opts.order?.ascending ?? true;
  const cols = opts.withTasks === false ? 'id, entity_id, created_at, updated_at' : ROW_COLS;
  const build = (keys?: string[]) => {
    let q = client.from(TABLE).select(cols).eq('user_id', userId).eq('kind', kind);
    if (keys) q = q.in('entity_id', keys);
    if (opts.keyPrefix) q = q.like('entity_id', `${opts.keyPrefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    q = q.order(col, { ascending });
    if (col !== 'entity_id') q = q.order('entity_id', { ascending: true }); // stable page boundaries
    return q;
  };
  try {
    if (opts.keys && !opts.keys.length) return [];
    const run = async (keys?: string[]): Promise<RawRow[]> => {
      if (opts.limit != null) {
        const { data, error } = await build(keys).limit(Math.max(1, opts.limit));
        return error ? [] : ((data ?? []) as RawRow[]);
      }
      return fetchAllRows<RawRow>((from, to) => build(keys).range(from, to));
    };
    let rows: RawRow[] = [];
    if (opts.keys) {
      const uniq = [...new Set(opts.keys)];
      for (let i = 0; i < uniq.length; i += 200) rows.push(...(await run(uniq.slice(i, i + 200))));
      if (opts.limit != null) rows = rows.slice(0, opts.limit);
    } else rows = await run();
    if (opts.withTasks === false) {
      return rows.map((r) => ({
        id: String(r.id), key: String(r.entity_id), tasks: null as unknown as PlanTasks<K>,
        created_at: r.created_at ?? null, updated_at: r.updated_at ?? null,
      }));
    }
    return rows.map((r) => toRow(kind, r));
  } catch { return []; }
}

/** One kind's rows across MANY users (rotation markers read by the sweeps) — paged. */
export async function readPlansForUsers<K extends ItemPlanStoreKind>(
  client: StoreClient, userIds: string[], kind: K, opts: { maxRows?: number } = {},
): Promise<Array<PlanRow<K> & { user_id: string }>> {
  if (!userIds.length) return [];
  try {
    const rows = await fetchAllRows<RawRow & { user_id: string }>((from, to) =>
      client.from(TABLE).select(`user_id, ${ROW_COLS}`)
        .eq('kind', kind).in('user_id', userIds)
        .order('updated_at', { ascending: false }).order('id', { ascending: true }).range(from, to),
    { maxRows: opts.maxRows ?? 5000 });
    return rows.map((r) => ({ ...toRow(kind, r), user_id: String(r.user_id) }));
  } catch { return []; }
}

/** One kind's rows by KEY across all users (ADMIN reads only — e.g. a workflow's owner record, which
 *  lives under the owner's row, not the reader's). Chunked `in()` + paged: never one giant filter. */
export async function readPlansByKeysAnyUser<K extends ItemPlanStoreKind>(
  admin: StoreClient, kind: K, keys: string[],
): Promise<Array<PlanRow<K> & { user_id: string }>> {
  const uniq = [...new Set(keys)];
  const out: Array<PlanRow<K> & { user_id: string }> = [];
  try {
    for (let i = 0; i < uniq.length; i += 200) {
      const slice = uniq.slice(i, i + 200);
      const rows = await fetchAllRows<RawRow & { user_id: string }>((from, to) =>
        admin.from(TABLE).select(`user_id, ${ROW_COLS}`)
          .eq('kind', kind).in('entity_id', slice)
          .order('entity_id', { ascending: true }).order('id', { ascending: true }).range(from, to));
      for (const r of rows) out.push({ ...toRow(kind, r), user_id: String(r.user_id) });
    }
  } catch { /* partial is still better than none — callers carry their own fallback */ }
  return out;
}

export interface WriteResult { error: { message: string; code?: string } | null }

/** Upsert on (user, kind, key). Stamps `updated_at` unless the caller supplies one. Never throws. */
export async function upsertPlan<K extends ItemPlanStoreKind>(
  client: StoreClient, userId: string, kind: K, key: string, tasks: PlanTasks<K>,
  opts: { updatedAt?: string; version?: number; stampUpdatedAt?: boolean } = {},
): Promise<WriteResult> {
  try {
    const row: Record<string, unknown> = { user_id: userId, kind, entity_id: key, tasks: checkTasks(kind, tasks, 'write') };
    if (opts.stampUpdatedAt !== false) row.updated_at = opts.updatedAt ?? new Date().toISOString();
    if (opts.version != null) row.version = opts.version;
    const { error } = await client.from(TABLE).upsert(row, { onConflict: ON_CONFLICT });
    return { error: error ?? null };
  } catch (e) { return { error: { message: e instanceof Error ? e.message : String(e) } }; }
}

/** Plain INSERT — the exactly-once claim idiom: the unique (user, kind, key) index settles the race;
 *  `inserted` is true only for the one winner. Never throws. */
export async function insertPlan<K extends ItemPlanStoreKind>(
  client: StoreClient, userId: string, kind: K, key: string, tasks: PlanTasks<K>,
): Promise<WriteResult & { inserted: boolean }> {
  try {
    const { data, error } = await client.from(TABLE)
      .insert({ user_id: userId, kind, entity_id: key, tasks: checkTasks(kind, tasks, 'write') })
      .select('id');
    return { error: error ?? null, inserted: !error && ((data ?? []) as unknown[]).length > 0 };
  } catch (e) { return { error: { message: e instanceof Error ? e.message : String(e) }, inserted: false }; }
}

/** UPDATE the row's tasks (never inserts). `where` adds conditional filters for compare-and-set claims
 *  (e.g. `q => q.lt('tasks->>at', cutoff)`); `updated` = rows actually changed. Never throws. */
export async function updatePlan<K extends ItemPlanStoreKind>(
  client: StoreClient, userId: string, kind: K, key: string, tasks: PlanTasks<K>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts: { where?: (q: any) => any; updatedAt?: string } = {},
): Promise<WriteResult & { updated: number }> {
  try {
    let q = client.from(TABLE)
      .update({ tasks: checkTasks(kind, tasks, 'write'), updated_at: opts.updatedAt ?? new Date().toISOString() })
      .eq('user_id', userId).eq('kind', kind).eq('entity_id', key);
    if (opts.where) q = opts.where(q);
    const { data, error } = await q.select('id');
    return { error: error ?? null, updated: error ? 0 : ((data ?? []) as unknown[]).length };
  } catch (e) { return { error: { message: e instanceof Error ? e.message : String(e) }, updated: 0 }; }
}

/** DELETE one key, several keys, or (keys omitted) every row of the kind for this user. Never throws. */
export async function deletePlans<K extends ItemPlanStoreKind>(
  client: StoreClient, userId: string, kind: K, keys?: string | string[],
): Promise<WriteResult> {
  try {
    let q = client.from(TABLE).delete().eq('user_id', userId).eq('kind', kind);
    if (typeof keys === 'string') q = q.eq('entity_id', keys);
    else if (Array.isArray(keys)) {
      if (!keys.length) return { error: null };
      q = q.in('entity_id', keys);
    }
    const { error } = await q;
    return { error: error ?? null };
  } catch (e) { return { error: { message: e instanceof Error ? e.message : String(e) } }; }
}

/** THE MIGRATION ADAPTER: door rows projected back onto the raw column names, wrapped as a PostgREST
 *  `{ data }` — for a migrated call site whose downstream (a Promise.all consumer, a Map keyed on
 *  `entity_id`) still speaks the raw shape. New code reads `row.key` directly. */
export function asRawResult<K extends ItemPlanStoreKind>(rows: PlanRow<K>[]): {
  data: Array<{ entity_id: string; tasks: PlanTasks<K>; updated_at: string | null; created_at: string | null }>;
} {
  return { data: rows.map((r) => ({ entity_id: r.key, tasks: r.tasks, updated_at: r.updated_at, created_at: r.created_at })) };
}
