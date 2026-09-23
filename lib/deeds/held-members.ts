// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HELD SET — ONE HOME (docs/attention-plan.md, laws A2 + A3).
//
// "Everything the agent ingested and chose not to interrupt you with", derived ONCE. The ledger
// route (`app/api/home/held`), the deed engine (`prepareBulkDeed`, acting on a NAMED class) and the
// Home's own door count (`attention.heldTotal` on the brief) all read THIS function. Before this,
// the route carried its own copy of the derivation and this module carried a near-identical second
// one — two implementations of one fact, which is how a door and the ledger behind it come to
// disagree about how many things are being held.
//
// TWO HARD PROPERTIES, structural rather than promised:
//   • ZERO AI. Every fact is cached or structural — the cached judgment (item_plans kind
//     'judgment'), the echo floor, the ownership-keyed notice law, understanding.bulk, the CC-only
//     read, the entity's reasoned priority weight. No AI client is built or reachable from here.
//   • THE SAME CUT THE DECK MAKES. The SAME deck floors decide eligibility, the SAME judged weight
//     order the agenda uses orders the candidates, and the SAME `rankAttention` seats the five — so
//     "held" here can never disagree with "not served" there.
//
// NO SILENT CAPS: every full listing is paged (PostgREST's invisible 1000-row ceiling is the repo's
// oldest lesson) and a saturated read SAYS SO rather than lying by omission.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { classifyItem } from '@/lib/inbox/classify-item';
import { readPlans } from '@/lib/store/item-plans';
import { loadUserRules } from '@/lib/inbox/rules/load';
import { getCampaignSignature, isCampaignEcho, type CampaignSignature } from '@/lib/inbox/campaign-echo';
import { deckEligible, fromEmailOf, type DeckFloors, type DeckItem } from '@/lib/home/deck-floors';
import {
  whyNowOf, rankAttention, classifyHeld, bandOf, internalDomainsOf, isInternalBridge, selectGraduates,
  ATTENTION_BUDGET, MAX_ADJACENCY_PROMOTIONS,
  type AttentionRow, type HeldFacts, type HeldClassId, type HeldBandId,
} from '@/lib/home/attention';
import { fetchAllRows } from '@/lib/utils/fetch-all';
import { MIRROR_SOURCE } from '@/lib/inbox/commitment-mirrors';

/* eslint-disable @typescript-eslint/no-explicit-any */
type DBClient = any;

/** The bound this account is read under — a saturated read says so rather than lying by omission. */
export const HELD_POOL_MAX = 6000;

export type HeldMemberRow = { id: string; source_data: Record<string, unknown> | null; work_title: string | null };

export type HeldDerivation = {
  /** Every held row, as the ledger's own fact shape — hand straight to `buildHeldLedger`. */
  facts: HeldFacts[];
  /** The same set, filed by class and resolved to rows the deed engine can act on. */
  membersByClass: Map<HeldClassId, HeldMemberRow[]>;
  /** How many the budget seated out of this pool (never more than ATTENTION_BUDGET). */
  servedCount: number;
  /** The held total — every row the agent chose not to interrupt with. */
  total: number;
  /** Q2's THREE BANDS, counted here so the door can speak the SMALL number (`waiting`) and the
   *  quiet right-side fact (`handled`) without the caller re-deriving either. They partition
   *  `total`: waiting + watched + handled === total, always. */
  waiting: number;
  watched: number;
  handled: number;
  /** The honest bound of the read this total was computed over. */
  poolRead: number;
  poolSaturated: boolean;
  /** INSTANT CATCH-UP (Sep 18): how many held rows WOULD graduate right now — the size of the
   *  backlog the steady-state cron is draining 200 at a time. Computed from the SAME facts through
   *  `selectGraduates` (pure, zero-AI, zero-IO), so it is the lane's own number and not an
   *  estimate of it. This is what makes "is this account dirty?" a fact instead of a feeling. */
  graduating: number;
};

/**
 * THE ONE DERIVATION. Every PENDING inbox row this user holds, cut exactly as the deck cuts, and
 * filed into its class. A commitment is never "held" here — it is an obligation the user made and it
 * lives on the deck, in its own lane (see the route's own note about the deck's non-mail rows).
 */
