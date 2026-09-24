// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORKING CIRCLE (W11.2 — the actor ladder's teammate rung, widened past the workspace).
//
// THE FINDING (owner walk, Sep 23): the Home's top five held three overdue commitments to ONE client
// contact, all almost certainly done — a colleague at a PARTNER firm (not a workspace member, on a
// different domain from every mailbox the user owns; the user signs those threads with that firm) had
// replied "we've implemented the changes" on the thread. The ladder's teammate rung was
// `active company_members ∪ the user's own corporate domain`, so that colleague's deed read as
// `unknown` and never settled anything. People work in MULTIPLE firms and contexts; a team is not
// the workspace roster.
//
// THE CIRCLE, per user = workspace members ∪ user-CONFIRMED collaborators ∪ INFERRED co-senders.
//
// THE INFERENCE RULE (zero AI, from the `emails` table only, over CIRCLE_WINDOW_DAYS):
//   A SIDE PAIR (X over Y, on one thread) is a message that places X beside the user facing Y:
//     • the user wrote TO Y and CC'd X                          (the user's own act — `ccByUser`)
//     • X wrote TO Y with the user copied (reply-all alongside) (X's own act     — `alongside`)
//   Per thread, X is ON THE USER'S SIDE when some Y has score(X over Y) > score(Y over X) — the
//   strict margin is what keeps a three-way back-and-forth from making both parties "ours". The
//   loser of a pair is that thread's COUNTERPARTY and gains a COUNTER thread.
//   • SAME ORGANISATION IS NEVER A SIDE: a pair whose two addresses share a CORPORATE domain says
//     nothing (the counterparty's own colleague replying alongside them is on THEIR side). A public
//     mail domain proves no organisation either way, so there only the structure speaks.
//   • THE COUNTERPARTY IS AN ORGANISATION (W12.2): sides are decided between organisations first —
//     per thread, an org that loses an org contest is that thread's counterparty and none of its
//     addresses is a same-side collaborator there; across threads, an org whose side threads fall
//     below CIRCLE_ORG_SIDE_DOMINANCE × its counterparty threads (org contests lost + threads with
//     sides where the user wrote TO it) is a COUNTERPARTY ORGANISATION: its pairs are void and its
//     people are never suggested (a client's colleagues, whom the user copies or who write to the
//     user's partner with the user copied, are the client's side, not ours).
//   • NEVER THE COUNTERPARTY: an address is a candidate only while its side threads OUTNUMBER its
//     counter threads; and the ladder's own precedence (counterparty > teammate) still names the
//     counterparty of any specific work, whatever the circle says.
//   • NEVER OURSELVES / ALREADY KNOWN: owned addresses, our coworkers' domain, active members and
//     the user's own corporate domain are excluded (they are `user` / `teammate` already); machine
//     senders (no-reply · notifications · mailer-daemon …) are never people.
//   • NEVER PUBLIC-DOMAIN-ONLY: nothing is inferred from a domain alone, and an address on a public
//     provider can be SUGGESTED by structure but never counts without the user's confirmation.
//
// THE THRESHOLD, stated (and why): an address is SUGGESTED at ≥ CIRCLE_SUGGEST_MIN_THREADS side
// threads. It COUNTS AS A TEAMMATE only when the user CONFIRMS it in Settings → Team, OR above the
// high bar: ≥ CIRCLE_AUTO_MIN_THREADS side threads · side threads ≥ CIRCLE_AUTO_DOMINANCE × counter
// threads (overwhelmingly on the user's side — the read-only census found the strongest real colleague
// at 20 side threads / 2 counter threads, a three-way exchange now and then; "zero" refused them) ·
// ≥ CIRCLE_AUTO_MIN_ALONGSIDE messages X wrote alongside the user · a corporate (non-public) domain.
// Why high: the teammate rung
// lets a deed CLOSE work the user owes (after the fulfillment judge reads that deed's own words), so
// a false teammate could close real work — the judge is a second guard, never the only one. A
// REMOVED address never counts, whatever its evidence (the user's hand wins).
//
// THE STORE (lib/store/item-plans.ts — the one typed door): `working_circle` (cache, key `user`) holds
// the last inference, recomputed at most every CIRCLE_TTL_MS; `circle_decision` (record, key = the
// address) holds each confirm/remove/add — one row per address, so a recompute never races a click.
//
// ONE LADDER: this module never assigns a role. `loadActorContext` (lib/evidence/actor.ts) reads the
// counting circle into `ActorContext.circle`, and `actorRole` — the ONE function — reads it.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { normAddress } from '@/lib/email-sync/authorship';
import { isEmailStrict } from '@/lib/core/email';
import { FREE_EMAIL_DOMAINS } from '@/lib/entities/recognize';
import { COWORKER_EMAIL_DOMAIN } from '@/lib/integrations/registry';
import { deletePlans, readPlan, readPlans, upsertPlan } from '@/lib/store/item-plans';
import { fetchAllRows } from '@/lib/utils/fetch-all';

