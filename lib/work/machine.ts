// ─── THE MACHINE (experience-spec Part "THE MACHINE", Aug 13) ────────────────────────────────
// The explicit lifecycle every actionable item moves through — derived AT READ TIME from truth
// that already exists (the judgment cache · the one prepared reader · live asks · sent markers),
// never a new table. Surfaces RENDER the state; structured actions ADVANCE it (transitions are
// buttons, conversations are text — a transition never answers with a question).
//
// `enacting` is deliberately absent from derivation: it is the client-transient between firing
// a transition and its consequence landing (seconds, shown locally), never a stored state.
//
// TWO READERS, ONE LADDER (machine adoption, Aug 14): `workStateOf` derives one item with its
// own queries (deep-dive scale); `workStatesFor` derives a whole deck's worth from BATCHED
// prefetched rows (4 queries total, no per-item fan-out). Both call the SAME pure `deriveState`
// — the ladder cannot fork.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PreparedArtifact } from '@/lib/prepare/read';

export type WorkLifecycle =
  | 'unjudged'          // spotted, no verdict — may deck, claims nothing
  | 'preparing'         // judged actionable; nothing landed yet, no ask stands (one pass cycle)
  | 'ready'             // prepared non-send work exists (a document, a decision enacted) — review
  | 'awaiting_input'    // an honest ask stands — supply or go-ahead
  | 'awaiting_decision' // decide verdict with its brief — the card is the primary
  | 'awaiting_approval' // a send-shaped artifact is staged — Send is the primary (the commit door)
  | 'committed'         // sent/booked, awaiting settle
  | 'parked'            // deliberately set aside with a date (revisit)
  | 'settled';          // closed — renders nowhere active

export type WorkMachineState = {
  state: WorkLifecycle;
  /** The judged verb behind the state (null when unjudged/settled without one). */
  verdictWork: string | null;
  /** What the primary affordance is, for renderers that want the word. */
  primary: 'send' | 'decide' | 'supply' | 'review' | 'none';
};

/** THE HUMAN WORDS — every surface that speaks a state uses THIS mapping (one grammar, no
 *  per-surface paraphrase; law: speak consequence, never internal jargon). Transient/terminal
 *  states map to null: they render nothing rather than noise. */
export const STATE_WORDS: Record<WorkLifecycle, string | null> = {
  unjudged: null,
  preparing: 'in motion',
  ready: 'ready to review',
  awaiting_input: 'needs one thing from you',
  awaiting_decision: 'decision laid out',
  awaiting_approval: 'ready to send',
  committed: 'sent — awaiting them',
  parked: 'set aside',
  settled: null,
};

type Verdict = { work?: string; resolution?: string; revisit?: { after?: string }; options?: unknown[] } | null;

export type DeriveInputs = {
  /** Item is open (pending/active). Closed → settled before anything else. */
  open: boolean;
  verdict: Verdict;
  judgedAt: string | null;
  /** Prepared artifacts from THE ONE READER (stale already derived — or approximated, see workStatesFor). */
  prepared: PreparedArtifact[];
  /** A live, un-proceeded input_checklist stands on the item. */
  liveAsk: boolean;
  /** A send-shaped artifact's sent stamp landed (inbox source_data stamps). */
  sentStamp: boolean;
};

