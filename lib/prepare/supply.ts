// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SUPPLY, ONCE (W4-B, Sep 22 — the type-it door).
//
// An ask names concrete missing things; a reader answers one by ATTACHING a file or, now, by TYPING
// the fact. Whichever door they use, the answer has to land the same way or the drafter reads two
// different worlds:
//
//   1. IT STAGES AS A HAVE, under the ONE requirement key — `require:<label>`. Every reader already
//      knows that key: `resolveRequirements` writes it when IT finds the artifact, the judge route
//      reads it to see what is already in hand, and `delegatePrepare` watches it to know the inputs
//      changed (ask-journey D3 — SUPPLY RE-OPENS THE WORK). The key was spelled out by hand in
//      three files; it is spelled here, once, so a typed supply and a resolved file are the same
//      fact to every one of them.
//   2. IT RE-OPENS THE WORK. The pool row alone re-runs a coworker's delegation (D3), but a REPLY
//      draft is stamped `generated_at` and would otherwise stand as the permanent answer, written
//      before the fact arrived. Dropping the stamp is what the rail's attach funnel has always
//      done; it lives here now so the typed door cannot drift from it.
//
// THE TEXT OF A FACT IS A DELIVERABLE (`type: 'text'`), not a file — that is the only honest
// difference between the two doors, and `renderPoolForContext` already inlines a text deliverable
// body verbatim, which is exactly what an IBAN or a reference number needs.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeDeliverable } from '@/lib/home/deliverable-pool';

/** The pool scope an item's requirements stage under. */
export type SupplyItemKind = 'inbox' | 'commitment';
const poolKindOf = (k: SupplyItemKind) => (k === 'commitment' ? 'commitment' as const : 'email' as const);

/** THE ONE REQUIREMENT KEY. Every writer and every reader of a staged requirement goes through it. */
export function requireTaskId(label: string): string {
  return `require:${String(label ?? '').toLowerCase().slice(0, 60)}`;
}

/** How long a typed fact may be. An IBAN, an address, a paragraph of context — not an essay. */
export const SUPPLY_TEXT_MAX = 2000;

/**
 * stageTypedSupply — the typed fact becomes the staged HAVE for its label. Same key, same item
 * scope, same `metadata.requirement` as the resolver's own staging, so `artifactTruth`, the judge
 * route and the D3 re-open read it identically to a file that was found.
 */
export async function stageTypedSupply(
  client: SupabaseClient, userId: string,
  args: { itemKind: SupplyItemKind; itemId: string; label: string; text: string },
): Promise<boolean> {
  const row = await writeDeliverable(client, userId, {
    kind: poolKindOf(args.itemKind),
    entityId: args.itemId,
    taskId: requireTaskId(args.label),
    type: 'text',
    title: args.label.slice(0, 100),
    content: args.text.slice(0, SUPPLY_TEXT_MAX),
    gist: `supplied for: ${args.label}`.slice(0, 120),
    metadata: {
      source: 'requirement_resolution',
      requirement: args.label,
      via: 'typed_supply',
      supplied_at: new Date().toISOString(),
    },
  });
  return !!row;
}

/**
 * reopenAfterSupply — an input landed, so the work prepared WITHOUT it is no longer the answer.
 * Dropping the reply draft's `generated_at` is THE SUPPLY SIGNAL the pass's one decision reads
 * (lib/prepare/hand.ts `decideRegeneration` · `supplyMoved` — W9.1: there is no freshness clock any
 * more; a draft the USER EDITED is marked, never replaced, by this signal); the coworker lane
 * re-opens on the pool row itself (delegatePrepare's require:* check). Non-fatal by construction:
 * the supply is already durable, and a failed re-open costs a pass, never the user's input.
 */
export async function reopenAfterSupply(
  client: SupabaseClient, userId: string,
  args: { itemKind: SupplyItemKind; itemId: string },
): Promise<void> {
  if (args.itemKind !== 'inbox') return; // a commitment carries no stamped reply draft
  try {
    const { data: itRow } = await client.from('inbox_items').select('id, source_data')
      .eq('id', args.itemId).eq('user_id', userId).maybeSingle();
    const isd = (itRow?.source_data ?? {}) as Record<string, unknown>;
    const dr = isd.draft as Record<string, unknown> | undefined;
    if (itRow && dr?.generated_at) {
      await client.from('inbox_items')
        .update({ source_data: { ...isd, draft: { ...dr, generated_at: undefined } } })
        .eq('id', itRow.id);
    }
  } catch { /* non-fatal — the supply is already in the pool */ }
}
