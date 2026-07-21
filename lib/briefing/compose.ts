// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE REASONED BRIEFING (S1) — the chief-of-staff brief, WRITTEN BY THE BRAIN.
//
// The six laws (docs/home-briefing-plan.md), enforced structurally where possible:
//   1. Judge, never restate — the model sees JUDGED STATE (asks, moves, stakes, weights), not raw mail.
//   2. Say less than you know — hard segment caps + in-prompt conviction rule; the tail becomes a count.
//   3. Never repeat yourself — yesterday's brief is INPUT; unchanged → silence or one continuity clause.
//   4. The word is the deed — the model writes around {refs}; the renderer swaps in LIVE components.
//   5. Never guess an identity — names/links come from the registry at render, never from the model.
//   6. Earn the voice — calm, specific, first person; the prompt bans cheer and invented urgency.
//
// Cost: narrate stored judgment, never re-summarize raw data. ONE deep compose per shape-change
// (daySig-gated — date + input sigs), served last-good from profiles.home_brief.briefing.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';

export type BriefingRef = {
  id: string;                       // "A1" / "W2" / "P1" / "G1" — the model's handle
  kind: 'action' | 'watch' | 'pulse' | 'group';
  itemId: string;                   // the real item/entity id the renderer resolves
  itemKind: 'inbox_item' | 'commitment' | 'entity';
  who: string | null;               // display name — swapped in at render, never written by the model
  href: string | null;
};

export type BriefingSegment = { text: string; sig: string };
export type Briefing = {
  daySig: string;
  composedAt: string;
  lead: BriefingSegment;
  action: BriefingSegment;
  watchlist: BriefingSegment | null;
  pulse: BriefingSegment | null;
  refs: BriefingRef[];
  /** ids of action candidates the model chose NOT to sentence — they render as the unfold tail. */
  tail: string[];
};

export type BriefingInputs = {
  todayStr: string;                 // YYYY-MM-DD (the user's day)
  firstName: string;
  // Action candidates — the deck's atoms, already entity-weighted. Judged fields only.
  actions: Array<{
    itemId: string; itemKind: 'inbox_item' | 'commitment';
    who: string | null; ask: string;              // the JUDGED ask (understanding/synthesis), not the subject
    move: string | null;                          // the entity's next move when this item is its vehicle
    entityId: string | null;                      // the body of work this belongs to — becomes a {G#} chip, never raw text
    entityName: string | null; weight: number;    // entityName resolves the {G#} chip at RENDER (never shown to the model)
    overdue: boolean; dueDate: string | null; href: string;
  }>;
  // Watchlist — slipping entities (something open on you), already reasoned.
  watch: Array<{ entityId: string; name: string; summary: string; move: string | null; quietDays: number | null; weight: number }>;
  // Pulse — moving without you (weight-filtered by the caller).
  moving: { count: number; closest: { entityId: string; name: string; summary: string } | null };
  // Today's calendar (day-shape awareness).
  schedule: Array<{ time: string; title: string }>;
  counts: { needYou: number; cleared: number; fromTeam: number; followUps: number; fyi: number };
  // Law 3 — what the brain said last time.
  prior: { lead?: string; action?: string; watchlist?: string; pulse?: string; composedAt?: string } | null;
};

// Bump whenever the PROMPT changes — folded into the daySig so a prompt edit recomposes existing briefs
// (the cached-AI-output lesson: inputs changing must not be the only invalidator).
const BRIEFING_PROMPT_VERSION = 7;

const sigOf = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return String(h); };

/** The day signature — compose only when the SHAPE of the day changed (inputs, not phrasing). */
export function briefingDaySig(inp: BriefingInputs): string {
  return sigOf(JSON.stringify({
    v: BRIEFING_PROMPT_VERSION,
    d: inp.todayStr,
    a: inp.actions.map((a) => [a.itemId, a.weight, a.overdue, a.ask.slice(0, 40)]),
    w: inp.watch.map((w) => [w.entityId, w.move?.slice(0, 30) ?? '']),
    // Schedule keys on its CONTENT (time + title), not just its length — so a swapped/rescheduled/renamed
    // meeting recomposes the brief even when the meeting COUNT is unchanged (day-shape awareness, always live).
    m: inp.moving.count, s: inp.schedule.map((sc) => [sc.time, sc.title.slice(0, 40)]), c: inp.counts.needYou,
  }));
}

