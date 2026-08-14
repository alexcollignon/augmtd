// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DELIVERABLE RESOLUTION (the "what's available / what's needed" half of preparation).
//
// The judge's verdict carries a deliverable INVENTORY (`requires` — the concrete artifacts the work
// must include, in the item's own words). This module resolves each against everything we can see —
// the per-item pool, the KB, connected drives (ONE universal resolver, lib/knowledge/resolve.ts) —
// with ONE reasoned pick per batch (a score is retrieval, not judgment):
//   have    → staged into the per-item pool (every reader — drafter, send path, stage — sees it)
//   missing → put to the USER as the room's input_checklist turn (the same component a coworker's
//             ask uses — one grammar for "I need something from you"), cleared by the ingest funnel.
//
// The result is the drafter's ARTIFACT TRUTH: a reply may only claim what is actually staged.
// Agnostic by construction: no keyword lists — the inventory is reasoned by the judge, retrieval is
// the universal resolver's registry, the match is a reasoned verdict, the ask is the one checklist.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { resolveFileUniversal, type UniversalCandidate } from '@/lib/knowledge/resolve';

export type RequirementResolution = {
  label: string;
  status: 'have' | 'missing';
  file?: { source: string; id: string; filename: string };
};

export type RequirementsResult = {
  resolutions: RequirementResolution[];
  have: RequirementResolution[];
  missing: RequirementResolution[];
  /** The drafter's constraint block — '' when there was nothing to resolve. */
  artifactTruth: string;
  /** W3 — the user tapped "go ahead with what's available" on this item's ask: the work proceeds
   *  around the gaps (work-with-what-you-have), and the ask is never re-posted. */
  proceeded?: boolean;
};