// v2 (W12.2): the counterparty is an organisation; a cached v1 inference is recomputed on read.
export const CIRCLE_VERSION = 2;
export const CIRCLE_WINDOW_DAYS = 180;
export const CIRCLE_SUGGEST_MIN_THREADS = 2;
export const CIRCLE_AUTO_MIN_THREADS = 4;
export const CIRCLE_AUTO_MIN_ALONGSIDE = 2;
export const CIRCLE_AUTO_DOMINANCE = 4;
/** W12.2 — an ORGANISATION is on the user's side only while its side threads reach this multiple of
 *  its counterparty threads; below it, it is a counterparty organisation and none of its people is
 *  ever a same-side collaborator (a client's colleagues, whatever the structure of one message says). */
export const CIRCLE_ORG_SIDE_DOMINANCE = 2;
export const CIRCLE_TTL_MS = 24 * 3_600_000;
/** The stated bound on each mail lane the recompute reads (reported as `capped` — NO SILENT CAPS). */
export const CIRCLE_READ_MAX = 20_000;
/** How many candidates the cache keeps (strongest first; the count beyond is reported). */
export const CIRCLE_KEEP_MAX = 200;

export const CIRCLE_KIND = 'working_circle' as const;
export const CIRCLE_DECISION_KIND = 'circle_decision' as const;
const CIRCLE_KEY = 'user';

/** One message, as the inference reads it (lean — addresses and the thread only). */
export type CircleMail = {
  from: string | null;
  fromName?: string | null;
  to: string[];
  cc: string[];
  threadId: string | null;
  fromUser: boolean;
};

export type CircleCandidate = {
  address: string;
  name: string | null;
  /** distinct threads where this address stood on the user's side */
  threads: number;
  /** distinct threads where it was the counterparty of a side pair */
  counterThreads: number;
  /** messages IT wrote to the counterparty with the user copied (winning threads only) */
  alongside: number;
  /** messages the USER wrote to a counterparty while copying it (winning threads only) */
  ccByUser: number;
  publicDomain: boolean;
  /** above the high bar — counts without a confirmation (unless removed) */
  auto: boolean;
};

export type CircleInference = { v: number; at: string; read: number; capped: boolean; dropped: number; candidates: CircleCandidate[] };

export type CircleDecisionState = 'confirmed' | 'removed';
export type CircleDecision = { address: string; state: CircleDecisionState; at: string; name?: string | null };

/** The facts the inference excludes by (the actor context's work-free half). */
export type CircleKnown = { own: readonly string[]; teammates: readonly string[]; teamDomains: readonly string[] };

