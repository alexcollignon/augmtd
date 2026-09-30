// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — THE FIXTURE WORLD. One declarative DSL for the raw records a case needs (people, email
// threads, commitments as stated, calendar events, projects, KB files, voice samples), seeded onto a
// PROBE HOST through the same DB shapes the product reads (explicit columns, every error checked),
// and torn down fully. Every relative time resolves against ONE run clock, so "9 days quiet" never
// rots and the plain columns (neutral.ts) see exactly the dates AUGMTD sees.
//
// Safety, by construction:
//   · seedWorld REFUSES any user that is not a probe host (auth email checked, never trusted).
//   · every seed is tagged and gets FRESH ids (producers cache on ids/signatures — a repeat on the
//     same ids would be served from cache and measure nothing).
//   · teardownWorld deletes the ledger + every derived row keyed to a seeded id, then verifies.
//   · probeWriteVerdict (pure) backs a fetch fence: a write that names a non-probe user_id aborts.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

// ── THE DSL ─────────────────────────────────────────────────────────────────────────────────────

/** A time: 'now' · '-3d' · '-3d 09:30' · '+2d 14:00' · '-2h' · '-45m' · an ISO timestamp. Day
 *  offsets with a clock time are wall-clock times in the world's timezone. */
export type When = string;

export type WorldPerson = {
  key: string;
  /** A generic first name (+ optional role) — never a real person (FIXTURES.md). */
  name: string;
  email: string;
  org?: string;
  role?: string;
};

export type WorldMessage = {
  key?: string;
  /** A person key, or 'me'. */
  from: string;
  /** Person keys / 'me' / literal addresses. Default: 'me' when from someone else, else the thread's first external sender. */
  to?: string[];
  cc?: string[];
  at: When;
  body: string;
  /** Defaults to the thread subject ("Re: " added after the first message). */
  subject?: string;
  /** File names attached (the body should reference them the way a human would). */
  attachments?: string[];
};

export type WorldThread = {
  key: string;
  subject: string;
  messages: WorldMessage[];
  /** The inbox item for this thread (default: one, anchored on the first inbound message).
   *  false = no item (e.g. a thread that only feeds evidence). */
  item?: boolean | { key?: string; anchor?: string };
  /** Automated-sender signals the sync would have stamped (bulk / notifications). */
  signals?: { isAutomatedSender?: boolean; isNotification?: boolean };
};

export type WorldCommitment = {
  key: string;
  direction: 'you_owe' | 'awaiting';
  description: string;
  /** Person key or a free-text counterparty. */
  counterparty?: string;
  /** A When; stored as the YYYY-MM-DD in the world timezone. */
  due?: When;
  thread?: string;
  createdAt?: When;
  source?: 'email' | 'manual' | 'meeting';
};

export type WorldEvent = {
  key: string;
  title: string;
  start: When;
  minutes?: number;
  attendees?: string[];
  description?: string;
  location?: string;
};

export type WorldProject = {
  key: string;
  name: string;
  summary?: string;
  goals?: string[];
  /** Thread keys (their inbox item) and commitment keys linked to the project. */
  links?: string[];
};

export type WorldDoc = {
  key: string; filename: string; text: string;
  /** Compute the file + chunk embeddings at seed time through the product's own embedding path (so
   *  resolveRequirements / KB search can find the file). Default: the world's `embedKb`, else off. */
  embed?: boolean;
};

export type World = {
  /** The user. Defaults: Taylor <taylor@northwind.test>. */
  me?: { name?: string; email?: string };
  /** IANA zone for wall-clock Whens (default UTC — the probe host's zone). */
  tz?: string;
  people?: WorldPerson[];
  threads?: WorldThread[];
  commitments?: WorldCommitment[];
  events?: WorldEvent[];
  projects?: WorldProject[];
  kb?: WorldDoc[];
  /** World-level default for `kb[].embed` (input-ask sets it: the asked-for file must be findable). */
  embedKb?: boolean;
  /** Bodies of mails the user sent before (voice samples), oldest first. */
  voiceSamples?: string[];
};

export const DEFAULT_ME = { name: 'Taylor', email: 'taylor@northwind.test' } as const;

export const PROBE_EMAILS = {
  standard: 'smoke-probe@augmtd-internal.test',
  eu: 'smoke-probe-eu@augmtd-internal.test',
} as const;

// ── THE PROBE POOL ──────────────────────────────────────────────────────────────────────────────
// N identical, isolated test accounts per tier (one live world per account → AUGMTD units run in
// parallel with full isolation). Account #1 of each tier is its original probe host above; #k (k ≥ 2)
// is `smoke-probe-pool-<k>@…` (standard — NOT `smoke-probe-<k>@`: smoke-run-record.ts already uses
// smoke-probe-2/3 as workflow co-members) or `smoke-probe-eu-<k>@…` (EU). Exact addresses only.

/** Pool accounts per tier, at most (k = 1..POOL_MAX). */
export const POOL_MAX = 8;

/** The address of pool account #k of a tier (#1 = the tier's original probe host). */
export function probePoolEmail(tier: 'standard' | 'eu', k: number): string {
  if (!Number.isInteger(k) || k < 1 || k > POOL_MAX) throw new Error(`probe pool: account #${k} out of range 1..${POOL_MAX}`);
  if (k === 1) return PROBE_EMAILS[tier];
  return tier === 'standard' ? `smoke-probe-pool-${k}@augmtd-internal.test` : `smoke-probe-eu-${k}@augmtd-internal.test`;
}

