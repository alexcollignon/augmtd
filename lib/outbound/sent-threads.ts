// OUTBOUND capture — the general "you reached out, no reply yet" signal. A person you email who never
// writes back creates no inbox_item today, so outreach you're awaiting is invisible to the Home, Timeline,
// and Projects. This module finds those COLD outbound recipients DETERMINISTICALLY (structure only — no
// keywords, no language assumptions), then a separate reasoned pass (classify-outbound.ts) decides intent
// (is it awaiting a reply?) + initiative from CONTENT. Keyed by RECIPIENT (not thread) so follow-ups
// collapse to one item and distinct recipients stay separate even under one provider thread_id.

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/utils/fetch-all';

export type OutboundCandidate = {
  recipient: string;        // the person you're awaiting (email, lowercased)
  who: string | null;       // display
  subject: string;          // your latest sent subject to them
  snippet: string;          // a short slice of the latest sent body (for the reasoned pass)
  lastSentAt: string;       // ISO — when you last reached out
  ageDays: number;          // days you've been waiting
  count: number;            // how many times you've reached out (follow-ups)
};

const DAY = 86_400_000;
const emailIn = (v: unknown): string | null => String(v || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;

/**
 * Cold outbound recipients (you sent, they never wrote back in the window), deduped by recipient. NO
 * content/keyword filtering — that's the reasoned pass's job. `windowDays` bounds "awaiting" (default 45).
 */
export async function getOutboundCandidates(
  supabase: SupabaseClient,
  userId: string,
  todayStr: string,
  opts: { windowDays?: number } = {},
): Promise<OutboundCandidate[]> {
  const windowDays = opts.windowDays ?? 45;
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  const since = new Date(todayMs - (windowDays + 30) * DAY).toISOString();

  // Paginated + ordered — NEVER a bare .limit(N): PostgREST caps at 1000 rows, so a busy mailbox would
  // otherwise get an arbitrary slice that drops recent sends (the real "internship outreach missing" bug).
  const emails = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase.from('emails')
      .select('is_from_user, from_address, subject, body, received_at, to_addresses')
      .eq('user_id', userId).gte('received_at', since)
      .order('received_at', { ascending: false })
      .range(from, to));
  if (!emails.length) return [];

  // Anyone who has EVER written to you (in the window) = not cold. Keyed by their address.
  const inboundSenders = new Set<string>();
  for (const e of emails as Array<Record<string, unknown>>) {
    if (e.is_from_user !== true) { const a = emailIn(e.from_address); if (a) inboundSenders.add(a); }
  }

  // Per recipient you SENT to: latest send (subject+snippet) + how many times.
  const byRecipient = new Map<string, { latestAt: string; subject: string; snippet: string; count: number }>();
  for (const e of emails as Array<Record<string, unknown>>) {
    if (e.is_from_user !== true) continue;
    const at = String(e.received_at || '');
    const subject = String(e.subject || '').trim();
    const snippet = String(e.body || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const tos = Array.isArray(e.to_addresses) ? (e.to_addresses as unknown[]) : [];
    for (const to of tos) {
      const r = emailIn(to);
      if (!r) continue;
      const cur = byRecipient.get(r) ?? { latestAt: '', subject: '', snippet: '', count: 0 };
      cur.count++;
      if (at > cur.latestAt) { cur.latestAt = at; cur.subject = subject; cur.snippet = snippet; }
      byRecipient.set(r, cur);
    }
  }

  const out: OutboundCandidate[] = [];
  for (const [recipient, v] of byRecipient) {
    if (inboundSenders.has(recipient)) continue;                 // they replied → warm, already has an item
    const ageDays = Math.round((todayMs - Date.parse(v.latestAt.slice(0, 10))) / DAY);
    if (ageDays > windowDays || ageDays < 0) continue;           // stale / clock skew
    if (!v.subject && !v.snippet) continue;                      // nothing to reason over
    out.push({ recipient, who: recipient, subject: v.subject, snippet: v.snippet, lastSentAt: v.latestAt, ageDays, count: v.count });
  }
  return out.sort((a, b) => b.lastSentAt.localeCompare(a.lastSentAt));
}
