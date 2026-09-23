// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE WORK JUDGMENT (judged-room J1, docs/judged-room-plan.md).
//
// judgeWork answers "what does DOING this take?" ONCE, with the BRAIN in view — the entity's
// state/next-move/goals-rules, the counterparty's person state, the unified understanding
// (relevance/ownership/mailKind/ask), what's ALREADY PREPARED in the pool, and the roster — and
// its single verdict drives three consequences at once: the COMPONENT the plane mounts, the
// EXECUTOR proposed (coworker / user / system), and the COMMIT GATE. Surfaces never infer locally;
// the ambient pass and the room read the SAME cached verdict, so they can never disagree.
//
// Doctrine: structural floors BEFORE AI (an answered thread, an automated sender, the ownership-
// keyed notice law — imported, never re-implemented); `none` is always legal; conservative
// (a wrong mount costs trust, message_only costs nothing); one reasoned call, schema-validated;
// cached on the item (sig = sigOf(JUDGE_VERSION, day, activity, pool, evidence, THE DEAL BLOCK AS
// RENDERED, …) — W9.3: the entity fields the prompt actually reads, never the entity's own sig).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { coerceUnderstanding, type ItemUnderstanding } from '@/lib/inbox/item-understanding';
import { isBystanderSeat } from '@/lib/inbox/recipient-role';
import { isNoMoveNotice, isAutomatedSenderStrong, rawMailKindOf, listMailOf } from '@/lib/inbox/notice-demotion';
import { isOwnCoworkerSender, ownCoworkerLocals, SELF_ECHO_REASON } from '@/lib/inbox/self-echo';
import { kindFloor, kindFloorReason } from '@/lib/work/kind-floor';
import { computeThreadReplyState, type ThreadMessage } from '@/lib/inbox/thread-resolution';
import { preparedState, isLiveArtifact, withdrawnReasonOf, type PreparedArtifact } from '@/lib/prepare/read';
import { loadRoster, type RosterEntry } from '@/lib/prepare/route-suggestion';
import { userTimezone, localNow, timesInText, dateStatedInText, dateStatedInTextVerified } from '@/lib/utils/user-time';
import { clipForPrompt, clipLabel, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { anchorPassedFact } from '@/lib/work/judgment-nominator';
import { readOutcomeFacts, outcomeHistoryFact, outcomeSigPart, type CounterpartyClass } from '@/lib/prepare/outcome-facts';
import { readSiblingNomination, siblingSettledFact } from '@/lib/inbox/conversation-identity';
import { readProofOfLifeAsk, proofOfLifeFact, proofOfLifeSigPart } from '@/lib/work/proof-of-life';
import { sigOf } from '@/lib/core/sig';
import { readPlan, upsertPlan } from '@/lib/store/item-plans';
import { normalizeEmail } from '@/lib/core/email';
import { loadEvidencePool, loadOpenWork, scopeOf, matchEvidence, evidenceSig, evidenceNewToPrior, resolveCommitmentAddress, SETTLE_MATCH, type Evidence, type EvidencePool, type EvidenceScope } from '@/lib/work/evidence-nominator';
import { actorLabel } from '@/lib/evidence/actor';
import { deedWords } from '@/lib/evidence/sources';

// ── LATER EVIDENCE (W3.1 EVIDENCE SETTLES, judge half · invariant 7) ─────────────────────────────
// The judge reads what the user's own record shows AFTER the item — sent mail to the counterparty on
// ANY thread, held/booked meetings, recorded transcripts — as dated FACTS. It never disposes from
// them on its own (precedence #11: evidence NOMINATES, the fulfillment judge DECIDES); the one rule
// that reads them is the long-standing ALREADY BOOKED rule (the scheduling half only).
//
// ONE POOL PER USER PER BATCH: judgeWork runs in loops (the prep pass, the judgment sweep, proof-of-
// life, the commitments sweep) — the pool (≤3 bounded reads) is memoized per user for a short window
// so a batch pays it once, never per item. Single-flight: concurrent judgments share the promise.
const EVIDENCE_LOOKBACK_DAYS = 60;          // an item older than this sees evidence from the window only
const EVIDENCE_POOL_TTL_MS = 90_000;        // a batch's lifetime; a newer deed re-keys the next pass
const EVIDENCE_CAL_HORIZON_DAYS = 21;       // the booked-calendar fact's forward reach (the v16 window)
const _evidencePools = new Map<string, { at: number; p: Promise<EvidencePool> }>();
function judgeEvidencePool(client: SupabaseClient, userId: string): Promise<EvidencePool> {
  const now = Date.now();
  const hit = _evidencePools.get(userId);
  if (hit && now - hit.at < EVIDENCE_POOL_TTL_MS) return hit.p;
  if (_evidencePools.size > 200) for (const [k, v] of _evidencePools) if (now - v.at >= EVIDENCE_POOL_TTL_MS) _evidencePools.delete(k);
  // THE SCOPE (W7.1 HEARTBEAT THROUGHPUT): the email lane is loaded by the PEOPLE + THREADS of the
  // account's open work (the nominator's ONE open-work reader), the newest-first window beside it —
  // found live: a heavy-mail account's newest-400 window had lost the counterparty's older thread.
  const since = new Date(now - EVIDENCE_LOOKBACK_DAYS * 86_400_000).toISOString();
  const p = (async () => {
    let scope: EvidenceScope | undefined;
    try {
      const { getPersonEntities } = await import('@/lib/entities/people');
      scope = scopeOf(await loadOpenWork(client, userId, await getPersonEntities(client, userId)));
    } catch { scope = undefined; } // the scope is an enhancement; the window alone still serves
    return loadEvidencePool(client, userId, since, scope);
  })().catch(() => ({ emails: [], events: [], transcripts: [] } as EvidencePool));
  _evidencePools.set(userId, { at: now, p });
  return p;
}

/** An evidence moment in the USER'S zone (TIME TRUTH — the prompt says times are in this zone). */
function atLocal(iso: string, tz: string): string {
  try { return new Date(iso).toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16); } catch { return iso.slice(0, 16).replace('T', ' '); }
}

/** The LATER EVIDENCE facts block — dated, short, one line per piece. '' when nothing was found.
 *  The calendar lines keep the ALREADY ON THE USER'S CALENDAR header the ALREADY BOOKED rule reads.
 *  W8.7 THE JUDGE SEES WHAT THE SETTLE SEES: the pool is matched with SETTLE_MATCH (every registry row,
 *  teammates included), so a TEAMMATE's mail renders as theirs — "a teammate (<name>) sent …", never
 *  as the user's — and a deed done THROUGH AUGMTD (the commit-door ledger) renders as a dated deed.
 *  The legacy sections are byte-identical; the new ones appear only when such a piece is present. */
export function laterEvidenceBlock(ev: Evidence[], tz: string): string {
  if (!ev.length) return '';
  const q = (t: string) => `"${clipLabel(String(t || 'untitled'), 70)}"`;
  const cal = ev.filter((e) => e.type === 'calendar');
  const sent = ev.filter((e) => e.type === 'email' && e.by === 'user');
  const mate = ev.filter((e) => e.type === 'email' && e.by === 'teammate');
  const recv = ev.filter((e) => e.type === 'email' && e.by === 'counterparty');
  const tr = ev.filter((e) => e.type === 'transcript');
  const deeds = ev.filter((e) => e.type === 'deed');
  return `LATER EVIDENCE — the user's own record AFTER this item, with this counterparty (dated facts, not a verdict):\n` +
    (cal.length ? `ALREADY ON THE USER'S CALENDAR with this counterparty:\n${cal.map((e) => `- ${q(e.title)} at ${atLocal(e.at, tz)} (${e.status === 'held' ? 'held' : 'booked, upcoming'})`).join('\n')}\n` : '') +
    (sent.length ? `SENT BY THE USER to this counterparty since (any thread):\n${sent.map((e) => `- ${q(e.title)} on ${atLocal(e.at, tz)}`).join('\n')}\n` : '') +
    (mate.length ? `SENT BY A TEAMMATE of the user (the user's side, not the user) to this counterparty since (any thread):\n${mate.map((e) => `- a teammate (${clipLabel(actorLabel(e.actor), 40)}) sent ${q(e.title)} on ${atLocal(e.at, tz)}`).join('\n')}\n` : '') +
    (recv.length ? `RECEIVED FROM THIS COUNTERPARTY since (any thread):\n${recv.map((e) => `- ${q(e.title)} on ${atLocal(e.at, tz)}`).join('\n')}\n` : '') +
    (tr.length ? `MEETINGS RECORDED with this counterparty since:\n${tr.map((e) => `- ${q(e.title)} on ${atLocal(e.at, tz)}`).join('\n')}\n` : '') +
    (deeds.length ? `DONE BY THE USER THROUGH AUGMTD since (a recorded deed):\n${deeds.map((e) => `- ${deedWords(e)} ${q(e.title)} on ${atLocal(e.at, tz)}`).join('\n')}\n` : '');
}