/** Which probe host an address is (pure; exact match against the pool's addresses), or null. */
export function probeHostOf(email: string | null | undefined): { tier: 'standard' | 'eu'; k: number } | null {
  const e = String(email ?? '').trim().toLowerCase();
  for (const tier of ['standard', 'eu'] as const) for (let k = 1; k <= POOL_MAX; k++) if (probePoolEmail(tier, k) === e) return { tier, k };
  return null;
}

// ── TIME ────────────────────────────────────────────────────────────────────────────────────────

/** Offset (ms) of `tz` from UTC at instant `d` (positive east). */
export function tzOffsetMs(tz: string, d: Date): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0');
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The local YYYY-MM-DD of an instant in `tz`. */
export function localDate(d: Date, tz = 'UTC'): string {
  return new Date(d.getTime() + tzOffsetMs(tz, d)).toISOString().slice(0, 10);
}

/** The local HH:MM of an instant in `tz`. */
export function localClock(d: Date, tz = 'UTC'): string {
  return new Date(d.getTime() + tzOffsetMs(tz, d)).toISOString().slice(11, 16);
}

const REL_RE = /^([+-]\d+)([dhm])(?:\s+(\d{1,2}):(\d{2}))?$/;

/** Resolve a When against the run clock. Throws on an unreadable expression (a fixture bug). */
export function resolveWhen(expr: When, now: Date, tz = 'UTC'): Date {
  const s = String(expr).trim();
  if (s === 'now') return new Date(now.getTime());
  const m = REL_RE.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (m[2] === 'h') return new Date(now.getTime() + n * 3_600_000);
    if (m[2] === 'm') return new Date(now.getTime() + n * 60_000);
    // Day offset: move the LOCAL date, then (optionally) set the local wall clock.
    const day = new Date(`${localDate(now, tz)}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + n);
    if (m[3] == null) {
      // Same local clock as now, n days away.
      const clock = localClock(now, tz);
      return zonedToUtc(day.toISOString().slice(0, 10), clock, tz);
    }
    const hh = String(Number(m[3])).padStart(2, '0');
    return zonedToUtc(day.toISOString().slice(0, 10), `${hh}:${m[4]}`, tz);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`world: unreadable time "${expr}" (use 'now', '-3d', '-3d 09:30', '+2h' or ISO)`);
  return d;
}

/** A local wall time (date + HH:MM in `tz`) → the UTC instant. */
export function zonedToUtc(dateStr: string, hhmm: string, tz = 'UTC'): Date {
  const guess = new Date(`${dateStr}T${hhmm}:00Z`);
  const off1 = tzOffsetMs(tz, guess);
  const d1 = new Date(guess.getTime() - off1);
  const off2 = tzOffsetMs(tz, d1); // DST edge: re-evaluate at the corrected instant
  return off2 === off1 ? d1 : new Date(guess.getTime() - off2);
}

/** A Supabase/PostgREST error, SAID (W28): some failures arrive with no `message` (a gateway 5xx with an
 *  empty or HTML body under load — the "read item: undefined" runs), so every field that says anything
 *  is kept: message · code · details · hint · status, else the raw object. Never "undefined". Pure. */
export function dbErr(e: unknown): string {
  if (e == null) return 'unknown error (null)';
  const o = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown; status?: unknown; name?: unknown };
  const parts = [o.message, o.code && `code ${String(o.code)}`, o.details, o.hint, o.status && `status ${String(o.status)}`, o.name]
    .filter((x) => x != null && String(x).trim() && String(x) !== 'undefined').map((x) => String(x).slice(0, 200));
  if (parts.length) return parts.join(' · ');
  try { return `unknown error ${JSON.stringify(e).slice(0, 200)}`; } catch { return 'unknown error (unserialisable)'; }
}

// ── DATE TEMPLATES IN TEXT ──────────────────────────────────────────────────────────────────────
// A body must never carry a literal date (it rots): write {{+3d}} and it renders against the run
// clock. Formats: {{+3d}} "Friday 2 October" · {{+3d|weekday}} "Friday" · {{+3d|dm}} "2 October" ·
// {{+3d|iso}} "2026-10-02" · {{+3d 14:00|time}} "14:00" · {{+3d|dmy}} "2 October 2026" ·
// {{+3d|short}} "Fri 2 Oct".

const TEMPLATE_RE = /\{\{\s*([^}|]+?)\s*(?:\|\s*(\w+)\s*)?\}\}/g;

export function fillTemplate(text: string, now: Date, tz = 'UTC'): string {
  return String(text ?? '').replace(TEMPLATE_RE, (_m, expr: string, fmt?: string) => {
    const d = resolveWhen(expr.trim(), now, tz);
    const ds = localDate(d, tz);
    const [y, mo, day] = ds.split('-').map(Number);
    const noon = new Date(Date.UTC(y, mo - 1, day, 12));
    const weekday = noon.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    const month = noon.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
    switch ((fmt ?? '').toLowerCase()) {
      case 'weekday': return weekday;
      case 'dm': return `${day} ${month}`;
      case 'dmy': return `${day} ${month} ${y}`;
      case 'iso': return ds;
      case 'time': return localClock(d, tz);
      case 'short': return `${weekday.slice(0, 3)} ${day} ${month.slice(0, 3)}`;
      default: return `${weekday} ${day} ${month}`;
    }
  });
}

// ── RESOLUTION (pure — the neutral renderer and the seeder read the SAME resolved world) ───────

export type ResolvedParty = { key: string; name: string; email: string; org?: string; role?: string; me: boolean };
export type ResolvedMessage = {
  key: string; threadKey: string; index: number; from: ResolvedParty; to: ResolvedParty[]; cc: ResolvedParty[];
  at: Date; subject: string; body: string; attachments: string[];
};
export type ResolvedWorld = {
  now: Date; tz: string; me: ResolvedParty;
  people: ResolvedParty[];
  threads: Array<{ key: string; subject: string; messages: ResolvedMessage[]; itemKey: string | null; anchorKey: string | null;
    /** W27.C — the message the item's ENVELOPE (source_data) carries: a real sync re-stamps it on the thread's
     *  NEWEST inbound message (lib/email-sync/sync-emails.ts, "only update source_data if this email is
     *  newer"); an explicit `item.anchor` pins it. The anchor stays the FOUNDING message (created_at). */
    envelopeKey: string | null; signals?: WorldThread['signals'] }>;
  commitments: Array<Omit<WorldCommitment, 'due' | 'createdAt' | 'counterparty'> & { due: string | null; createdAt: Date; counterparty: ResolvedParty | { key: string; name: string; email: string; me: false; free: true } | null }>;
  events: Array<{ key: string; title: string; start: Date; end: Date; attendees: ResolvedParty[]; description?: string; location?: string }>;
  projects: WorldProject[];
  kb: WorldDoc[];
  voiceSamples: string[];
};

export function resolveWorld(w: World, now: Date): ResolvedWorld {
  const tz = w.tz ?? 'UTC';
  const me: ResolvedParty = { key: 'me', name: w.me?.name ?? DEFAULT_ME.name, email: w.me?.email ?? DEFAULT_ME.email, me: true };
  const people: ResolvedParty[] = (w.people ?? []).map((p) => ({ ...p, me: false }));
  const byKey = new Map<string, ResolvedParty>([['me', me], ...people.map((p) => [p.key, p] as const)]);
  const party = (k: string): ResolvedParty => {
    const hit = byKey.get(k);
    if (hit) return hit;
    if (/@/.test(k)) return { key: k, name: k.split('@')[0], email: k, me: false };
    throw new Error(`world: unknown person "${k}" (declare it in world.people, or use 'me' / a literal address)`);
  };
  const fill = (x: string) => fillTemplate(x, now, tz);
  const keys = new Set<string>();
  const uniq = (k: string, what: string) => { if (keys.has(k)) throw new Error(`world: duplicate key "${k}" (${what})`); keys.add(k); };

  const threads = (w.threads ?? []).map((t) => {
    uniq(t.key, 'thread');
    const firstExternal = t.messages.find((m) => m.from !== 'me')?.from;
    const messages = t.messages.map((m, i): ResolvedMessage => {
      const from = party(m.from);
      const toKeys = m.to ?? (m.from === 'me' ? (firstExternal ? [firstExternal] : []) : ['me']);
      return {
        key: m.key ?? `${t.key}.m${i + 1}`, threadKey: t.key, index: i, from,
        to: toKeys.map(party), cc: (m.cc ?? []).map(party), at: resolveWhen(m.at, now, tz),
        subject: fill(m.subject ?? (i === 0 ? t.subject : `Re: ${t.subject}`)), body: fill(m.body), attachments: m.attachments ?? [],
      };
    });
    for (let i = 1; i < messages.length; i++) {
      if (messages[i].at.getTime() < messages[i - 1].at.getTime()) throw new Error(`world: thread "${t.key}" messages are not in time order`);
    }
    for (const m of messages) uniq(m.key, 'message');
    const inbound = messages.filter((m) => !m.from.me);
    const wantItem = t.item !== false && inbound.length > 0;
    const itemOpt = typeof t.item === 'object' ? t.item : {};
    const anchorKey = wantItem ? (itemOpt.anchor ?? inbound[0].key) : null;
    if (anchorKey && !messages.some((m) => m.key === anchorKey)) throw new Error(`world: thread "${t.key}" item anchor "${anchorKey}" is not one of its messages`);
    const itemKey = wantItem ? (itemOpt.key ?? t.key) : null;
    const envelopeKey = !wantItem ? null : itemOpt.anchor ?? inbound[inbound.length - 1].key;
    return { key: t.key, subject: fill(t.subject), messages, itemKey, anchorKey, envelopeKey, signals: t.signals };
  });
  const commitments = (w.commitments ?? []).map((c) => {
    uniq(c.key, 'commitment');
    if (c.thread && !threads.some((t) => t.key === c.thread)) throw new Error(`world: commitment "${c.key}" names unknown thread "${c.thread}"`);
    const cp = c.counterparty == null ? null : byKey.get(c.counterparty) ?? { key: c.counterparty, name: c.counterparty, email: '', me: false as const, free: true as const };
    return { ...c, description: fill(c.description), due: c.due ? localDate(resolveWhen(c.due, now, tz), tz) : null, createdAt: resolveWhen(c.createdAt ?? '-1d', now, tz), counterparty: cp };
  });
  const events = (w.events ?? []).map((e) => {
    uniq(e.key, 'event');
    const start = resolveWhen(e.start, now, tz);
    return { key: e.key, title: fill(e.title), start, end: new Date(start.getTime() + (e.minutes ?? 30) * 60_000), attendees: (e.attendees ?? []).map(party), description: e.description == null ? undefined : fill(e.description), location: e.location };
  });
  const linkable = new Set([...threads.map((t) => t.itemKey).filter(Boolean) as string[], ...commitments.map((c) => c.key)]);
  for (const p of w.projects ?? []) {
    uniq(p.key, 'project');
    for (const l of p.links ?? []) if (!linkable.has(l)) throw new Error(`world: project "${p.key}" links unknown item "${l}"`);
  }
  for (const d of w.kb ?? []) uniq(d.key, 'kb');
  const projects = (w.projects ?? []).map((p) => ({ ...p, summary: p.summary == null ? undefined : fill(p.summary) }));
  const kb = (w.kb ?? []).map((d) => ({ ...d, text: fill(d.text), embed: d.embed ?? w.embedKb ?? false }));
  return { now, tz, me, people, threads, commitments, events, projects, kb, voiceSamples: (w.voiceSamples ?? []).map(fill) };
}

// ── PROBE SAFETY ────────────────────────────────────────────────────────────────────────────────

type AuthAdmin = { auth: { admin: { getUserById(id: string): Promise<{ data: { user: { email?: string | null } | null } | null; error: { message: string } | null }> } } };

/** Refuse anything but a probe host: the auth row's email must be a probe-pool address. */
export async function assertProbeHost(admin: AuthAdmin, userId: string): Promise<'standard' | 'eu'> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw new Error(`world: cannot verify probe host ${userId.slice(0, 8)}: ${dbErr(error)}`);
  const host = probeHostOf(data?.user?.email);
  if (host) return host.tier;
  throw new Error(`world: REFUSED — user ${userId.slice(0, 8)} is not a probe host (fixtures are never written to a real account)`);
}

export type FenceVerdict = { allow: true } | { allow: false; reason: string };

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** THE PROBE WRITE FENCE (pure): a Supabase write is allowed only when every user_id it names — in
 *  the query filters or the JSON body — is a probe id. A write naming no user is allowed (it targets
 *  rows by id, which only the probe's own reads could have produced). Reads always pass. */
export function probeWriteVerdict(rawUrl: string, method: string, body: unknown, supabaseUrl: string, probeIds: readonly string[]): FenceVerdict {
  let u: URL, base: URL;
  try { u = new URL(rawUrl); base = new URL(supabaseUrl); } catch { return { allow: true }; }
  if (u.host !== base.host) return { allow: true };
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return { allow: true };
  if (!u.pathname.startsWith('/rest/v1/')) return { allow: true };
  const probes = new Set(probeIds.map((x) => x.toLowerCase()));
  const named: string[] = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (k === 'user_id' || k === 'p_user_id') named.push(...(v.match(UUID_RE) ?? []));
  }
  let parsed: unknown = body;
  if (typeof body === 'string') { try { parsed = JSON.parse(body); } catch { parsed = null; } }
  const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    for (const k of ['user_id', 'p_user_id']) if (typeof rec?.[k] === 'string') named.push(rec[k] as string);
  }
  const foreign = named.map((x) => x.toLowerCase()).filter((x) => !probes.has(x));
  return foreign.length ? { allow: false, reason: `write names non-probe user ${foreign[0].slice(0, 8)} (${m} ${u.pathname})` } : { allow: true };
}

let fenceInstalled = false;
/** Install the fence (idempotent). A refused write THROWS inside the producer — a run that tried to
 *  touch another user's rows must fail loudly, never quietly succeed. */
export function installProbeWriteFence(supabaseUrl: string, probeIds: () => readonly string[], onBlock: (reason: string) => void): void {
  if (fenceInstalled) return;
  fenceInstalled = true;
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
    const v = probeWriteVerdict(url, method, init?.body ?? null, supabaseUrl, probeIds());
    if (!v.allow) { onBlock(v.reason); throw new Error(`eval probe fence: ${v.reason}`); }
    return orig(input, init);
  }) as typeof fetch;
}

// ── SEED / TEARDOWN ─────────────────────────────────────────────────────────────────────────────

export type WorldCtx = {
  admin: SupabaseClient;
  userId: string;
  /** The run clock every When resolves against. */
  now: Date;
  /** Unique per seed (fresh ids + tag-scoped cleanup). */
  tag?: string;
  /** The probe's own RLS session (producers that take the user's client); absent → admin. */
  session?: SupabaseClient;
  /** Self-check mode: seed-time embeddings are stubbed (a fixed vector, zero AI). */
  stubbed?: boolean;
  /** Inject the embedder (tests). Default: the product's own embedText (stubbed → a fixed vector). */
  embed?: (texts: string[]) => Promise<number[][]>;
};

export const EMBED_DIM = 1024;

/** THE EMBED-ON-SEED PATH: file vector = fileEmbedText(filename, text[:6000]) and one raw chunk vector
 *  = rawChunkEmbedText(filename, content[:2000]) — exactly the derivations lib/knowledge/ingest.ts
 *  writes for an uploaded file, embedded through the factory's `embeddings` slot (Bedrock Cohere). */
export async function embedDocTexts(ctx: WorldCtx, texts: string[]): Promise<number[][]> {
  if (ctx.embed) return ctx.embed(texts);
  if (ctx.stubbed) return texts.map(() => new Array(EMBED_DIM).fill(0.001));
  const { embedText } = await import('../../../../lib/knowledge/indexer');
  const out: number[][] = [];
  for (const t of texts) out.push(await embedText(t, ctx.userId, ctx.admin));
  return out;
}

async function docVectors(ctx: WorldCtx, filename: string, text: string): Promise<{ file: number[]; chunk: number[] }> {
  const { fileEmbedText, rawChunkEmbedText } = await import('../../../../lib/knowledge/indexer');
  const [file, chunk] = await embedDocTexts(ctx, [fileEmbedText(filename, text.slice(0, 6000)), rawChunkEmbedText(filename, text.slice(0, 2000))]);
  return { file, chunk };
}

export type LedgerRow = { table: string; id: string };

export type SeededWorld = {
  tag: string;
  resolved: ResolvedWorld;
  /** world key → DB id (threads → inbox item id; messages → emails id; commitments; events; projects; kb). */
  ids: Record<string, string>;
  /** world thread key → the provider thread id stamped on its emails. */
  threadIds: Record<string, string>;
  ledger: LedgerRow[];
  seededAt: string;
};

type Sb = SupabaseClient;
const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error || r.data == null) throw new Error(`world seed: ${what} failed: ${r.error?.message ?? 'no row returned'}`);
  return r.data;
};

const addr = (p: ResolvedParty) => p.email;
const named = (p: ResolvedParty) => (p.name && p.name !== p.email ? `${p.name} <${p.email}>` : p.email);

export function newTag(): string {
  return `w26${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ── THE LIVE-WORLD REGISTRY (concurrency-safe teardown) ─────────────────────────────────────────
// Two worlds may be alive on one probe host at once (--world-lanes > 1, or two repeats of one case).
// Rows a producer derives from a world are keyed by what the worlds SHARE — a person's address
// (person_state), a person/project name (recognized work_entities) — so a teardown must never delete
// such a row while another live world that shares the key may still be reading or writing it: it
// defers to the LAST sharer, which deletes everything created since the FIRST sharer was seeded. And
// a teardown never deletes a row another live world seeded. Process-local by design (one runner).

type Shared = { n: number; since: string };
type Live = { ids: Set<string>; names: Map<string, Shared>; emails: Map<string, Shared> };
const LIVE = new Map<string, Live>();
const liveOf = (uid: string): Live => { let l = LIVE.get(uid); if (!l) { l = { ids: new Set(), names: new Map(), emails: new Map() }; LIVE.set(uid, l); } return l; };
const sharedKeys = (s: SeededWorld) => ({
  names: [...new Set([...s.resolved.people.map((p) => p.name), ...s.resolved.projects.map((p) => p.name)].filter(Boolean).map((n) => n.toLowerCase()))],
  emails: [...new Set(s.resolved.people.map((p) => p.email.toLowerCase()).filter(Boolean))],
});
function registerLive(uid: string, s: SeededWorld): void {
  const l = liveOf(uid);
  const k = sharedKeys(s);
  for (const n of k.names) { const e = l.names.get(n); l.names.set(n, e ? { n: e.n + 1, since: e.since < s.seededAt ? e.since : s.seededAt } : { n: 1, since: s.seededAt }); }
  for (const m of k.emails) { const e = l.emails.get(m); l.emails.set(m, e ? { n: e.n + 1, since: e.since < s.seededAt ? e.since : s.seededAt } : { n: 1, since: s.seededAt }); }
}
/** Unregister a world; returns, per shared key, null (another live world still shares it — defer) or
 *  the earliest seededAt among the worlds that shared it (delete what was created since). */
function releaseLive(uid: string, s: SeededWorld): { names: Map<string, string | null>; emails: Map<string, string | null> } {
  const l = liveOf(uid);
  const k = sharedKeys(s);
  const rel = (m: Map<string, Shared>, key: string): string | null => {
    const e = m.get(key);
    if (!e) return s.seededAt; // never registered (a teardown after a failed seed) — own window
    if (e.n > 1) { m.set(key, { ...e, n: e.n - 1 }); return null; }
    m.delete(key);
    return e.since;
  };
  const names = new Map(k.names.map((n) => [n, rel(l.names, n)] as const));
  const emails = new Map(k.emails.map((m) => [m, rel(l.emails, m)] as const));
  for (const r of s.ledger) l.ids.delete(r.id);
  return { names, emails };
}
/** Forget every live world — what a NEW process sees after a kill (tests simulate the restart). */
export function forgetLiveWorlds(): void { LIVE.clear(); }
/** Worlds alive on this host right now (the post-run sweep refuses to run while any is). */
export function liveWorldCount(uid: string): number { const l = LIVE.get(uid); return l ? l.ids.size : 0; }

/** Seed the world on the probe host. Fresh ids every call; every row lands in the ledger. */
export async function seedWorld(ctx: WorldCtx, world: World): Promise<SeededWorld> {
  await assertProbeHost(ctx.admin as unknown as AuthAdmin, ctx.userId);
  const tag = ctx.tag ?? newTag();
  const rw = resolveWorld(world, ctx.now);
  const sb: Sb = ctx.admin;
  const uid = ctx.userId;
  const out: SeededWorld = { tag, resolved: rw, ids: {}, threadIds: {}, ledger: [], seededAt: new Date().toISOString() };
  registerLive(uid, out);
  const live = liveOf(uid);
  const led = (table: string, id: string) => { out.ledger.push({ table, id }); live.ids.add(id); };

  try {
    // Emails (every message) → then the thread's inbox item anchored on its founding inbound.
    for (const t of rw.threads) {
      const threadId = `eval-${tag}-${t.key}`;
      out.threadIds[t.key] = threadId;
      for (const m of t.messages) {
        const row = must(await sb.from('emails').insert({
          user_id: uid, message_id: `<eval-${tag}-${m.key}@fixture.test>`, thread_id: threadId,
          from_address: addr(m.from), from_name: m.from.name, to_addresses: m.to.map(addr), cc_addresses: m.cc.map(addr),
          subject: m.subject, body: m.body, received_at: m.at.toISOString(), is_from_user: m.from.me, is_read: true,
          labels: [], metadata: { eval_run: tag, ...(m.attachments.length ? { attachments: m.attachments.map((f) => ({ filename: f })) } : {}) },
        }).select('id').single(), `emails(${m.key})`) as { id: string };
        out.ids[m.key] = row.id;
        led('emails', row.id);
      }
      if (t.itemKey && t.anchorKey) {
        const anchor = t.messages.find((m) => m.key === t.anchorKey)!;
        // THE ENVELOPE follows the newest inbound message, as a real sync keeps it (W27.C); the item is
        // still FOUNDED on the anchor (created_at, work_title, the sweep marker in source_id).
        const env = t.messages.find((m) => m.key === t.envelopeKey) ?? anchor;
        const newest = t.messages[t.messages.length - 1];
        const isCcOnly = !env.to.some((p) => p.me) && env.cc.some((p) => p.me);
        const item = must(await sb.from('inbox_items').insert({
          user_id: uid, source: 'email', source_id: `eval-${tag}-${anchor.key}`, status: 'pending', is_read: false,
          work_title: anchor.subject, auto_generated: false, project_locked: false,
          created_at: anchor.at.toISOString(), last_activity_at: newest.at.toISOString(),
          source_data: {
            subject: env.subject, body: env.body, from: named(env.from), from_name: env.from.name, from_address: addr(env.from),
            to: env.to.map(addr), cc: env.cc.map(addr), is_cc_only: isCcOnly, received_at: env.at.toISOString(),
            thread_id: threadId, message_id: `<eval-${tag}-${env.key}@fixture.test>`, email_id: out.ids[env.key], provider: 'fixture',
            ...(env.attachments.length ? { attachments: env.attachments.map((f) => ({ filename: f })) } : {}),
            ...(t.signals ? { signals: t.signals } : {}),
            eval_run: tag,
          },
        }).select('id').single(), `inbox_items(${t.itemKey})`) as { id: string };
        out.ids[t.itemKey] = item.id;
        led('inbox_items', item.id);
      }
    }
    for (const c of rw.commitments) {
      const cp = c.counterparty;
      const row = must(await sb.from('commitments').insert({
        user_id: uid, direction: c.direction, description: c.description,
        counterparty: cp ? ('free' in cp ? cp.name : named(cp as ResolvedParty)) : null,
        due_date: c.due, source: c.source ?? 'email', source_id: `eval:${tag}:${c.key}`,
        thread_id: c.thread ? out.threadIds[c.thread] : null, status: 'open', project_locked: false,
        created_at: c.createdAt.toISOString(), updated_at: c.createdAt.toISOString(),
      }).select('id').single(), `commitments(${c.key})`) as { id: string };
      out.ids[c.key] = row.id;
      led('commitments', row.id);
    }
    for (const e of rw.events) {
      const row = must(await sb.from('calendar_events').insert({
        user_id: uid, event_id: `eval-${tag}-${e.key}`, calendar_id: 'primary', provider: 'gmail', title: e.title,
        description: e.description ?? null, location: e.location ?? null, start_time: e.start.toISOString(), end_time: e.end.toISOString(),
        timezone: rw.tz, is_all_day: false, organizer: rw.me.email, status: 'confirmed', project_locked: false,
        meeting_status: e.end.getTime() < ctx.now.getTime() ? 'completed' : 'upcoming',
        attendees: e.attendees.map((p) => ({ name: p.name, email: p.email, status: 'accepted' })),
        metadata: { eval_run: tag },
      }).select('id').single(), `calendar_events(${e.key})`) as { id: string };
      out.ids[e.key] = row.id;
      led('calendar_events', row.id);
    }
    for (const p of rw.projects) {
      const row = must(await sb.from('work_entities').insert({
        user_id: uid, kind: 'initiative', name: p.name, summary: p.summary ?? null, aliases: [], tracked: true, status: 'active',
        goals: p.goals ?? [], rules: [], people: [],
      }).select('id').single(), `work_entities(${p.key})`) as { id: string };
      out.ids[p.key] = row.id;
      led('work_entities', row.id);
      for (const l of p.links ?? []) {
        const isCommit = rw.commitments.some((c) => c.key === l);
        const { error } = await sb.from('entity_links').insert({
          user_id: uid, entity_id: row.id, item_kind: isCommit ? 'commitment' : 'inbox_item', item_id: out.ids[l], via: 'user', locked: true, reason: 'eval fixture',
        });
        if (error) throw new Error(`world seed: entity_links(${p.key}→${l}) failed: ${dbErr(error)}`);
      }
    }
    if (rw.kb.length) {
      const src = must(await sb.from('knowledge_sources').insert({
        user_id: uid, provider: 'upload', folder_name: `Eval fixtures ${tag}`, status: 'ready', file_count: rw.kb.length,
      }).select('id').single(), 'knowledge_sources') as { id: string };
      led('knowledge_sources', src.id);
      for (const d of rw.kb) {
        const vec = d.embed ? await docVectors(ctx, d.filename, d.text) : null;
        const row = must(await sb.from('knowledge_files').insert({
          user_id: uid, source_id: src.id, provider_file_id: `eval-${tag}-${d.key}`, filename: d.filename, mime_type: 'text/plain',
          extracted_text: d.text, summary: d.text.slice(0, 280), size_bytes: d.text.length, last_modified_at: ctx.now.toISOString(),
          ...(vec ? { embedding: JSON.stringify(vec.file), indexed_at: ctx.now.toISOString() } : {}),
        }).select('id').single(), `knowledge_files(${d.key})`) as { id: string };
        out.ids[d.key] = row.id;
        led('knowledge_files', row.id);
        if (vec) {
          const ch = must(await sb.from('knowledge_chunks').insert({
            file_id: row.id, user_id: uid, chunk_index: 0, heading: null, content: d.text.slice(0, 2000), context_header: d.filename,
            embedding: JSON.stringify(vec.chunk),
          }).select('id').single(), `knowledge_chunks(${d.key})`) as { id: string };
          led('knowledge_chunks', ch.id);
        }
      }
    }
    if (rw.voiceSamples.length) {
      const threadId = `eval-${tag}-voice`;
      for (let i = 0; i < rw.voiceSamples.length; i++) {
        const at = new Date(ctx.now.getTime() - (30 - i) * 86_400_000);
        const row = must(await sb.from('emails').insert({
          user_id: uid, message_id: `<eval-${tag}-voice-${i}@fixture.test>`, thread_id: `${threadId}-${i}`,
          from_address: rw.me.email, from_name: rw.me.name, to_addresses: ['colleague@globex.test'], cc_addresses: [],
          subject: `Note ${i + 1}`, body: rw.voiceSamples[i], received_at: at.toISOString(), is_from_user: true, is_read: true, labels: [], metadata: { eval_run: tag },
        }).select('id').single(), `emails(voice ${i})`) as { id: string };
        led('emails', row.id);
      }
    }
  } catch (e) {
    await teardownWorld(ctx, out).catch(() => {});
    throw e;
  }
  return out;
}

/** Tables a teardown must leave exactly as it found them (the symmetry check). */
export const SYMMETRY_TABLES = [
  'inbox_items', 'emails', 'commitments', 'calendar_events', 'work_entities', 'entity_links',
  'knowledge_sources', 'knowledge_files', 'knowledge_chunks', 'item_plans', 'item_deliverables', 'room_turns', 'person_state',
] as const;

/** Per-USER singleton rows a producer may legitimately mint on first use (a campaign signature, the
 *  working circle, a reconcile claim — keyed 'user' / 'campaign:signature' / 'replied', never to a
 *  fixture id): the symmetry check counts only item_plans keyed to an ID (a uuid in entity_id), and
 *  teardown leaves the singletons (a real account has them too). Anything else left behind is residue. */
export const ID_KEYED_PLAN = '%-%-%-%-%';

/** Row counts per table for the probe user (the symmetry snapshot). */
export async function snapshotCounts(sb: Sb, userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of SYMMETRY_TABLES) {
    let q = sb.from(t).select('user_id', { count: 'exact', head: true }).eq('user_id', userId);
    if (t === 'item_plans') q = q.like('entity_id', ID_KEYED_PLAN);
    const { count, error } = await q;
    if (error) throw new Error(`world snapshot: ${t}: ${dbErr(error)}`);
    out[t] = count ?? 0;
  }
  return out;
}

export function diffCounts(before: Record<string, number>, after: Record<string, number>): string[] {
  return Object.keys(before).filter((t) => (after[t] ?? 0) !== before[t]).map((t) => `${t}: ${before[t]} → ${after[t] ?? 0}`);
}

/** Delete the ledger AND every derived row keyed to a seeded id (item_plans, item_deliverables,
 *  room_turns, entity_links, commitments minted from seeded mail, entities/person rows recognition
 *  made for world people). Scoped to the probe user; never an untagged row other suites rely on. */
export async function teardownWorld(ctx: WorldCtx, s: SeededWorld): Promise<{ deleted: number; errors: string[] }> {
  await assertProbeHost(ctx.admin as unknown as AuthAdmin, ctx.userId);
  const sb: Sb = ctx.admin;
  const uid = ctx.userId;
  const errors: string[] = [];
  let deleted = 0;
  const del = async (label: string, q: PromiseLike<{ error: { message: string } | null; count?: number | null }>) => {
    const r = await q;
    if (r.error) errors.push(`${label}: ${dbErr(r.error)}`);
    else deleted += r.count ?? 0;
  };
  const ids = s.ledger.map((l) => l.id);
  const threadIds = Object.values(s.threadIds);

  // Commitments minted by producers from seeded mail (source_id = an email/item id, or the seeded thread).
  const minted = new Set<string>();
  for (const chunk of chunks(ids, 50)) {
    const { data, error } = await sb.from('commitments').select('id').eq('user_id', uid).in('source_id', chunk);
    if (error) errors.push(`commitments(minted by source): ${dbErr(error)}`);
    for (const r of (data ?? []) as Array<{ id: string }>) minted.add(r.id);
  }
  if (threadIds.length) {
    const { data, error } = await sb.from('commitments').select('id').eq('user_id', uid).in('thread_id', threadIds);
    if (error) errors.push(`commitments(minted by thread): ${dbErr(error)}`);
    for (const r of (data ?? []) as Array<{ id: string }>) minted.add(r.id);
  }
  const { data: tagged, error: tagErr } = await sb.from('commitments').select('id').eq('user_id', uid).like('source_id', `eval:${s.tag}:%`);
  if (tagErr) errors.push(`commitments(tagged): ${dbErr(tagErr)}`);
  for (const r of (tagged ?? []) as Array<{ id: string }>) minted.add(r.id);
  const allIds = [...new Set([...ids, ...minted])];

  // Entities recognition may have minted for world people/projects during the run — only once no
  // other live world shares the name (the last sharer sweeps since the first one's seed), never a row
  // another live world seeded, never one linked to an item outside this world.
  const released = releaseLive(uid, s);
  const liveIds = liveOf(uid).ids;
  const ownKeys = new Set([...allIds, ...threadIds]);
  const madeEntities: string[] = [];
  for (const [n, since] of released.names) {
    if (since == null) continue;
    const { data, error } = await sb.from('work_entities').select('id').eq('user_id', uid).gte('created_at', since).ilike('name', n);
    if (error) errors.push(`work_entities(recognized ${n}): ${dbErr(error)}`);
    for (const r of (data ?? []) as Array<{ id: string }>) if (!allIds.includes(r.id) && !liveIds.has(r.id)) madeEntities.push(r.id);
  }
  if (madeEntities.length) {
    const { data: links, error } = await sb.from('entity_links').select('entity_id, item_id').eq('user_id', uid).in('entity_id', madeEntities);
    if (error) errors.push(`entity_links(recognized): ${dbErr(error)}`);
    const foreign = new Set(((links ?? []) as Array<{ entity_id: string; item_id: string }>).filter((l) => !ownKeys.has(l.item_id)).map((l) => l.entity_id));
    for (let i = madeEntities.length - 1; i >= 0; i--) if (foreign.has(madeEntities[i])) madeEntities.splice(i, 1);
  }
  const entityIds = [...s.ledger.filter((l) => l.table === 'work_entities').map((l) => l.id), ...madeEntities];

  // Derived rows keyed to any seeded id (the producer caches: item_plans kinds, deliverables, turns).
  for (const id of [...allIds, ...entityIds]) {
    await del('item_plans', sb.from('item_plans').delete({ count: 'exact' }).eq('user_id', uid).like('entity_id', `%${id}%`));
    await del('item_deliverables', sb.from('item_deliverables').delete({ count: 'exact' }).eq('user_id', uid).like('entity_id', `%${id}%`));
    await del('room_turns', sb.from('room_turns').delete({ count: 'exact' }).eq('user_id', uid).like('room_key', `%${id}%`));
  }
  for (const chunk of chunks(allIds, 50)) {
    await del('entity_links(item)', sb.from('entity_links').delete({ count: 'exact' }).eq('user_id', uid).in('item_id', chunk));
  }
  for (const tid of threadIds) {
    await del('entity_links(thread)', sb.from('entity_links').delete({ count: 'exact' }).eq('user_id', uid).eq('item_id', tid));
    await del('item_plans(thread)', sb.from('item_plans').delete({ count: 'exact' }).eq('user_id', uid).like('entity_id', `%${tid}%`));
  }
  for (const chunk of chunks(entityIds, 50)) {
    await del('entity_links(entity)', sb.from('entity_links').delete({ count: 'exact' }).eq('user_id', uid).in('entity_id', chunk));
  }
  // person_state rows for world people (keyed by address) touched during the run — deferred to the
  // last live world sharing the address.
  for (const [email, since] of released.emails) {
    if (since == null) continue;
    await del('person_state', sb.from('person_state').delete({ count: 'exact' }).eq('user_id', uid).gte('updated_at', since).ilike('person_key', `%${email}%`));
  }
  // The rows themselves, children first.
  const order = ['knowledge_chunks', 'knowledge_files', 'knowledge_sources', 'calendar_events', 'inbox_items', 'emails', 'work_entities'];
  for (const table of order) {
    const rows = s.ledger.filter((l) => l.table === table).map((l) => l.id);
    for (const chunk of chunks(rows, 50)) await del(table, sb.from(table).delete({ count: 'exact' }).eq('user_id', uid).in('id', chunk));
  }
  for (const chunk of chunks([...minted], 50)) await del('commitments', sb.from('commitments').delete({ count: 'exact' }).eq('user_id', uid).in('id', chunk));
  for (const chunk of chunks(madeEntities, 50)) await del('work_entities(recognized)', sb.from('work_entities').delete({ count: 'exact' }).eq('user_id', uid).in('id', chunk));
  // Mail a producer wrote onto a seeded thread (e.g. a stored draft) goes with it.
  for (const tid of threadIds) await del('emails(thread)', sb.from('emails').delete({ count: 'exact' }).eq('user_id', uid).eq('thread_id', tid));
  return { deleted, errors };
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** The world key a DB id belongs to (reports speak world keys, never uuids). */
export function keyOfId(s: SeededWorld, id: string | null | undefined): string | null {
  if (!id) return null;
  for (const [k, v] of Object.entries(s.ids)) if (v === id || String(id).includes(v)) return k;
  return null;
}
