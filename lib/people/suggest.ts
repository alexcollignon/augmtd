// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PEOPLE RESOLUTION — ONE lookup, every door.
//
// Born as the body of `GET /api/people/suggest` (the typeahead, Aug 4). The card contract's
// must-refuse ("never an attendee outside the room's people without the user's word") needs the
// SAME grounded source server-side, so a chat-born invite can turn "with Sam" into a real address
// without inventing one — and a second copy of this query is how the typeahead and the preparer
// would start disagreeing about who exists.
//
// Sources, in order: the relationship graph (who the user actually corresponds with, ranked by
// importance) topped up from real received mail. Robots are never people.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export type SuggestedPerson = { email: string; name: string | null };

const ROBOT_RE = /no-?reply|notification|mailer|donotreply/i;

/** The typeahead's own read. `q` is a free-text fragment (name or address); ≥2 chars or nothing. */
export async function suggestPeople(
  client: SupabaseClient, userId: string, rawQuery: string, limit = 6,
): Promise<SuggestedPerson[]> {
  // Strip PostgREST or()-syntax breakers (, ( )) and the broad % wildcard — a pasted
  // "Doe (Acme)" or "smith, jones" must degrade to a working prefix search, never a 400
  // that silently kills the lookup. `_` stays (legit in emails; a benign 1-char wildcard).
  const q = (rawQuery ?? '').replace(/[,()%]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (q.length < 2) return [];
  const seen = new Map<string, SuggestedPerson>();
  try {
    // 1 — the relationship graph: who this user actually corresponds with, ranked.
    const { data: rel } = await client.from('relationship_graph')
      .select('contact_email, contact_name, importance')
      .eq('user_id', userId)
      .or(`contact_email.ilike.%${q}%,contact_name.ilike.%${q}%`)
      .order('importance', { ascending: false, nullsFirst: false })
      .limit(limit);
    for (const r of rel ?? []) {
      const email = String(r.contact_email ?? '').toLowerCase();
      if (email && !seen.has(email)) seen.set(email, { email, name: (r.contact_name as string) ?? null });
    }
    // 2 — top-up from real mail (covers contacts the graph hasn't scored yet).
    if (seen.size < limit) {
      const { data: mails } = await client.from('emails')
        .select('from_address, from_name')
        .eq('user_id', userId)
        .or(`from_address.ilike.%${q}%,from_name.ilike.%${q}%`)
        .order('received_at', { ascending: false })
        .limit(25);
      for (const m of mails ?? []) {
        const email = String(m.from_address ?? '').toLowerCase();
        if (!email || seen.has(email)) continue;
        if (ROBOT_RE.test(email)) continue; // robots aren't people
        seen.set(email, { email, name: (m.from_name as string) ?? null });
        if (seen.size >= limit) break;
      }
    }
  } catch { /* the lookup is grounding, never a blocker — an empty result refuses honestly */ }
  return [...seen.values()].slice(0, limit);
}

/**
 * resolvePersonEmail — a NAME the user spoke → one real address, or nothing.
 *
 * AMBIGUITY IS A REFUSAL (the house law, from the workflow member resolver): two people answering
 * to "Sam" means the invite gets NEITHER — the card asks instead of guessing which human to mail.
 * A single distinct address wins even when several rows share it (one person, two spellings).
 */
export async function resolvePersonEmail(
  client: SupabaseClient, userId: string, name: string,
): Promise<string | null> {
  const n = (name ?? '').trim();
  if (n.length < 2 || n.includes('@')) return null;
  const hits = await suggestPeople(client, userId, n, 6);
  const distinct = [...new Set(hits.map((h) => h.email.toLowerCase()))];
  if (distinct.length === 1) return distinct[0];
  if (!distinct.length) return null;
  // Several candidates: an EXACT name match (a full name the user typed) still resolves; anything
  // fuzzier refuses.
  const exact = [...new Set(hits.filter((h) => (h.name ?? '').trim().toLowerCase() === n.toLowerCase())
    .map((h) => h.email.toLowerCase()))];
  return exact.length === 1 ? exact[0] : null;
}
