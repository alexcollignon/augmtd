// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE BRAIN — MEMBERSHIP RECONCILE. When an item moves between entities (a manual meeting/commitment/email
// move, an attach/detach, a lifecycle change that empties an entity), BOTH the source and destination
// change — so both must re-reason, and everything derived from membership must reconcile. This is the
// single place that keeps entities honest after any membership change:
//   • RE-REASON   — refreshEntityState (summary/momentum/next-move/priority), sig-gated (runs iff changed)
//   • IDENTITY    — recompute the entity's PEOPLE fingerprint from its CURRENT links (recognition reads it)
//   • CATEGORY    — re-ground (domain-aware) since the people set changed
//   • LIFECYCLE   — an entity emptied to zero real members is auto-archived (no ghost projects)
// Non-fatal throughout; safe to fire-and-forget from an API tail.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { refreshEntityState } from '@/lib/entities/state';
import { personForms } from '@/lib/entities/recognize';

const FREE = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com', 'proton.me', 'protonmail.com', 'aol.com']);
const domainOf = (e: string) => (e.includes('@') ? e.split('@')[1].toLowerCase() : '');
const CATS = ['client', 'internal', 'personal', 'admin'];

/** The user's OWN corporate domains (login + connected mailboxes, minus free providers) → "internal". */
async function ownDomains(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const [{ data: prof }, { data: conns }] = await Promise.all([
      supabase.from('profiles').select('email').eq('id', userId).maybeSingle(),
      supabase.from('connections').select('provider_account_id, metadata').eq('user_id', userId),
    ]);
    const pd = domainOf(((prof as { email?: string } | null)?.email) || ''); if (pd && !FREE.has(pd)) out.add(pd);
    for (const c of (conns ?? []) as Array<{ provider_account_id?: string; metadata?: { email?: string } }>) {
      const d = domainOf(c.metadata?.email || c.provider_account_id || ''); if (d && !FREE.has(d)) out.add(d);
    }
  } catch { /* non-fatal */ }
  return out;
}

/** Gather an entity's people (+ their domains) from its CURRENT links — the identity signal. Tokens
 *  carry EVERY form (name + full email + "@domain" via personForms) so recall matches whichever form a
 *  later item arrives in — the fragmentation fix's fingerprint half. */
async function peopleOf(supabase: SupabaseClient, userId: string, entityId: string): Promise<{ people: string[]; domains: Set<string>; linkCount: number }> {
  const people = new Set<string>(); const domains = new Set<string>();
  const { data: links } = await supabase.from('entity_links').select('item_kind, item_id')
    .eq('user_id', userId).eq('entity_id', entityId).neq('item_kind', 'email_thread');
  const rows = (links ?? []) as Array<{ item_kind: string; item_id: string }>;
  const by = (k: string) => rows.filter((l) => l.item_kind === k).map((l) => l.item_id);
  const add = (p?: string | null) => { if (!p) return; for (const f of personForms(p)) people.add(f); };
  const inbox = by('inbox_item');
  if (inbox.length) { const { data } = await supabase.from('inbox_items').select('id, source_data').in('id', inbox.slice(0, 400)); for (const r of (data ?? []) as Array<{ source_data?: { from_name?: string; from_address?: string } }>) { const nm = r.source_data?.from_name || ''; const ad = r.source_data?.from_address || ''; add(nm && ad ? `${nm} <${ad}>` : (nm || ad)); const d = domainOf(ad); if (d) domains.add(d); } }
  const commits = by('commitment');
  if (commits.length) { const { data } = await supabase.from('commitments').select('id, counterparty').in('id', commits.slice(0, 400)); for (const r of (data ?? []) as Array<{ counterparty?: string }>) add(r.counterparty); }
  const mtgs = by('meeting');
  if (mtgs.length) { const { data } = await supabase.from('meeting_transcripts').select('id, attendees').in('id', mtgs.slice(0, 100)); for (const r of (data ?? []) as Array<{ attendees?: unknown }>) { const att = Array.isArray(r.attendees) ? r.attendees : []; for (const a of att.slice(0, 8)) { const o = a as { name?: string; email?: string }; add(typeof a === 'string' ? a : (o?.name && o?.email ? `${o.name} <${o.email}>` : (o?.name || o?.email))); } } }
  const cals = by('calendar_event');
  if (cals.length) { const { data } = await supabase.from('calendar_events').select('id, attendees').in('id', cals.slice(0, 100)); for (const r of (data ?? []) as Array<{ attendees?: unknown }>) { const att = Array.isArray(r.attendees) ? r.attendees : []; for (const a of att.slice(0, 8)) { const o = a as { name?: string; email?: string }; add(typeof a === 'string' ? a : (o?.name && o?.email ? `${o.name} <${o.email}>` : (o?.name || o?.email))); } } }
  return { people: [...people].slice(0, 40), domains, linkCount: rows.length };
}

/** LIGHT fingerprint refresh (no AI): recompute every active initiative's people tokens from its current
 *  links. Cron-called so pre-existing fingerprints (name-form-only, old normalization) converge to the
 *  multi-form tokens recall now matches on. Capped + non-fatal per entity. */
