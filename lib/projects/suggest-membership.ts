// The "Suggested" tier of project membership — the MIDDLE of Prepared(auto) → Suggested(one-click) →
// Awareness(manual). The strict magnet (associate.ts) auto-attaches only CONFIDENT matches; this surfaces
// the plausible-but-not-confident ones as one-click suggestions the user accepts (→ a sticky manual attach)
// or ignores. Two signals, both read-only (NO commit):
//   1. GENEROUS initiative match — a loose atom whose `initiative` matches a project name generously
//      (whole-token containment either way) but NOT strictly (so the magnet skipped it). "Aspire" ← "Genpact
//      Aspire".
//   2. MEETING person-bridge — a loose meeting the exactly-one gate left initiative-less: resolve its
//      attendees (its commitments' counterparties) to their known initiatives; if any matches a project,
//      suggest it ("an attendee is tied to <project>"). This is where ambiguous/group meetings get a home.
//
// Only LOOSE + UNLOCKED atoms are eligible (project_id IS NULL AND project_locked = false) — a human's
// decision (attach/detach) is never re-suggested. Nothing here mutates; accepting a suggestion calls the
// existing PATCH /api/items/project (which locks it).

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeInitiative, coerceUnderstanding } from '@/lib/inbox/item-understanding';
import { initiativeKeyMatch } from './associate';
import { getInitiativeCandidates } from '@/lib/inbox/initiative-candidates';

export type MembershipSuggestion = {
  kind: 'inbox' | 'commitment' | 'meeting';
  id: string;
  title: string;
  reason: string; // short "why we think so"
};

const FREE_EMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com', 'yandex.com', 'pm.me', 'hey.com']);
// The user's OWN company token(s) — the second-level label of their corporate domain(s) (augmtd.ai → "augmtd").
// Too broad to base a suggestion on: "AUGMTD" would match every augmtd-labeled item. Derived per-user, agnostic.
async function companyTokens(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const toks = new Set<string>();
  try {
    const [{ data: prof }, { data: conns }] = await Promise.all([
      supabase.from('profiles').select('email').eq('id', userId).maybeSingle(),
      supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
    ]);
    const addrs = [prof?.email as string | undefined, ...((conns ?? []) as Array<Record<string, unknown>>).map((c) => ((c.metadata as { email?: string } | null)?.email) || (c.provider_account_id as string))];
    for (const a of addrs) {
      const dom = String(a || '').toLowerCase().split('@')[1];
      if (!dom || FREE_EMAIL_DOMAINS.has(dom)) continue;
      const sld = dom.split('.').slice(-2, -1)[0]; // "augmtd" from "augmtd.ai"
      if (sld && sld.length >= 3) toks.add(sld);
    }
  } catch { /* degrade to no company tokens */ }
  return toks;
}
const tokensOf = (k: string | null) => new Set((k || '').split(' ').filter(Boolean));
// The overlap between two keys must include a DISTINCTIVE (≥3-char, non-company) shared token — otherwise a
// single broad token (the user's company name) drives a bogus suggestion.
function distinctiveOverlap(projKey: string | null, itemKey: string | null, company: Set<string>): boolean {
  const it = tokensOf(itemKey);
  return [...tokensOf(projKey)].some((t) => it.has(t) && t.length >= 3 && !company.has(t));
}
// Generous match the STRICT magnet would NOT already take (else it'd auto-attach) + a distinctive overlap.
function generousOnly(projKey: string | null, itemKey: string | null, company: Set<string>): boolean {
  if (!projKey || !itemKey) return false;
  if (!(initiativeKeyMatch(projKey, itemKey, false) && !initiativeKeyMatch(projKey, itemKey, true))) return false;
  return distinctiveOverlap(projKey, itemKey, company);
}