/** THE ONE LADDER — pure, both readers call it. Every clause carries its found-live rationale. */
export function deriveState(input: DeriveInputs): WorkMachineState {
  const none: WorkMachineState = { state: 'settled', verdictWork: null, primary: 'none' };
  if (!input.open) return none;
  const v = input.verdict;
  if (!v?.work) return { state: 'unjudged', verdictWork: null, primary: 'none' };
  if (v.work === 'none') return v.revisit?.after && v.revisit.after > new Date().toISOString().slice(0, 10)
    ? { state: 'parked', verdictWork: 'none', primary: 'none' }
    : { state: 'settled', verdictWork: 'none', primary: 'none' };

  // THE GROUND LAW (Aug 13): a stale artifact (its ground moved — a newer inbound landed) is
  // SUPERSEDED work, not preparation. The machine never lets a dead plan hold a Send primary.
  const live = input.prepared.filter((p) => !p.stale);
  // René sweep (Aug 13): an invite with no time / a forward with no recipient is staged work the
  // send door hard-rejects — NOT send-shaped (a Send primary that cannot fire is a lie).
  const SEND_KINDS = ['reply_draft', 'nudge_draft', 'invite', 'forward'];
  const sendShaped = live.find((p) => SEND_KINDS.includes(p.kind) && p.sendReady !== false);
  const sendBlocked = live.find((p) => SEND_KINDS.includes(p.kind) && p.sendReady === false);
  const decisionBrief = live.find((p) => p.decision && p.decision.options.length >= 2);
  const document = live.find((p) => p.kind === 'deliverable' && !p.decision);
  const superseded = input.prepared.some((p) => p.stale);
  // René sweep: the deep-dive's decision card falls back to the VERDICT's own validated options —
  // the machine must see the same material, or door and machine disagree (6 of 6 decide items on
  // a real account read "preparing" for 17 days while the door showed a live decision).
  const decisionMaterial = !!decisionBrief || (Array.isArray(v.options) && v.options.length >= 2);

  if (input.sentStamp) return { state: 'committed', verdictWork: v.work, primary: 'none' };

  // ── The ladder (most-specific first; the spec's order). ──
  if (v.work === 'decide' && decisionMaterial && !sendShaped) return { state: 'awaiting_decision', verdictWork: v.work, primary: 'decide' };
  // René sweep: the OPEN ASK outranks a staged send — the system itself says inputs are missing;
  // offering Send as the primary invites sending work with known holes (12 of 19 live asks on a
  // real account sat demoted behind a Send button). The draft stays available on the door.
  if (input.liveAsk) return { state: 'awaiting_input', verdictWork: v.work, primary: 'supply' };
  if (sendShaped) return { state: 'awaiting_approval', verdictWork: v.work, primary: 'send' };
  // A staged-but-unfireable send (timeless invite, recipientless forward) needs the user's input
  // even without a checklist turn — the artifact card says what's missing.
  if (sendBlocked) return { state: 'awaiting_input', verdictWork: v.work, primary: 'supply' };
  if (document) return { state: 'ready', verdictWork: v.work, primary: 'review' };
  // THE GROUND LAW: superseded work with nothing fresh yet = honest motion (the pass is
  // re-preparing from the new inbound) — never the staleness downgrade below.
  if (superseded) return { state: 'preparing', verdictWork: v.work, primary: 'none' };
  // René sweep: `preparing` is TRANSIENT by spec (one pass cycle). A judgment older than 48h with
  // nothing landed and nobody asked is not "in motion" — the machine claims nothing (unjudged)
  // rather than parading a 17-day-old verdict as activity; the verb still rides for renderers.
  if (input.judgedAt && Date.now() - Date.parse(input.judgedAt) > 48 * 3_600_000) {
    return { state: 'unjudged', verdictWork: v.work, primary: 'none' };
  }
  return { state: 'preparing', verdictWork: v.work, primary: 'none' };
}

/** Derive the lifecycle for ONE item. One judgment read + the one prepared reader + one ask read —
 *  cheap, cacheable by callers; the ladder itself lives in deriveState. */
