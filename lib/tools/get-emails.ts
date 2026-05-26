// ─── Configurable inbox email fetcher ─────────────────────────────────────────
// Replaces the hardcoded `get_urgent_emails` tool with a fully composable
// version that supports mode, time window, sender, keyword, and topic filters.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface GetEmailsConfig {
  /** 'urgent' = unread only · 'recent' = time-filtered · 'all' = no time filter */
  mode?: 'urgent' | 'recent' | 'all';
  /** Relative window or ISO date string. Ignored when mode='all'. Default: '7d' */
  since?: '24h' | '7d' | '30d' | string;
  /** Additional unread filter (applies in 'recent' and 'all' modes too) */
  unread_only?: boolean;
  /** Partial match against sender name or email address (case-insensitive) */
  from?: string;
  /** OR-match: at least one keyword must appear in subject or snippet */
  keywords?: string[];
  /** Free-text topic — split into keywords, same OR-match logic as keywords */
  topic?: string;
  /** Max emails to return. Default 15, max 50 */
  limit?: number;
}

function parseSince(since: string): Date | null {
  if (since === '24h') return new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (since === '7d')  return new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
  if (since === '30d') return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (since === '90d') return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  // Try ISO date string
  const d = new Date(since);
  return isNaN(d.getTime()) ? null : d;
}

export async function executeGetEmails(
  config: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<string> {
  const mode       = (config.mode as string)      || 'recent';
  const sinceRaw   = (config.since as string)     || '7d';
  const unreadOnly = config.unread_only === true || mode === 'urgent';
  const fromFilter = typeof config.from === 'string' ? config.from.toLowerCase().trim() : null;
  const limit      = Math.min(Math.max(typeof config.limit === 'number' ? config.limit : 15, 1), 50);

  // Merge keywords + topic into one OR-match set
  const keywordList: string[] = [];
  if (Array.isArray(config.keywords)) {
    keywordList.push(...(config.keywords as string[]).map(k => k.toLowerCase().trim()).filter(Boolean));
  }
  if (typeof config.topic === 'string' && config.topic.trim()) {
    keywordList.push(...config.topic.toLowerCase().trim().split(/\s+/).filter(k => k.length > 2));
  }

  // ── DB query ────────────────────────────────────────────────────────────────
  let query = supabase
    .from('inbox_items')
    .select('id, source_data, visual_section, status, created_at, is_read')
    .eq('user_id', userId)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(200); // fetch generously, filter client-side

  // Date cutoff at DB level
  if (mode !== 'all') {
    const cutoff = parseSince(sinceRaw);
    if (cutoff) query = query.gte('created_at', cutoff.toISOString());
  }

  // Unread filter at DB level
  if (unreadOnly) query = query.eq('is_read', false);

  const { data } = await query;
  if (!data || data.length === 0) return 'No emails found matching the criteria.';

  // ── Client-side filters ──────────────────────────────────────────────────────
  let items = (data as any[]).map(item => ({
    id: item.id,
    fromName:  (item.source_data?.from_name || item.source_data?.from || 'Unknown') as string,
    fromEmail: (item.source_data?.from_address || '') as string,
    subject:   (item.source_data?.subject || '(no subject)') as string,
    snippet:   ((item.source_data?.snippet || item.source_data?.body || '') as string).slice(0, 300),
    createdAt: item.created_at as string,
    isRead:    item.is_read !== false,
    section:   (item.visual_section || 'noted') as string,
  }));

  // Sender filter
  if (fromFilter) {
    items = items.filter(e =>
      e.fromName.toLowerCase().includes(fromFilter) ||
      e.fromEmail.toLowerCase().includes(fromFilter)
    );
  }

  // Keyword / topic filter (OR logic)
  if (keywordList.length > 0) {
    items = items.filter(e => {
      const hay = `${e.subject} ${e.snippet}`.toLowerCase();
      return keywordList.some(k => hay.includes(k));
    });
  }

  if (items.length === 0) return 'No emails found matching the criteria.';

  const subset = items.slice(0, limit);

  // ── Format output ────────────────────────────────────────────────────────────
  const lines = subset.map(e => {
    const date = new Date(e.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const readFlag = e.isRead ? '' : ' [unread]';
    const from = e.fromEmail ? `${e.fromName} <${e.fromEmail}>` : e.fromName;
    return `• ${date}${readFlag} — From: ${from}\n  Subject: ${e.subject}${e.snippet ? `\n  "${e.snippet}"` : ''}`;
  });

  const header = `${subset.length} email${subset.length !== 1 ? 's' : ''} (${mode}${fromFilter ? `, from: ${fromFilter}` : ''}${keywordList.length ? `, keywords: ${keywordList.slice(0, 3).join(', ')}` : ''}):`;
  return `${header}\n\n${lines.join('\n\n')}`;
}
