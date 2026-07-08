// Layer 3 — the SYNTHESIS pass of the "assemble → reconcile → synthesize" Home brief.
//
// Replaces the four blind, siloed AI passes (tldr / must-respond / follow-ups / fyi) with ONE
// grounded pass that reasons over the FULL reconciled per-person context (from Layer 1) plus the
// structured candidate items the route already computed. Because the model sees every dimension for
// each person at once — meetings held/upcoming, commitments, and the emails awaiting reply, all with
// timestamps and today's date — it is cross-aware BY CONSTRUCTION:
//   • it drops a "confirm our meeting" email that a real meeting already superseded (no scheduling
//     ghosts) — this SUBSUMES the old SCHEDULING regex + meeting-supersession bandaid,
//   • it never emits two fragments about the same person (entity grouping),
//   • it drops asks whose relative time has passed (stale expiry).
//
// It is GROUNDED: it may only reference the facts it is given (each candidate carries an index it
// must echo, so we can map its output back to real ids — it cannot invent an item), and GENERAL: it
// reasons about phrasing/relevance rather than matching hardcoded patterns, so it works for any user.
//
// See docs/brief-and-labeling-plan.md — "DIRECTION (corrected July 2)".

import { aiCreate } from '@/lib/ai/factory';
import { logAIUsage } from '@/lib/ai/log-usage';
import { parseModelJSON } from '@/lib/ai/parse-json';
import type { BriefContext } from './brief-context';

// ── The structured candidates the route feeds in (already deterministically computed) ──
export interface MustRespondCandidate {
  itemId: string;
  from: string;        // display name or address
  fromEmail: string;   // the counterparty email (identity — used to reconcile against meetings)
  subject: string;
  snippet: string;
  receivedAt: string;  // ISO
}
export interface WaitingCandidate {
  id?: string;
  counterparty: string | null;
  description: string;
  ageDays: number;
}
export interface FyiGroupCandidate {
  label: string;
  count: number;
  kind: 'person' | 'newsletter';
  subjects: string[];
}
// A "keep an eye on" candidate: something happening AROUND the user that carries real substance
// (a real person / thread / decision — even if the user is only cc'd), as opposed to bulk noise.
// The synthesis judges which of these are worth surfacing (tier = keep_an_eye_on) vs digest (fyi).
export interface AwarenessCandidate {
  itemId: string;
  from: string;        // display name or address
  fromEmail: string;   // counterparty email (identity — reconciles against meetings/threads)
  subject: string;
  snippet: string;
  receivedAt: string;  // ISO
  ccOnly: boolean;     // was the user only cc'd? (context for the judgment, NOT a rule)
}
export interface CommitmentFact {
  description: string;
  overdue: boolean;
  dueToday: boolean;
  dueDate: string | null;
}
// An OPEN commitment fed to the synthesis for it to JUDGE placement (framing), rather than the route
// trusting the raw ingest `direction`. The synthesis decides — grounded, echoing the id — whether the
// user genuinely owes an action, is waiting on someone, or it's just awareness.
export interface CommitmentCandidate {
  id: string;
  description: string;
  counterparty: string | null;
  direction: string;      // the ingest guess (you_owe | awaiting) — a HINT, not the verdict
  dueDate: string | null;
  overdue: boolean;
  dueToday: boolean;
  ageDays: number;
}
export type CommitmentPlacement = 'on_your_plate' | 'ball_in_court' | 'informational';
export interface ScheduleFact {
  time: string;   // ISO
  title: string;
}

