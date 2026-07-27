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
};

const CONFIDENT = 0.55; // below this, don't even ask the judge — retrieval found nothing close

// The drafter/producer's constraint block — non-blocking by design: missing pieces are named so the
// work proceeds honestly around them, never so it stalls waiting for completeness.
function buildTruth(have: RequirementResolution[], missing: RequirementResolution[]): string {
  return (
    `ARTIFACT TRUTH — claim, attach, or build on ONLY what is actually staged:\n` +
    (have.length ? `- STAGED (attached/ready): ${have.map((h) => `${h.label} → "${h.file!.filename}"`).join(' · ')}\n` : '') +
    (missing.length ? `- MISSING (NOT in hand): ${missing.map((m2) => m2.label).join(' · ')}. Do NOT claim these are attached or promise a specific delivery time for them — either say they will follow separately or ask what's needed to get them.\n` : '')
  );
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
  const requires = (args.requires ?? []).filter((r) => r.label?.trim()).slice(0, 5);
  if (!requires.length) return empty;

  try {
    // ── Retrieval: the universal resolver per label (pool-first, entity-affinity). ──
    const perLabel: Array<{ label: string; candidates: UniversalCandidate[] }> = [];
    for (const r of requires) {
      const cands = await resolveFileUniversal(admin, { userId, entityId: args.entityId ?? null }, r.label, 4).catch(() => []);
      perLabel.push({ label: r.label, candidates: cands.filter((c) => c.score >= CONFIDENT || c.source === 'pool') });
    }

    // ── ONE reasoned pick for the whole batch (conservative: "related" is not "is"). ──
    const anyCands = perLabel.some((p) => p.candidates.length);
    let picks: Record<string, number | null> = {};
    if (anyCands) {
      const block = perLabel.map((p, i) =>
        `${i}. NEEDED: "${p.label}"\n${p.candidates.length
          ? p.candidates.map((c, j) => `   ${j}. [${c.source}] "${c.filename}" — ${c.snippet.slice(0, 120)}`).join('\n')
          : '   (no candidates found)'}`).join('\n');
      const res = await aiCall<{ picks?: Array<{ index?: number; match?: number | null }> }>({
        userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 200, source: 'task_preparation',
        prompt: `TASK: ${args.itemTitle.slice(0, 140)}\n\nFor each NEEDED artifact, is one of its candidate files ACTUALLY that artifact (not merely related to the same deal/topic)? Be conservative — a wrong attach costs trust; when unsure, match null.\n\n${block}\n\nJSON only: {"picks":[{"index":<needed #>,"match":<candidate # or null>}, ...]}`,
      }).catch(() => ({ json: undefined }));
      for (const p of res.json?.picks ?? []) {
        if (typeof p?.index === 'number') picks[p.index] = typeof p.match === 'number' ? p.match : null;
      }
    }

    // ── Stage haves into the pool; collect the missing. ──
    const { writeDeliverable } = await import('@/lib/home/deliverable-pool');
    const poolKind = args.itemKind === 'commitment' ? 'commitment' : 'email';
    const resolutions: RequirementResolution[] = [];
    for (let i = 0; i < perLabel.length; i++) {
      const { label, candidates } = perLabel[i];
      const m = picks[i];
      const cand = typeof m === 'number' ? candidates[m] : undefined;
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
    // exactly what it needs. One ask per item; the richer, attributed one wins.
    const { data: workerAsk } = await admin.from('room_turns').select('id')
      .eq('user_id', userId).eq('room_key', roomKey).like('dedupe_key', `delegate:${args.itemId}:%`)
      .filter('component->>key', 'eq', 'input_checklist').limit(1).maybeSingle();
    if (workerAsk) {
      await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).then(() => {}, () => {});
      return { resolutions, have, missing, artifactTruth: buildTruth(have, missing) };
    }
    if (missing.length) {
      await writeRoomTurn(admin, userId, roomKey, {
        role: 'system',
        text: have.length
          ? `I have ${have.map((h) => `"${h.file!.filename}"`).join(', ')} ready for this, but I couldn't find ${missing.length === 1 ? 'one thing' : `${missing.length} things`} — attach below or tell me where to look.`
          : `To finish this I need ${missing.length === 1 ? 'one thing' : `${missing.length} things`} I couldn't find anywhere — attach below or tell me where to look.`,
        refs: [{ label: args.itemTitle.slice(0, 60), href: args.itemKind === 'commitment' ? `/item/${args.itemId}?kind=commitment` : `/item/${args.itemId}` }],
        component: { key: 'input_checklist', state: { items: missing.map((m2) => m2.label), taskId: null } },
        dedupeKey,
      });
    } else {
      await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', roomKey).eq('dedupe_key', dedupeKey).then(() => {}, () => {});
    }

    // ── The drafter's ARTIFACT TRUTH. ──
    return { resolutions, have, missing, artifactTruth: buildTruth(have, missing) };
  } catch {
    return empty; // resolution is an enhancement — the draft still goes out under its own rules
  }
}
