// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LEGACY ASK DETECTOR (owner walk, Sep 8 — the unfinished room)
//
// THE ASK SPEAKS CONSEQUENCE shipped (lib/prepare/requirements.ts `composeAskSpeech`) and gate T13.1
// proved the canned preamble was gone from every live seam. But an ask's text is DURABLE: turns
// written before that change still stand in real rooms, still speaking the template the law
// outlawed. The owner's room showed exactly one, months old, under a composed brief — the page
// saying two things at once, in two voices.
//
// A LAW THAT ONLY BINDS NEW WRITES IS HALF A LAW. So the serving door recomposes what it finds
// (app/api/room/turns — read the served turns, recompose the legacy ones in after(), serve the
// composed words on the next paint; never blocking, never blanking).
//
// THIS FILE IS THE ONLY PLACE THE OLD WORDS MAY APPEAR, and it is a MATCHER, never a template: it
// exports no text a writer could use. That is why gate T13.1 excepts this one path — the rule is
// still "no seam SAYS this", and recognising a sentence is not saying it.
//
// THE SET IS BOUNDED AND CLOSED. Three template literals ever existed (git: 27b21fe →
// lib/prepare/requirements.ts, lib/prepare/pass.ts), and all three end in the same clause. That
// clause is the marker: it is distinctive enough that a composed sentence cannot trip it (the
// composer is explicitly forbidden the word "everywhere" and the deterministic floor deliberately
// says "or tell me where to look" WITHOUT "attach below"), and every legacy rendering carries it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { readPlans } from '@/lib/store/item-plans';

/** The marker every retired ask template ends on — assembled from fragments so that no whole
 *  legacy sentence exists as a literal anywhere in the tree, not even here. */
const LEGACY_TAIL = ['attach', 'below', 'or', 'tell', 'me', 'where', 'to', 'look'].join('\\s+');
const LEGACY_ASK_RE = new RegExp(LEGACY_TAIL, 'i');

/**
 * Is this stored ask text the retired canned preamble (in any of its renderings)?
 * Conservative by construction: no match → leave the turn alone. A recompose costs a cheap AI call,
 * so a false positive would burn spend on a sentence that is already good; a false negative just
 * leaves an old turn reading as it always has.
 */
export function isLegacyAskSpeech(text: string | null | undefined): boolean {
  const t = String(text ?? '');
  if (!t.trim()) return false;
  return LEGACY_ASK_RE.test(t);
}

/** The shape the serving door hands over — exactly the fields readRoomTurns already carries. */
export type ServedAskTurn = {
  id?: string;
  role: 'user' | 'system';
  text: string;
  refs?: Array<{ label: string; href: string | null }> | undefined;
  component?: { key: string; refId?: string; state?: Record<string, unknown> } | null;
  key?: string;
};

/** How many stale asks one serve may repair. A room can only hold a handful of live asks, and the
 *  cap makes the spend of an old room's first open bounded and predictable. */
const REPAIR_CAP = 2;

/**
 * THE STALE ASK IS RE-SPOKEN (owner walk, Sep 8). Called from the ONE turn-serving door, in
 * `after()`: the paint already went out with whatever the room held, and the composed words land on
 * the next one. Never throws; a failure leaves the old turn exactly as it was.
 *
 * It reuses the ONE composer (`composeAskSpeech`) with the SAME facts its authoring seam had — the
 * judged labels verbatim off the turn's own component, the work title off the turn's own ref, and
 * the judged verb off the item's cached judgment — so a repaired ask is indistinguishable from one
 * authored today. The labels are never rewritten (they render verbatim in their rows).
 */
export async function recomposeLegacyAsks(
  client: SupabaseClient, userId: string, turns: ServedAskTurn[],
): Promise<number> {
  let repaired = 0;
  try {
    const stale = turns.filter((t) =>
      t.id && t.role === 'system' && t.component?.key === 'input_checklist'
      && Array.isArray(t.component.state?.items) && (t.component.state!.items as unknown[]).length > 0
      && isLegacyAskSpeech(t.text)).slice(0, REPAIR_CAP);
    if (!stale.length) return 0;
    const { composeAskSpeech } = await import('@/lib/prepare/requirements');
    for (const t of stale) {
      const labels = (t.component!.state!.items as unknown[]).map(String).filter(Boolean).slice(0, 5);
      const itemTitle = String(t.refs?.[0]?.label ?? '').trim();
      // The judged verb is the ask's CONSEQUENCE half. The turn's own dedupe key names the item
      // (`requires:<itemId>` — both authoring seams write it), and the judgment cache is keyed
      // `<kind>:<itemId>`; either kind may match, so both are asked for in one read.
      let work: string | null = null;
      const itemId = (t.key ?? '').startsWith('requires:') ? (t.key ?? '').slice('requires:'.length) : '';
      if (itemId) {
        const data = await readPlans(client, userId, 'judgment', { keys: [`inbox:${itemId}`, `commitment:${itemId}`], limit: 1 });
        const row = data[0] as { tasks?: { verdict?: { work?: string } } } | undefined;
        const v = row?.tasks?.verdict?.work;
        work = typeof v === 'string' ? v : null;
      }
      const say = await composeAskSpeech(client, userId, {
        labels, itemTitle: itemTitle || 'this work',
        work: (work ?? null) as never,
      });
      if (!say?.trim() || isLegacyAskSpeech(say)) continue; // never write the old words back
      const { error } = await client.from('room_turns').update({ text: say.trim() })
        .eq('id', t.id!).eq('user_id', userId);
      if (!error) repaired++;
    }
  } catch { /* the repair is an enhancement — the room still serves what it has */ }
  return repaired;
}