// Word-boundary clip with NO ellipsis — for a `requires` label, which is an IDENTITY (it keys the
// staged `require:<label>` rows), so it must not grow a display glyph. Titles use clipLabel.
function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const w = cut.lastIndexOf(' ');
  return (w > max * 0.5 ? cut.slice(0, w) : cut).trim();
}
import { COMPONENT_KEYS, gateOf, renderComponentOptions, componentForWork, JUDGE_VERSION, WORK_VERBS, type WorkComponentKey, type WorkGate, type WorkVerb } from '@/lib/work/surface-registry';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// JUDGMENTS FOLLOW WHAT MATTERS (stabilization W9.3).
//
// (a) THE DEAL BLOCK IS THE ENTITY DEP. The judge reads an entity through exactly ONE rendering — the
// deal block below (name · state summary · next move · goals · rules). W2.5 keyed the sig on the
// entity's own `sig`, which moves on EVERY re-synthesis (any ledger line, any member verdict flip) —
// so each state refresh re-judged every member item that day, even when nothing the judge reads had
// changed (the cost cascade, found by the Sep 23 audit). The sig now carries the RENDERED block: a
// re-synthesis that changes nothing the judge reads costs nothing; one that does re-judges today.
// One-time cost of the format change: an entity-linked item already judged today misses once on its
// next read (the day slot re-keys every verdict tomorrow anyway); JUDGE_VERSION is NOT bumped (the
// block's text is unchanged — THE RULE in lib/core/versions.ts: a fact rides the sig as a dep), so
// same-version priors keep anchoring and there is no corpus-wide re-judge.
//
// (b) MATERIAL CHANGE IS NAMED. "BE CONSISTENT with your prior" is right for a re-read; it is wrong
// when the present moved. Beside new LATER EVIDENCE (W7.1), three facts are stamped on every cached
// verdict and compared on the re-judgment: a NEWER INBOUND message on the thread, the item's own
// deadline PASSING, and the deal's NEXT MOVE changing. When one moved, the prompt says so; otherwise
// the consistency clause stands byte-identical. A prior with no stamp (cached before W9.3) is never
// guessed material.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The entity fields the judge prompt reads, as rendered into it. '' when the item has no entity. */
export function dealBlockOf(ent: { name?: unknown; state?: unknown; next_move?: unknown; goals?: unknown; rules?: unknown } | null | undefined): string {
  if (!ent) return '';
  const st = (ent.state ?? {}) as { summary?: string };
  const nm = (ent.next_move ?? null) as { title?: string } | null;
  const goals = Array.isArray(ent.goals) ? (ent.goals as string[]).filter(Boolean) : [];
  const rules = Array.isArray(ent.rules) ? (ent.rules as string[]).filter(Boolean) : [];
  return `THE DEAL (${String(ent.name ?? '')}): ${st.summary ?? ''}${nm?.title ? ` · next move: ${nm.title}` : ''}` +
    `${goals.length ? ` · goals: ${goals.join('; ')}` : ''}${rules.length ? ` · rules: ${rules.join('; ')}` : ''}\n`;
}

/** The facts stamped on a cached verdict so the re-judgment can tell a re-read from a moved present. */
export type MaterialStamp = {
  /** newest INBOUND (not-from-user) message time on the item's thread; '' when none. */
  tn: string;
  /** the item's own stated deadline has passed (a past due date, or today's stated time behind now). */
  dp: boolean;
  /** the deal's next-move title as the prompt renders it; '' when none. */
  nm: string;
};

/** PURE — what MATERIALLY changed since the prior verdict's stamp. [] for an unstamped prior. */
export function materialChangesSince(prior: unknown, now: MaterialStamp): string[] {
  if (!prior || typeof prior !== 'object') return [];
  const p = prior as Partial<MaterialStamp>;
  const out: string[] = [];
  if (typeof p.tn === 'string' && now.tn && now.tn > p.tn) out.push('a NEWER message from them arrived on the thread (see WHERE THE THREAD STANDS NOW)');
  if (p.dp === false && now.dp) out.push("the item's own stated deadline has PASSED");
  if (typeof p.nm === 'string' && p.nm !== now.nm) out.push(now.nm ? "the deal's next move CHANGED (see THE DEAL above)" : "the deal's next move was CLEARED");
  return out;
}

/** The prompt sentence for the named changes — '' when nothing moved (the consistency clause stands). */
export function materialChangeClause(changes: string[]): string {
  return changes.length
    ? ` MATERIAL CHANGE SINCE THAT CALL: ${changes.join('; ')} — judge from the present facts; consistency with the prior call does not hold where these moved.`
    : '';
}

export type WorkVerdict = {
  work: WorkVerb;
  component: WorkComponentKey;
  executor: { kind: 'coworker' | 'user' | 'system'; id?: string; name?: string };
  gate: WorkGate;
  /** decide-only: the numbered routes (the plane appends the decline). */
  options?: Array<{ label: string }>;
  /** MOOTNESS/CLOSURE (promise fix) — a machine-actionable disposition when work='none':
   *  'expired' = the thing this asked about has already happened / its window passed (acting is
   *  pointless — a link for a past event, "tomorrow" that has gone); 'answered' = the ask is
   *  already settled in the thread (a confirmation, a closure). THE ONE consequence module
   *  (lib/work/apply-verdict.ts) turns this into a resolution — the verdict MOVES the posture,
   *  it never just decorates the room. */
  resolution?: 'expired' | 'answered' | null;
  /** DELIBERATE TIME (proactive-team W4) — "not yet": the item's own words say the right move
   *  comes LATER (a stated get-back date, "after the board meeting on X"). work='none' + revisit
   *  parks it: the deck demotes it (a plain none), the cache serves it WITHOUT AI until the date,
   *  and on/after the date the daily re-judgment is forced fresh so it comes back live. Judged,
   *  never a snooze timer; only with a concrete basis in the item.
   *
   *  `by` NAMES THE AUTHOR OF THE PARK (Q9 · THE TRIAGE DECK). The deck's ← LATER is the SAME
   *  record, driven by a person instead of the judge — there is no second snooze store anywhere,
   *  because a second store is a second truth about when a thing comes back. Absent = the judge's
   *  own (every park written before Q9). The one behavioural difference lives at the parked serve:
   *  A USER'S WORD OUTRANKS THE JUDGE, so a park the PERSON set holds until its date whatever else
   *  moved on the item, while the judge's own park still yields the moment the item's facts change. */
  revisit?: { after: string; reason?: string; by?: 'judge' | 'user' } | null;
  /** THE DELIVERABLE INVENTORY (the "what does it take" half of the judgment): the concrete
   *  attachable artifacts this work must INCLUDE, in the item's own words ("could you share the
   *  org report, individual report and ALP sheet" → 3 entries). ONLY what the item explicitly
   *  asks for or the work objectively cannot go out without — never inferred nice-to-haves.
   *  The preparation pass resolves each (have it / need it from the user) before drafting. */
  requires?: Array<{ label: string }>;
  /** FAILURE HONESTY (proactive-team W2): true means the judge COULD NOT judge — the reasoning call
   *  failed or returned an unusable verdict. A failed verdict is NEVER cached (the next open retries)
   *  and NEVER moves the posture or strips artifacts (apply-verdict guards on it). "Failed to judge"
   *  and "judged none" are different truths; conflating them cost real drafts. */
  failed?: true;
  reason: string;
};

export type JudgeInput = { kind: 'inbox' | 'commitment'; id: string };

// ONE verb list — the registry's (a verb added there without a preparation path fails the P21 gate).
const WORKS = new Set<string>(WORK_VERBS);

