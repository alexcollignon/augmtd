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
export interface CommitmentFact {
  description: string;
  overdue: boolean;
  dueToday: boolean;
  dueDate: string | null;
}
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
  waitingOnCount: number;
  triaged: number;
  filtered: number;
  emailReplyCount: number;
  topPriorities: Array<{ title: string; posture: string; source: string; overdue: boolean }>;
  mustRespond: MustRespondCandidate[];
  waiting: WaitingCandidate[];
  fyiGroups: FyiGroupCandidate[];
}

// ── Output shapes — identical to what the client already renders ──
export type Tldr = { teaser: string; bullets: string[]; dontMiss: string | null };
export type FollowUp = { id?: string; who: string; status: string; nextMove: string };
export type Followups = { teaser: string; items: FollowUp[]; closing: string | null };
export type FyiDigest = { groups: { label: string; summary: string; kind: 'person' | 'newsletter' }[]; tailGroups: number; tailItems: number };
export type Reply = { who: string; ask: string; angle: string; itemId: string };
export type MustRespond = { teaser: string; items: Reply[] };

export interface SynthesisResult {
  tldr: Tldr | null;
  mustRespond: MustRespond | null;
  followups: Followups | null;
  fyiDigest: FyiDigest | null;
  /** itemIds the synthesis judged superseded/stale — the route drops them from priorities too, so
      the prose and the cards can't contradict each other. */
  droppedItemIds: string[];
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
      parts.push(`email ${age}d ago "${e.subject}" [${e.posture}]`);
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
    ? input.waiting.map((w, i) => `[W${i}] ${w.counterparty || 'Someone'} — "${w.description}" — ${w.ageDays}d quiet`).join('\n')
    : 'none';
  const fyiStr = input.fyiGroups.length
    ? input.fyiGroups.map((g, i) => `[F${i}] ${g.label} (${g.count}, ${g.kind}): ${g.subjects.slice(0, 5).filter(Boolean).map((s) => `"${s}"`).join('; ')}`).join('\n')
    : 'none';

  const prompt = `You are ${me}'s personal assistant. Write today's brief in a warm, first-person PA voice — as if you personally keep ${me}'s day in order (met X, owe Y, waiting on Z). Use ${me}'s first name naturally.

You are given the COMPLETE grounded picture, reconciled per person. Reason over it holistically before writing:
- SUPERSESSION: if an email awaiting a reply is a scheduling/confirmation/logistics message from someone ${me} ALREADY has a meeting with (held or upcoming), the meeting settles it — DROP that reply (do not list it in "mustRespond"). Same for any ask a later interaction already resolved.
- STALENESS: drop an ask whose moment has passed (e.g. "by 6pm yesterday").
- GROUPING: never write two separate fragments about the same person — fold everything about them into one coherent thought.
- GROUNDING: use ONLY the facts below. Never invent names, numbers, asks, or details. Echo the [Rn]/[Wn]/[Fn] tag of every item you keep so it maps back.

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

THREADS ${me} IS WAITING ON (ball in ${me}'s court to nudge):
${waitingStr}

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
  "followups": {
    "teaser": "one short line introducing the roundup",
    "items": [{"w": <the [Wn] index>, "who": "person or topic", "status": "short status (how long quiet, what's pending)", "nextMove": "recommended next move (brief, specific)"}],
    "closing": "a short offer to draft these — name the 1-2 you'd tackle first — or null"
  },
  "fyiDigest": {
    "groups": [{"f": <the [Fn] index>, "summary": "one-line digest of what these are about"}]
  }
}

If a section has no items, return it with an empty items/groups array (or null for tldr fields). Keep every "mustRespond" item you did not drop; every "followups" item; and one digest line per FYI group.`;

  try {
    const res = await aiCreate(client, {
      model, max_tokens: 1400, temperature: 0.4,
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = parseModelJSON<{
      tldr?: { teaser?: string; bullets?: string[]; dontMiss?: string | null };
      mustRespond?: { teaser?: string; items?: { r?: number; who?: string; ask?: string; angle?: string }[] };
      droppedReplies?: number[];
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

    // Must-respond — map [Rn] back to real itemIds; anything not returned (or explicitly dropped) is
    // gone. This is where supersession takes effect deterministically on the cards too.
    const keptR = new Set<number>();
    const mustItems: Reply[] = (Array.isArray(parsed.mustRespond?.items) ? parsed.mustRespond!.items! : [])
      .map((x) => {
        const cand = typeof x.r === 'number' ? input.mustRespond[x.r] : undefined;
        if (!cand) return null;
        keptR.add(x.r as number);
        return { who: x.who || cand.from, ask: x.ask || '', angle: x.angle || '', itemId: cand.itemId };
      })
      .filter((x): x is Reply => !!x)
      .slice(0, 25);
    const mustRespond: MustRespond | null = mustItems.length
      ? { teaser: parsed.mustRespond?.teaser || '', items: mustItems }
      : null;
    // Dropped = explicitly dropped OR simply not kept (the model saw it and left it out).
    const droppedItemIds: string[] = input.mustRespond
      .map((m, i) => ({ id: m.itemId, i }))
      .filter(({ i }) => !keptR.has(i))
      .map(({ id }) => id);

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

    return { tldr, mustRespond, followups, fyiDigest, droppedItemIds };
  } catch {
    return { tldr: null, mustRespond: null, followups: null, fyiDigest: null, droppedItemIds: [] };
  }
}
