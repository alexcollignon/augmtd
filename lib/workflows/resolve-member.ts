// ════════════════════════════════════════════════════════════════════════════════════════════════
// NAMES ARE THE MODEL'S JOB, IDS ARE CODE'S (processes arc Phase B — the handoff contract).
//
// A generated `handoff` step carries the person AS THE REQUEST NAMES THEM ("Jordan approves the
// shortlist"). The model never emits an assignee_user_id — a hallucinated uuid is an unauthorized
// gate. This module is the ONE place a spoken name becomes a workspace member id.
//
// THE LADDER (strictest first, stop at the first tier that yields EXACTLY ONE person):
//   1. exact full-name match (case/whitespace-insensitive)
//   2. unique first-name match
//   3. unique distinctive-token containment (any name token, ≥3 chars, matching a member's tokens
//      or their email localpart)
// AMBIGUITY IS A REFUSAL: two Sams → null. No match → null. We never guess who holds a gate —
// the unresolved step keeps an empty assignee and the surfaces ask the human to pick.
//
// The member read mirrors /api/meetings/teammates: company_members → user_ids, THEN profiles as a
// second query (FK-join aliases are unreliable here — house lore). Never throws.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createAdmin } from '@supabase/supabase-js';

export interface ResolvedMember {
  userId: string;
  /** The ROSTER's spelling — the canonical name the step stores, not the request's rendering. */
  name: string;
  email: string;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
const tokens = (s: string): string[] => norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 3);

/** Every active member of the user's active company, INCLUDING the user themself (a request may
 *  legitimately name the requester as a reviewer of a later stage). Empty on any failure. */
export async function listWorkspaceMembers(
  supabase: SupabaseClient, userId: string,
): Promise<ResolvedMember[]> {
  try {
    const { data: membership } = await supabase
      .from('company_members')
      .select('company_id, joined_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      // THE DETERMINISTIC WORKSPACE (found by H15, Aug 19): unordered limit(1) handed a
      // two-workspace user an ARBITRARY roster (~1 run in 3 on the probe) — "Jordan approves it"
      // could resolve against the wrong company's people, silently. Oldest active membership =
      // the primary workspace, every read, every time. (Column is joined_at — the silent-column
      // trap bit here first: ordering by a non-existent created_at errored into an empty roster.)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const companyId = (membership as { company_id?: string } | null)?.company_id;
    if (!companyId) return [];

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const admin = url && key ? createAdmin(url, key) : supabase;

    const { data: members } = await admin
      .from('company_members')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('status', 'active');
    const userIds = [...new Set(((members ?? []) as Array<{ user_id: string }>).map(m => m.user_id).filter(Boolean))];
    if (!userIds.length) return [];

    const { data: profiles } = await admin
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);

    return ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>)
      .map(p => ({
        userId: p.id,
        name: (p.full_name ?? '').trim() || (p.email ?? '').split('@')[0] || 'Teammate',
        email: p.email ?? '',
      }))
      .filter(m => !!m.userId);
  } catch {
    return [];
  }
}

/** THE MATCHER, over an already-read roster (pure — testable, and one read serves N handoffs). */
export function matchMemberByName(members: ResolvedMember[], rawName: string): ResolvedMember | null {
  const name = norm(rawName ?? '');
  if (!name || !members.length) return null;

  // (1) exact full name
  const exact = members.filter(m => norm(m.name) === name);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // two identically-named people — never guess

  // (2) unique first name — ONLY when the spoken name IS a bare first name (found by H15,
  // Aug 19: "Sam Stone" resolved to Sam Lee here on its first token alone, skipping tier 3's
  // every-token law entirely — a FULL name must resolve on full evidence or refuse).
  const spoken = name.split(' ').filter(Boolean);
  if (spoken.length === 1) {
    const byFirst = members.filter(m => norm(m.name).split(' ')[0] === spoken[0]);
    if (byFirst.length === 1) return byFirst[0];
    if (byFirst.length > 1) return null; // two Sams — ambiguous, refuse
  }

  // (3) unique distinctive-token containment (handles "Sam from legal", "Dr. Jordan Lee").
  // THE CONFIDENT-WRONG FLOOR (found by H15, Aug 19): a PARTIAL hit on a multi-token name must
  // never authorize — "Sam Lee" sharing only "lee" with member "Lee Chan" is a DIFFERENT human,
  // and assigning them the gate silently is the exact failure this module's header forbids.
  // A multi-token spoken name resolves here only when EVERY one of its tokens lands on the same
  // member; a single-token name keeps unique-containment. Anything less is a refusal — the
  // unresolved path (empty assignee + the pick-in-Studio note) is honest and well-served.
  const want = tokens(name);
  if (!want.length) return null;
  const byToken = members.filter(m => {
    const have = new Set([...tokens(m.name), ...tokens((m.email ?? '').split('@')[0])]);
    return want.length > 1 ? want.every(t => have.has(t)) : want.some(t => have.has(t));
  });
  return byToken.length === 1 ? byToken[0] : null;
}

/** THE ONE DOOR: a spoken name → a workspace member, or null (no match OR ambiguous). */
export async function resolveMemberByName(
  supabase: SupabaseClient, userId: string, name: string,
): Promise<ResolvedMember | null> {
  if (!name?.trim()) return null;
  const members = await listWorkspaceMembers(supabase, userId);
  return matchMemberByName(members, name);
}