export async function suggestProjectMembership(
  supabase: SupabaseClient,
  userId: string,
  projects: Array<{ id: string; name: string }>,
): Promise<Record<string, MembershipSuggestion[]>> {
  const keyed = projects.map((p) => ({ id: p.id, name: p.name, key: normalizeInitiative(p.name) })).filter((p) => p.key && p.key.length >= 3);
  if (!keyed.length) return {};
  const out: Record<string, MembershipSuggestion[]> = {};
  const push = (pid: string, s: MembershipSuggestion) => { (out[pid] ??= []).push(s); };
  const seen = new Set<string>(); // pid:kind:id — one suggestion per (project, atom)
  const company = await companyTokens(supabase, userId);

  try {
    const [inboxRes, comRes, mtgRes] = await Promise.all([
      supabase.from('inbox_items').select('id, work_title, source_data').eq('user_id', userId).eq('source', 'email').eq('status', 'pending').is('project_id', null).eq('project_locked', false).limit(1000),
      supabase.from('commitments').select('id, description, initiative, counterparty').eq('user_id', userId).in('status', ['open', 'pending']).is('project_id', null).eq('project_locked', false).limit(500),
      supabase.from('meeting_transcripts').select('id, title, initiative').eq('user_id', userId).is('project_id', null).eq('project_locked', false).limit(300),
    ]);

    // 1 — generous-but-not-strict initiative matches (emails, commitments, meetings-with-a-label).
    for (const it of (inboxRes.data ?? []) as Array<{ id: string; work_title: string | null; source_data: Record<string, unknown> }>) {
      const ik = normalizeInitiative(coerceUnderstanding((it.source_data ?? {}).understanding)?.initiative);
      for (const p of keyed) if (generousOnly(p.key, ik, company)) { const k = `${p.id}:inbox:${it.id}`; if (!seen.has(k)) { seen.add(k); push(p.id, { kind: 'inbox', id: it.id, title: it.work_title || 'Email', reason: 'related to this deal' }); } }
    }
    for (const c of (comRes.data ?? []) as Array<{ id: string; description: string | null; initiative: string | null }>) {
      const ik = normalizeInitiative(c.initiative);
      for (const p of keyed) if (generousOnly(p.key, ik, company)) { const k = `${p.id}:commitment:${c.id}`; if (!seen.has(k)) { seen.add(k); push(p.id, { kind: 'commitment', id: c.id, title: c.description || 'Commitment', reason: 'related to this deal' }); } }
    }
    const mtgs = (mtgRes.data ?? []) as Array<{ id: string; title: string | null; initiative: string | null }>;
    for (const m of mtgs) {
      if (!m.initiative) continue;
      const ik = normalizeInitiative(m.initiative);
      for (const p of keyed) if (generousOnly(p.key, ik, company)) { const k = `${p.id}:meeting:${m.id}`; if (!seen.has(k)) { seen.add(k); push(p.id, { kind: 'meeting', id: m.id, title: m.title || 'Meeting', reason: 'related to this deal' }); } }
    }

    // 2 — meeting person-bridge: a loose, initiative-LESS meeting whose attendees (its commitments'
    // counterparties) are known to belong to a project's initiative. Bounded to a handful of such meetings.
    const looseMtgs = mtgs.filter((m) => !m.initiative).slice(0, 40);
    for (const m of looseMtgs) {
      const { data: coms } = await supabase.from('commitments').select('counterparty').eq('user_id', userId).eq('source', 'meeting').eq('source_id', m.id);
      const names = [...new Set((coms ?? []).map((c: { counterparty: string | null }) => c.counterparty).filter(Boolean))] as string[];
      if (!names.length) continue;
      const { canonical, candidates } = await getInitiativeCandidates(supabase, userId, { personNames: names, personEmails: names });
      const labels = [canonical, ...candidates].filter(Boolean) as string[];
      for (const label of labels) {
        const ik = normalizeInitiative(label);
        const p = keyed.find((pp) => initiativeKeyMatch(pp.key, ik, false) && distinctiveOverlap(pp.key, ik, company));
        if (p) { const k = `${p.id}:meeting:${m.id}`; if (!seen.has(k)) { seen.add(k); push(p.id, { kind: 'meeting', id: m.id, title: m.title || 'Meeting', reason: `an attendee is tied to ${label}` }); } }
      }
    }
  } catch (e) {
    console.warn('[suggest-membership] skipped (pre-migration or error):', (e as Error).message);
  }
  // Cap per project so the UI stays calm.
  for (const pid of Object.keys(out)) out[pid] = out[pid].slice(0, 8);
  return out;
}