const domainOf = (a: string): string => { const i = a.lastIndexOf('@'); return i > 0 ? a.slice(i + 1) : ''; };
const isPublic = (d: string): boolean => FREE_EMAIL_DOMAINS.has(d.toLowerCase());
/** Machine senders are never people (the local part names a system, never a person). */
const MACHINE_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|bounces?|calendar|invites?|support|info|news(letter)?|updates?|alerts?)([+._-]|$)/i;
export const isMachineAddress = (a: string): boolean => MACHINE_LOCAL.test(a.split('@')[0] ?? '');

/** The organisation an address speaks for: its corporate domain; a public-provider address is its
 *  own (a public domain proves no organisation). */
export const orgOf = (a: string): string => { const d = domainOf(a); return d && !isPublic(d) ? d : a; };

/** THE HIGH BAR — a verdict of the counts under the CURRENT rule, never a stored fact: a cached
 *  inference is re-judged on every read (W12.2 — a verdict cached under an earlier rule held both
 *  of the owner's strongest partners below the bar for a day). */
export function autoVerdict(c: Pick<CircleCandidate, 'threads' | 'counterThreads' | 'alongside' | 'publicDomain'>): boolean {
  return c.threads >= CIRCLE_AUTO_MIN_THREADS && c.threads >= CIRCLE_AUTO_DOMINANCE * c.counterThreads
    && c.alongside >= CIRCLE_AUTO_MIN_ALONGSIDE && !c.publicDomain;
}

/** Two addresses of the SAME organisation (a shared CORPORATE domain) — never a side pair. */
export function sameOrganisation(a: string, b: string): boolean {
  const da = domainOf(a), db = domainOf(b);
  return !!da && da === db && !isPublic(da);
}

/**
 * THE INFERENCE — pure, zero IO, zero AI. Returns every address that clears the SUGGEST threshold
 * (with its `auto` verdict), strongest first. See the header for the rule.
 */
