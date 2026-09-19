// ════════════════════════════════════════════════════════════════════════════════════════════════
// prepare_bulk_deed — THE BULK-DEED CARD'S CHAT PRODUCER (docs/attention-plan.md, law A7's parity
// clause: "the same deed is sayable in the composer and routes through the same door").
//
// ONE tool contract, ONE execution body, and it is a THIN WRAPPER over `prepareBulkDeed` — the same
// function the ledger's own verb buttons call through `/api/deeds/prepare`. Saying "archive the
// notices" and clicking Archive on the Notices row produce the SAME stored deed row, because there
// is only one place a deed can be born.
//
// IT NEVER COMMITS. The model prepares and speaks one line; the card's button is the only commit
// door (`/api/deeds/commit`). A model that could archive thirty messages by emitting a tool call is
// exactly the class THE HUMAN-IN-THE-LOOP LAW forbids, and the shape of this module is the
// enforcement: `commitBulkDeed` is not imported here and cannot be reached from here.
//
// AMBIGUITY IS A REFUSAL. The class is resolved DETERMINISTICALLY against `HELD_CLASSES` — by key,
// by label, or by a distinctive word of the label. A description matching two classes refuses BY
// LISTING them; it never picks one. (The author-doors law, one arc over.)
//
// ⚠️ AGENTOS, STATED: there is deliberately no Python twin. AgentOS runs WORKER chat and workflow
// agent steps; the held-quiet ledger is the CHIEF's seat (the deck is one attention surface with one
// owner), so this tool is exposed to `chief_of_staff` only and the chief's loop is native TS. If a
// worker is ever given the ledger, the twin belongs in `infra/agentos/tools_tasks.py` beside a case
// in `app/api/internal/agentos/tools/route.ts` — and a Python change needs a BOX REDEPLOY.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { HELD_CLASSES, HELD_CLASS_ORDER, type HeldClassId } from '@/lib/home/attention';
import { BULK_VERBS, type BulkDeed, type BulkVerb } from '@/lib/deeds/words';

export const prepareBulkDeedDefinition = {
  name: 'prepare_bulk_deed',
  description:
    'Prepare a BULK DEED CARD over a group the agent is holding quiet for the user — NEVER acts. Use when ' +
    'they say things like "archive all the notices", "unsubscribe from the newsletters", "bin the promos". ' +
    'The card states exactly what will happen and to how many, and the user commits it with one click. ' +
    'Say one short line — the card carries the rest. It cannot act on anything by itself.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verb: {
        type: 'string' as const,
        enum: [...BULK_VERBS],
        description: 'archive (clear them, reversible) · unsubscribe · trash (to the mailbox bin, never deleted) · expire (stale commitments)',
      },
      group: {
        type: 'string' as const,
        description:
          "the group in the user's own words — e.g. \"notices\", \"newsletters\", \"the quieter threads\". " +
          'Leave empty only when they named specific items rather than a group.',
      },
    },
    required: ['verb'] as string[],
  },
};

export type BulkDeedCardRef = { id: string; deed: BulkDeed };

export type PrepareBulkDeedOutcome =
  | { ok: true; card: BulkDeedCardRef; line: string }
  | { ok: false; line: string };

/** The words a class answers to: its key's own tokens plus its label's. Stopwords out, so "the
 *  quieter threads" and "quieter" both reach `quieter_threads` and neither reaches anything else. */
const CLASS_STOPWORDS = new Set(['the', 'a', 'an', 'all', 'my', 'your', 'and', '&', 'of', 'in', 'on']);

function tokensOf(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((t) => t.length > 2 && !CLASS_STOPWORDS.has(t));
}

/**
 * THE DETERMINISTIC CLASS RESOLUTION — zero AI. Exact key → exact label → token overlap.
 * A tie is returned as a tie; the caller refuses by listing it.
 */