export async function workStateOf(
  client: SupabaseClient, userId: string,
  item: { kind: 'inbox' | 'commitment'; id: string },
): Promise<WorkMachineState> {
  const none: WorkMachineState = { state: 'settled', verdictWork: null, primary: 'none' };
  try {
    // ── Closed items settle regardless of anything else. ──
    let open = false;
    let sentStamp = false;
    if (item.kind === 'inbox') {
      const { data: it } = await client.from('inbox_items').select('status, source_data').eq('id', item.id).eq('user_id', userId).maybeSingle();
      open = !!it && it.status === 'pending';
      const sd = (it?.source_data ?? {}) as { draft?: { sent_at?: string }; prepared_invite?: { sent_at?: string }; prepared_forward?: { sent_at?: string } };
      sentStamp = !!(sd.draft?.sent_at || sd.prepared_invite?.sent_at || sd.prepared_forward?.sent_at);
      // KNOWN GAP (René sweep): commitments carry no sent stamp anywhere yet — a sent commitment
      // nudge settles via the resolver instead of passing through `committed`.
    } else {
      const { data: c } = await client.from('commitments').select('status').eq('id', item.id).eq('user_id', userId).maybeSingle();
      open = !!c && ['pending', 'active', 'open'].includes(String(c.status));
    }
    if (!open) return none;

    const { data: j } = await client.from('item_plans').select('tasks, updated_at')
      .eq('user_id', userId).eq('kind', 'judgment')
      .eq('entity_id', `${item.kind}:${item.id}`).maybeSingle();
    const verdict = ((j?.tasks ?? null) as { verdict?: Verdict } | null)?.verdict ?? null;

    // ── Prepared truth via THE ONE READER (never a parallel derivation). ──
    const { getPrepared } = await import('@/lib/prepare/read');
    const prepared = verdict?.work && verdict.work !== 'none'
      ? await getPrepared(client, userId, { kind: item.kind === 'inbox' ? 'inbox_item' : 'commitment', id: item.id }).catch(() => [])
      : [];

    // ── The live ask (awaiting_input outranks preparing; a kept ask IS the preparation). ──
    let liveAsk = false;
    if (verdict?.work && verdict.work !== 'none') {
      const { data: asks } = await client.from('room_turns').select('component, archived_at')
        .eq('user_id', userId).like('dedupe_key', `%${item.id}%`).limit(6);
      liveAsk = (asks ?? []).some((t) => {
        const c = t.component as { key?: string; state?: { proceeded?: boolean } } | null;
        return c?.key === 'input_checklist' && !t.archived_at && !c?.state?.proceeded;
      });
    }

    return deriveState({ open, verdict, judgedAt: (j?.updated_at as string) ?? null, prepared, liveAsk, sentStamp });
  } catch { return none; }
}

/** Derive a whole DECK's worth of states from batched reads — 3 queries total, no per-item
 *  fan-out (the brief route serves ~60 rows; per-item workStateOf would be ~300 queries).
 *
 *  STALENESS APPROXIMATION (documented, safe direction): the exact ground check needs one
 *  emails query per thread — too hot for the deck. Here an artifact is stale when the item's
 *  `last_activity_at` postdates its `prepared_from.receivedAt` (+5s slack). last_activity_at
 *  is stamped from inbound received_at on every sync path, so this over-triggers only on rare
 *  same-thread user activity — and over-stale renders "in motion" instead of a wrong "ready
 *  to send": the error direction costs a label, never trust. */
