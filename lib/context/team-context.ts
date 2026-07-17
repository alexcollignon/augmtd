// The user's ORG / TEAM roster — the "professional surroundings" a chief of staff knows: who are the user's
// own colleagues (same organization). Feeds the reasoning so internal coordination reads differently from
// client/partner work, and a colleague is never mistaken for a deal counterparty. Cached per-process.

import type { SupabaseClient } from '@supabase/supabase-js';

export type TeamRoster = { names: string[]; emails: string[] };

const memo = new Map<string, { at: number; roster: TeamRoster }>();
const TTL = 5 * 60 * 1000;
const emailOf = (s?: string | null): string | null => String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
const domainOf = (s?: string | null): string | null => { const e = emailOf(s); return e ? e.split('@')[1] || null : null; };
const FREE = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com', 'zoho.com', 'pm.me']);

// The user's REAL teammates. A `company` here can be a shared multi-tenant workspace (Alex@augmtd.ai and
// René@zeroto100.ai co-exist in one workspace but are DIFFERENT organizations), so company_members alone is
// unsafe — it would call a cross-org partner an "internal colleague". The reliable org signal is the
// CORPORATE DOMAIN (the user's login + connected mailboxes, minus free providers). We intersect: a teammate
// is a company member who ALSO shares the user's corporate domain. Empty for a solo-domain / personal user.
export async function getTeamRoster(supabase: SupabaseClient, userId: string): Promise<TeamRoster> {
  const c = memo.get(userId);
  if (c && Date.now() - c.at < TTL) return c.roster;
  const roster: TeamRoster = { names: [], emails: [] };
  try {
    // 1) the user's own corporate domains.
    const [{ data: prof }, { data: conns }] = await Promise.all([
      supabase.from('profiles').select('email').eq('id', userId).maybeSingle(),
      supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
    ]);
    const corp = new Set<string>();
    const addCorp = (a?: string | null) => { const d = domainOf(a); if (d && !FREE.has(d)) corp.add(d); };
    addCorp((prof as { email?: string } | null)?.email);
    for (const cn of (conns ?? []) as Array<{ metadata: { email?: string } | null; provider_account_id?: string | null }>) addCorp(cn.metadata?.email || cn.provider_account_id);
    if (!corp.size) { memo.set(userId, { at: Date.now(), roster }); return roster; } // personal-domain user → no org team

    // 2) company members, kept ONLY if they share the user's corporate domain (true same-org).
    const { data: mine } = await supabase.from('company_members').select('company_id').eq('user_id', userId).eq('status', 'active');
    const companyIds = [...new Set((mine ?? []).map((m: { company_id: string }) => m.company_id).filter(Boolean))];
    if (companyIds.length) {
      const { data: members } = await supabase.from('company_members').select('user_id').in('company_id', companyIds).eq('status', 'active').neq('user_id', userId);
      const ids = [...new Set((members ?? []).map((m: { user_id: string }) => m.user_id).filter(Boolean))];
      if (ids.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
        const names = new Set<string>(), emails = new Set<string>();
        for (const p of (profs ?? []) as Array<{ full_name?: string; email?: string }>) {
          const d = domainOf(p.email); if (!d || !corp.has(d)) continue; // cross-org workspace member → skip
          if (p.full_name?.trim()) names.add(p.full_name.trim());
          const e = emailOf(p.email); if (e) emails.add(e);
        }
        roster.names = [...names].slice(0, 30);
        roster.emails = [...emails].slice(0, 30);
      }
    }
  } catch { /* solo user / no company → empty roster */ }
  memo.set(userId, { at: Date.now(), roster });
  return roster;
}

// A compact prompt line naming the internal team, so the reasoning treats them as colleagues (internal
// coordination), never as external clients/counterparties. Empty for a solo user.
export function renderTeamContext(roster: TeamRoster): string {
  if (!roster.names.length) return '';
  return `\n[YOUR TEAM] Your own colleagues (same organization): ${roster.names.join(', ')}. Mail involving these people is INTERNAL coordination with your team — NOT a client/vendor relationship. External senders are clients, partners, or vendors.\n`;
}
