// ONE BRAIN — PERSON ENTITY resolver (Phase C cutover #4). The consumers that read person_state (the
// per-email rows) resolve through the person ENTITY registry first: one row per human, matched by ALIAS
// (any address or name form) — which is what kills duplicate cards/cues for one person. person_state
// remains the fallback until demolition. Per-process cached (small per-user set, 60s TTL).

import type { SupabaseClient } from '@supabase/supabase-js';

export type PersonEntity = {
  id: string;
  name: string;
  aliases: string[];
  state: { self?: boolean; summary?: string; relationship?: string; momentum?: string; whoOwes?: { you: string[]; them: string[] }; cadence?: string | null; style?: string | null; last_touch?: { when: string | null; what: string; channel: string } | null } | null;
  nextTouch: { kind?: string; title?: string; reason?: string; entityRef?: string | null } | null;
  lastEventAt: string | null;
  /** Derived from last_event_at (the entity registry stores no quiet_days column). */
  quietDays: number | null;
};

const memo = new Map<string, { at: number; list: PersonEntity[] }>();
const TTL = 60_000;

const norm = (s: string) => s.toLowerCase().trim();

export async function getPersonEntities(supabase: SupabaseClient, userId: string): Promise<PersonEntity[]> {
  const c = memo.get(userId);
  if (c && Date.now() - c.at < TTL) return c.list;
  let list: PersonEntity[] = [];
  try {
    const { data } = await supabase.from('work_entities')
      .select('id, name, aliases, state, next_move, last_event_at')
      .eq('user_id', userId).eq('kind', 'person').eq('status', 'active').limit(500);
    const now = Date.now();
    list = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const lastEventAt = (r.last_event_at as string) ?? null;
      return {
        id: r.id as string, name: r.name as string,
        aliases: Array.isArray(r.aliases) ? (r.aliases as string[]).map(norm) : [],
        state: (r.state as PersonEntity['state']) ?? null,
        nextTouch: (r.next_move as PersonEntity['nextTouch']) ?? null,
        lastEventAt,
        quietDays: lastEventAt ? Math.max(0, Math.floor((now - new Date(lastEventAt).getTime()) / 86400000)) : null,
      };
    });
  } catch { /* pre-migration / non-fatal */ }
  memo.set(userId, { at: Date.now(), list });
  return list;
}

/** Split a raw "Name <email>" / bare-email / bare-name identity string into its forms. */
export function parseWho(raw: string | null | undefined): { email: string | null; name: string | null } {
  const s = String(raw ?? '').trim();
  if (!s) return { email: null, name: null };
  const m = s.match(/^(.*?)<([^>]+@[^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim() };
  if (s.includes('@') && !s.includes(' ')) return { email: s, name: null };
  return { email: null, name: s };
}

/** Resolve a raw identity string through the registry (orchestrated-loop O1) — the ONE identity
 *  answer every consumer reads: which human, is it the user, and their canonical name. */
export function resolveIdentity(list: PersonEntity[], raw: string | null | undefined): {
  person: PersonEntity | null; isSelf: boolean; canonical: string | null;
} {
  const { email, name } = parseWho(raw);
  const person = findPersonEntity(list, email, name);
  return { person, isSelf: person?.state?.self === true, canonical: person?.name ?? null };
}

/** Find the ONE human an email/name refers to — alias containment (the registry did the identity work). */
export function findPersonEntity(list: PersonEntity[], email?: string | null, name?: string | null): PersonEntity | null {
  const e = email ? norm(email) : null;
  const n = name ? norm(name) : null;
  for (const p of list) {
    if (e && (p.aliases.includes(e) || norm(p.name) === e)) return p;
  }
  if (n) for (const p of list) {
    if (norm(p.name) === n || p.aliases.includes(n)) return p;
  }
  return null;
}