export interface SynthesisInput {
  firstName: string | null;
  now: Date;
  ctx: BriefContext;
  schedule: ScheduleFact[];
  commitments: CommitmentFact[];
  /** open commitments for the synthesis to JUDGE into on_your_plate / ball_in_court / informational
      — the route routes by this verdict instead of the raw ingest direction (Bug #1 fix). */
  commitmentCandidates: CommitmentCandidate[];
  waitingOnCount: number;
  triaged: number;
  filtered: number;
  emailReplyCount: number;
  topPriorities: Array<{ title: string; posture: string; source: string; overdue: boolean }>;
  mustRespond: MustRespondCandidate[];
  waiting: WaitingCandidate[];
  fyiGroups: FyiGroupCandidate[];
  /** awareness/cc'd threads the synthesis may PROMOTE to the "keep an eye on" tier if they carry
      real substance — general judgment, not a rule. Kept small by the synthesis (2–4). */
  keepAnEyeOn: AwarenessCandidate[];
  /** itemIds whose newest thread message is INBOUND (a genuinely unanswered human reply the user
      still owes). These are PROTECTED: the synthesis may NOT drop them — a real reply must never
      appear then vanish after enrichment. Only items where the user has the last word are droppable
      for closure. Missing from the set → not protected (droppable as before). */
  protectedItemIds?: Set<string>;
}

// ── Output shapes — identical to what the client already renders ──
export type Tldr = { teaser: string; bullets: string[]; dontMiss: string | null };
export type FollowUp = { id?: string; who: string; status: string; nextMove: string };
export type Followups = { teaser: string; items: FollowUp[]; closing: string | null };
export type FyiDigest = { groups: { label: string; summary: string; kind: 'person' | 'newsletter' }[]; tailGroups: number; tailItems: number };
export type Reply = { who: string; ask: string; angle: string; itemId: string; subject?: string; snippet?: string; receivedAt?: string };
export type MustRespond = { teaser: string; items: Reply[] };
// "Keep an eye on" — glanceable awareness, NO action. Each item traces back to a real inbox item.
export type KeepAnEye = { who: string; why: string; itemId: string };
export type KeepAnEyeOn = { items: KeepAnEye[] };

export interface SynthesisResult {
  tldr: Tldr | null;
  mustRespond: MustRespond | null;
  followups: Followups | null;
  fyiDigest: FyiDigest | null;
  /** the middle awareness tier — real things around the user worth SEEING (no action). Selective. */
  keepAnEyeOn: KeepAnEyeOn | null;
  /** itemIds the synthesis judged superseded/stale — the route drops them from priorities too, so
      the prose and the cards can't contradict each other. */
  droppedItemIds: string[];
  /** commitmentId → placement verdict. The route routes each open commitment by THIS (not the raw
      ingest direction): on_your_plate (user owes, acts), ball_in_court (waiting/nudge), or
      informational (awareness only). Missing id → route falls back to the ingest direction. */
  commitmentPlacements: Record<string, CommitmentPlacement>;
}

const iso = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString());
const daysBetween = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);

// Render the per-person reconciled context as compact, grounded prose the model reasons over. Only
// people that appear in a candidate (must-respond / waiting) OR have both a meeting and an email are
// worth spelling out — that's where cross-source reconciliation happens.
function renderPeople(input: SynthesisInput): string {
  const { ctx, now } = input;
  const nowIso = iso(now);
  const relevantEmails = new Set(input.mustRespond.map((m) => m.fromEmail).filter(Boolean));
  const lines: string[] = [];
  for (const p of ctx.people.values()) {
    const hasCandidate = relevantEmails.has(p.key);
    const hasMeetingAndMail = p.meetings.length > 0 && p.emails.length > 0;
    const hasCommitmentAndMore = p.commitments.length > 0 && (p.meetings.length > 0 || p.emails.length > 0);
    if (!hasCandidate && !hasMeetingAndMail && !hasCommitmentAndMore) continue;
    const who = p.name || p.key;
    const parts: string[] = [];
    const held = p.meetings.filter((m) => m.start <= nowIso).sort((a, b) => b.start.localeCompare(a.start));
    const upcoming = p.meetings.filter((m) => m.start > nowIso).sort((a, b) => a.start.localeCompare(b.start));
    if (held.length) parts.push(`met ${daysBetween(nowIso, held[0].start)}d ago${held[0].title ? ` ("${held[0].title}")` : ''}`);
    if (upcoming.length) parts.push(`upcoming meeting in ${Math.max(0, daysBetween(upcoming[0].start, nowIso))}d${upcoming[0].title ? ` ("${upcoming[0].title}")` : ''}`);
    for (const e of p.emails.slice(0, 4)) {
      const age = daysBetween(nowIso, e.at);
      // Structural reply-state (direction+time, no text match): if the user already replied on this
      // thread it is HANDLED — surface that flag so the synthesis can drop/deprioritize by REASONING.
      const replied = e.userResponded ? ' — YOU ALREADY REPLIED on this thread (handled)' : '';
      parts.push(`email ${age}d ago "${e.subject}" [${e.posture}]${replied}`);
    }
    for (const c of p.commitments.slice(0, 4)) {
      parts.push(`${c.direction === 'you_owe' ? 'you owe' : 'they owe'}: "${c.description}"${c.dueDate ? ` (due ${c.dueDate})` : ''}`);
    }
    if (parts.length) lines.push(`- ${who}: ${parts.join('; ')}`);
  }
  return lines.length ? lines.join('\n') : '(no cross-source people to reconcile)';
}