export async function composeBriefing(
  supabase: SupabaseClient, userId: string, inp: BriefingInputs,
): Promise<Briefing | null> {
  // ── Candidates arrive in AGENDA (deck) order from the caller — {A1} IS the deck's first actionable, so
  // the prose lead and the deck hero anchor on the same thing (Living-Home S1). No re-sort here; hard caps
  // only (law 2's structural half). ──
  const actions = inp.actions.slice(0, 10);
  const watch = [...inp.watch].sort((a, b) => b.weight - a.weight).slice(0, 4);

  // GROUP refs — the body of work an action belongs to is a {G#} CHIP (resolved to the registry name at
  // render), NEVER raw text the model writes. So the model can connect items on the same deal without ever
  // authoring — or restating — a name/subject/company. One G per distinct entity present in the actions.
  const groupOf = new Map<string, string>();   // entityId → G#
  const groupRefs: BriefingRef[] = [];
  for (const a of actions) {
    if (a.entityId && a.entityName && !groupOf.has(a.entityId)) {
      const gid = `G${groupOf.size + 1}`;
      groupOf.set(a.entityId, gid);
      groupRefs.push({ id: gid, kind: 'group', itemId: a.entityId, itemKind: 'entity', who: a.entityName, href: null });
    }
  }

  const refs: BriefingRef[] = [
    ...actions.map((a, i) => ({ id: `A${i + 1}`, kind: 'action' as const, itemId: a.itemId, itemKind: a.itemKind, who: a.who, href: a.href })),
    ...watch.map((w, i) => ({ id: `W${i + 1}`, kind: 'watch' as const, itemId: w.entityId, itemKind: 'entity' as const, who: w.name, href: null })),
    ...(inp.moving.closest ? [{ id: 'P1', kind: 'pulse' as const, itemId: inp.moving.closest.entityId, itemKind: 'entity' as const, who: inp.moving.closest.name, href: null }] : []),
    ...groupRefs,
  ];

  const candidateBlock = [
    `ACTION CANDIDATES (things that need ${inp.firstName} — reference as {A1}…{A${actions.length}}; the renderer substitutes the live person/item):`,
    ...actions.map((a, i) => `  {A${i + 1}} · weight ${a.weight}${a.overdue ? ' · OVERDUE' : ''}${a.dueDate ? ` · due ${a.dueDate}` : ''}${a.entityId && groupOf.has(a.entityId) ? ` · body of work ${groupOf.get(a.entityId)}` : ''}\n    the ask: ${a.ask.slice(0, 140)}${a.move ? `\n    the move: ${a.move.slice(0, 100)}` : ''}`),
    groupOf.size ? `\n(Actions sharing the same {G#} tag are the SAME body of work — you may address them together, using that {G#} chip if you name the work.)` : '',
    watch.length ? `\nWATCHLIST (quietly slipping, something owed — reference as {W1}…{W${watch.length}}):` : '',
    ...watch.map((w, i) => `  {W${i + 1}} · ${w.quietDays ? `quiet ${w.quietDays}d · ` : ''}${w.summary.slice(0, 120)}${w.move ? `\n    the move: ${w.move.slice(0, 100)}` : ''}`),
    `\nMOVING WITHOUT THEM: ${inp.moving.count} bodies of work${inp.moving.closest ? ` — closest to needing them: {P1} (${inp.moving.closest.summary.slice(0, 90)})` : ''}`,
    // Schedule: the NEXT meeting is given verbatim (one line) so the model can reference it EXACTLY; the
    // rest are only a count. Never a `·`-joined blob the model can fuse into an invented single event.
    inp.schedule.length
      ? `\nTODAY'S CALENDAR: ${inp.schedule.length} ${inp.schedule.length === 1 ? 'meeting' : 'meetings'}.  NEXT — ${inp.schedule[0].time}: ${inp.schedule[0].title}`
      : `\nTODAY'S CALENDAR: no meetings`,
    `\nCOUNTS: ${inp.counts.needYou} need them · ${inp.counts.cleared} cleared today · ${inp.counts.fromTeam} from their team · ${inp.counts.followUps} to follow up`,
  ].filter(Boolean).join('\n');

  const priorBlock = inp.prior
    ? `\nWHAT YOU TOLD THEM LAST TIME (do NOT repeat any of it verbatim; unchanged things get SILENCE or at most one short continuity clause like "still hasn't moved"):\nlead: ${inp.prior.lead ?? '—'}\naction: ${inp.prior.action ?? '—'}\nwatchlist: ${inp.prior.watchlist ?? '—'}\npulse: ${inp.prior.pulse ?? '—'}`
    : '';

  const prompt =
    `You are ${inp.firstName}'s chief of staff, writing their brief for ${inp.todayStr}. You have read everything; ` +
    `below is your OWN JUDGED STATE of their work — asks, moves, stakes, weights. You never see raw mail, so you ` +
    `cannot restate it: every sentence must carry a judgment (a stake, a reason, a connection between items, or the move to make).\n\n` +
    candidateBlock + priorBlock + `\n\nWrite FOUR segments, JSON only:\n` +
    `{"lead": "...", "action": "...", "watchlist": "..." | null, "pulse": "..." | null, "sentenced": ["A1", ...]}\n\n` +
    `THE ONE UNBREAKABLE RULE — you write around REFS, you never author identities:\n` +
    `- EVERY person, company, deal, project, or body of work you mention MUST be a {ref} ({A#}/{W#}/{P#}/{G#}). ` +
    `NEVER type a name, company, product, or subject line yourself — not even if it appears in the ask text below. ` +
    `The ask/move text is context for YOUR judgment; paraphrase the action, and point to who/what via its {ref}. ` +
    `If you cannot say something without typing a proper noun, use its {ref} or leave it out.\n` +
    `- This includes FIRST NAMES. When the ask or move text names a person — who owes, who is owed, who to check ` +
    `with — reference them by the {ref} that stands for them (each {A#} already IS that person/deal). Do not ` +
    `re-type "owed to <Name>" or "check with <Name>": either the {ref} already conveys it, or omit the name.\n` +
    `- NEVER explain your own bookkeeping. Do not write "these are the same X", "all one Y", "both belong to Z", ` +
    `or narrate that items are grouped. If two actions share a {G#}, simply speak to them as one line of work ` +
    `and reference {G#} once if you must name it — never describe the grouping.\n\n` +
    `RULES (each is load-bearing):\n` +
    `- lead: ≤2 sentences — the shape of the day + which ONE thing to do first and WHY. The candidates are in ` +
    `PRIORITY ORDER: {A1} is the top of the user's list, so lead with {A1} unless a later candidate is genuinely ` +
    `more pressing (an overdue/dated obligation) — and then you MUST name that one by its {ref}, never a silent ` +
    `different pick. Reflect today's calendar: how booked the day is and, if there is one, the NEXT meeting using ` +
    `EXACTLY the time and title given under TODAY'S CALENDAR (copy them verbatim; NEVER merge two meetings or ` +
    `invent one). If the day is genuinely quiet, SAY it's quiet — never manufacture urgency.\n` +
    `- action: ≤3 sentences covering ONLY the candidates you are genuinely sure matter most (usually 2-4), via their ` +
    `{refs}. If — and ONLY if — candidates remain beyond the ones you named, close with them as a count ("the other N ` +
    `can wait"); if none remain, do NOT add any such clause (never write "the other zero can wait").\n` +
    `- watchlist: ≤2 sentences on what's quietly slipping, with the move — or null if nothing deserves words.\n` +
    `- pulse: ONE short sentence on what's moving without them (use {P1} if given) — or null.\n` +
    `- sentenced: the action refs you actually wrote into sentences (the rest render as the folded tail).\n` +
    `- NEVER invent urgency, consequences, or that a person will "escalate"/"chase"/"follow up" — state only what the ` +
    `judged state says. An automated or system notice is a task to handle, never a person with feelings.\n` +
    `- Voice: you are the chief of staff SPEAKING TO ${inp.firstName}. Their work is SECOND person — "fourteen items need YOU", ` +
    `"YOUR VAT number", "once YOU submit". Use "I" ONLY for your own recommendations ("I'd start with…"). NEVER write as if you are them.\n` +
    `- Calm and specific; zero exclamation marks, zero cheerleading.\n` +
    `- Say LESS than you know: if you aren't sure something deserves a sentence, leave it to the counts.`;

  const res = await aiCall<{ lead?: string; action?: string; watchlist?: string | null; pulse?: string | null; sentenced?: string[] }>({
    userId, supabase, shape: { output: 'json', reasoning: 'deep' }, prompt, maxTokens: 900, temperature: 0.15, source: 'brain_synthesis',
  });
  const j = res.json;
  if (!j?.lead || !j?.action) return null;

  // Law 5 backstop: strip any ref the model invented (not in our candidate set).
  const known = new Set(refs.map((r) => r.id));
  const clean = (t: string) => t.replace(/\{([AWPG]\d+)\}/g, (m, id) => (known.has(id) ? m : '')).replace(/\s{2,}/g, ' ').trim();
  const sentenced = new Set((j.sentenced ?? []).filter((id) => known.has(id)));
  const tail = actions.map((_, i) => `A${i + 1}`).filter((id) => !sentenced.has(id))
    .map((id) => refs.find((r) => r.id === id)!.itemId);

  return {
    daySig: briefingDaySig(inp), composedAt: new Date().toISOString(),
    lead: { text: clean(j.lead), sig: sigOf(j.lead) },
    action: { text: clean(j.action), sig: sigOf(j.action) },
    watchlist: j.watchlist ? { text: clean(j.watchlist), sig: sigOf(j.watchlist) } : null,
    pulse: j.pulse ? { text: clean(j.pulse), sig: sigOf(j.pulse) } : null,
    refs, tail,
  };
}
