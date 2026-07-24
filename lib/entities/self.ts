// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SELF ENTITY (orchestrated-loop O1a, docs/orchestrated-loop-plan.md) — the user IS a person in
// the ONE registry. Every form the user appears as — profile name, login email, connected-mailbox
// addresses, and the from-names on their OWN sent mail ("Alex Collignon <alex@…>" when the profile
// says "Alexandre Collignon") — accumulates as aliases on one `work_entities kind='person'` row
// marked `state.self = true`.
//
// The evidence is STRUCTURAL, never a nickname heuristic: a name observed as the from-name of mail
// sent from the user's own address IS the user (a fact); a merely-similar name never observed on
// own mail is NOT added (no guessing). Downstream, nothing string-matches identity anymore — the
// spine, the extractor, and the Preparation Pass resolve through the registry (lib/entities/people.ts
// findPersonEntity) and ask "does this resolve to the self entity?".
//
// Idempotent + cheap: derives the alias set, writes only on change. Called by the ambient
// Preparation Pass (2h refresh) and the heal sweep; safe anywhere.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

const norm = (s: string) => s.toLowerCase().trim();

export type SelfEntity = { id: string; name: string; aliases: string[] };

/** Every identity form the user provably appears as — all structural facts. */
async function deriveSelfForms(supabase: SupabaseClient, userId: string): Promise<{ name: string; aliases: string[] }> {
  const aliases = new Set<string>();
  const add = (s: string | null | undefined) => { const t = norm(String(s ?? '')); if (t) aliases.add(t); };

  const [{ data: prof }, { data: conns }, { data: sent }] = await Promise.all([
    supabase.from('profiles').select('email, full_name').eq('id', userId).maybeSingle(),
    supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
    // From-forms on the user's OWN sent mail — the self-evidence that catches nickname forms.
    supabase.from('emails').select('from_name, from_address').eq('user_id', userId).eq('is_from_user', true).limit(500),
  ]);
  add(prof?.email); add(prof?.full_name);
  for (const c of (conns ?? []) as Array<Record<string, unknown>>) {
    add(((c.metadata as { email?: string } | null)?.email) || (c.provider_account_id as string));
  }
  for (const e of (sent ?? []) as Array<{ from_name: string | null; from_address: string | null }>) {
    add(e.from_name); add(e.from_address);
  }
  return { name: String(prof?.full_name || prof?.email || 'You'), aliases: [...aliases] };
}

/** Find-or-create the user's own person entity and accumulate its aliases. Returns the row (or null
 *  on failure — non-fatal by design; consumers degrade to their structural email floor). */
export async function ensureSelfEntity(supabase: SupabaseClient, userId: string): Promise<SelfEntity | null> {
  try {
    const { name, aliases } = await deriveSelfForms(supabase, userId);
    if (!aliases.length) return null;

    // The marked row first; else an existing person entity that IS the user (matched on any derived
    // form — e.g. one accidentally minted from the user's alt address) gets ADOPTED as self, so one
    // human never has two rows.
    const { data: persons } = await supabase.from('work_entities')
      .select('id, name, aliases, state').eq('user_id', userId).eq('kind', 'person').eq('status', 'active').limit(500);
    const rows = (persons ?? []) as Array<{ id: string; name: string; aliases: unknown; state: Record<string, unknown> | null }>;
    const formSet = new Set(aliases);
    const existing =
      rows.find((r) => (r.state as { self?: boolean } | null)?.self === true)
      ?? rows.find((r) => formSet.has(norm(r.name)) || (Array.isArray(r.aliases) && (r.aliases as string[]).some((a) => formSet.has(norm(a)))));

    if (!existing) {
      const { data: inserted } = await supabase.from('work_entities')
        .insert({ user_id: userId, kind: 'person', name, aliases, state: { self: true }, status: 'active' })
        .select('id').maybeSingle();
      return inserted ? { id: inserted.id as string, name, aliases } : null;
    }

    const priorAliases = (Array.isArray(existing.aliases) ? (existing.aliases as string[]) : []).map(norm);
    const merged = [...new Set([...priorAliases, ...aliases])];
    const state = { ...(existing.state ?? {}), self: true };
    const changed = merged.length !== priorAliases.length || (existing.state as { self?: boolean } | null)?.self !== true;
    if (changed) {
      await supabase.from('work_entities').update({ aliases: merged, state }).eq('id', existing.id).eq('user_id', userId);
    }
    return { id: existing.id, name: existing.name, aliases: merged };
  } catch { return null; }
}