// One grounded synthesis call. Falls back to nulls on any failure — the route keeps the cached brief.
export async function synthesizeBrief(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aiClientAndModel: { client: any; model: string },
  input: SynthesisInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logCtx?: { userId: string; supabase: any },
): Promise<SynthesisResult> {
  const { client, model } = aiClientAndModel;
  const { firstName, now } = input;
  const me = firstName || 'the user';

  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const scheduleStr = input.schedule.length
    ? input.schedule.map((s) => `${new Date(s.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ${s.title}`).join('; ')
    : 'none';
  const commitStr = input.commitments.length
    ? input.commitments.map((c) => `"${c.description}"${c.overdue ? ' [OVERDUE]' : c.dueToday ? ' [due today]' : c.dueDate ? ` [due ${c.dueDate}]` : ''}`).join('; ')
    : 'none';
  const topStr = input.topPriorities.length
    ? input.topPriorities.map((p) => `"${p.title}"${p.overdue ? ' [overdue]' : ''} (${p.posture}, from ${p.source})`).join('; ')
    : 'none';

  const peopleStr = renderPeople(input);

  const mustRespondStr = input.mustRespond.length
    ? input.mustRespond.map((m, i) => `[R${i}] from ${m.from} (${m.fromEmail || 'no address'}), ${daysBetween(iso(now), m.receivedAt)}d ago — "${m.subject}": ${m.snippet}`).join('\n')
    : 'none';
  const waitingStr = input.waiting.length
    ? input.waiting.map((w, i) => `[W${i}] ${w.counterparty || 'an unnamed party'} — "${w.description}" — ${w.ageDays}d quiet`).join('\n')
    : 'none';
  const fyiStr = input.fyiGroups.length
    ? input.fyiGroups.map((g, i) => `[F${i}] ${g.label} (${g.count}, ${g.kind}): ${g.subjects.slice(0, 5).filter(Boolean).map((s) => `"${s}"`).join('; ')}`).join('\n')
    : 'none';
  const eyeStr = input.keepAnEyeOn.length
    ? input.keepAnEyeOn.map((k, i) => `[K${i}] from ${k.from} (${k.fromEmail || 'no address'})${k.ccOnly ? ' [you were cc’d]' : ''}, ${daysBetween(iso(now), k.receivedAt)}d ago — "${k.subject}": ${k.snippet}`).join('\n')
    : 'none';
  const commitCandStr = input.commitmentCandidates.length
    ? input.commitmentCandidates.map((c, i) => `[C${i}] "${c.description}"${c.counterparty ? ` — with ${c.counterparty}` : ''}${c.dueDate ? ` (due ${c.dueDate}${c.overdue ? ', OVERDUE' : c.dueToday ? ', today' : ''})` : ''} — ${c.ageDays}d old — system guessed: ${c.direction === 'awaiting' ? 'you are waiting on them' : 'you owe it'}`).join('\n')
    : 'none';

  const prompt = `You are ${me}'s personal assistant. Write today's brief in a warm, first-person PA voice — as if you personally keep ${me}'s day in order (met X, owe Y, waiting on Z). Use ${me}'s first name naturally.

You are given the COMPLETE grounded picture, reconciled per person. Reason over it holistically before writing:
- ALREADY RESPONDED (structural, trustworthy): if the per-person context marks a thread "YOU ALREADY REPLIED on this thread (handled)", ${me} has structurally sent a message on that thread AFTER it landed — the ball is no longer in ${me}'s court. Treat it as HANDLED: DROP that reply (list its [Rn] index in "droppedReplies") unless a NEWER inbound message on the thread reopened it (a fresh question after ${me}'s reply). This flag comes from real message direction + timestamps, not phrasing — trust it.
- SUPERSESSION: if an email awaiting a reply is a scheduling/confirmation/logistics message from someone ${me} ALREADY has a meeting with (held or upcoming), the meeting settles it — DROP that reply by listing its [Rn] index in "droppedReplies". Same for any ask a later interaction already resolved. EVERY reply you do NOT put in droppedReplies is KEPT and shown — this is opt-OUT: the default is to keep. droppedReplies must be RARE (usually empty, at most one or two). Drop ONLY a reply that is GENUINELY settled by a concrete later fact you can see (a meeting held after it, a reply already sent, or the "already replied" flag above). NEVER drop a real, still-open reply just because you didn't write about it, ran low on space, or it felt minor — when unsure, KEEP it.
- STALENESS: drop an ask whose moment has passed (e.g. "by 6pm yesterday").
- GROUPING: never write two separate fragments about the same person — fold everything about them into one coherent thought.
- GROUNDING: use ONLY the facts below. Never invent names, numbers, asks, or details. Echo the [Rn]/[Wn]/[Fn]/[Kn] tag of every item you keep so it maps back.

TIERS — every surfaced item falls into one of three, by how much ACTION it demands of ${me}:
- "mustRespond" (ACT): a real person is waiting on ${me}'s reply, or ${me} owes something. ${me}'s move.
- "keepAnEyeOn" (AWARE — NO action): a real thing happening AROUND ${me} that ${me} should SEE but does nothing about — a genuine person/relationship/thread with substance (an urgent meeting request ${me} was cc'd on, a project thread ${me} is on, a decision in ${me}'s orbit). Being cc'd rather than to'd does NOT make something noise — a serious message from a real person or a known relationship still belongs here even if ${me} is only cc'd.
- "fyiDigest" (SKIM/IGNORE): mailing-list / notification / newsletter / receipt noise. No person really needs ${me}'s attention.
JUDGE which awareness candidates [Kn] rise to keepAnEyeOn vs stay noise — use your judgment about substance and the sender being a real person/relationship, NOT any fixed sender/domain. If a candidate is a substantive message from a real person (a meeting request, a real project/relationship thread, a decision ${me} is in the loop on) — especially one ${me} was deliberately cc'd on — it SHOULD be surfaced here, even though ${me} takes no action on it. Only drop candidates that are actually bulk/transactional/marketing/receipt noise. Be SELECTIVE about VOLUME: keep AT MOST 2–4 (pick the most substantive; don't pad with marginal ones) — but do surface the genuinely important ones rather than returning an empty tier when real awareness items exist.
GROUNDING (STRICT): each "why it matters" MUST be derived from the candidate's OWN subject and snippet as shown in the [Kn] line below — describe what THAT specific message actually is. NEVER invent a reason, a topic, a meeting, or a number that isn't in that candidate's text. If you cannot state a real, grounded reason from its own subject/snippet, DROP the candidate (leave it out) rather than fabricate one. A one-line grounded "why it matters" each.

COMMITMENT PLACEMENT — for EACH open commitment [Cn], judge where it belongs by WHO must act, from the description + the per-person context (the "system guessed" flag is only a HINT — it is often WRONG, so re-decide from the meaning):
- "on_your_plate" — ${me} genuinely OWES an action here (a promise ${me} made, a task assigned to ${me}). ${me} must do it.
- "ball_in_court" — ${me} is WAITING on someone else to do it (${me} requested it, delegated it, handed it off, or is owed it). The next move is a NUDGE, not doing the work. THIS IS COMMON and easy to miss — read the description for who actually performs the action: if the WORK is someone else's (a refund ${me} requested and a vendor must process; a task ${me} delegated to a colleague; a document ${me} is owed), it is ball_in_court, NOT on_your_plate — even when the "system guessed" you owe it. ${me} does NOT owe work that is physically someone else's to do.
- "informational" — just awareness; nobody is really blocked on ${me} and no nudge is warranted (already resolved, trivial, or purely FYI).
Return a verdict for every [Cn]. Echo the index. Do NOT invent commitments.

Today is ${dateStr}.
Meetings today: ${scheduleStr}
Emails needing ${me}'s reply: ${input.emailReplyCount}
Triaged in last 24h: ${input.triaged}${input.filtered ? ` (${input.filtered} noise/marketing)` : ''}
Commitments ${me} owes: ${commitStr}
Waiting on others: ${input.waitingOnCount}
Top items needing ${me}: ${topStr}

PER-PERSON CONTEXT (reconciled across meetings, emails, commitments):
${peopleStr}

EMAILS AWAITING ${me}'s REPLY (candidates — keep only the genuine ones after supersession/staleness):
${mustRespondStr}

OPEN COMMITMENTS to place (judge on_your_plate / ball_in_court / informational for each [Cn]):
${commitCandStr}

THREADS ${me} IS WAITING ON (ball in ${me}'s court to nudge):
${waitingStr}

AWARENESS CANDIDATES (things around ${me}, often cc'd — judge which few rise to "keepAnEyeOn" vs are noise):
${eyeStr}

FYI EMAILS (low-priority awareness, grouped by sender — one digest line each):
${fyiStr}

Return ONLY JSON in this exact shape:
{
  "tldr": {
    "teaser": "one short sentence summarising the day",
    "bullets": ["3-4 short scannable bullets — meetings, todos/commitments, replies; lead with what matters most"],
    "dontMiss": "the single most time-sensitive thing today, grounded in a real item, or null"
  },
  "mustRespond": {
    "teaser": "one short line",
    "items": [{"r": <the [Rn] index kept>, "who": "sender or topic", "ask": "what they're asking (one line)", "angle": "recommended reply gist (one line)"}]
  },
  "droppedReplies": [<the [Rn] indexes you DROPPED as superseded/stale, with none invented>],
  "commitmentPlacements": [{"c": <the [Cn] index>, "placement": "on_your_plate|ball_in_court|informational"}],
  "keepAnEyeOn": {
    "items": [{"k": <the [Kn] index>, "who": "person or topic", "why": "one line — why it's worth seeing (no action needed)"}]
  },
  "followups": {
    "teaser": "one short line introducing the roundup",
    "items": [{"w": <the [Wn] index>, "who": "person or topic", "status": "short status (how long quiet, what's pending)", "nextMove": "recommended next move (brief, specific)"}],
    "closing": "a short offer to draft these — name the 1-2 you'd tackle first — or null"
  },
  "fyiDigest": {
    "groups": [{"f": <the [Fn] index>, "summary": "one-line digest of what these are about"}]
  }
}

If a section has no items, return it with an empty items/groups array (or null for tldr fields). Keep every "mustRespond" item you did not drop; every "followups" item; AT MOST 2–4 "keepAnEyeOn" items (fewer is better); and one digest line per FYI group.`;

  try {
    const res = await aiCreate(client, {
      model, max_tokens: 5000, temperature: 0.4,
      messages: [{ role: 'user', content: prompt }],
    });
    if (logCtx) {
      logAIUsage(logCtx.supabase, {
        userId: logCtx.userId, source: 'brief_synthesis', provider: 'openai', model, tier: 'standard', taskType: 'summarization', usage: res.usage,
      }).catch(() => {});
    }
    const parsed = parseModelJSON<{
      tldr?: { teaser?: string; bullets?: string[]; dontMiss?: string | null };
      mustRespond?: { teaser?: string; items?: { r?: number; who?: string; ask?: string; angle?: string }[] };
      droppedReplies?: number[];
      commitmentPlacements?: { c?: number; placement?: string }[];
      keepAnEyeOn?: { items?: { k?: number; who?: string; why?: string }[] };
      followups?: { teaser?: string; items?: { w?: number; who?: string; status?: string; nextMove?: string }[]; closing?: string | null };
      fyiDigest?: { groups?: { f?: number; summary?: string }[] };
    }>(res.choices?.[0]?.message?.content || '', {});

    // TLDR
    const tldr: Tldr | null = (Array.isArray(parsed.tldr?.bullets) && parsed.tldr!.bullets!.length) || parsed.tldr?.teaser
      ? {
          teaser: parsed.tldr?.teaser || '',
          bullets: Array.isArray(parsed.tldr?.bullets) ? parsed.tldr!.bullets!.slice(0, 4) : [],
          dontMiss: parsed.tldr?.dontMiss || null,
        }
      : null;

    // Must-respond — KEEP every candidate reply EXCEPT the ones the model explicitly dropped
    // (droppedReplies, for supersession/staleness). Opt-OUT, not opt-in: a model that forgets to echo
    // an [Rn], truncates, or returns a malformed items array can NEVER silently nuke a real reply the
    // user owes. Enrich with the model's who/ask/angle wherever it mapped one back.
    const droppedR = new Set<number>(
      Array.isArray(parsed.droppedReplies) ? parsed.droppedReplies.filter((n): n is number => typeof n === 'number') : [],
    );
    // PROTECT genuinely unanswered human replies (newest thread message INBOUND). The model may drop
    // an item ONLY when the deterministic reply-state says the user has the last word — so a real,
    // still-open reply can never be dropped for "closure" and appear-then-vanish after enrichment.
    // This makes the enriched must-respond set ⊇ the protected members. (Guard here, at the single
    // place droppedR feeds BOTH mustItems and droppedItemIds, so the two outputs stay consistent.)
    const protectedIds = input.protectedItemIds;
    if (protectedIds && protectedIds.size) {
      input.mustRespond.forEach((cand, i) => {
        if (droppedR.has(i) && protectedIds.has(cand.itemId)) droppedR.delete(i);
      });
    }
    const modelItems = Array.isArray(parsed.mustRespond?.items) ? parsed.mustRespond!.items! : [];
    const enrichR = new Map<number, { who?: string; ask?: string; angle?: string }>();
    modelItems.forEach((x) => { if (typeof x.r === 'number') enrichR.set(x.r, x); });
    const mustItems: Reply[] = input.mustRespond
      .map((cand, i) => ({ cand, i }))
      .filter(({ i }) => !droppedR.has(i))
      .map(({ cand, i }, j) => {
        // Enrich (who/ask/angle CONTEXT) by the [Rn] index when the model echoed it; else fall back to
        // POSITION — the model returns the kept items in order but often omits the numeric index, and
        // without this fallback the ask/angle context is silently lost (bare names only).
        const x = enrichR.get(i) ?? modelItems[j];
        // Carry the REAL email through to the client (avatar/subject/snippet/date live richness) —
        // these come straight from the deterministic candidate, not the model, so they can't drift.
        return {
          // who = the candidate's real sender (identity is deterministic, never the model's free text) so
          // the row's name always matches its subject + itemId; the model only supplies ask/angle judgment.
          who: cand.from, ask: x?.ask || '', angle: x?.angle || '', itemId: cand.itemId,
          subject: cand.subject, snippet: cand.snippet, receivedAt: cand.receivedAt,
        };
      })
      // High safety bound only — NOT a functional gate. Real replies must never be hidden by a cap;
      // the pool is already cleaned (automated senders excluded upstream), so this is pure headroom.
      .slice(0, 100);
    const mustRespond: MustRespond | null = mustItems.length
      ? { teaser: parsed.mustRespond?.teaser || '', items: mustItems }
      : null;
    const droppedItemIds: string[] = input.mustRespond.filter((_, i) => droppedR.has(i)).map((m) => m.itemId);
    // Cross-tier dedup (Bug #2): an item may live in EXACTLY ONE tier. Must-respond WINS — anything
    // the user must reply to is action, not just awareness, so it must never also appear in
    // "keep an eye on". Collect the surfaced must-respond itemIds; keep-an-eye-on filters them out.
    const mustItemIds = new Set(mustItems.map((m) => m.itemId).filter(Boolean));

    // Commitment placements — map [Cn] verdicts back to real commitment ids. Only accept the three
    // valid placements; anything else is ignored and the route falls back to the ingest direction.
    const commitmentPlacements: Record<string, CommitmentPlacement> = {};
    for (const x of Array.isArray(parsed.commitmentPlacements) ? parsed.commitmentPlacements : []) {
      const cand = typeof x.c === 'number' ? input.commitmentCandidates[x.c] : undefined;
      const pl = x.placement;
      if (cand && (pl === 'on_your_plate' || pl === 'ball_in_court' || pl === 'informational')) {
        commitmentPlacements[cand.id] = pl;
      }
    }

    // Keep an eye on — the middle awareness tier. Map [Kn] back to real itemIds; hard-cap at 4 so a
    // chatty model can't turn awareness into a backlog. Deduped by itemId.
    const eyeSeen = new Set<string>();
    const eyeItems: KeepAnEye[] = (Array.isArray(parsed.keepAnEyeOn?.items) ? parsed.keepAnEyeOn!.items! : [])
      .map((x) => {
        const cand = typeof x.k === 'number' ? input.keepAnEyeOn[x.k] : undefined;
        // Skip if unmapped, already-seen (dedup within tier), OR already surfaced as a must-respond
        // reply (cross-tier dedup — must-respond wins, Bug #2).
        if (!cand || eyeSeen.has(cand.itemId) || mustItemIds.has(cand.itemId)) return null;
        eyeSeen.add(cand.itemId);
        // IDENTITY (who) comes from the MAPPED candidate, never the model's free text — so the card ALWAYS
        // describes the item it links to. If the model echoed a `k` that mismatches the `who`/`why` it
        // wrote (a grounding slip), we'd otherwise show one sender's name but open a different email
        // (the "click Rehab Afifi → open Santander" bug). The model only supplies judgment (`why`).
        return { who: cand.from, why: x.why || '', itemId: cand.itemId };
      })
      .filter((x): x is KeepAnEye => !!x)
      .slice(0, 4);
    const keepAnEyeOn: KeepAnEyeOn | null = eyeItems.length ? { items: eyeItems } : null;

    // Follow-ups
    const followItems: FollowUp[] = (Array.isArray(parsed.followups?.items) ? parsed.followups!.items! : [])
      .map((x) => {
        const cand = typeof x.w === 'number' ? input.waiting[x.w] : undefined;
        return { id: cand?.id, who: x.who || cand?.counterparty || '', status: x.status || '', nextMove: x.nextMove || '' };
      })
      .filter((x) => x.who || x.status)
      .slice(0, 8);
    const followups: Followups | null = followItems.length
      ? { teaser: parsed.followups?.teaser || '', items: followItems, closing: parsed.followups?.closing || null }
      : null;

    // FYI digest
    const fyiGroups = (Array.isArray(parsed.fyiDigest?.groups) ? parsed.fyiDigest!.groups! : [])
      .map((x) => {
        const g = typeof x.f === 'number' ? input.fyiGroups[x.f] : undefined;
        return g && x.summary ? { label: g.label, summary: x.summary, kind: g.kind } : null;
      })
      .filter((g): g is FyiDigest['groups'][number] => !!g);
    // Tail counts (senders beyond the shown groups) are deterministic and computed by the route over
    // the FULL group set — filled in there. Emit 0 here; the route overrides.
    const fyiDigest: FyiDigest | null = fyiGroups.length
      ? { groups: fyiGroups, tailGroups: 0, tailItems: 0 }
      : null;

    return { tldr, mustRespond, keepAnEyeOn, followups, fyiDigest, droppedItemIds, commitmentPlacements };
  } catch {
    return { tldr: null, mustRespond: null, keepAnEyeOn: null, followups: null, fyiDigest: null, droppedItemIds: [], commitmentPlacements: {} };
  }
}
