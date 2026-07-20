// The user's ORG / TEAM roster — the "professional surroundings" a chief of staff knows: who are the user's
// own colleagues (same organization). Feeds the reasoning so internal coordination reads differently from
// client/partner work, and a colleague is never mistaken for a deal counterparty. Cached per-process.

import type { SupabaseClient } from '@supabase/supabase-js';

export type TeamRoster = { names: string[]; emails: string[] };

const memo = new Map<string, { at: number; roster: TeamRoster }>();
const TTL = 5 * 60 * 1000;
const emailOf = (s?: string | null): string | null => String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;

// The user's teammates = the ACTIVE members of their company in the tool. company_members is the authoritative
// org definition (it's what the user set up), and companies commonly span MULTIPLE domains — a founder on
// gmail, a subsidiary, an acquired brand, contractors — so filtering by email domain would wrongly drop real
// teammates. We trust membership; the CONTENT-FIRST reasoning downstream still judges each email's nature, so
// a partner who happens to share a workspace is handled by the content, not by a rigid "internal" label.
export async function getTeamRoster(supabase: SupabaseClient, userId: string): Promise<TeamRoster> {
  const c = memo.get(userId);
  if (c && Date.now() - c.at < TTL) return c.roster;
  const roster: TeamRoster = { names: [], emails: [] };
  try {
    const { data: mine } = await supabase.from('company_members').select('company_id').eq('user_id', userId).eq('status', 'active');
    const companyIds = [...new Set((mine ?? []).map((m: { company_id: string }) => m.company_id).filter(Boolean))];
    if (companyIds.length) {
      const { data: members } = await supabase.from('company_members').select('user_id').in('company_id', companyIds).eq('status', 'active').neq('user_id', userId);
      const ids = [...new Set((members ?? []).map((m: { user_id: string }) => m.user_id).filter(Boolean))];
      if (ids.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
        const names = new Set<string>(), emails = new Set<string>();
        for (const p of (profs ?? []) as Array<{ full_name?: string; email?: string }>) {
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

// A compact prompt line naming the user's own team, so the reasoning can tell internal coordination from
// external client/partner work — the way a chief of staff who knows the org would. Framed as CONTEXT, not a
// rule: the email's content still decides its nature (a shared workspace can include a partner, and the
// content makes that clear). Empty for a solo user.
export function renderTeamContext(roster: TeamRoster): string {
  if (!roster.names.length) return '';
  return `\n[YOUR TEAM] People in your own organization (workspace): ${roster.names.join(', ')}. Use this to distinguish INTERNAL coordination with your own team from EXTERNAL client/partner/vendor work — but let the email's actual content decide (a workspace can include an outside partner; the content shows whether a message is internal or a client/partner matter).\n`;
}