export async function deriveHeld(
  client: DBClient, userId: string, selfEmail?: string | null,
): Promise<HeldDerivation> {
  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);
  const self = selfEmail?.toLowerCase();

  // ── THE POOL — paged, stable-ordered (fetchAllRows' own contract). ─────────────────────────────
  const rows = await fetchAllRows<any>((from, to) => client.from('inbox_items')
    .select('id, user_id, work_title, work_state, rule_type, type_override, source, source_data, created_at, last_activity_at')
    .eq('user_id', userId).eq('status', 'pending').neq('source', MIRROR_SOURCE) // THE MIRROR FLOOR (W2.3)
    .order('last_activity_at', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
    .range(from, to), { maxRows: HELD_POOL_MAX });

  // ── THE FACTS, all cached or structural — no AI anywhere on this path. ─────────────────────────
  let sig: CampaignSignature | null = null;
  try { sig = await getCampaignSignature(client, userId); } catch { /* the floor goes inert, never fabricates */ }
  const userRules = await loadUserRules(userId, client).catch(() => []);

  // The cached judgments, read WHOLE (paged) rather than chunked per candidate: the ledger needs the
  // disposition too ('answered' / 'expired'), which is what makes `judged_quiet` a real account.
  const judgments = (await readPlans(client, userId, 'judgment', { keyPrefix: 'inbox:' })).map((r) => ({ entity_id: r.key, tasks: r.tasks }));
  const judgedNone = new Set<string>();
  const judgedResolution = new Map<string, string | null>();
  // Q9 · THE PERSON'S OWN PARK rides the SAME read: the triage deck's ← LATER writes the judgment's
  // own `revisit` with `by: 'user'` (lib/work/judge.ts parkItem), so "when does this come back" is
  // one fact in one place, read here for free rather than from a snooze table that could disagree.
  const userParked = new Map<string, string>();
  for (const j of judgments) {
    const v = j.tasks?.verdict as { work?: string; resolution?: string; revisit?: { after?: string; by?: string } } | undefined;
    if (v?.work !== 'none') continue;
    const id = String(j.entity_id).replace(/^inbox:/, '');
    judgedNone.add(id);
    judgedResolution.set(id, v?.resolution ?? null);
    if (v.revisit?.by === 'user' && typeof v.revisit.after === 'string') userParked.set(id, v.revisit.after.slice(0, 10));
  }

  const floors: DeckFloors = { judgedNone, isEcho: (it) => isCampaignEcho(it as never, sig) };

  // ── Q8 · WHO COUNTS AS A BRIDGE. The user's own corporate domains (their connected mailboxes +
  //    profile address, free-mail providers excluded) plus our coworkers' sending domain. An
  //    attendee inside those domains is a TEAMMATE, and a teammate attends everything — the recurring
  //    internal standup made five colleagues "adjacent" and every mail they ever sent got promoted.
  const internalDomains = await (async () => {
    const addrs: Array<string | null> = [selfEmail ?? null];
    try {
      const [{ data: conns }, { data: prof }] = await Promise.all([
        client.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
        client.from('profiles').select('email').eq('id', userId).maybeSingle(),
      ]);
      for (const c of (conns ?? []) as Array<Record<string, unknown>>) {
        addrs.push(((c.metadata as { email?: string } | null)?.email) || (c.provider_account_id as string) || null);
      }
      if (prof?.email) addrs.push(prof.email as string);
    } catch { /* non-fatal — the coworker domain still guards, adjacency simply stays broader */ }
    return internalDomainsOf(addrs);
  })();

  // ── THE CALENDAR ADJACENCY FACT (shared with A1's why-now) — the near-calendar counterparties. ─
  // THE DAY ANCHOR's fact rides here too (Sep 18): the adjacency carries WHICH event it is, so the
  // two readers of this fact — the deck's why-now and the ledger's band — stay the same fact.
  const adjByEmail = new Map<string, { localTime: string | null; title: string | null; eventId: string }>();
  try {
    const { data: tzRows } = await client.from('calendar_events').select('timezone')
      .eq('user_id', userId).not('timezone', 'is', null).limit(300);
    const tzFreq = new Map<string, number>();
    for (const r of (tzRows ?? []) as Array<{ timezone: string | null }>) { const t = r.timezone; if (t) tzFreq.set(t, (tzFreq.get(t) ?? 0) + 1); }
    const userTz = [...tzFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UTC';
    const { data: soon } = await client.from('calendar_events')
      .select('id, title, start_time, attendees, is_all_day')
      .eq('user_id', userId).eq('status', 'confirmed')
      .gte('start_time', new Date(now.getTime() - 30 * 60_000).toISOString())
      .lte('start_time', new Date(now.getTime() + 48 * 3_600_000).toISOString())
      .order('start_time', { ascending: true }).limit(40);
    for (const ev of (soon ?? []) as any[]) {
      const t = String(ev.title || '').trimStart().toLowerCase();
      if (t.startsWith('canceled') || t.startsWith('cancelled')) continue;
      const localTime = ev.is_all_day ? 'all day' : (() => {
        try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTz }).format(new Date(ev.start_time)); }
        catch { return String(ev.start_time).slice(11, 16); }
      })();
      for (const a of ((ev.attendees ?? []) as any[])) {
        const e = String(a?.email || '').toLowerCase();
        if (!e || e === self) continue;
        // AN INTERNAL TEAMMATE IS NEVER A BRIDGE (Q8) — this one line is the whole swallow fix, and
        // it guards BOTH readers of the fact: the deck's why-now clause and the ledger's band.
        if (isInternalBridge(e, internalDomains)) continue;
        if (!adjByEmail.has(e)) adjByEmail.set(e, { localTime, title: (ev.title as string) || null, eventId: String(ev.id) });
      }
    }
  } catch { /* non-fatal — no brought_forward class, never a fabricated one */ }
  const adjacencyOf = (it: DeckItem) => {
    const e = fromEmailOf((it.source_data ?? {}) as Record<string, unknown>);
    return e ? adjByEmail.get(e.toLowerCase()) ?? null : null;
  };

  // ── THE SAME CUT THE DECK MAKES — the deck floors decide eligibility, `rankAttention` decides the
  //    five. Anything else is held, whichever side of the line it fell on.
  const classified = rows.map((it) => ({ it: it as DeckItem, posture: classifyItem(it as never, userRules) }));
  const eligible = classified.filter((x) => deckEligible(x.it, x.posture, floors));

  // The judged WEIGHT order, exactly as the deck orders (the entity's reasoned priority).
  const weights = new Map<string, number>();
  try {
    const ids = eligible.map((x) => String(x.it.id));
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      const { data: links } = await client.from('entity_links').select('item_id, entity_id')
        .eq('user_id', userId).eq('item_kind', 'inbox_item').in('item_id', slice).not('entity_id', 'is', null);
      const entIds = [...new Set((links ?? []).map((l: any) => l.entity_id as string))];
      if (!entIds.length) continue;
      const { data: ents } = await client.from('work_entities').select('id, priority').in('id', entIds);
      const prio = new Map((ents ?? []).map((e: any) => [e.id as string, (e.priority as { weight?: number } | null)?.weight]));
      for (const l of (links ?? []) as Array<{ item_id: string; entity_id: string }>) {
        const w = prio.get(l.entity_id);
        if (typeof w === 'number') weights.set(l.item_id, w);
      }
    }
  } catch { /* non-fatal — the neutral weight stands (absence of judgment is not judgment) */ }

  const candidates: AttentionRow[] = eligible
    .map((x) => {
      const sd = (x.it.source_data ?? {}) as Record<string, unknown>;
      const u = (sd.understanding ?? null) as { deadline?: string | null; relevance?: string } | null;
      const due = typeof u?.deadline === 'string' && /^\d{4}-\d{2}-\d{2}/.test(u.deadline) ? u.deadline.slice(0, 10) : null;
      const adj = adjacencyOf(x.it);
      const source = u?.relevance === 'action' ? 'notice' as const : 'reply' as const;
      const who = (sd.from_name as string) || (sd.from as string) || null;
      return {
        key: `${source[0]}-${x.it.id}`, entityId: String(x.it.id), source,
        whyNow: whyNowOf({ source, who, dueDate: due, overdue: !!due && due < todayISO, dueToday: due === todayISO, meeting: adj }, now),
        calendarAdjacent: !!adj, overdue: !!due && due < todayISO, dueToday: due === todayISO, dueDate: due,
      } satisfies AttentionRow;
    })
    .sort((a, b) => (weights.get(b.entityId) ?? 20) - (weights.get(a.entityId) ?? 20));

  const { served } = rankAttention(candidates, ATTENTION_BUDGET);
  const servedIds = new Set(served.map((r) => r.entityId));
  const eligibleIds = new Set(eligible.map((x) => String(x.it.id)));

  // ── THE HELD SET — the floors' refusals PLUS the budget's overflow, one list, one classification.
  const facts: HeldFacts[] = [];
  const membersByClass = new Map<HeldClassId, HeldMemberRow[]>();
  const byBand: Record<HeldBandId, number> = { waiting: 0, watched: 0, handled: 0 };
  // Q8's CAP: past three, "someone on today's calendar sent this" stops being information about the
  // row and starts being a description of a recurring meeting's guest list. The overflow keeps its
  // TRUE class — nothing is hidden, it is simply not promoted.
  let adjacencyPromotions = 0;
  for (const it of rows) {
    const id = String(it.id);
    if (servedIds.has(id)) continue;
    const budgetOverflow = eligibleIds.has(id);
    const adjacent = !!adjacencyOf(it as DeckItem)
      && budgetOverflow && adjacencyPromotions < MAX_ADJACENCY_PROMOTIONS;
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const u = (sd.understanding ?? null) as { ownership?: string; deadline?: string | null } | null;
    // THE MACHINERY LIFT FACT: a judged stated deadline still ahead (user's day). ISO-date string
    // compare — the understanding's deadline is stored absolute (the deixis law).
    const dl = typeof u?.deadline === 'string' ? u.deadline.slice(0, 10) : null;
    const f: HeldFacts = {
      item: it as DeckItem,
      isEcho: floors.isEcho(it as DeckItem),
      judgedNone: judgedNone.has(id),
      judgedResolution: judgedResolution.get(id) ?? null,
      calendarAdjacent: adjacent,
      budgetOverflow,
      // Q2's WATCHED fact, off cached judgment only: THEY owe the next move.
      waitingOnOthers: u?.ownership === 'awaiting' || it.work_state === 'waiting',
      quietSince: (it.last_activity_at as string | null) ?? (it.created_at as string | null) ?? null,
      deadlineAhead: dl !== null && dl >= todayISO,
      // Q9 · the park, and whether its day has come. The comparison is CODE-SIDE here (the pure
      // module owns no clock), on the same day boundary `deadlineAhead` already uses.
      userParkedUntil: userParked.get(id) ?? null,
      userParkDue: userParked.has(id) && userParked.get(id)! <= todayISO,
    };
    facts.push(f);
    const cls = classifyHeld(f);
    if (cls === 'brought_forward') adjacencyPromotions++;
    const band = bandOf(cls, f);
    byBand[band]++;
    // THE DEED ACTS ON EXACTLY WHAT THE LEDGER SHOWS. The class rows are a HANDLED-band surface, so
    // a class named by a bulk deed resolves to its handled members only — a waiting or watched row
    // can never be swept up by a verb the reader fired on a class row they were looking at.
    if (band !== 'handled') continue;
    const bucket = membersByClass.get(cls) ?? membersByClass.set(cls, []).get(cls)!;
    bucket.push({ id, source_data: it.source_data ?? null, work_title: it.work_title ?? null });
  }

  return {
    facts,
    membersByClass,
    graduating: selectGraduates(facts, todayISO).length,
    servedCount: served.length,
    total: facts.length,
    waiting: byBand.waiting,
    watched: byBand.watched,
    handled: byBand.handled,
    poolRead: rows.length,
    poolSaturated: rows.length >= HELD_POOL_MAX,
  };
}

