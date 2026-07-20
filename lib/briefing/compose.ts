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
  id: string;                       // "A1" / "W2" / "P1" — the model's handle
  kind: 'action' | 'watch' | 'pulse';
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
    entityName: string | null; weight: number;
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
const BRIEFING_PROMPT_VERSION = 2;

const sigOf = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return String(h); };

/** The day signature — compose only when the SHAPE of the day changed (inputs, not phrasing). */
export function briefingDaySig(inp: BriefingInputs): string {
  return sigOf(JSON.stringify({
    v: BRIEFING_PROMPT_VERSION,
    d: inp.todayStr,
    a: inp.actions.map((a) => [a.itemId, a.weight, a.overdue, a.ask.slice(0, 40)]),
    w: inp.watch.map((w) => [w.entityId, w.move?.slice(0, 30) ?? '']),
    m: inp.moving.count, s: inp.schedule.length, c: inp.counts.needYou,
  }));
}

export async function composeBriefing(
  supabase: SupabaseClient, userId: string, inp: BriefingInputs,
): Promise<Briefing | null> {
  // ── Candidates, deterministically ordered by reasoned weight; hard caps (law 2's structural half). ──
  const actions = [...inp.actions].sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || b.weight - a.weight).slice(0, 10);
  const watch = [...inp.watch].sort((a, b) => b.weight - a.weight).slice(0, 4);
  const refs: BriefingRef[] = [
    ...actions.map((a, i) => ({ id: `A${i + 1}`, kind: 'action' as const, itemId: a.itemId, itemKind: a.itemKind, who: a.who, href: a.href })),
    ...watch.map((w, i) => ({ id: `W${i + 1}`, kind: 'watch' as const, itemId: w.entityId, itemKind: 'entity' as const, who: w.name, href: null })),
    ...(inp.moving.closest ? [{ id: 'P1', kind: 'pulse' as const, itemId: inp.moving.closest.entityId, itemKind: 'entity' as const, who: inp.moving.closest.name, href: null }] : []),
  ];

  const candidateBlock = [
    `ACTION CANDIDATES (things that need ${inp.firstName} — reference as {A1}…{A${actions.length}}; the renderer substitutes the person/deal name):`,
    ...actions.map((a, i) => `  {A${i + 1}} · weight ${a.weight}${a.overdue ? ' · OVERDUE' : ''}${a.dueDate ? ` · due ${a.dueDate}` : ''}${a.entityName ? ` · part of "${a.entityName}"` : ''}\n    the ask: ${a.ask.slice(0, 140)}${a.move ? `\n    the move: ${a.move.slice(0, 100)}` : ''}`),
    watch.length ? `\nWATCHLIST (quietly slipping, something owed — reference as {W1}…{W${watch.length}}):` : '',
    ...watch.map((w, i) => `  {W${i + 1}} · ${w.quietDays ? `quiet ${w.quietDays}d · ` : ''}${w.summary.slice(0, 120)}${w.move ? `\n    the move: ${w.move.slice(0, 100)}` : ''}`),
    `\nMOVING WITHOUT THEM: ${inp.moving.count} bodies of work${inp.moving.closest ? ` — closest to needing them: {P1} (${inp.moving.closest.summary.slice(0, 90)})` : ''}`,
    inp.schedule.length ? `\nTODAY'S CALENDAR: ${inp.schedule.map((s) => `${s.time} ${s.title}`).join(' · ')}` : `\nTODAY'S CALENDAR: empty`,
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
    `RULES (each is load-bearing):\n` +
    `- lead: ≤2 sentences — the shape of the day + which ONE thing to do first and WHY. If the day is genuinely quiet, SAY it's quiet — never manufacture urgency.\n` +
    `- action: ≤3 sentences covering ONLY the candidates you are genuinely sure matter most (usually 2-4). Weave in their {refs}. Connect related ones ("both are {entityName}") when true. End with the tail as a count if any remain, phrased naturally (e.g. "the other N can wait").\n` +
    `- watchlist: ≤2 sentences on what's quietly slipping, with the move — or null if nothing deserves words.\n` +
    `- pulse: ONE short sentence on what's moving without them (use {P1} if given) — or null.\n` +
    `- sentenced: the action refs you actually wrote into sentences (the rest render as the folded tail).\n` +
    `- Use {A1}-style refs for every person/deal you mention — NEVER write names or subjects yourself.\n` +
    `- Voice: you are the chief of staff SPEAKING TO ${inp.firstName}. Their work is SECOND person — "fourteen items need YOU", "YOUR VAT number", "once YOU submit". Use "I" ONLY for your own recommendations ("I'd start with…", "I'd leave the rest"). NEVER write as if you are them.\n` +
    `- Calm and specific; zero exclamation marks, zero cheerleading.\n` +
    `- Say LESS than you know: if you aren't sure something deserves a sentence, leave it to the counts.`;

  const res = await aiCall<{ lead?: string; action?: string; watchlist?: string | null; pulse?: string | null; sentenced?: string[] }>({
    userId, supabase, shape: { output: 'json', reasoning: 'deep' }, prompt, maxTokens: 900, temperature: 0.3, source: 'brain_synthesis',
  });
  const j = res.json;
  if (!j?.lead || !j?.action) return null;

  // Law 5 backstop: strip any ref the model invented (not in our candidate set).
  const known = new Set(refs.map((r) => r.id));
  const clean = (t: string) => t.replace(/\{([AWP]\d+)\}/g, (m, id) => (known.has(id) ? m : '')).replace(/\s{2,}/g, ' ').trim();
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