function fallbackVerdict(reason: string, resolution?: 'expired' | 'answered'): WorkVerdict {
  return { work: 'none', component: 'message_only', executor: { kind: 'user' }, gate: null, reason, ...(resolution ? { resolution } : {}) };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DIRECTION FLOOR (stabilization W11.1 · ONE COHERENT ITEM — owner walk, Sep 23). A `chase` is a
// nudge for something SOMEONE ELSE owes the user; it is only valid on AWAITING work. Found live: a
// you_owe commitment ("Change '<phrase>' in the second tab", owed TO a client contact) carried a
// prepared email that NUDGED THE CLIENT ("Just a quick nudge on the small edit we discussed …") —
// the obligation inverted, in the user's own voice. The prompt already says so (JUDGE_VERSION 15's
// ask-direction rule); a rule in a prompt is a wish, so the floor is CODE, applied to every verdict
// the judge serves (computed, cached and parked alike — a cached inverted chase self-heals on its
// first serve, with no re-judgment and no AI):
//   · a COMMITMENT the user owes (direction you_owe) + chase → `none` (message_only, NO disposition):
//     the debt stays open and on the desk as the user's own; nothing is prepared that speaks for it
//     as a chase. (No send_file/produce: a chase verdict carries no inventory, so any other verb
//     would be an invented one — CONSERVATIVE: none costs nothing, a wrong mount costs trust.)
//   · an INBOX item whose understanding says the user owes the move (ownership you_owe) + chase →
//     `reply` (reply_composer): the counterparty is waiting on the USER on this thread, and the one
//     move the user owes on a thread is their reply. (`none` would demote live work off the deck.)
// Pure — exported for the gate (scripts/smoke-item-coherence.ts) and tests/unit.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const DIRECTION_FLOOR_REASON = 'you owe this — a nudge to them would invert the obligation';
export function directionFloor(
  v: WorkVerdict,
  facts: { kind: 'inbox' | 'commitment'; direction?: string | null; ownership?: string | null },
): WorkVerdict {
  if (v.work !== 'chase') return v;
  if (facts.kind === 'commitment' && String(facts.direction ?? '') === 'you_owe') {
    const out: WorkVerdict = {
      work: 'none', component: 'message_only', executor: { kind: 'user' }, gate: null,
      reason: `${DIRECTION_FLOOR_REASON}. (${clipLabel(v.reason, 110)})`,
    };
    return out;
  }
  if (facts.kind === 'inbox' && String(facts.ownership ?? '') === 'you_owe') {
    const component = (componentForWork('reply') ?? 'reply_composer') as WorkComponentKey;
    const out: WorkVerdict = {
      work: 'reply', component, executor: v.executor.kind === 'coworker' ? v.executor : { kind: 'user' },
      gate: gateOf(component), reason: `${DIRECTION_FLOOR_REASON} — the move owed is the user's reply. (${clipLabel(v.reason, 110)})`,
    };
    return out;
  }
  return v;
}

/** The user-clock context every time-law compares against (T-class: the brain reasons in the
 *  USER's day and hour, never the server's — and every time claim is checked against the item's
 *  own text, the expired_on pattern extended to hours). */
type TimeCtx = { todayStr: string; nowHHMM: string; itemText: string };

/** The reasoned second layer of THE STATED-DATE CHECK, injected so coerceVerdict stays a pure
 *  shape-coercer that never reaches for a client of its own. Absent → layer 1 alone (the tests'
 *  and the fallback path's shape). Returns a code-verified verdict, never the model's assertion. */
type DateVerifier = (text: string, iso: string) => Promise<boolean>;

async function coerceVerdict(raw: unknown, roster: RosterEntry[], ctx: TimeCtx, verifyDate?: DateVerifier): Promise<WorkVerdict | null> {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const work = String(r.work || '').toLowerCase();
  if (!WORKS.has(work)) return null;
  // STRUCTURAL coherence — the model picks the WORK; the COMPONENT DERIVES from the registry,
  // always (the work→component map is 1:1 — letting the model's component half through produced
  // real drift like chase/reply_composer). One source: the registry.
  const component = componentForWork(work) ?? '';
  if (!COMPONENT_KEYS.has(component)) return null;
  const exRaw = (r.executor ?? {}) as Record<string, unknown>;
  const exKind = String(exRaw.kind || 'user').toLowerCase();
  const executor: WorkVerdict['executor'] = { kind: exKind === 'coworker' || exKind === 'system' ? exKind : 'user' };
  if (executor.kind === 'coworker') {
    const w = roster.find((x) => x.name.toLowerCase() === String(exRaw.name || '').toLowerCase());
    if (w) { executor.id = w.id; executor.name = w.name; }
    else executor.kind = 'user'; // an unrecognized name never invents a coworker
  }
  const out: WorkVerdict = {
    work: work as WorkVerdict['work'], component: component as WorkComponentKey,
    executor, gate: gateOf(component as WorkComponentKey),
    // Word-boundary clip — a raw slice served "…whether the proposal meets expect" to the
    // decision card (found on the served room, Aug 12). The clip is honest: cut at a space.
    reason: clipLabel(String(r.reason || ''), 240),
  };
  // The disposition is only meaningful on a none verdict (a live work item can't be moot).
  // STRUCTURAL COHERENCE on "expired" (the hallucinated-expiry class): the model must SHOW the
  // stated date that passed (`expired_on`) and the ARITHMETIC is code's, not the model's — an
  // unparseable, missing, or future basis rejects the disposition (the same law as the component
  // half: the model supplies judgment, the registry/calendar supply the facts). T-class extends it
  // to HOURS: a SAME-DAY expiry needs a TIME the item itself states (`expired_time`, verified
  // in-text) that has already passed on the USER'S clock — a 12:30 meeting is honestly over at
  // 20:34 the same day, and an undated-untimed ask can never expire at all.
  const reso = String(r.resolution || '').toLowerCase();
  if (work === 'none' && reso === 'answered') out.resolution = 'answered';
  if (work === 'none' && reso === 'expired') {
    const basis = String(r.expired_on ?? '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(basis)) {
      // THE STATED-DATE CHECK (P27 hardening): a past basis is only an expiry when the item's OWN
      // text states that date (any common rendering — dateStatedInText). A fabricated yesterday
      // no longer defeats the same-day protection; an unverifiable claim keeps the item live.
      if (basis < ctx.todayStr) {
        // LAYER 1 (free, deterministic). LAYER 2 (proactive-reach LAW 3, owner amendment): when the
        // item states its date in a language or a rendering layer 1 cannot render, ONE cheap reasoned
        // call is asked to QUOTE the span — and CODE verifies the quote is a verbatim substring
        // carrying the date's own digits before it counts. The model can propose; only code disposes,
        // so the fail-safe asymmetry P27 bought is preserved in both layers.
        if (dateStatedInText(ctx.itemText, basis)) out.resolution = 'expired';
        else if (verifyDate && await verifyDate(ctx.itemText, basis)) out.resolution = 'expired';
      }
      else if (basis === ctx.todayStr) {
        const t = /^(\d{1,2}):(\d{2})$/.exec(String(r.expired_time ?? '').trim());
        if (t) {
          const hhmm = `${t[1].padStart(2, '0')}:${t[2]}`;
          if (timesInText(ctx.itemText).includes(hhmm) && ctx.nowHHMM > hhmm) out.resolution = 'expired';
        }
      }
    }
  }
  // W4 — revisit: none-only, never alongside a closure disposition, a real FUTURE date only (a
  // past or malformed date is meaningless — the item just stays live). Local-day comparison.
  if (work === 'none' && !out.resolution && r.revisit && typeof r.revisit === 'object') {
    const rv = r.revisit as Record<string, unknown>;
    const after = String(rv.after ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(after) && after > ctx.todayStr) {
      out.revisit = { after, ...(rv.reason ? { reason: clipLabel(String(rv.reason), 140) } : {}) };
    }
  }
  if (work === 'decide' && Array.isArray(r.options)) {
    out.options = (r.options as unknown[]).slice(0, 4)
      .map((o) => ({ label: clipLabel(String((o as Record<string, unknown>)?.label ?? o ?? ''), 80) }))
      .filter((o) => o.label);
  }
  // The deliverable inventory is only meaningful on outbound work (a none/chase carries nothing).
  if ((work === 'reply' || work === 'send_file' || work === 'produce') && Array.isArray(r.requires)) {
    const reqs = (r.requires as unknown[]).slice(0, 5)
      // Word-boundary clip — a mid-word label ("…timezone offset an") read as broken UI (Aug 4).
      .map((o) => ({ label: clipWords(String((o as Record<string, unknown>)?.label ?? o ?? '').trim(), 90) }))
      .filter((o) => o.label);
    if (reqs.length) out.requires = reqs;
  }
  return out;
}

/** The judgment cache rides item_plans (kind 'judgment', entity_id = `${kind}:${id}` — free TEXT,
 *  zero-migration, owner-RLS). tasks jsonb holds { verdict, sig }. */
async function readCache(
  client: SupabaseClient, userId: string, input: JudgeInput, sig: string,
): Promise<{ hit: WorkVerdict | null; prior: WorkVerdict | null; priorSig: string | null; priorEv: string | null; priorMat: unknown }> {
  const data = await readPlan(client, userId, 'judgment', `${input.kind}:${input.id}`);
  const t = (data?.tasks ?? null) as { verdict?: unknown; sig?: string; ev?: string; mat?: unknown } | null;
  const v = (t?.verdict ?? null) as WorkVerdict | null;
  const valid = !!v && WORKS.has(v.work) && COMPONENT_KEYS.has(v.component);
  if (!valid) return { hit: null, prior: null, priorSig: null, priorEv: null, priorMat: null };
  // W7.1: the evidence set the prior was made AGAINST (absent on verdicts cached before the stamp
  // existed — read as "none seen", so a pre-deploy prior never anchors against evidence it never saw).
  const priorEv = typeof t!.ev === 'string' ? t!.ev : null;
  // W9.3: the material stamp the prior was made against (absent before W9.3 — never guessed material).
  const priorMat = t!.mat ?? null;
  // A stale-sig verdict is still the judge's OWN PRIOR JUDGMENT — fed back into the re-judgment
  // as self-consistency context (stickiness through reasoning, never a lock): an ambiguous item
  // must not flip verdicts on a daily re-check unless something material actually changed.
  // SAME-VERSION ONLY: a prior made under an older JUDGE_VERSION was judged under different laws —
  // anchoring on it would entrench exactly the calls a version bump exists to correct.
  const sameVersion = String(t!.sig ?? '').split(':')[0] === String(JUDGE_VERSION);
  if (t!.sig === sig) return { hit: v, prior: v, priorSig: String(t!.sig), priorEv, priorMat };
  return { hit: null, prior: sameVersion ? v : null, priorSig: sameVersion ? String(t!.sig ?? '') : null, priorEv, priorMat: sameVersion ? priorMat : null };
}

/** The sig with its DAY component blanked — the parked-serve comparison: same item facts (version,
 *  activity, pool), only the calendar moved. */
const nonDaySig = (s: string): string => { const p = s.split(':'); return [p[0], ...p.slice(2)].join(':'); };

/** `ev` (W7.1) = the evidenceSig the verdict was judged against — the re-judgment reads it to know
 *  whether LATER EVIDENCE is new to the prior (never part of the sig itself; the sig already moves). */
async function writeCache(client: SupabaseClient, userId: string, input: JudgeInput, sig: string, verdict: WorkVerdict, ev?: string | null, mat?: unknown): Promise<void> {
  // `mat` (W9.3) = the MaterialStamp the verdict was judged against — the re-judgment's moved-present read.
  await upsertPlan(client, userId, 'judgment', `${input.kind}:${input.id}`, {
    verdict, sig, ...(ev != null ? { ev } : {}), ...(mat != null ? { mat } : {}),
  });
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// Q9 · ← LATER — THE PERSON'S OWN PARK (docs/attention-plan.md PART III, THE TRIAGE DECK).
//
// "← LATER — one-keystroke when (tomorrow / next week / date) → THE REVISIT PARK → returns ON that
// date as a deck candidate."
//
// THE REVISIT PARK, not a snooze store beside it. There is exactly ONE mechanism in this house for
// "come back on a date", and it is the judgment's own `revisit` — the deck demotes on it, the cache
// serves it without AI until the date, `applyVerdictConsequences` narrates it into the item's room
// and stamps `work_parked` on the activity ledger, and the date's arrival forces a fresh judgment.
// A parallel table would be a second answer to "when does this come back", and the first time the
// two disagreed the item would either vanish or nag.
//
// So the deck writes THE SAME RECORD the judge writes, in the same place, in the same shape — with
// `by: 'user'` on it, which is the only thing that differs and the only thing that needs to: the
// judge's park is an inference (it yields when the item's facts move), the person's is an
// instruction (it holds). The caller then runs the verdict through the ONE consequence module, so a
// hand-parked item gets the identical room line and the identical undoable ledger entry a judged
// park has always got.
//
// THE SIG IS THE ITEM'S OWN, WHERE THERE IS ONE. Re-stamping today's park under the judgment row's
// existing signature means a same-day re-read serves it as a cache hit rather than re-judging; a
// never-judged item gets a marker sig, which the `by: 'user'` clause above makes harmless.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The reason stored on a hand-parked verdict. Deterministic — the person gave a date, not prose. */
export const USER_PARK_REASON = 'you asked to see this later';

export type ParkResult =
  | { ok: true; verdict: WorkVerdict; after: string }
  | { ok: false; reason: string };

export async function parkItem(
  client: SupabaseClient, userId: string, input: JudgeInput, args: { after: string },
): Promise<ParkResult> {
  const after = String(args.after ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(after)) return { ok: false, reason: 'that is not a date I can hold it to' };
  // THE USER'S CLOCK decides what "later" means — their day boundary, never the server's.
  const todayStr = localNow(await userTimezone(client, userId)).dateStr;
  if (after <= todayStr) return { ok: false, reason: 'later has to be a day that has not happened yet' };
  // LATER ALWAYS RECORDS A DATE, and never further out than the park is meant to reach: a year is
  // a decision to never see something again, which is what ↓ is for.
  const horizon = new Date(`${todayStr}T00:00:00Z`);
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 1);
  if (after > horizon.toISOString().slice(0, 10)) return { ok: false, reason: 'that is further out than I can honestly hold it' };

  const data = await readPlan(client, userId, 'judgment', `${input.kind}:${input.id}`);
  const priorSig = String(((data?.tasks ?? null) as { sig?: string } | null)?.sig ?? '');
  const sig = priorSig.split(':')[0] === String(JUDGE_VERSION) ? priorSig : `${JUDGE_VERSION}:${todayStr}:user-park`;

  const verdict: WorkVerdict = {
    ...fallbackVerdict(USER_PARK_REASON),
    revisit: { after, by: 'user' },
  };
  await writeCache(client, userId, input, sig, verdict);
  return { ok: true, verdict, after };
}

export async function judgeWork(client: SupabaseClient, userId: string, input: JudgeInput): Promise<WorkVerdict> {
  try {
    // ── Load the item + its brain neighborhood. ──
    let title = '', body = '', who: string | null = null, whoEmail: string | null = null, threadNow = '';
    let u: ItemUnderstanding | null = null, activityAt = '', workState: string | null = null, rawKind: string | null = null, listMail = false;
    // THE REASONED KIND alone (the user's own override, else the understanding's kind) — the kind
    // floor never reads the header tier's inferred 'newsletter' (a list conversation stays the
    // notice law's, where the ownership key protects it).
    let reasonedKind: string | null = null;
    let dueDate: string | null = null; // the item's own stated date (commitment due / extracted deadline) — the event-boundary anchor
    let threadMsgs: ThreadMessage[] = [];
    // AN ITEM'S OWN DOCUMENT IS THE ITEM'S OWN CONTEXT (owner walk, Sep 10): the files that arrived
    // WITH the item are facts about the work. Names + a one-line gist only (the judge is token-tight),
    // but with the DIRECTION stated — a document the counterparty sent us can never be judged as
    // something we owe them back. Facts ride the day-keyed sig, so no JUDGE_VERSION bump is needed.
    let attachFacts = '';
    // THE SEAT LAW (threads-plan · THE OPENING CONTRACT clause 4): WHO WAS ADDRESSED is a fact, and
    // the judge has been framing third-party requests as the user's debt without it. Code states the
    // seat (stamped at sync since July 8); the judge applies the rule with the body in view — the
    // naming exception is a reading of the text, not an arithmetic.
    let seatBlock = '';
    // THE EVIDENCE MATCH'S INPUTS (W3.1): the moment evidence must postdate, the thread it may share,
    // and who must act — set per kind below; the counterparty ADDRESS is `whoEmail` for both kinds.
    let evAfterISO = '', evThreadId: string | null = null, evFulfiller: 'user' | 'counterparty' = 'user';
    // THE DIRECTION FLOOR's fact (W11.1): WHO OWES — the commitment's own direction (inbox items read
    // the understanding's ownership, `u` below). Applied to every verdict this function serves.
    let commitDirection: string | null = null;
    if (input.kind === 'inbox') {
      const { data: it } = await client.from('inbox_items')
        .select('id, work_title, work_state, status, last_activity_at, created_at, source_data')
        .eq('id', input.id).eq('user_id', userId).maybeSingle();
      if (!it || it.status !== 'pending') return fallbackVerdict('no longer open');
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      title = String(it.work_title || sd.subject || '');
      // EXCERPT-HONESTY LAW (Aug 4): a hard character cut quoted as the sender's words made the
      // judge read a normal email as "cut off mid-sentence" — clips end at boundaries and declare
      // themselves; the prompt carries the rule that a marker is OUR clipping, never source truth.
      body = clipForPrompt(String(sd.body || ''), 1200);
      who = (sd.from_name as string) || (sd.from_address as string) || null;
      whoEmail = (sd.from_address as string) || null;
      u = coerceUnderstanding(sd.understanding);
      dueDate = u?.deadline ?? null;
      rawKind = rawMailKindOf(sd);
      reasonedKind = String(sd.kind_override ?? '').toLowerCase() || u?.mailKind || null;
      listMail = listMailOf(sd);
      workState = (it.work_state as string) || null;
      try {
        const { readItemAttachments, attachmentFactBlock } = await import('@/lib/inbox/attachment-context');
        attachFacts = attachmentFactBlock(await readItemAttachments(client, userId, sd, String(it.id)), who);
      } catch { /* the attachment fact is an enhancement */ }
      if (isBystanderSeat({ isCcOnly: sd.is_cc_only as boolean | null | undefined })) {
        const toList = (Array.isArray(sd.to) ? (sd.to as string[]) : []).filter(Boolean).slice(0, 3).join(', ');
        seatBlock = `THE USER'S SEAT ON THIS EMAIL: CC ONLY — it is addressed To: ${toList || 'someone else'}, not to the user.\n`;
      }
      activityAt = String(it.last_activity_at || it.created_at || '');
      const tid = (sd.thread_id as string) || null;
      evAfterISO = activityAt; evThreadId = tid;
      if (tid) {
        const { data: msgs } = await client.from('emails').select('is_from_user, received_at, from_address, from_name, to_addresses, cc_addresses, body')
          .eq('user_id', userId).eq('thread_id', tid);
        threadMsgs = ((msgs ?? []) as Array<Record<string, unknown>>).map((m) => ({
          is_from_user: !!m.is_from_user, received_at: (m.received_at as string) ?? null,
          from: (m.from_address as string) ?? null,
          to: [...((m.to_addresses as string[]) ?? []), ...((m.cc_addresses as string[]) ?? [])],
        }));
        // THE WATERMARK LAW (Aug 2): the judge judges the thread's PRESENT, never the founding
        // snapshot — a thread that moved past its stored ask ("thank you, all fixed") was still
        // judged as the original investigation. The newest messages (own words only — quoted
        // tails stripped) ride the item text, so every code-check (stated dates/times) and the
        // verdict itself read the CURRENT position.
        const ordered = ((msgs ?? []) as Array<Record<string, unknown>>)
          .filter((m) => m.received_at)
          .sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
        const newest = ordered.slice(-2);
        if (newest.length && String(newest[newest.length - 1].received_at) > String(it.created_at)) {
          const { topMessageOf } = await import('@/lib/inbox/top-message');
          threadNow = newest.map((m) =>
            `[${String(m.received_at).slice(0, 16)}] ${m.is_from_user ? 'THE USER' : String(m.from_name || m.from_address || 'them')}: "${clipForPrompt(topMessageOf(String(m.body || '')).replace(/\s+/g, ' '), 400)}"`,
          ).join('\n');
        }
      }
    } else {
      const { data: c } = await client.from('commitments')
        .select('id, description, counterparty, direction, status, due_date, updated_at, created_at, source, source_id, thread_id')
        .eq('id', input.id).eq('user_id', userId).maybeSingle();
      if (!c || !['open', 'pending', 'in_progress'].includes(String(c.status))) return fallbackVerdict('no longer open');
      // THE STANDING FLOOR (Arc 2 binding): a source='workflow' commitment is the team's standing
      // promise — its WORKFLOW produces it. Structurally none: the pass must never delegate it,
      // no drafter touches it; overdue-ness is its whole surface (the missed-run debt).
      if (String(c.source) === 'workflow') {
        return {
          work: 'none', component: 'message_only', executor: { kind: 'system' }, gate: null,
          reason: 'a standing scheduled task — its workflow produces the deliverable; overdue means a run was missed',
        };
      }
      // THE HANDOFF FLOOR (processes arc Phase B, found live Aug 18: the judge prepared a
      // "Draft email" move on a teammate-approval ask): a source='handoff' commitment is a
      // DECISION GATE on a parked run — its verbs are Approve/Hold, rendered by the commitment's
      // own surface through the ONE resume door. Structurally none: no drafter, no delegation,
      // no prepared moves; deciding IS the work.
      if (String(c.source) === 'handoff') {
        return {
          work: 'none', component: 'message_only', executor: { kind: 'system' }, gate: null,
          reason: 'a teammate-approval gate on a running process — approve or hold it back is the whole move',
        };
      }
      title = String(c.description || '');
      who = (c.counterparty as string) || null;
      // THE COMMITMENT'S ADDRESS (W3.1): the counterparty resolves to an email through facts the house
      // holds ("Name <email>" → the person registry → the thread's inbound sender → the meeting's
      // attendees) — the nominator's ONE resolver. Before, `whoEmail` was never set on this branch:
      // the booked-calendar fact and the person lookup were structurally blind for every commitment.
      try {
        const { getPersonEntities } = await import('@/lib/entities/people');
        whoEmail = await resolveCommitmentAddress(client, userId, c as { id: string; counterparty?: string | null; thread_id?: string | null; source?: string | null; source_id?: string | null }, await getPersonEntities(client, userId));
      } catch { whoEmail = null; }
      evAfterISO = String(c.created_at || ''); evThreadId = (c.thread_id as string) || null;
      evFulfiller = String(c.direction) === 'awaiting' ? 'counterparty' : 'user';
      commitDirection = (c.direction as string | null) ?? null;
      activityAt = String(c.updated_at || c.created_at || '');
      dueDate = (c.due_date as string) || null;
      body = `direction: ${c.direction}${c.due_date ? ` · due ${c.due_date}` : ''}`;
    }

    // ── The pool (the judge must KNOW prepared work exists) + the sig. ──
    // W5c · THE JUDGE READS LIVE: an artifact THE ONE READER hides (a false completion claim, an
    // invite outside the stated window, a passed time, a superseded ground) is NOT prepared work —
    // found live (Sep 23): the judge read a hidden paste pack as "already prepared", verdicted
    // send_file and REQUIRED the pack from the user as an input. Hidden ones are stated WITHDRAWN,
    // so the verdict knows the team re-prepares them (never an ask to the user).
    const prepSt = await preparedState(client, userId, { kind: input.kind === 'inbox' ? 'inbox_item' : 'commitment', id: input.id });
    const pool: PreparedArtifact[] = prepSt.live;
    const withdrawn = prepSt.all.filter((a) => !isLiveArtifact(a));
    // THE USER'S CLOCK (T-class): the day boundary, "now", and every time law run in the USER'S
    // timezone (derived from their own calendar), never the server's. The day rides the sig: with
    // time-awareness a verdict is a function of TODAY — at most one re-judgment per item per day,
    // PLUS one when a same-day event boundary crosses: an item due today whose own stated time has
    // passed flips the sig, so "be there at 12:30" is re-judged the pass after 12:30, not at
    // midnight (day-blindness was how a finished meeting stayed on the plate all evening).
    const tzName = await userTimezone(client, userId);
    const nowL = localNow(tzName);
    const todayStr = nowL.dateStr;
    const itemText = `${title}\n${body}${threadNow ? `\n\nWHERE THE THREAD STANDS NOW (newest last — judge the PRESENT position, not the founding ask; a pure closure/thank-you with nothing further asked = resolution "answered"):\n${threadNow}` : ''}`;
    const eventPassed = !!dueDate && dueDate === todayStr && timesInText(itemText).some((t) => t < nowL.hhmm);
    // LAW 4 · ONE CONVERSATION, ONE OBLIGATION: when the same human exchange was settled on ANOTHER
    // thread, the settlement is handed to the judge as a FACT (never as a disposition — the judge
    // still decides, exactly as with the anchor fact). It rides the SIG, because a fact that arrives
    // after today's verdict was cached would otherwise be invisible until tomorrow.
    const siblingNom = await readSiblingNomination(client, userId, `${input.kind}:${input.id}`);
    // LAW 7 · THE OUTCOME LOOP: what the user actually DID with our preparations of this shape —
    // sent as written, edited, or resolved the item without using it — reaches the judge as a FACT,
    // narrowed to this item's own counterparty class. Deterministic, zero-AI, cached per user per
    // day; SILENT under the N-floor. It rides the sig (via a hash of exactly what is spoken), so a
    // history that shifted re-judges today instead of waiting for tomorrow — and when nothing is
    // speakable the sig is byte-identical to the pre-LAW-7 sig, which is why this is a FACTS
    // addition and needs no JUDGE_VERSION bump (the attachment/anchor/sibling-fact precedent).
    // Q7 · PROOF OF LIFE: when the sweep's lane has ASKED whether this long-silent item is still
    // live, its stamp rides the sig (so today's cached verdict cannot swallow the question) and its
    // fact rides the prompt. A fact, never a disposition — the judge decides, under its own time law.
    const proofAsk = await readProofOfLifeAsk(client, userId, `${input.kind}:${input.id}`);
    const outcomeFacts = await readOutcomeFacts(client, userId, todayStr).catch(() => null);
    const outcomeKlass: CounterpartyClass = input.kind !== 'inbox' ? 'unknown'
      : (isAutomatedSenderStrong(whoEmail, who, title) ? 'automated' : 'human');
    // THE ENTITY THE JUDGE READS rides the sig (W2.5, R4) — as the RENDERED deal block (W9.3), not the
    // entity's own sig: a re-synthesized state re-judges today only when something the prompt reads
    // (summary · next move · goals · rules · name) actually changed. See JUDGMENTS FOLLOW WHAT MATTERS.
    const { data: link } = await client.from('entity_links').select('entity_id')
      .eq('user_id', userId).eq('item_kind', input.kind === 'inbox' ? 'inbox_item' : 'commitment')
      .eq('item_id', input.id).not('entity_id', 'is', null).maybeSingle();
    const ent = link?.entity_id
      ? (await client.from('work_entities').select('name, state, next_move, goals, rules')
        .eq('id', link.entity_id).eq('user_id', userId).maybeSingle()).data
      : null;
    const dealBlock = dealBlockOf(ent);
    // W9.3 THE MATERIAL STAMP — computed before the sig/cache read, stored with the verdict.
    const matNow: MaterialStamp = {
      tn: threadMsgs.filter((m) => !m.is_from_user && m.received_at).map((m) => String(m.received_at)).sort().pop() ?? '',
      dp: (!!dueDate && dueDate < todayStr) || eventPassed,
      nm: String(((ent?.next_move ?? null) as { title?: string } | null)?.title ?? ''),
    };
    // LATER EVIDENCE (W3.1) — matched from the per-user batch pool; its identity rides the sig so a
    // NEW deed re-judges, the same set never re-spends.
    let evidence: Evidence[] = [];
    if (evAfterISO) {
      try {
        const full = await judgeEvidencePool(client, userId);
        const horizon = new Date(Date.now() + EVIDENCE_CAL_HORIZON_DAYS * 86_400_000).toISOString();
        evidence = matchEvidence({ ...full, events: full.events.filter((e) => e.at <= horizon) }, {
          kind: input.kind, id: input.id, afterISO: evAfterISO,
          counterpartyEmail: whoEmail ? normalizeEmail(whoEmail) : null, threadId: evThreadId,
          fulfiller: evFulfiller, description: title,
        }, new Date().toISOString(), SETTLE_MATCH);
      } catch { evidence = []; } // the evidence fact is an enhancement
    }
    // THE ONE SIG HELPER (W2.5): `<JUDGE_VERSION>:<day>:<deps>` — the version and day slots stay
    // positional (readCache's same-version prior, the parked serve's nonDaySig, parkItem), every
    // other input the verdict reads is a named dep.
    const sig = `${JUDGE_VERSION}:${todayStr}:${sigOf({ version: JUDGE_VERSION, deps: {
      activityAt, poolN: pool.length, poolAt: pool[0]?.at ?? '', past: eventPassed,
      sib: siblingNom ? `:sib${siblingNom.at}` : '', proof: proofOfLifeSigPart(proofAsk),
      outcome: outcomeSigPart(outcomeFacts), evidence: evidenceSig(evidence),
      entity: ent ? dealBlock : null,
    } })}`;
    const { hit: cached, prior, priorSig, priorEv, priorMat } = await readCache(client, userId, input, sig);
    const evSig = evidenceSig(evidence);
    // THE DIRECTION FLOOR at the serve (W11.1): a verdict cached before the floor existed (an inverted
    // chase on work the user owes) is coerced HERE and written back under the same sig, so every raw
    // reader of the judgment cache (the machine, the room board, the deck) reads the corrected verb
    // on the next read — zero AI, no re-judgment, no JUDGE_VERSION bump (the prompt is unchanged).
    const dirFacts = { kind: input.kind, direction: commitDirection, ownership: u?.ownership ?? null } as const;
    if (cached) {
      const floored = directionFloor(cached, dirFacts);
      if (floored !== cached) await writeCache(client, userId, input, sig, floored, priorEv, priorMat);
      return floored;
    }
    // W4 PARKED SERVE — a revisit verdict holds WITHOUT AI until its date: same item facts (only
    // the day moved) + the revisit date still ahead → re-serve the parked verdict under today's
    // sig. Parking an item costs one judgment, not one per day.
    //
    // Q9 · A USER'S WORD OUTRANKS THE JUDGE. When the PERSON set the date (the triage deck's ←
    // LATER), the park holds until that date REGARDLESS of the non-day sig — they said "not this
    // week", and a fresh pool artifact or a re-run pass is not a reason to put it back in front of
    // them. The judge's OWN park keeps its original contract (it is an inference from the item's
    // words, so it yields the moment those facts move). On/after the date BOTH fall through and are
    // judged fresh, exactly as they always were: the park expires, it never self-renews.
    if (prior?.revisit?.after && prior.revisit.after > todayStr
      && (prior.revisit.by === 'user' || (priorSig && nonDaySig(priorSig) === nonDaySig(sig)))) {
      const parked = directionFloor(prior, dirFacts); // a parked verdict is none — the floor is a no-op
      await writeCache(client, userId, input, sig, parked, priorEv, priorMat);
      return parked;
    }

    // ── STRUCTURAL FLOORS (no AI): answered → none · the ownership notice law → none. ──
    if (input.kind === 'inbox' && threadMsgs.length) {
      const st = computeThreadReplyState(threadMsgs, null);
      if (st.lastMessageFromUser) {
        const v = fallbackVerdict('you have the last word on this thread — nothing owed until they reply', 'answered');
        await writeCache(client, userId, input, sig, v, null, matNow);
        return v;
      }
    }
    // THE SELF-RECOGNITION FLOOR (Q1, attention-plan PART III) — BEFORE the notice law, because it
    // is the stronger statement: our own coworker's mail is not merely a notice nobody owes a move
    // on, it is a POINTER to work that already stands on its own surface. Judged `none` with no
    // disposition: the pointer is not "expired" and it is not "answered" — nothing about it is
    // settled, it simply was never a counterparty ask. (Audit, Sep 17: the reference deck's top
    // rows were our own reminder mail; ONE shortlist ask stood FOUR times.) Deterministic, zero AI,
    // registry-derived — the same predicate the demotion and the extractor consult.
    // (The cheap registry read decides first, so the roster narrowing — one query — is paid only on
    // the mail that is actually ours, never on every judgment.)
    if (input.kind === 'inbox' && isOwnCoworkerSender(whoEmail)
      && isOwnCoworkerSender(whoEmail, await ownCoworkerLocals(client, userId))) {
      const v = fallbackVerdict(SELF_ECHO_REASON);
      await writeCache(client, userId, input, sig, v, null, matNow);
      return v;
    }
    if (input.kind === 'inbox' && isNoMoveNotice({ u, rawKind, fromEmail: whoEmail, fromName: who, subject: title, workState, listMail })) {
      const v = fallbackVerdict('an automated notice nobody owes a move on');
      await writeCache(client, userId, input, sig, v, null, matNow);
      return v;
    }
    // THE KIND FLOOR (W8.3, JUDGE_VERSION 21) — the notice law's class, one kind wider: an
    // UNSOLICITED kind (cold outreach, a newsletter) owes nothing until the user has answered it, and
    // a NOTICE kind (notification, receipt) owes nothing without a you_owe key. Found live: a
    // cold-outreach pitch judged `schedule` and listed as real, alive work. Structural, before AI;
    // the one escape is the user's own message in the thread (a pitch they answered is a conversation).
    if (input.kind === 'inbox') {
      // W11.3 · + the platform facet (fromEmail): mail the platform itself sent is never the user's work.
      const kf = kindFloor({ kind: reasonedKind, ownership: u?.ownership ?? null, userEngaged: threadMsgs.some((m) => m.is_from_user), fromEmail: whoEmail });
      if (kf.refuses) {
        const v = fallbackVerdict(kindFloorReason(kf.why));
        await writeCache(client, userId, input, sig, v, null, matNow);
        return v;
      }
    }

    // ── The brain neighborhood: entity + person (assembled, not re-derived). ──
    // (the entity row was read above, before the sig — its rendered deal block rides it: dealBlockOf.)
    let personBlock = '';
    if (who) {
      try {
        const { getPersonEntities, findPersonEntity, parseWho } = await import('@/lib/entities/people');
        const pw = parseWho(who);
        const pe = findPersonEntity(await getPersonEntities(client, userId), whoEmail ?? pw.email, pw.name);
        if (pe?.state?.summary) personBlock = `THE COUNTERPARTY (${pe.name}): ${pe.state.summary}\n`;
      } catch { /* non-fatal */ }
    }
    // W3 — an OPEN ASK on this item is a fact the judgment must hold: the user owes inputs; the
    // work is waiting on them, not on re-judgment. Live asks only (archived = history).
    let askBlock = '';
    try {
      const { data: ask } = await client.from('room_turns').select('component, created_at, author')
        .eq('user_id', userId)
        .or(`dedupe_key.eq.requires:${input.id},dedupe_key.like.delegate:${input.id}:*`)
        .filter('component->>key', 'eq', 'input_checklist').is('archived_at', null)
        .limit(1).maybeSingle();
      const st = (ask?.component as { state?: { items?: string[]; proceeded?: boolean } } | null)?.state;
      if (ask && st?.items?.length) {
        askBlock = st.proceeded
          ? `AN ASK to the user stood on this item and they said GO AHEAD with what's available — the work proceeds around the gaps.\n`
          : `AN OPEN ASK to the user has stood since ${String(ask.created_at).slice(0, 10)}: ${st.items.slice(0, 4).join('; ')}. They have not supplied these yet — the item is waiting on THEM, which does not make it moot. THIS ASK IS OURS, TO THE USER, for material WE need to produce THEIR deliverable — it is NEVER something the counterparty owes: do not flip the judgment to "chase" because of it, and never treat the missing input as the other side's debt (chasing the counterparty for the thing WE owe THEM inverts the obligation).\n`;
      }
    } catch { /* the ask fact is an enhancement */ }
    // ── THE BOOKED-CALENDAR FACT (JUDGE v16, found live: a `schedule` verdict stood on a meeting
    // the counterparty had ALREADY ACCEPTED on the real calendar) — now one section of LATER EVIDENCE
    // (W3.1): the calendar lines keep their header and the ALREADY BOOKED rule's meaning (bookings
    // with THIS counterparty, forward reach 21 days), for BOTH kinds, beside the user's sent mail on
    // other threads and the recorded meetings. Facts only — the fulfillment judge settles. ──
    const evidenceBlock = laterEvidenceBlock(evidence, tzName);
    const roster = await loadRoster(client, userId);
    const poolBlock = pool.length
      ? `ALREADY PREPARED (prefill, don't redo): ${pool.slice(0, 3).map((d) => `${d.kind}${d.by ? ` by ${d.by}` : ''}${d.attachment ? ` (+${d.attachment.filename})` : ''}`).join(' · ')}\n`
      : '';
    const withdrawnBlock = withdrawn.length
      ? `WITHDRAWN — NOT PREPARED (failed a truth check; the team re-prepares these itself — never treat them as existing, never list them in "requires", never ask the user to supply them): ${withdrawn.slice(0, 3).map((d) => `${d.kind} (${withdrawnReasonOf(d) ?? 'not ready'})`).join(' · ')}\n`
      : '';

    // ── THE ONE REASONED CALL. ──
    const judgePrompt =
        `You are the user's chief of staff judging ONE piece of work: what does DOING it take?\n\n` +
        askBlock +
        // The WEEKDAY and the CLOCK are stated, never derived — "by Thursday" / "tomorrow" / "at
        // 12:30" reasoning from a bare ISO date made the model guess (real mootness misfires). All
        // in the USER'S zone: their day boundary, their hour.
        `RIGHT NOW for the user it is ${nowL.pretty} (${nowL.tz}); today's date is ${todayStr}. Times mentioned in items are in this zone unless they say otherwise. The item's last activity was ${activityAt.slice(0, 10) || 'unknown'}.\n\n` +
        // THE ANCHOR FACT (proactive-reach LAW 1): when the item's OWN stated date has passed, say
        // so in CODE — computed, never inferred from the model's date arithmetic. It is a FACT, not
        // a disposition: the judge still decides moot vs still-owed (its own July law — an overdue
        // invoice is still owed). Rides the day-keyed sig, so no JUDGE_VERSION bump is needed.
        anchorPassedFact(dueDate, todayStr) +
        siblingSettledFact(siblingNom) +
        // W3.1 — LATER EVIDENCE sits beside the other settlement fact: what the user's record shows
        // AFTER the item. Facts; the judge decides (and only the ALREADY BOOKED rule reads them).
        evidenceBlock +
        // Q7 — the silence, stated in code. Empty string when the lane has not asked.
        proofOfLifeFact(proofAsk) +
        // LAW 7 — the user's own verdicts on our preparations. A fact; the judge decides.
        outcomeHistoryFact(outcomeFacts, { klass: outcomeKlass }) +
        // THE SEAT LAW — stated before the deal/person colour, because it decides whether any of
        // this is the user's work at all.
        seatBlock +
        dealBlock + personBlock + poolBlock + withdrawnBlock + attachFacts +
        (u ? `UNDERSTANDING: relevance=${u.relevance} ownership=${u.ownership ?? '?'} kind=${u.mailKind ?? '?'}${u.ask ? ` ask="${u.ask}"` : ''}${u.deadline ? ` deadline=${u.deadline}` : ''}\n` : '') +
        `THE ITEM${who ? ` (from ${who})` : ''}: ${clipLabel(title, 140)}\n${body ? `${body}\n` : ''}` +
        `${threadNow ? `\nWHERE THE THREAD STANDS NOW (newest last — judge THIS position, not the founding ask): \n${threadNow}\n` : ''}` +
        // EXCERPT-HONESTY (Aug 4): our own length-clips must never read as source truncation.
        `${EXCERPT_RULE}\n\n` +
        `THE TEAM (for executor "coworker"):\n${roster.map((w) => `- ${w.name} — ${w.role.replace(/_/g, ' ')}: ${w.description}`).join('\n') || '(none)'}\n\n` +
        `COMPONENTS (pick exactly one — what the work surface should mount):\n${renderComponentOptions()}\n\n` +
        (prior ? `YOUR PRIOR JUDGMENT on this item: work=${prior.work}${prior.resolution ? ` resolution=${prior.resolution}` : ''}${prior.revisit ? ` revisit=${prior.revisit.after}` : ''} — "${clipForPrompt(prior.reason, 120)}". BE CONSISTENT with it unless something in the item MATERIALLY changed since; do not flip an ambiguous call on a re-read.${evidenceNewToPrior(evSig, priorEv) ? ' NEW SINCE THAT CALL: the LATER EVIDENCE above was NOT in front of you when you made it — it IS a material change; where it shows the thing done, held or booked, judge from the evidence and never repeat a prior reason it contradicts.' : ''}${materialChangeClause(materialChangesSince(priorMat, matNow))}${prior.revisit && prior.revisit.after <= todayStr ? ' YOU SET THIS ASIDE until that date and THE DATE HAS ARRIVED — judge it fresh NOW as live work (the wait is over; do not re-park it without a NEW stated basis).' : ''}\n\n` : '') +
        `Rules:\n` +
        `- work: reply|decide|produce|send_file|schedule|forward|chase|none. CONSERVATIVE: unsure → "none"/"message_only" — a wrong mount costs trust, none costs nothing.\n` +
        `- "forward" ONLY when the item explicitly asks the user to PASS this thread/document on to a NAMED third party ("please forward this to…", "can you share this with finance/legal/<person>") — the passing-on IS the work. A reply that merely mentions someone else is still "reply".\n` +
        `- "schedule" when the real move is putting a meeting/call on the calendar (a proposed time to confirm, an ask to set up a call). A negotiation about WHICH time is still "reply"; "schedule" is for when the invite itself is the deliverable.\n` +
        `- COHERENCE: your work must MATCH your reason. If your reason says something is still owed, live, or "requires a response", work CANNOT be "none" — name the work that does it (a proposed call/times → "schedule" or "reply"; a stated either-way choice → "decide" with its options; an open question → "reply"). "none" is only for items where your reason says nothing is owed by anyone.\n` +
        `- THE SEAT LAW: when the seat fact above says the user is CC ONLY, the request is addressed to SOMEONE ELSE and is THAT person's to do — it is not the user's debt. Do not judge it "reply"/"chase"/"send_file"/"produce", never frame it as something the user owes or is owed, and never list a "requires" for it: work="none" (the user is watching, not owing), UNLESS the body names the user directly and asks THEM for something (a second ask aimed at the CC'd reader), or the item's own words hand the user a distinct move. Being copied on someone else's ask is awareness.\n` +
        `- A commitment with direction "awaiting" means the COUNTERPARTY owes the user — the natural work is "chase" (nudge what you're owed) unless it's moot or the item clearly says otherwise.\n` +
        `- ALREADY BOOKED: when the item's work is scheduling/confirming a meeting and the calendar above ALREADY shows that meeting booked with this sender (same encounter — the time fits what the thread converged on), the scheduling work is DONE: work="none" with resolution="answered" (the calendar is the settled fact; a second invite would double-book). This rule applies ONLY when a calendar block appears above — never from the thread alone. A calendar entry does NOT settle a reply the sender still awaits — only the scheduling half. And a WAIT-UNTIL item ("reconnect after X", "circle back once Y lands", "not before <date>") is NEVER "answered" — nothing is settled, the moment is simply later: that is work="none" WITH "revisit" carrying the stated date.\n` +
        `- TIME: if the thing this asks about has ALREADY HAPPENED or its window has passed such that acting now is pointless (a meeting that took place, access for a past event, a "tomorrow" that has gone), work="none" with resolution="expired". Resolve RELATIVE deadlines ("by Thursday", "tomorrow", "end of week") FORWARD from the item's OWN date (its last-activity date above): "by Thursday" in a message from Monday July 27 means Thursday July 30 — a FUTURE date, still live. resolution="expired" requires CERTAINTY that the window truly passed: it needs a SPECIFIC time/date STATED IN THE ITEM whose passing you can point to — name it as "expired_on" (the stated date, resolved to an absolute YYYY-MM-DD, in the past) and, when the window passed EARLIER TODAY (a meeting/call/slot whose stated clock time is already behind the user's RIGHT NOW above), ALSO name "expired_time" (that stated time as HH:MM 24h — e.g. a 12:30 meeting when it is now 20:34: expired_on=today, expired_time="12:30"). An UNDATED request can NEVER be expired (there is no window to have passed; an open ask with no deadline is simply live work) — no expired_on, no expiry. A deadline that is TODAY or LATER is never expired, and when you are not sure of the dates, judge the work normally (wrongly resolving live work costs trust; judging it costs nothing). resolution="answered" is ONLY for items that ARE closures: the message itself announces settlement (a confirmation, "all set", a done-deal notice) and asks nothing of anyone anymore. If the item still ASKS the user for anything not yet given — a reply, a time, a decision, a document — it is NOT answered, it IS the live work ("not yet confirmed/settled" describes work to do, never a reason to file it). And "answered" never means the user merely HAS what's needed to act: an unfulfilled request ("please forward this", "please send X") still owes the doing. NOT every passed date is expired — an unpaid invoice or an unanswered substantive ask still needs the work; when acting late still has value, judge the work normally.\n` +
        `- REVISIT ("not yet"): when the item's OWN WORDS say the right move comes LATER — a stated get-back date ("I'll send the numbers next week"), "let's reconnect after the board meeting on X", "check back in once the pilot ends" — then work="none" with revisit={"after":"YYYY-MM-DD"} (the date resolved FORWARD from the item's own date; if only a rough window is stated, pick its earliest day). The item leaves the desk and RETURNS on that date. Only with a concrete stated basis; NEVER park work that can and should be done now (an ask due today or undated is live work, not a revisit).\n` +
        `- decide ONLY when the real move is a choice between 2-3 CONCRETE routes stated in the item (accept/decline/redirect) — then give options (short labels, ≤4; do NOT include a decline, the surface adds it).\n` +
        `- executor: "coworker" (name one from THE TEAM — only when producing something is genuinely their craft) · "user" (replying, deciding, personal/admin) · "system" (an atomic mechanical act: send an existing file, book the stated invite).\n` +
        `- requires: for reply/send_file/produce ONLY — the concrete ATTACHABLE artifacts this work must INCLUDE, each as a short noun phrase in the item's OWN words (an email asking for "the organizational report, the individual report and the allocation sheet" requires those 3). An artifact is a THING that can be attached: a document, file, sheet, deck, link. NEVER a confirmation, approval, decision, answer, availability, or time — those are the user's sign-off or the reply's own words, not attachments (a "confirm the Thursday time" ask requires [], the reply itself carries the answer). ONLY what the item explicitly asks for or the work objectively cannot go out without; a plain conversational reply requires []. Never invent.\n` +
        `- Respect the deal's rules; never invent people, files, or dates.\n\n` +
        `JSON only: {"work":"…","component":"…","executor":{"kind":"coworker|user|system","name":"<team name if coworker>"},"options":[{"label":"…"}],"requires":[{"label":"…"}],"resolution":"expired|answered|null","expired_on":"YYYY-MM-DD (expired only — the stated date that passed)","expired_time":"HH:MM (only when it passed earlier TODAY — the stated clock time)","revisit":{"after":"YYYY-MM-DD","reason":"<why later>"}|null,"reason":"<one sentence>"}`;
    const judgeOnce = async (extra = '') => {
      const res = await aiCall<Record<string, unknown>>({
        userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 350, source: 'task_preparation',
        prompt: judgePrompt + extra,
      });
      return await coerceVerdict(res.json, roster, { todayStr, nowHHMM: nowL.hhmm, itemText },
        (text, iso) => dateStatedInTextVerified(client, userId, text, iso));
    };
    // The structural floors — applied to EVERY verdict (first pass and coherence retry alike).
    const applyFloors = (v: NonNullable<Awaited<ReturnType<typeof coerceVerdict>>>) => {
      // STRUCTURAL TIME FLOOR — the brain's own extracted deadline outranks the model's date
      // arithmetic: a deadline that is TODAY or LATER can never be "expired" (the for-Friday
      // misfire). Facts are structural; the disposition drops, nothing resolves, the item stays live.
      if (v.resolution === 'expired' && u?.deadline && u.deadline >= todayStr) delete v.resolution;
      // STRUCTURAL SENDER FLOOR — an automated sender's mailbox has NO READER: work can never be
      // "reply" or "chase" (the failed-payments class). The item's ACTION visibility is untouched.
      if (input.kind === 'inbox' && (v.work === 'reply' || v.work === 'chase')
        && isAutomatedSenderStrong(whoEmail, who, title)) {
        v.work = 'none'; v.component = 'message_only'; v.gate = null;
        delete v.requires; delete v.options;
        v.reason = `automated sender — a reply reaches no one; the action happens outside the mailbox. (${clipLabel(v.reason, 110)})`;
      }
      // THE DIRECTION FLOOR (W11.1) — a chase is only valid on AWAITING work; on work the user owes it
      // is coerced (commitment → none · inbox → reply). After the sender floor: an automated sender
      // has already become none, and none is never touched.
      return directionFloor(v, dirFacts);
    };
    // THE COHERENCE FLOOR (Aug 4 — the P18 class, promoted from "logged" to law): a plain none
    // whose OWN REASON claims the window passed — with no code-verified expired_on surviving the
    // floors — is an INCOHERENT verdict, not a judgment ("due tomorrow, but it is now past" stood
    // as none and vanished live work). Deterministic check on the model's own words; one
    // corrective retry; still incoherent → FAILED (never cached, never demotes — failure honesty).
    const incoherentNone = (v: NonNullable<Awaited<ReturnType<typeof coerceVerdict>>>) =>
      v.work === 'none' && !v.resolution && !v.revisit &&
      !v.reason.startsWith('automated sender') &&
      /(?:\bis\b|\bnow\b|\balready\b|\bhas\b)[^.]{0,20}\b(?:past|passed|expired)\b|\bwindow (?:has )?(?:passed|closed)\b|\bno longer (?:relevant|actionable|needed|possible)\b|\btoo late\b/i.test(v.reason);

    let verdict = await judgeOnce();
    // FAILURE HONESTY (W2): an unusable/absent model reply is a FAILED judgment, not a judged none.
    // It is never cached (caching it made an AI hiccup a confident day-long "nothing to do" — and the
    // deck's judgedNoneIds then demoted live work on an outage). The next open simply retries.
    if (!verdict) return { ...fallbackVerdict('could not judge this yet — it will retry'), failed: true };
    verdict = applyFloors(verdict);
    if (incoherentNone(verdict)) {
      const retry = await judgeOnce(
        `\n\nYOUR PREVIOUS VERDICT WAS INCOHERENT: its reason claimed the window/deadline had passed, ` +
        `but no date stated in the item verifies that (deadlines resolve FORWARD from the item's own ` +
        `date — "by tomorrow"/"by ${todayStr}" or later is FUTURE, never past). Re-judge: if the work ` +
        `is live, name it (reply/send_file/produce with its requires); "none" is lawful only with a ` +
        `verifiable expired_on or a reason that says nothing is owed by anyone.`);
      const rv = retry ? applyFloors(retry) : null;
      if (!rv || incoherentNone(rv)) {
        return { ...fallbackVerdict('incoherent verdict (claimed a passed window with no verifiable date) — it will retry'), failed: true };
      }
      verdict = rv;
    }
    await writeCache(client, userId, input, sig, verdict, evSig, matNow);
    return verdict;
  } catch { return { ...fallbackVerdict('could not judge this yet — it will retry'), failed: true }; }
}