/**
 * The deed engine's view of the same derivation: "everything the ledger filed under Notices",
 * resolved to real item ids. A deed named by CLASS must act on exactly the set the ledger shows, so
 * it reads the SAME function rather than a second copy of the law.
 */
export async function deriveHeldMembers(
  client: DBClient, userId: string, selfEmail?: string | null,
): Promise<Map<HeldClassId, HeldMemberRow[]>> {
  return (await deriveHeld(client, userId, selfEmail)).membersByClass;
}

/**
 * THE DOOR'S NUMBERS (A3's one-scale clause × Q2's gradient). The Home's door reads THIS, so the
 * door and the ledger behind it can never speak two different scales — they are the same
 * computation. The door speaks `waiting` (the small, alive number) and rests `handled` beside it;
 * `total` stays served so nothing that already reads it has to change. Counts only.
 */
export async function countHeld(
  client: DBClient, userId: string, selfEmail?: string | null,
): Promise<{
  total: number; waiting: number; watched: number; handled: number;
  servedCount: number; poolRead: number; poolSaturated: boolean; graduating: number;
  /** THE DERIVATION ITSELF, handed back. The count IS a whole-pool walk; throwing its facts away
   *  meant the ledger's first visit after a Home visit walked the pool a second time while the
   *  reader watched. The caller primes the ledger's last-good from this (lib/deeds/held-cache). */
  derived: HeldDerivation;
}> {
  const d = await deriveHeld(client, userId, selfEmail);
  return {
    total: d.total, waiting: d.waiting, watched: d.watched, handled: d.handled,
    servedCount: d.servedCount, poolRead: d.poolRead, poolSaturated: d.poolSaturated,
    // The catch-up detector's one fact, riding the read the brief already pays for.
    graduating: d.graduating,
    derived: d,
  };
}