export function inferCircle(mails: readonly CircleMail[], known: CircleKnown): CircleCandidate[] {
  const own = new Set(known.own.map((a) => normAddress(a)));
  const mates = new Set(known.teammates.map((a) => normAddress(a)));
  const teamDomains = new Set(known.teamDomains.map((d) => d.toLowerCase()));
  const coworker = COWORKER_EMAIL_DOMAIN.toLowerCase();
  const external = (raw: string | null | undefined): string | null => {
    const a = normAddress(raw);
    if (!a || !a.includes('@') || own.has(a)) return null;
    if (domainOf(a) === coworker) return null;
    return a;
  };
  // Addresses that are already `user`/`teammate`, or machines, never become candidates — but they
  // still take part in pairs (a member beside the user is a side; their counterparty still loses).
  const excluded = (a: string): boolean => mates.has(a) || teamDomains.has(domainOf(a)) || isMachineAddress(a);

  type Pair = { s: number; alongside: number; cc: number };
  const byThread = new Map<string, Map<string, Pair>>(); // thread → `${x}\u0000${y}` → score
  const names = new Map<string, string>();
  const userTo = new Map<string, Set<string>>(); // thread → the orgs the user wrote TO there
  const bump = (t: string, x: string, y: string, kind: 'alongside' | 'cc') => {
    if (x === y || sameOrganisation(x, y)) return;
    const m = byThread.get(t) ?? byThread.set(t, new Map()).get(t)!;
    const k = `${x}\u0000${y}`;
    const p = m.get(k) ?? { s: 0, alongside: 0, cc: 0 };
    p.s++; if (kind === 'alongside') p.alongside++; else p.cc++;
    m.set(k, p);
  };
  for (const m of mails) {
    if (!m.threadId) continue; // a side is a CONVERSATION fact; a threadless message proves nothing
    const to = [...new Set(m.to.map(external).filter((a): a is string => !!a))];
    const cc = [...new Set(m.cc.map(external).filter((a): a is string => !!a))];
    if (m.fromUser) {
      for (const y of to) for (const x of cc) bump(m.threadId, x, y, 'cc');
      const ut = userTo.get(m.threadId) ?? userTo.set(m.threadId, new Set()).get(m.threadId)!;
      for (const y of to) ut.add(orgOf(y));
      continue;
    }
    const x = external(m.from);
    if (!x) continue;
    if (m.fromName && !names.has(x)) names.set(x, String(m.fromName));
    const userCopied = m.cc.some((a) => own.has(normAddress(a)));
    if (!userCopied) continue;
    for (const y of to) bump(m.threadId, x, y, 'alongside');
  }

  // ── W12.2 · THE COUNTERPARTY IS AN ORGANISATION (owner walk on prod after W11 deployed: Settings →
  //    Team suggested people on the CLIENT's own domain — the client's colleagues, copied when the
  //    user writes to someone else, or writing to the user's partner with the user copied, won a
  //    pair over a third address and read as "ours"). A side is decided between ORGANISATIONS first:
  //    per thread, the org pairs are summed (a corporate domain is one org; a public-provider
  //    address is its own) and an org that loses any org contest on the thread is that thread's
  //    COUNTERPARTY — no address of it is a same-side collaborator there. Across threads, an org
  //    whose side threads do not reach CIRCLE_ORG_SIDE_DOMINANCE × its counterparty threads is a
  //    COUNTERPARTY ORGANISATION for this user: its pairs are void everywhere (they neither make it
  //    "ours" nor push anyone else to the counterparty side — the partner's inflated counter count
  //    came from exactly those pairs), and none of its people is ever suggested.
  type OrgSides = { side: Set<string>; counter: Set<string> };
  const orgContest = (pairs: Map<string, Pair>, voidOrg: (o: string) => boolean): OrgSides => {
    const os = new Map<string, number>();
    for (const [k, p] of pairs) {
      const [x, y] = k.split('\u0000');
      const ox = orgOf(x), oy = orgOf(y);
      if (ox === oy || voidOrg(ox)) continue;
      os.set(`${ox}\u0000${oy}`, (os.get(`${ox}\u0000${oy}`) ?? 0) + p.s);
    }
    const wins = new Set<string>(), counter = new Set<string>();
    for (const [k, sc] of os) {
      const [ox, oy] = k.split('\u0000');
      if (sc > (os.get(`${oy}\u0000${ox}`) ?? 0)) { wins.add(ox); counter.add(oy); }
    }
    return { side: new Set([...wins].filter((o) => !counter.has(o))), counter };
  };
  // Pass 1 — every thread's org contest → each org's side / counterparty threads, settled ONE org at
  // a time: the most counterparty-like org (lowest side ÷ counterparty ratio) is voided first and the
  // tallies re-read without its pairs, so a client's colleagues writing to the partner never make the
  // PARTNER look like a counterparty (the pairs that did are void by then). Bounded by the org count.
  const counterpartyOrgs = new Set<string>();
  const isCorporateOrg = (o: string) => !o.includes('@');
  for (;;) {
    const orgTally = new Map<string, { side: number; counter: number }>();
    const tallyOf = (o: string) => orgTally.get(o) ?? orgTally.set(o, { side: 0, counter: 0 }).get(o)!;
    for (const [t, pairs] of byThread) {
      const { side, counter } = orgContest(pairs, (o) => counterpartyOrgs.has(o));
      if (!side.size) continue;
      for (const o of side) tallyOf(o).side++;
      // The org the USER addressed on a thread with sides, and that did not stand on the user's side
      // there, is that thread's To-counterparty (the user writing TO them is the counterparty's mark).
      const counted = new Set(counter);
      for (const o of userTo.get(t) ?? []) if (!side.has(o)) counted.add(o);
      for (const o of counted) tallyOf(o).counter++;
    }
    let worst: string | null = null, worstRatio = Infinity, worstCounter = 0;
    for (const [o, n] of orgTally) {
      if (!isCorporateOrg(o) || counterpartyOrgs.has(o)) continue;
      if (!(n.counter > 0 && n.side < CIRCLE_ORG_SIDE_DOMINANCE * n.counter)) continue;
      const ratio = n.side / n.counter;
      if (ratio < worstRatio || (ratio === worstRatio && (n.counter > worstCounter || (n.counter === worstCounter && worst !== null && o < worst)))) {
        worst = o; worstRatio = ratio; worstCounter = n.counter;
      }
    }
    if (!worst) break;
    counterpartyOrgs.add(worst);
  }
  const voidOrg = (o: string) => counterpartyOrgs.has(o);

  // Pass 2 — the address pairs, credited only between a side org and a counterparty org of that thread.
  type Agg = { side: Set<string>; counter: Set<string>; alongside: number; cc: number };
  const agg = new Map<string, Agg>();
  const at = (a: string) => agg.get(a) ?? agg.set(a, { side: new Set(), counter: new Set(), alongside: 0, cc: 0 }).get(a)!;
  for (const [t, pairs] of byThread) {
    const orgs = orgContest(pairs, voidOrg);
    for (const [k, p] of pairs) {
      const [x, y] = k.split('\u0000');
      if (voidOrg(orgOf(x))) continue; // a counterparty organisation's pair says nothing
      const rev = pairs.get(`${y}\u0000${x}`)?.s ?? 0;
      if (p.s <= rev) continue; // the strict margin — a symmetric exchange names no side
      // THE THREAD'S COUNTERPARTY IS AN ORG: X's org must stand on the user's side of this thread and
      // Y's org must be its counterparty — never a same-side credit on the counterparty's own domain.
      if (!orgs.side.has(orgOf(x)) || !orgs.counter.has(orgOf(y))) continue;
      const ax = at(x);
      if (!ax.side.has(t)) { ax.side.add(t); }
      ax.alongside += p.alongside; ax.cc += p.cc;
      at(y).counter.add(t);
    }
  }

  const out: CircleCandidate[] = [];
  for (const [address, a] of agg) {
    if (excluded(address) || voidOrg(orgOf(address))) continue;
    // NEVER THE COUNTERPARTY: a counter thread is not also a side thread for this address.
    const counterOnly = [...a.counter].filter((t) => !a.side.has(t)).length;
    const threads = a.side.size;
    if (threads < CIRCLE_SUGGEST_MIN_THREADS || threads <= counterOnly) continue;
    const publicDomain = isPublic(domainOf(address));
    const c = { address, name: names.get(address) ?? null, threads, counterThreads: counterOnly,
      alongside: a.alongside, ccByUser: a.cc, publicDomain };
    out.push({ ...c, auto: autoVerdict(c) });
  }
  return out.sort((p, q) => q.threads - p.threads || q.alongside - p.alongside || p.address.localeCompare(q.address));
}