const CONFIDENT = 0.55; // below this, don't even ask the judge — retrieval found nothing close

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STAGING LAW (proactive-team W6 — born from a live wrong-attach: a cross-client
// "Assessment Answers" PDF staged as another deal's "Individual Report" on filename+snippet alone).
//
//   1. PROVENANCE GATES CANDIDACY (identity over topic — recognition's lesson applied here): a
//      candidate may AUTO-STAGE only when it is the item's own (pool — the thread/user dropped it)
//      or belongs to the SAME body of work (candidate.entityId === the item's entity). A global-KB
//      or drive hit on a LOOSE item is never staged — at best it becomes a named SUGGESTION in the
//      ask ("might be this — confirm"). Prepared requires certainty; uncertain is Suggested.
//   2. EVIDENCE IS SHOWN AND CODE-CHECKED: the reasoned pick must QUOTE the phrase that proves the
//      file IS the artifact; code verifies the quote actually appears in the candidate's
//      filename/snippet. No verifiable evidence → no match (the expired_on pattern, generalized).
//   3. ONE FILE, ONE LABEL: a single file claiming to be two DISTINCT artifacts means the pick
//      isn't discriminating — all duplicate matches are rejected (wrong attach is worse than none).
//   4. The stage bar for entity-matched KB candidates is 0.7 (parity with the doc-send path);
//      pool candidates keep their natural standing.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const STAGE_SCORE = 0.7;

export type ArtifactPick = {
  label: string;
  /** The candidate that may STAGE (passed provenance + evidence) — null when nothing qualifies. */
  candidate: UniversalCandidate | null;
  /** The code-verified quote that proved the match (present iff candidate). */
  evidence?: string;
  /** A plausible-but-unstageable hit (wrong provenance / unverified) — named in the ask, never staged. */
  suggestion?: UniversalCandidate | null;
};

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Is this candidate ALLOWED to auto-stage for this item (provenance law #1 + the score bar #4)? */
function stageEligible(c: UniversalCandidate, entityId: string | null | undefined): boolean {
  if (c.source === 'pool') return true;
  if (entityId && c.entityId === entityId) return c.score >= STAGE_SCORE; // affinity boost already rides the score
  return false; // global KB / drive hit on a loose or different-entity item — suggestion at best
}

/**
 * verifyArtifactMatch — the ONE evidence-quoting yes/no every attach door uses (doc-send + any
 * future path). Same law as pickArtifacts #2: the model quotes the proving phrase, CODE checks the
 * quote is real. Cross-entity candidates are rejected structurally before any AI runs.
 */
export async function verifyArtifactMatch(
  admin: SupabaseClient, userId: string,
  input: { task: string; candidate: UniversalCandidate; entityId?: string | null; emailExcerpt?: string | null },
): Promise<{ match: boolean; evidence: string | null }> {
  const c = input.candidate;
  // Provenance floor: a file that BELONGS to a different body of work never attaches here.
  if (input.entityId && c.entityId && c.entityId !== input.entityId) return { match: false, evidence: null };
  try {
    const res = await aiCall<{ match?: boolean; evidence?: string }>({
      userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 160, source: 'task_preparation',
      prompt:
        `TASK: ${input.task.slice(0, 140)}\n` +
        (input.emailExcerpt ? `THEIR OWN WORDS: ${input.emailExcerpt.replace(/\s+/g, ' ').slice(0, 400)}\n` : '') +
        `CANDIDATE FILE: "${c.filename}" [${c.source}${c.originKind ? ` · ${c.originKind}` : ''}]\nSnippet: ${c.snippet.slice(0, 200)}\n\n` +
        `Is this file THE document the task asks to send/share — not merely related to the same ` +
        `client/topic? If yes, return "evidence": a short phrase COPIED VERBATIM from the filename ` +
        `or snippet that proves it is THIS document. Unsure → false.\n` +
        `JSON only: {"match":true|false,"evidence":"<verbatim phrase or empty>"}`,
    });
    const evidence = String(res.json?.evidence ?? '').trim();
    const real = res.json?.match === true && evidence.length >= 3
      && normText(`${c.filename} ${c.snippet}`).includes(normText(evidence));
    return { match: real, evidence: real ? evidence : null };
  } catch { return { match: false, evidence: null }; }
}

/**
 * pickArtifacts — THE testable decision layer (retrieval stays infrastructure; THIS is where the
 * wrong-PDF class lived). Applies the staging law per label: provenance filter → one contrastive,
 * evidence-quoting verification per label → code-side quote check → the one-file-one-label collapse.
 */
export async function pickArtifacts(
  admin: SupabaseClient, userId: string,
  input: {
    itemTitle: string;
    /** The item's own words (email body excerpt) — the pick grounds in what was actually asked. */
    emailExcerpt?: string | null;
    entityId?: string | null;
    perLabel: Array<{ label: string; candidates: UniversalCandidate[] }>;
  },
): Promise<ArtifactPick[]> {
  const out: ArtifactPick[] = [];
  for (const { label, candidates } of input.perLabel) {
    const eligible = candidates.filter((c) => stageEligible(c, input.entityId)).slice(0, 3);
    let suggestion = candidates.find((c) => !stageEligible(c, input.entityId) && c.score >= STAGE_SCORE) ?? null;
    // R-class SUGGESTION FLOOR: a named "maybe this?" must itself be plausible — offering another
    // deal's kickoff transcript as maybe-the-HR-insights reads as not paying attention, even
    // wearing an "unsure" label. One relaxed reasoned read (only when a suggestion would surface);
    // an implausible candidate is silence, not a suggestion.
    if (suggestion) {
      const sres = await aiCall<{ plausible?: boolean }>({
        userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 60, source: 'task_preparation',
        prompt: `THE ASK: ${input.itemTitle.slice(0, 120)} — needs "${label}".\n` +
          `CANDIDATE FILE (from elsewhere in the user's files): "${suggestion.filename}" — ${suggestion.snippet.slice(0, 140)}\n\n` +
          `Could this file PLAUSIBLY be that artifact or this same engagement's material — not another ` +
          `client's or an unrelated meeting's? Unsure → false.\nJSON only: {"plausible":true|false}`,
      }).catch(() => ({ json: { plausible: false } }));
      if (sres.json?.plausible !== true) suggestion = null;
    }
    if (!eligible.length) { out.push({ label, candidate: null, suggestion }); continue; }
    // ── The contrastive, evidence-quoting verification (law #2) — per label, full context. ──
    const res = await aiCall<{ match?: number | null; evidence?: string }>({
      userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 220, source: 'task_preparation',
      prompt:
        `A colleague asked for a specific artifact. Decide whether one of the candidate files IS that ` +
        `artifact — not merely related to the same client, topic, or kind of work. Being adjacent ` +
        `("assessment material" when they asked for "the individual report") is NOT a match.\n\n` +
        `THE ASK: ${input.itemTitle.slice(0, 140)}\n` +
        (input.emailExcerpt ? `THEIR OWN WORDS: ${input.emailExcerpt.replace(/\s+/g, ' ').slice(0, 500)}\n` : '') +
        `THE NEEDED ARTIFACT: "${label}"\n\n` +
        `CANDIDATES:\n${eligible.map((c, j) =>
          `${j}. "${c.filename}" [${c.source}${c.originKind ? ` · ${c.originKind}` : ''}${input.entityId && c.entityId === input.entityId ? ' · SAME body of work' : ''}] — ${c.snippet.slice(0, 160)}`).join('\n')}\n\n` +
        `If one IS the artifact: return its number AND "evidence" — a short phrase COPIED VERBATIM ` +
        `from that candidate's filename or snippet above that proves it (the proof must name what ` +
        `makes it THIS artifact, not the shared topic). If none qualifies, match null. Unsure → null.\n` +
        `JSON only: {"match":<number or null>,"evidence":"<verbatim phrase or empty>"}`,
    }).catch(() => ({ json: undefined }));
    const idx = typeof res.json?.match === 'number' ? res.json.match : null;
    const cand = idx !== null ? eligible[idx] : undefined;
    const evidence = String(res.json?.evidence ?? '').trim();
    // Law #2, the CODE half: the quoted evidence must actually appear in the candidate's own text.
    // Ask-journey D2 (Aug 13): substring-only rejected the RIGHT file ~2/3 of runs — the model
    // quotes the ask's word order ("signed Schedule B addendum") against a file named "Schedule B
    // addendum - signed". A token-subset fallback keeps the check code-verified (every evidence
    // word must exist in the candidate's own text) while surviving word-order variance.
    const candText = normText(`${cand?.filename ?? ''} ${cand?.snippet ?? ''}`);
    const evNorm = normText(evidence);
    const evTokens = evNorm.split(' ').filter((t) => t.length > 1);
    const evidenceReal = !!cand && evidence.length >= 3
      && (candText.includes(evNorm)
        || (evTokens.length >= 2 && evTokens.every((t) => candText.includes(t))));
    out.push(evidenceReal
      ? { label, candidate: cand!, evidence, suggestion: null }
      : { label, candidate: null, suggestion });
  }
  // ── Law #3: one file, one label — duplicate matches all reject (ambiguity is not confidence). ──
  const counts = new Map<string, number>();
  for (const p of out) if (p.candidate) counts.set(p.candidate.id, (counts.get(p.candidate.id) ?? 0) + 1);
  for (const p of out) {
    if (p.candidate && (counts.get(p.candidate.id) ?? 0) > 1) {
      p.suggestion = p.candidate; p.candidate = null; delete p.evidence;
    }
  }
  return out;
}

// The drafter/producer's constraint block — non-blocking by design: missing pieces are named so the
// work proceeds honestly around them, never so it stalls waiting for completeness.
function buildTruth(have: RequirementResolution[], missing: RequirementResolution[]): string {
  return (
    `ARTIFACT TRUTH — claim, attach, or build on ONLY what is actually staged:\n` +
    (have.length ? `- STAGED (attached/ready): ${have.map((h) => `${h.label} → "${h.file!.filename}"`).join(' · ')}\n` : '') +
    (missing.length ? `- MISSING (NOT in hand): ${missing.map((m2) => m2.label).join(' · ')}. Do NOT claim these are attached or promise a specific delivery time for them — either say they will follow separately or ask what's needed to get them.\n` : '')
  );
}

// THE ATTACHABILITY FLOOR's one reasoned check — which labels denote retrievable/attachable
// THINGS (documents, files, sheets, decks, links) vs answers/decisions/confirmations that only
// the user's own words or sign-off can supply. Memoized per label-set (the same judged requires
// recur every pass); conservative on failure (keep all).
const _attachMemo = new Map<string, { at: number; keep: Set<string> }>();
async function attachableOnly(
  client: SupabaseClient, userId: string, requires: Array<{ label: string }>,
): Promise<Array<{ label: string }>> {
  const sig = requires.map((r) => r.label.toLowerCase()).join('|');
  const memo = _attachMemo.get(sig);
  if (memo && Date.now() - memo.at < 10 * 60 * 1000) return requires.filter((r) => memo.keep.has(r.label));
  try {
    const lines = requires.map((r, i) => `${i + 1}. ${r.label}`).join('\n');
    const res = await aiCall<{ attachable?: number[] }>({
      userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 80,
      source: 'task_preparation',
      prompt:
        `Which of these are ATTACHABLE THINGS — a document, file, report, sheet, deck, or link that ` +
        `could be retrieved and attached to an email? NOT attachable: a confirmation, approval, ` +
        `decision, answer, availability, a time, or anything only a person's own words can supply. ` +
        `(A "confirmation letter" IS a document; "confirmation of the meeting time" is an answer.)\n` +
        `${lines}\n\nJSON only: {"attachable":[numbers]}`,
    });
    if (!Array.isArray(res.json?.attachable)) return requires; // failure ≠ a verdict — keep all
    const keep = new Set(res.json.attachable.map((n) => requires[Number(n) - 1]?.label).filter(Boolean) as string[]);
    _attachMemo.set(sig, { at: Date.now(), keep });
    return requires.filter((r) => keep.has(r.label));
  } catch { return requires; }
}

export async function resolveRequirements(
  admin: SupabaseClient, userId: string,
  args: {
    itemKind: 'inbox' | 'commitment';
    itemId: string;
    itemTitle: string;
    entityId?: string | null;
    requires: Array<{ label: string }>;
  },
): Promise<RequirementsResult> {
  const empty: RequirementsResult = { resolutions: [], have: [], missing: [], artifactTruth: '' };
  let requires = (args.requires ?? []).filter((r) => r.label?.trim()).slice(0, 5);
  if (!requires.length) return empty;

  // ── THE ATTACHABILITY FLOOR (Aug 4, found live: "attach a confirmation of the Thursday demo
  // call time" — an ANSWER classified as an artifact; the resolver searched drives for a decision
  // and asked the user to attach one). A require the resolver works on must denote a retrievable
  // THING. One cheap reasoned check (never a keyword list — "confirmation letter" IS a document),
  // memoized per label-set; on AI failure keep everything (a silly ask beats a silently dropped
  // real requirement). Runs at the ONE resolver, so every door — pass, on-demand draft, judge
  // serving edge, any item/task/project — inherits it. ──
  requires = await attachableOnly(admin, userId, requires);
  if (!requires.length) return empty;

  try {
    // ── Retrieval: the universal resolver per label (pool-first, entity-affinity). ──
    const perLabel: Array<{ label: string; candidates: UniversalCandidate[] }> = [];
    for (const r of requires) {
      const cands = await resolveFileUniversal(admin, { userId, entityId: args.entityId ?? null }, r.label, 4).catch(() => []);
      perLabel.push({ label: r.label, candidates: cands.filter((c) => c.score >= CONFIDENT || c.source === 'pool') });
    }

    // ── The item's OWN WORDS ground the pick (a filename can't be judged against a 140-char title). ──
    let emailExcerpt: string | null = null;
    try {
      if (args.itemKind === 'inbox') {
        const { data: it } = await admin.from('inbox_items').select('source_data').eq('id', args.itemId).eq('user_id', userId).maybeSingle();
        emailExcerpt = String(((it?.source_data ?? {}) as { body?: string }).body ?? '').slice(0, 700) || null;
      } else {
        const { data: c } = await admin.from('commitments').select('description').eq('id', args.itemId).eq('user_id', userId).maybeSingle();
        emailExcerpt = String(c?.description ?? '').slice(0, 300) || null;
      }
    } catch { /* the excerpt is grounding, not a gate */ }

    // ── THE STAGING LAW (W6): provenance-gated, evidence-verified, one-file-one-label. ──
    const picks = await pickArtifacts(admin, userId, {
      itemTitle: args.itemTitle, emailExcerpt, entityId: args.entityId ?? null, perLabel,
    });

    // ── Stage haves into the pool; collect the missing (+ their named suggestions). ──
    const { writeDeliverable } = await import('@/lib/home/deliverable-pool');
    const poolKind = args.itemKind === 'commitment' ? 'commitment' : 'email';
    const resolutions: RequirementResolution[] = [];
    const suggestions: Array<{ label: string; filename: string }> = [];
    for (const pick of picks) {
      const { label, candidate: cand } = pick;
      if (pick.suggestion) suggestions.push({ label, filename: pick.suggestion.filename });
      if (cand) {
        // Idempotent staging: one pool row per (item, requirement) — a re-resolve replaces nothing
        // it doesn't have to (writeDeliverable dedupes on task_id).
        await writeDeliverable(admin, userId, {
          kind: poolKind, entityId: args.itemId, taskId: `require:${label.toLowerCase().slice(0, 60)}`,
          type: 'file', title: cand.filename.slice(0, 100),
          content: cand.snippet.slice(0, 2000), gist: `staged for: ${label}`.slice(0, 120),
          metadata: { source: 'requirement_resolution', requirement: label, attachment: { fileId: cand.id, filename: cand.filename, source: cand.source } },
        }).catch(() => {});
        resolutions.push({ label, status: 'have', file: { source: cand.source, id: cand.id, filename: cand.filename } });
      } else {
        resolutions.push({ label, status: 'missing' });
      }
    }
    const have = resolutions.filter((r) => r.status === 'have');
    const missing = resolutions.filter((r) => r.status === 'missing');

    // ── The ASK: missing requirements land as the room's ONE input-checklist turn (CoS-voiced —
    // the engine asking, not a coworker). The ingest funnel clears it; a later pass re-resolves
    // with the attachment in the pool. Nothing to ask → clear any prior ask (it's been satisfied
    // by a re-judgment or a resolve). ──
    const { writeRoomTurn, roomKeyForItem } = await import('@/lib/room/turns');
    const roomKey = await roomKeyForItem(admin, userId, args.itemKind, args.itemId);
    const dedupeKey = `requires:${args.itemId}`;
    // THE COWORKER SUPERSEDES: while a coworker's own needs_input ask stands on this item, the
    // engine's provisional ask is redundant noise — the worker attempted the work and asked for
    // exactly what it needs. One ask per item; the richer, attributed one wins. LIVE asks only —
    // an ARCHIVED conversation's ask is history, it must not keep suppressing the engine's ask
    // (mirrors the pass's own live-only check; unfiltered retry pre-migration).
    let workerAsk: { id: string } | null = null;
    try {
      const { data } = await admin.from('room_turns').select('id')
        .eq('user_id', userId).eq('room_key', roomKey).like('dedupe_key', `delegate:${args.itemId}:%`)
        .filter('component->>key', 'eq', 'input_checklist').is('archived_at', null).limit(1).maybeSingle();
      workerAsk = data ?? null;
    } catch {
      const { data } = await admin.from('room_turns').select('id')
        .eq('user_id', userId).eq('room_key', roomKey).like('dedupe_key', `delegate:${args.itemId}:%`)
        .filter('component->>key', 'eq', 'input_checklist').limit(1).maybeSingle();
      workerAsk = data ?? null;
    }
    if (workerAsk) {
      await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).then(() => {}, () => {});
      return { resolutions, have, missing, artifactTruth: buildTruth(have, missing) };
    }
    // W3 LIFECYCLE — a PROCEEDED ask (the user's "go ahead with what's available") is a standing
    // decision: the ask is never re-posted (the turn stays in the room as the record), and the
    // caller proceeds around the gaps under the artifact truth.
    const { data: priorAsk } = await admin.from('room_turns').select('id, component')
      .eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).maybeSingle();
    const proceeded = !!((priorAsk?.component as { state?: { proceeded?: boolean } } | null)?.state?.proceeded);
    if (proceeded) {
      return { resolutions, have, missing, artifactTruth: buildTruth(have, missing), proceeded: true };
    }
    // ONE ARTIFACT = ONE ASK (experience-spec law 3, Aug 2 — found live: two items asked for the
    // "STC Bahrain comprehensive assessment report" under word-shuffled labels as two checklists).
    // Before posting, check the room's OTHER live asks: a missing label already asked-for by a
    // sibling item's checklist (distinctive-token match — the shared identity primitive) is
    // COVERED — this item joins that ask's `covers` instead of duplicating it. Only genuinely
    // new labels get a turn of their own.
    let uncovered = missing;
    if (missing.length) {
      try {
        const { namesOverlap } = await import('@/lib/entities/recognize');
        const selfRef = `${args.itemKind === 'commitment' ? 'commitment' : 'inbox'}:${args.itemId}`;
        const { data: siblings } = await admin.from('room_turns').select('id, component, dedupe_key')
          .eq('user_id', userId).eq('room_key', roomKey)
          .filter('component->>key', 'eq', 'input_checklist')
          .neq('dedupe_key', dedupeKey).limit(10);
        const covered = new Set<string>();
        for (const sib of (siblings ?? []) as Array<{ id: string; component: { key?: string; state?: Record<string, unknown> } | null }>) {
          const st = (sib.component?.state ?? {}) as Record<string, unknown>;
          const sibItems = Array.isArray(st.items) ? (st.items as string[]) : [];
          const hits = missing.filter((m2) => sibItems.some((si) => namesOverlap(m2.label, si)));
          if (!hits.length) continue;
          for (const h of hits) covered.add(h.label);
          const covers = [...new Set([...(Array.isArray(st.covers) ? (st.covers as string[]) : []), selfRef])];
          await admin.from('room_turns').update({ component: { ...(sib.component ?? {}), state: { ...st, covers } } }).eq('id', sib.id).then(() => {}, () => {});
        }
        uncovered = missing.filter((m2) => !covered.has(m2.label));
        if (!uncovered.length && missing.length) {
          // Everything this item needs is already asked-for — no second checklist, and any prior
          // own-ask turn dies (the sibling's ask carries it via covers).
          await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).then(() => {}, () => {});
        }
      } catch { uncovered = missing; /* the merge is best-effort — a duplicate beats a silent drop */ }
    }
    if (uncovered.length) {
      // Unstageable-but-plausible hits are NAMED, never silently attached (Prepared → Suggested:
      // the user confirms in the room — "use it" routes through the conversation/attach funnel).
      const suggestLine = suggestions.length
        ? ` I did find ${suggestions.slice(0, 2).map((s) => `"${s.filename}" (maybe the ${s.label.toLowerCase()})`).join(' and ')} — but I'm not sure enough to attach ${suggestions.length === 1 ? 'it' : 'them'} without you confirming.`
        : '';
      await writeRoomTurn(admin, userId, roomKey, {
        role: 'system',
        text: (have.length
          ? `I have ${have.map((h) => `"${h.file!.filename}"`).join(', ')} ready for this, but I couldn't find ${uncovered.length === 1 ? 'one thing' : `${uncovered.length} things`} — attach below or tell me where to look.`
          : `To finish this I need ${uncovered.length === 1 ? 'one thing' : `${uncovered.length} things`} I couldn't find anywhere — attach below or tell me where to look.`) + suggestLine,
        refs: [{ label: args.itemTitle.slice(0, 60), href: args.itemKind === 'commitment' ? `/item/${args.itemId}?kind=commitment` : `/item/${args.itemId}` }],
        component: { key: 'input_checklist', state: { items: uncovered.map((m2) => m2.label), taskId: null } },
        dedupeKey,
      });
    } else {
      await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).then(() => {}, () => {});
    }

    // ── The drafter's ARTIFACT TRUTH. ──
    return { resolutions, have, missing, artifactTruth: buildTruth(have, missing) };
  } catch {
    // FAILURE HONESTY (W2): a failed resolution is not "nothing was required" — the draft still
    // goes out (asks never block), but under a truth block that forbids claiming anything is in
    // hand (an unconstrained draft after a resolver outage was the silent fabrication channel).
    return {
      ...empty,
      artifactTruth:
        'ARTIFACT TRUTH — the artifact resolution FAILED, so NOTHING is staged: do not claim or ' +
        'promise any attachment; say the documents will follow separately.',
    };
  }
}