export async function refreshPeopleFingerprints(supabase: SupabaseClient, userId: string, cap = 150): Promise<number> {
  let updated = 0;
  try {
    const { data: ents } = await supabase.from('work_entities').select('id, people')
      .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(cap);
    for (const e of (ents ?? []) as Array<{ id: string; people?: unknown }>) {
      try {
        const { people, linkCount } = await peopleOf(supabase, userId, e.id);
        if (!linkCount) continue; // orphan — the archive sweep handles it
        const cur = Array.isArray(e.people) ? (e.people as string[]) : [];
        if (people.length && (people.length !== cur.length || people.some((p) => !cur.includes(p)))) {
          await supabase.from('work_entities').update({ people }).eq('id', e.id).eq('user_id', userId);
          updated++;
        }
      } catch { /* per-entity non-fatal */ }
    }
  } catch { /* non-fatal */ }
  return updated;
}

/** ORPHAN sweep: an ACTIVE initiative with zero links that has sat empty for days is a ghost (founded
 *  and never joined, or emptied outside the reconcile path) — archive it (reversible). A user-pinned
 *  (tracked) entity is never touched: pinning is a human decision that outranks the machine. */
export async function archiveOrphanEntities(supabase: SupabaseClient, userId: string, olderThanDays = 3): Promise<number> {
  let archived = 0;
  try {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const { data: ents } = await supabase.from('work_entities').select('id, tracked, created_at')
      .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').lt('created_at', cutoff).limit(300);
    for (const e of (ents ?? []) as Array<{ id: string; tracked?: boolean }>) {
      if (e.tracked) continue;
      const { count } = await supabase.from('entity_links').select('item_id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('entity_id', e.id);
      if ((count ?? 0) === 0) {
        await supabase.from('work_entities').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', e.id).eq('user_id', userId);
        archived++;
      }
    }
  } catch { /* non-fatal */ }
  return archived;
}

/** Grounded category (fact constrains judgment): an external-company person ⇒ NOT internal. */
async function groundedCategory(supabase: SupabaseClient, userId: string, entity: { id: string; name: string; summary: string | null }, people: string[], domains: Set<string>, own: Set<string>): Promise<string | null> {
  const hasInternal = [...domains].some((d) => own.has(d));
  const hasExternal = [...domains].some((d) => d && !own.has(d) && !FREE.has(d));
  const allowed = hasExternal ? ['client', 'personal', 'admin'] : hasInternal ? ['internal', 'admin', 'client'] : ['personal', 'admin', 'internal'];
  try {
    const res = await aiCall<{ category?: string }>({
      userId, supabase, shape: { output: 'json' }, temperature: 0, maxTokens: 40, source: 'brain_synthesis',
      prompt: `Classify this body of work into ONE category. Choose ONLY from: ${allowed.join(', ')}.\n` +
        `Name: ${entity.name}\nWhere it stands: ${entity.summary ?? ''}\nPeople: ${people.join(', ') || '(none)'}\n` +
        `${hasExternal ? 'Includes EXTERNAL-company people (so NOT internal). ' : ''}${hasInternal ? 'Includes the users OWN-company colleagues. ' : ''}\n` +
        `"client" = external client/deal (you do business FOR/WITH them). "internal" = the owners own org/team/hiring/ops. ` +
        `"personal" = personal life / a service YOU consume (even from an external company). "admin" = a vendor/tool/SaaS/subscription/automated account.\n` +
        `JSON only: {"category":"${allowed.join('|')}"}`,
    });
    return CATS.includes(res.json?.category as string) ? res.json!.category! : allowed[0];
  } catch { return null; }
}

/** Reconcile a set of entities after their membership changed. Fire-and-forget from an API tail. */
export async function reconcileEntities(supabase: SupabaseClient, userId: string, entityIds: Array<string | null | undefined>): Promise<void> {
  const ids = [...new Set(entityIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  const own = await ownDomains(supabase, userId);
  for (const id of ids) {
    try {
      const { people, domains, linkCount } = await peopleOf(supabase, userId, id);
      // LIFECYCLE — an entity emptied to zero members becomes a ghost; archive it (reversible), skip the rest.
      // THE PINNING LAW (July 29, found live): a TRACKED entity is a human decision that outranks
      // the machine — a user-created project awaiting its work is never a ghost. Same guard the
      // orphan sweep always had; every auto-archive door carries it.
      if (linkCount === 0) {
        const { data: pin } = await supabase.from('work_entities').select('tracked').eq('id', id).eq('user_id', userId).maybeSingle();
        if (!pin?.tracked) {
          await supabase.from('work_entities').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId);
          continue;
        }
      }
      // IDENTITY — the people fingerprint recognition reads (recomputed from CURRENT links, not additive).
      await supabase.from('work_entities').update({ people }).eq('id', id).eq('user_id', userId).then(() => {}, () => {});
      // RE-REASON — state (sig-gated) + re-grounded category (the people set changed).
      await refreshEntityState(supabase, userId, id).catch(() => {});
      const { data: ent } = await supabase.from('work_entities').select('id, name, summary, state').eq('id', id).eq('user_id', userId).maybeSingle();
      if (ent) {
        const cat = await groundedCategory(supabase, userId, { id: ent.id as string, name: ent.name as string, summary: (ent.summary as string) ?? null }, people, domains, own);
        if (cat) { const st = ((ent.state ?? {}) as Record<string, unknown>); await supabase.from('work_entities').update({ state: { ...st, category: cat } }).eq('id', id).eq('user_id', userId).then(() => {}, () => {}); }
      }
    } catch { /* per-entity non-fatal */ }
  }
}