/** THE COUNTING RULE — pure. A removal always wins; a confirmation always counts; an inferred
 *  address counts only above the high bar (`auto`). */
export function countingCircle(candidates: readonly CircleCandidate[], decisions: readonly CircleDecision[]): string[] {
  const state = new Map(decisions.map((d) => [normAddress(d.address), d.state]));
  const out = new Set<string>();
  for (const d of decisions) if (d.state === 'confirmed') out.add(normAddress(d.address));
  for (const c of candidates) if (c.auto && state.get(c.address) !== 'removed') out.add(c.address);
  for (const [a, s] of state) if (s === 'removed') out.delete(a);
  return [...out].filter(Boolean).sort();
}

export type CircleRowState = 'confirmed' | 'inferred' | 'suggested' | 'removed';
export type CircleRow = {
  address: string; name: string | null; state: CircleRowState; counts: boolean;
  threads: number; alongside: number; publicDomain: boolean;
};

/** The Settings view — pure. `inferred` = counting by the high bar; `suggested` = awaiting a word. */
export function circleRows(candidates: readonly CircleCandidate[], decisions: readonly CircleDecision[]): CircleRow[] {
  const dec = new Map(decisions.map((d) => [normAddress(d.address), d]));
  const rows: CircleRow[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    seen.add(c.address);
    const d = dec.get(c.address);
    const state: CircleRowState = d?.state === 'removed' ? 'removed' : d?.state === 'confirmed' ? 'confirmed' : c.auto ? 'inferred' : 'suggested';
    rows.push({ address: c.address, name: c.name ?? d?.name ?? null, state, counts: state === 'confirmed' || state === 'inferred',
      threads: c.threads, alongside: c.alongside, publicDomain: c.publicDomain });
  }
  for (const [a, d] of dec) {
    if (seen.has(a)) continue;
    rows.push({ address: a, name: d.name ?? null, state: d.state, counts: d.state === 'confirmed', threads: 0, alongside: 0, publicDomain: isPublic(domainOf(a)) });
  }
  const order: Record<CircleRowState, number> = { confirmed: 0, inferred: 1, suggested: 2, removed: 3 };
  return rows.sort((p, q) => order[p.state] - order[q.state] || q.threads - p.threads || p.address.localeCompare(q.address));
}