export function resolveHeldClass(
  described: string,
): { ok: true; classKey: HeldClassId } | { ok: false; candidates: HeldClassId[] } {
  const raw = described.trim().toLowerCase();
  if (!raw) return { ok: false, candidates: [] };

  const exactKey = HELD_CLASS_ORDER.find((id) => id === raw || id.replace(/_/g, ' ') === raw);
  if (exactKey) return { ok: true, classKey: exactKey };

  const exactLabel = HELD_CLASS_ORDER.find((id) => HELD_CLASSES[id].label.toLowerCase() === raw);
  if (exactLabel) return { ok: true, classKey: exactLabel };

  const asked = new Set(tokensOf(raw));
  if (!asked.size) return { ok: false, candidates: [] };
  const hits = HELD_CLASS_ORDER.filter((id) => {
    const own = new Set([...tokensOf(id.replace(/_/g, ' ')), ...tokensOf(HELD_CLASSES[id].label)]);
    for (const t of asked) if (own.has(t)) return true;
    return false;
  });
  if (hits.length === 1) return { ok: true, classKey: hits[0] };
  return { ok: false, candidates: hits };
}

/** The list a refusal offers instead of a guess — the ledger's own labels, in the ledger's order. */
export function classListSentence(candidates?: HeldClassId[]): string {
  const ids = candidates?.length ? candidates : HELD_CLASS_ORDER;
  return ids.map((id) => `“${HELD_CLASSES[id].label}”`).join(', ');
}

/**
 * The one execution body. Returns the card's ref, or an honest line and nothing else. It NEVER
 * commits, and the only engine function it can reach is the preparer.
 */
export async function executePrepareBulkDeed(
  client: SupabaseClient,
  userId: string,
  args: { verb: string; group?: string | null; itemIds?: string[]; selfEmail?: string | null },
): Promise<PrepareBulkDeedOutcome> {
  const verb = String(args.verb ?? '').toLowerCase() as BulkVerb;
  if (!(BULK_VERBS as readonly string[]).includes(verb)) {
    return { ok: false, line: `I can archive, unsubscribe, trash or expire in bulk — “${String(args.verb)}” isn’t one of those.` };
  }

  let classKey: HeldClassId | null = null;
  const group = (args.group ?? '').trim();
  if (group) {
    const r = resolveHeldClass(group);
    if (!r.ok) {
      return {
        ok: false,
        line: r.candidates.length > 1
          ? `“${group}” could mean ${classListSentence(r.candidates)} — which one?`
          : `I’m not holding a group called “${group}”. The ones I have are ${classListSentence()}.`,
      };
    }
    classKey = r.classKey;
  } else if (!(args.itemIds ?? []).length) {
    return { ok: false, line: `Which group? I’m holding ${classListSentence()}.` };
  }

  // The engine, imported lazily so a chat surface never pulls the provider SDKs it does not use.
  const { prepareBulkDeed } = await import('@/lib/deeds/bulk');
  const res = await prepareBulkDeed(client, userId, {
    verb, classKey, itemIds: args.itemIds, selfEmail: args.selfEmail ?? null,
  });
  if (!res.ok) return { ok: false, line: res.error };
  return { ok: true, card: { id: res.deed.id, deed: res.deed }, line: bulkDeedCardLine(res.deed) };
}

/** The one line the producer speaks beside the card — the card carries every count itself. */
export function bulkDeedCardLine(deed: BulkDeed): string {
  if (deed.verb === 'unsubscribe') {
    const auto = (deed.breakdown.oneClick ?? 0) + (deed.breakdown.mailto ?? 0);
    const manual = deed.breakdown.needsClick ?? 0;
    if (auto && manual) return `I can unsubscribe from ${auto} of these on your behalf; ${manual} need a click from you. It’s all on the card.`;
    if (auto) return `I can unsubscribe from all ${auto} of these on your behalf — review it and it’s one click.`;
    return 'None of these can be unsubscribed automatically — the card lists the ones you’d have to click yourself.';
  }
  if (deed.verb === 'expire') {
    return `Here’s what closing those would do — each one is judged before it closes, so anything still genuinely owed stays open.`;
  }
  return `Here’s exactly what that would do. Review it and commit when it looks right.`;
}
