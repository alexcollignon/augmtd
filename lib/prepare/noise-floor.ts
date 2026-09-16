// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE NOISE FLOOR — "noise is never prepared, and a brief never obliges the misaddressed"
// (proactive-reach census fix #3; LAW 5's reach extended from the deck to the two seams that SPEND).
//
// WHY THIS EXISTS (found live, Sep 13 — the receipt-grammar census on the reference account):
//
//     135 live `prep:*` narrations. 35 of them anchored on the user's OWN outbound campaign coming
//     back — "Clara drafted the reply on 'Generic outreach email' — it's ready to review", "Clara
//     laid out the decision on 'Marketing outreach from …'". Three of those echoes were still
//     carrying a standing prepared draft, and five had been re-judged `reply`/`decide` THAT DAY.
//
// The receipt grammar was won at the template layer and lost here: the machine spoke like a
// colleague who finished something, and what it finished was work no colleague would have started.
//
// THE DIAGNOSIS — AND WHY THIS IS A SPEND FLOOR, NOT A SECOND JUDGE. The echo floor (LAW 5) had
// reached `classifyItem`, `isNeedsReply`, the notice law, the entity-source mapper and the deck —
// so those very items were already postured `fyi`/`hidden` and were NOT on the deck. They reached
// the prepare lanes anyway because the prepare pass builds its candidates from the SPINE
// (`buildWorkItems` → `partitionDailyReport`), a derivation that never passes through classifyItem.
// The judge then judged them on their merits — correctly, on the facts it is given: a human wrote a
// direct question, so `reply` is a defensible verdict. The judge was not wrong; it was asked.
//
// So this floor does NOT overrule a verdict and does not resolve, hide or re-posture anything:
//   • It is asked BEFORE the spend, exactly like the intake POVERTY GATE (a warm mailbox is never
//     interviewed and never billed) — the question is "is this worth an AI call", not "what is it".
//   • Judgment still belongs to the judge; lane entry still belongs to the deck floors; posture
//     still belongs to `classifyItem`. This module owns only the refusal to WORK on a row every one
//     of those laws has already put in the awareness lane.
//   • It reuses their predicates read-only (`isCampaignEcho`, `noticeIsDemoted`) — a fork here is
//     how the deck and the engine would come to disagree about what noise is.
//   • FAIL-OPEN everywhere: no signature, no row, a failed read → NOT noise. We decline to spend on
//     evidence or not at all (showing costs less than hiding; so does preparing).
//
// PURE-ADJACENT: one select, one day-cached signature read, zero AI.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { getCampaignSignature, isCampaignEcho, type CampaignSignature } from '@/lib/inbox/campaign-echo';
import { noticeIsDemoted, type DeckItem, type DeckFloors } from '@/lib/home/deck-floors';

export type NoiseVerdict = {
  noise: boolean;
  /** The honest sentence the caller reports/stores — the pass's `reason`, the room's PRESENT line. */
  reason: string | null;
  via: 'echo' | 'notice' | null;
};

export const NOT_NOISE: NoiseVerdict = { noise: false, reason: null, via: null };

/** THE PURE HALF — every fact handed in, so the gates can assert it without a database. */
export function noiseOf(item: DeckItem, sig?: CampaignSignature | null): NoiseVerdict {
  try {
    // A human decision on the row outranks the floor, at the top, as everywhere else (the pinning
    // law's spirit; `isCampaignEcho` short-circuits on the same field).
    if (item.type_override) return NOT_NOISE;
    const echo = isCampaignEcho(item as never, sig ?? null);
    if (echo) {
      return {
        noise: true, via: 'echo',
        reason: 'your own outbound campaign coming back — nothing prepared for it',
      };
    }
    // The deck's own notice law, asked with the judge deliberately OUT of it: `judgedNone` is empty
    // because the judge consult happens immediately after this floor and owns that question. What
    // is asked here is only the structural half — a misaddressed/bulk/no-move notice.
    const floors: DeckFloors = { judgedNone: new Set<string>(), isEcho: () => echo };
    if (noticeIsDemoted(item, floors)) {
      return {
        noise: true, via: 'notice',
        reason: 'a bulk/no-move notice — nothing is owed, so nothing is prepared',
      };
    }
    return NOT_NOISE;
  } catch {
    return NOT_NOISE; // the floor never breaks a preparation
  }
}

/**
 * THE ASYNC DOOR — "is this inbox row noise?", for the two seams that spend on it (the prepare
 * engine, the room composer). Commitments and meetings have no inbound subject and no sender, so
 * the floor is structurally inert for them: it answers only about `inbox` rows.
 */
export async function itemIsNoise(
  client: SupabaseClient, userId: string, itemId: string,
): Promise<NoiseVerdict> {
  try {
    const { data } = await client.from('inbox_items')
      .select('id, user_id, work_title, work_state, rule_type, type_override, source_data')
      .eq('id', itemId).eq('user_id', userId).maybeSingle();
    if (!data) return NOT_NOISE; // no row is not evidence of noise
    let sig: CampaignSignature | null = null;
    try { sig = await getCampaignSignature(client, userId); } catch { /* inert, never fabricated */ }
    return noiseOf(data as DeckItem, sig);
  } catch {
    return NOT_NOISE;
  }
}