// ── IO (bounded, paged, explicit columns; every failure degrades to "no circle") ───────────────────

const MAIL_COLS = 'from_address, from_name, to_addresses, cc_addresses, thread_id, is_from_user';
const toCircleMail = (r: Record<string, unknown>): CircleMail => ({
  from: (r.from_address as string | null) ?? null, fromName: (r.from_name as string | null) ?? null,
  to: ((r.to_addresses as string[] | null) ?? []).map(String), cc: ((r.cc_addresses as string[] | null) ?? []).map(String),
  threadId: (r.thread_id as string | null) ?? null, fromUser: r.is_from_user === true,
});

/** The two lanes the rule reads: the user's own mail, and inbound mail that COPIES the user. */
export async function readCircleMails(client: SupabaseClient, userId: string, own: readonly string[], nowMs = Date.now()): Promise<{ mails: CircleMail[]; capped: boolean }> {
  const since = new Date(nowMs - CIRCLE_WINDOW_DAYS * 86_400_000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lane = (filter: (q: any) => any) => fetchAllRows<Record<string, unknown>>((from, to) =>
    filter(client.from('emails').select(MAIL_COLS).eq('user_id', userId).gt('received_at', since))
      .order('received_at', { ascending: false }).order('id', { ascending: true }).range(from, to), { maxRows: CIRCLE_READ_MAX });
  const ownList = [...new Set(own.map((a) => normAddress(a)).filter(Boolean))];
  const [mine, copied] = await Promise.all([
    lane((q) => q.eq('is_from_user', true)),
    ownList.length ? lane((q) => q.eq('is_from_user', false).overlaps('cc_addresses', ownList)) : Promise.resolve([]),
  ]);
  return { mails: [...mine, ...copied].map(toCircleMail), capped: mine.length >= CIRCLE_READ_MAX || copied.length >= CIRCLE_READ_MAX };
}

/** Recompute the inference from the mail (zero AI). Never writes. */
export async function computeCircle(client: SupabaseClient, userId: string, known: CircleKnown, nowMs = Date.now()): Promise<CircleInference> {
  const { mails, capped } = await readCircleMails(client, userId, known.own, nowMs);
  const all = inferCircle(mails, known);
  return { v: CIRCLE_VERSION, at: new Date(nowMs).toISOString(), read: mails.length, capped, dropped: Math.max(0, all.length - CIRCLE_KEEP_MAX), candidates: all.slice(0, CIRCLE_KEEP_MAX) };
}

export async function readCircleDecisions(client: SupabaseClient, userId: string): Promise<CircleDecision[]> {
  const rows = await readPlans(client, userId, CIRCLE_DECISION_KIND);
  const out: CircleDecision[] = [];
  for (const r of rows) {
    const t = (r.tasks ?? {}) as { state?: string; at?: string; name?: string | null };
    if (t.state !== 'confirmed' && t.state !== 'removed') continue;
    out.push({ address: normAddress(r.key), state: t.state, at: String(t.at ?? r.updated_at ?? ''), name: t.name ?? null });
  }
  return out;
}

/** READ-ONLY MODE for a whole process (censuses, dry runs, gates): a recomputed inference is never
 *  persisted, whatever a caller asks. Production never calls this. */
let persistAllowed = true;
export function setCirclePersistence(on: boolean): void { persistAllowed = on; }

const isFresh = (inf: CircleInference | null, nowMs: number): inf is CircleInference =>
  !!inf && inf.v === CIRCLE_VERSION && Number.isFinite(Date.parse(inf.at)) && nowMs - Date.parse(inf.at) < CIRCLE_TTL_MS;

export type LoadedCircle = { inference: CircleInference | null; decisions: CircleDecision[]; counting: string[]; names: Record<string, string>; recomputed: boolean };

/**
 * THE ONE LOADER — the stored inference (recomputed when older than the TTL, or on `refresh`) +
 * the user's decisions → the counting circle. `persist: false` never writes (censuses, gates).
 */
export async function loadCircle(
  client: SupabaseClient, userId: string, known: CircleKnown,
  opts: { persist?: boolean; refresh?: boolean; nowMs?: number } = {},
): Promise<LoadedCircle> {
  const nowMs = opts.nowMs ?? Date.now();
  const [cached, decisions] = await Promise.all([
    opts.refresh ? Promise.resolve(null) : readPlan(client, userId, CIRCLE_KIND, CIRCLE_KEY),
    readCircleDecisions(client, userId).catch(() => [] as CircleDecision[]),
  ]);
  let inference = (cached?.tasks ?? null) as CircleInference | null;
  let recomputed = false;
  if (!isFresh(inference, nowMs)) {
    try {
      inference = await computeCircle(client, userId, known, nowMs);
      recomputed = true;
      if (opts.persist !== false && persistAllowed) await upsertPlan(client, userId, CIRCLE_KIND, CIRCLE_KEY, inference as never);
    } catch { /* keep the stale inference (or none) — a failed read only NARROWS the circle */ }
  }
  // Re-judge the high bar under the CURRENT rule (a cached verdict is never served as a fact).
  if (inference) inference = { ...inference, candidates: (inference.candidates ?? []).map((c) => ({ ...c, auto: autoVerdict(c) })) };
  const candidates = inference?.candidates ?? [];
  const names: Record<string, string> = {};
  for (const c of candidates) if (c.name) names[c.address] = c.name;
  for (const d of decisions) if (d.name && !names[d.address]) names[d.address] = d.name;
  return { inference, decisions, counting: countingCircle(candidates, decisions), names, recomputed };
}

/** An address the user may add — the ONE strict email predicate (lib/core/email.ts). */
export const isCircleAddress = (a: string): boolean => isEmailStrict(normAddress(a));

/** The user's click, recorded (confirm · remove · add = confirm an address never inferred ·
 *  reset = forget the decision). Never throws; `{ error }` on a bad address or a failed write. */
export async function decideCircle(
  client: SupabaseClient, userId: string, address: string, action: 'confirm' | 'remove' | 'add' | 'reset', name?: string | null,
): Promise<{ error: string | null }> {
  const a = normAddress(address);
  if (!isCircleAddress(a)) return { error: 'not an email address' };
  if (action === 'reset') { const r = await deletePlans(client, userId, CIRCLE_DECISION_KIND, a); return { error: r.error?.message ?? null }; }
  const state: CircleDecisionState = action === 'remove' ? 'removed' : 'confirmed';
  const r = await upsertPlan(client, userId, CIRCLE_DECISION_KIND, a, { state, at: new Date().toISOString(), name: name ?? null } as never);
  return { error: r.error?.message ?? null };
}
