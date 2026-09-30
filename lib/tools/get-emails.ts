// ─── Configurable inbox email fetcher ─────────────────────────────────────────
// Replaces the hardcoded `get_urgent_emails` tool with a fully composable
// version that supports mode, time window, sender, keyword, and topic filters.

import type { SupabaseClient } from '@supabase/supabase-js';
import { clipWithRule } from '@/lib/utils/pack-context';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

/** W28 · RETRIEVAL THAT CAN READ THE WHOLE THING. A listing carries short snippets (400) and each
 *  email's id; opening ONE email (`email_id`) returns its thread oldest-first with the NEWEST message
 *  whole — through the excerpt law (boundary cut + declared mark), never a raw slice. Found by the W28
 *  eval: a 300-char snippet was all a coworker could ever see, and it told the user "the email got cut
 *  off" while the answer (a deadline in the second paragraph) sat unread. */
export const EMAIL_LIST_SNIPPET_CHARS = 400;
export const EMAIL_OPEN_NEWEST_CHARS = 8000;
export const EMAIL_OPEN_EARLIER_CHARS = 1500;
export const EMAIL_OPEN_THREAD_MESSAGES = 8;

/** Open one inbox email by its item id: the whole thread (bounded), newest message in full. */
export async function readEmailThread(supabase: SupabaseClient, userId: string, itemId: string): Promise<string | null> {
  const { data: item, error } = await supabase.from('inbox_items').select('id, created_at, source_data->subject, source_data->from_name, source_data->from_address, source_data->thread_id, source_data->body')
    .eq('id', itemId).eq('user_id', userId).maybeSingle();
  if (error || !item) return null;
  const it = item as { created_at?: string; subject?: string; from_name?: string; from_address?: string; thread_id?: string; body?: string };
  const { topMessageOf } = await import('@/lib/inbox/top-message');
  let msgs: Array<{ from_name?: string | null; from_address?: string | null; is_from_user?: boolean | null; body?: string | null; received_at?: string | null }> = [];
  if (it.thread_id) {
    const { data, error: tErr } = await supabase.from('emails').select('from_name, from_address, is_from_user, body, received_at')
      .eq('user_id', userId).eq('thread_id', it.thread_id).order('received_at', { ascending: false }).limit(EMAIL_OPEN_THREAD_MESSAGES);
    if (!tErr && data?.length) msgs = [...data].reverse();
  }
  if (!msgs.length) msgs = [{ from_name: it.from_name, from_address: it.from_address, is_from_user: false, body: it.body, received_at: it.created_at }];
  const lines = msgs.map((m, i) => {
    const newest = i === msgs.length - 1;
    const who = m.is_from_user ? 'the user' : `${m.from_name || ''} <${m.from_address || ''}>`.trim();
    const words = (newest ? String(m.body ?? '') : topMessageOf(String(m.body ?? ''))).trim();
    return `--- ${newest ? 'NEWEST · ' : ''}From: ${who} · ${String(m.received_at ?? '').slice(0, 16).replace('T', ' ')} ---\n${clipForPrompt(words, newest ? EMAIL_OPEN_NEWEST_CHARS : EMAIL_OPEN_EARLIER_CHARS)}`;
  });
  return `Email thread "${it.subject || '(no subject)'}" (id ${itemId}, oldest first — ${EXCERPT_RULE}):\n\n${lines.join('\n\n')}`;
}

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

export const getEmailsDefinition = {
  name: 'get_emails',
  description: "Search the user's inbox by topic, sender, keyword or time window. Use when the user asks about specific emails, conversations, or wants to find something in their inbox. Pass the most specific filter you can extract from the request.",
  input_schema: {
    type: 'object' as const,
    properties: {
      filter: { type: 'string', description: "Topic, subject keyword, or concept to search for. Be specific — e.g. 'job application personal assistant' not just 'email'." },
      from: { type: 'string', description: 'Sender name or email address. Only use when the user is asking about a specific person.' },
      since: { type: 'string', enum: ['24h', '7d', '30d'], description: 'How far back to look. Default: 7d.' },
      unread_only: { type: 'boolean', description: 'Only return unread emails.' },
      limit: { type: 'number', description: 'Max results to return. Default 15.' },
      email_id: { type: 'string', description: 'OPEN one email in full: its id from a previous get_emails listing. Returns the whole thread (newest message in full). Use it whenever the snippet is not enough to answer.' },
    },
    required: [],
  },
};

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
  if (typeof config.email_id === 'string' && config.email_id.trim()) {
    return (await readEmailThread(supabase, userId, config.email_id.trim())) ?? `Email not found: ${config.email_id}`;
  }
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
  // `filter` is the AI schema's name for the topic (the chief passed it and it was silently ignored).
  for (const t of [config.topic, config.filter]) {
    if (typeof t === 'string' && t.trim()) keywordList.push(...t.toLowerCase().trim().split(/\s+/).filter(k => k.length > 2));
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
    // EXCERPT HONESTY (invariant 13): a raw `.slice()` hard-cut the body/snippet with no marker —
    // the model reading a mid-word cut as "the email got cut off" is the law's own founding
    // incident. `clipWithRule` ends at a boundary and carries EXCERPT_RULE inline (this tool
    // result is a standalone message back to the model, so the rule can't ride on a caller).
    snippet:   clipWithRule((item.source_data?.snippet || item.source_data?.body || '') as string, EMAIL_LIST_SNIPPET_CHARS),
    // The whole body is SEARCHED (never shown here — opening the email shows it).
    haystack:  `${item.source_data?.subject ?? ''} ${item.source_data?.body ?? item.source_data?.snippet ?? ''}`.toLowerCase(),
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
      const hay = e.haystack;
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
    return `• ${date}${readFlag} — From: ${from} [id: ${e.id}]\n  Subject: ${e.subject}${e.snippet ? `\n  "${e.snippet}"` : ''}`;
  });

  const header = `${subset.length} email${subset.length !== 1 ? 's' : ''} (${mode}${fromFilter ? `, from: ${fromFilter}` : ''}${keywordList.length ? `, keywords: ${keywordList.slice(0, 3).join(', ')}` : ''}):`;
  return `${header}\n\n${lines.join('\n\n')}\n\n(Snippets are the first lines only — open an email with get_emails { email_id } to read it whole.)`;
}
