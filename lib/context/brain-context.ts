// UNIFIED READ-TIME CONTEXT (Step 2) — the single reader that folds the durable BRAIN (the entity
// registry: the person entity + the item's own linked work entity) into a compact prose block for any generative surface (the drafter first; brief /
// coworker chat later). This is the "context kept at the top" move: surfaces READ precomputed judgment
// instead of re-deriving it, so a draft/brief reasons WITH the relationship + where the deal stands.
//
// Read-only, cheap (two keyed lookups, NO AI, NO recompute). Returns '' when nothing is known — purely
// additive, never blocks the caller.

import type { SupabaseClient } from '@supabase/supabase-js';

const emailOf = (s?: string | null): string | null =>
  String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;

export type BrainContextOpts = {
  personEmail?: string | null;
  personName?: string | null;
  /** THE WIDER WORK comes from the item's OWN entity link (ONE BRAIN — identity, never a label
   *  match). Pass the item when known; a drafter that only holds `source_data` passes the thread
   *  id and the link is resolved through the thread's newest inbox row. `understanding.initiative`
   *  (a string the classifier guessed) is no longer accepted here — W2.2. */
  item?: { kind: 'inbox_item' | 'commitment' | 'meeting'; id: string } | null;
  threadId?: string | null;
};

/** The entity an item is filed under — read off `entity_links`, the registry's own edge. */
async function linkedEntityId(supabase: SupabaseClient, userId: string, opts: BrainContextOpts): Promise<string | null> {
  let link = opts.item ?? null;
  if (!link && opts.threadId) {
    const { data: it } = await supabase.from('inbox_items').select('id')
      .eq('user_id', userId).eq('source_data->>thread_id', String(opts.threadId))
      .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if (it?.id) link = { kind: 'inbox_item', id: String(it.id) };
  }
  if (!link) return null;
  const { data: el } = await supabase.from('entity_links').select('entity_id')
    .eq('user_id', userId).eq('item_kind', link.kind).eq('item_id', link.id).not('entity_id', 'is', null).maybeSingle();
  return (el?.entity_id as string) ?? null;
}

export async function renderBrainContext(supabase: SupabaseClient, userId: string, opts: BrainContextOpts): Promise<string> {
  const parts: string[] = [];

  // ── The PERSON — who they are to you + where you stand + how they write (so the draft matches).
  // THE PERSON ENTITY ONLY (One Brain cutover #4; W2.6 demolition): one row per human, alias-matched —
  // no per-address duplicates. The `person_state` fallback is gone: that table has had no writer since
  // July, so for a person the registry doesn't know it could only hand the drafter a months-old frozen
  // relationship as current. No entity → no WHO block (the honest absence). ──
  try {
    const email = emailOf(opts.personEmail);
    try {
      const { getPersonEntities, findPersonEntity } = await import('@/lib/entities/people');
      const pe = findPersonEntity(await getPersonEntities(supabase, userId), email, opts.personName ?? null);
      const s = pe?.state ?? null;
      if (s?.summary) {
        const p = [`[WHO YOU'RE WRITING TO — ${pe!.name}${s.relationship && s.relationship !== 'unknown' ? ` · ${s.relationship}` : ''}]`, `Where you stand: ${s.summary}`];
        if (s.whoOwes?.you?.length) p.push(`You owe them: ${s.whoOwes.you.join('; ')}`);
        if (s.whoOwes?.them?.length) p.push(`They owe you: ${s.whoOwes.them.join('; ')}`);
        if (s.style) p.push(`How they communicate (match this register): ${s.style}`);
        parts.push(p.join('\n'));
      }
    } catch { /* non-fatal */ }
  } catch { /* non-fatal */ }

  // ── The WIDER WORK this touches, so the reply fits the deal, not just the message. Resolved
  // through the item's ENTITY LINK (the memory already decided what this item is about) — never by
  // string-matching a classifier's initiative label against entity names. ──
  try {
    const entityId = await linkedEntityId(supabase, userId, opts);
    if (entityId) {
      const { data: hit } = await supabase.from('work_entities').select('name, state')
        .eq('id', entityId).eq('user_id', userId).eq('kind', 'initiative').maybeSingle();
      const st = (hit?.state ?? null) as { summary?: string; stage?: string | null } | null;
      if (hit?.name && st?.summary) {
        const p = [`[THE WIDER WORK — ${hit.name}]`, `Where it stands: ${st.summary}`];
        if (st.stage) p.push(`Stage: ${st.stage}`);
        parts.push(p.join('\n'));
      }
    }
  } catch { /* non-fatal */ }

  if (!parts.length) return '';
  return `[RELATIONSHIP & DEAL CONTEXT — what you already know about this person and this work; ground the reply in it, do NOT restate it verbatim]\n${parts.join('\n\n')}`;
}

// `renderWorldContext` (the coworker chat's private "your world" block) is GONE — W2.2 ONE USER
// GROUNDING: every user-scope consumer reads `assembleUserGrounding` (lib/room/user-grounding.ts).