export async function workStatesFor(
  client: SupabaseClient, userId: string,
  items: Array<{ kind: 'inbox' | 'commitment'; id: string; /** prefetched row, when the caller holds it */ row?: { status?: string | null; source_data?: unknown; last_activity_at?: string | null } }>,
): Promise<Map<string, WorkMachineState & { /** when the item was FIRST judged — the deck's "surfaced today" delta rides this */ judgedFirstAt?: string | null }>> {
  const out = new Map<string, WorkMachineState & { judgedFirstAt?: string | null }>();
  if (!items.length) return out;
  try {
    const keyOf = (i: { kind: string; id: string }) => `${i.kind}:${i.id}`;
    const inboxNeedingRows = items.filter((i) => i.kind === 'inbox' && !i.row).map((i) => i.id);
    const commitNeedingRows = items.filter((i) => i.kind === 'commitment' && !i.row).map((i) => i.id);
    const commitIds = items.filter((i) => i.kind === 'commitment').map((i) => i.id);
    const [jRes, inboxRes, commitRes, askRes, poolRes] = await Promise.all([
      client.from('item_plans').select('entity_id, tasks, updated_at, created_at')
        .eq('user_id', userId).eq('kind', 'judgment').in('entity_id', items.map(keyOf)),
      inboxNeedingRows.length
        ? client.from('inbox_items').select('id, status, source_data, last_activity_at').eq('user_id', userId).in('id', inboxNeedingRows)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      commitNeedingRows.length
        ? client.from('commitments').select('id, status').eq('user_id', userId).in('id', commitNeedingRows)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      client.from('room_turns').select('dedupe_key, component, archived_at')
        .eq('user_id', userId).filter('component->>key', 'eq', 'input_checklist').is('archived_at', null).limit(200),
      // A commitment's prepared work lives in the deliverable pool, not on the row.
      commitIds.length
        ? client.from('item_deliverables').select('entity_id, type, title, content, metadata, created_at')
            .eq('user_id', userId).eq('kind', 'commitment').in('entity_id', commitIds)
            .order('created_at', { ascending: false }).limit(200)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);
    const judgments = new Map<string, { verdict: Verdict; at: string | null; firstAt: string | null }>();
    for (const j of (jRes.data ?? []) as Array<{ entity_id: string; tasks: unknown; updated_at: string; created_at: string }>) {
      judgments.set(j.entity_id, { verdict: ((j.tasks ?? null) as { verdict?: Verdict } | null)?.verdict ?? null, at: j.updated_at ?? null, firstAt: j.created_at ?? null });
    }
    const rows = new Map<string, { status?: string | null; source_data?: unknown; last_activity_at?: string | null }>();
    for (const r of (inboxRes.data ?? []) as Array<Record<string, unknown>>) rows.set(`inbox:${r.id}`, r as never);
    for (const r of (commitRes.data ?? []) as Array<Record<string, unknown>>) rows.set(`commitment:${r.id}`, r as never);
    const askIds = new Set<string>();
    for (const t of (askRes.data ?? []) as Array<{ dedupe_key: string | null; component: unknown }>) {
      const c = t.component as { state?: { proceeded?: boolean } } | null;
      if (c?.state?.proceeded) continue;
      const m = /^(?:requires|delegate):([0-9a-f-]{36})/.exec(String(t.dedupe_key ?? ''));
      if (m) askIds.add(m[1]);
    }

    const { preparedFromSourceData, poolRowsToArtifacts } = await import('@/lib/prepare/read');
    const poolByCommit = new Map<string, Array<Record<string, unknown>>>();
    for (const r of (poolRes.data ?? []) as Array<Record<string, unknown>>) {
      const arr = poolByCommit.get(String(r.entity_id)) ?? [];
      arr.push(r); poolByCommit.set(String(r.entity_id), arr);
    }
    for (const item of items) {
      const key = keyOf(item);
      const row = item.row ?? rows.get(key);
      const open = item.kind === 'inbox'
        ? String(row?.status ?? '') === 'pending'
        : ['pending', 'active', 'open'].includes(String(row?.status ?? ''));
      const j = judgments.get(key);
      const sd = (row?.source_data ?? {}) as Record<string, unknown> & { draft?: { sent_at?: string }; prepared_invite?: { sent_at?: string }; prepared_forward?: { sent_at?: string } };
      const prepared = item.kind === 'inbox'
        ? preparedFromSourceData(sd as never)
        : poolRowsToArtifacts(poolByCommit.get(item.id) ?? [], 'commitment');
      // The staleness approximation (see the function doc): last_activity past the stamp.
      const lastAct = Date.parse(String(row?.last_activity_at ?? '')) || 0;
      if (lastAct) for (const a of prepared) {
        const pAt = Date.parse(String(a.ground?.receivedAt ?? '')) || 0;
        if (pAt && lastAct > pAt + 5000) a.stale = true;
      }
      const sentStamp = item.kind === 'inbox' && !!(sd.draft?.sent_at || sd.prepared_invite?.sent_at || sd.prepared_forward?.sent_at);
      out.set(key, {
        ...deriveState({
          open, verdict: j?.verdict ?? null, judgedAt: j?.at ?? null,
          prepared, liveAsk: askIds.has(item.id), sentStamp,
        }),
        judgedFirstAt: j?.firstAt ?? null,
      });
    }
  } catch { /* the machine word is an enhancement — rows render without it */ }
  return out;
}
