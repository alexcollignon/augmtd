// ─── read_action_history — the conversation reads the action ledger ─────────────────────────────
// One-surface plan § context controls: "what files were sent?", "what went out this week?",
// "what did we do on X?" are HISTORY READS a chief of staff answers instantly. The ledgers exist
// (activity_events · action_commits · email_sends); this capability lets the conversation read
// them. Read-only, reversible, user-scoped.
//
// HONESTY: the digest names its own boundary — this is what happened THROUGH AUGMTD; mail sent
// directly from Gmail/Outlook outside the platform is not in this ledger (the synced thread is,
// but not as an "action" row). Never let the model imply the ledger is the whole world.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ActionHistoryConfig {
  days?: number;        // look-back window (default 7, max 30)
  query?: string;       // optional case-insensitive filter against titles/subjects/results
  kind?: 'sends' | 'all'; // 'sends' = only outbound commits (replies, nudges, forwards, invites, coworker mail)
}

export const readActionHistoryDefinition = {
  name: 'read_action_history',
  description:
    'Read the ledger of actions taken through the platform: replies/nudges sent, forwards and calendar invites ' +
    'committed, coworker emails, items marked done or dismissed, delegations. Use for "what was sent", "what went ' +
    'out this week", "what did we do about X". Read-only. Covers actions taken THROUGH the platform only.',
  input_schema: {
    type: 'object' as const,
    properties: {
      days: { type: 'number', description: 'Look-back window in days (default 7, max 30)' },
      query: { type: 'string', description: 'Filter to entries mentioning this text (person, subject, project)' },
      kind: { type: 'string', enum: ['sends', 'all'], description: '"sends" = outbound only; default "all"' },
    },
  },
};

const SEND_TYPES = new Set(['reply_sent', 'nudge_sent', 'forward_sent', 'invite_sent']);
const day = (iso: string) => new Date(iso).toISOString().slice(5, 10).replace('-', '/');

export async function executeReadActionHistory(
  config: ActionHistoryConfig, userId: string, supabase: SupabaseClient,
): Promise<string> {
  try {
    const days = Math.min(Math.max(Math.round(config.days ?? 7), 1), 30);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const q = (config.query ?? '').trim().toLowerCase();
    const sendsOnly = config.kind === 'sends';

    const [acts, commits, coworkerMail] = await Promise.all([
      supabase.from('activity_events').select('type, title, created_at')
        .eq('user_id', userId).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(80),
      supabase.from('action_commits').select('action_type, payload, result, created_at')
        .eq('user_id', userId).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(30),
      supabase.from('email_sends').select('subject, to_count, status, created_at')
        .eq('user_id', userId).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(30),
    ]);

    type Line = { at: string; text: string; send: boolean };
    const lines: Line[] = [];

    for (const a of (acts.data ?? []) as Array<{ type: string; title: string; created_at: string }>) {
      lines.push({ at: a.created_at, text: `${a.title} (${a.type.replace(/_/g, ' ')})`, send: SEND_TYPES.has(a.type) });
    }
    for (const c of (commits.data ?? []) as Array<{ action_type: string; payload: Record<string, unknown>; result: string | null; created_at: string }>) {
      const label = c.action_type === 'calendar_invite' ? 'Calendar invite sent' : c.action_type === 'forward' ? 'Email forwarded' : `Committed: ${c.action_type}`;
      const detail = String(c.payload?.subject ?? c.payload?.title ?? c.result ?? '').slice(0, 80);
      lines.push({ at: c.created_at, text: `${label}${detail ? ` — ${detail}` : ''}`, send: true });
    }
    for (const m of (coworkerMail.data ?? []) as Array<{ subject: string | null; to_count: number; status: string; created_at: string }>) {
      lines.push({
        at: m.created_at,
        text: `Coworker email ${m.status === 'sent' ? 'sent' : 'FAILED'}${m.subject ? ` — "${String(m.subject).slice(0, 70)}"` : ''} (${m.to_count} recipient${m.to_count === 1 ? '' : 's'})`,
        send: true,
      });
    }

    let kept = lines
      .filter((l) => (!sendsOnly || l.send) && (!q || l.text.toLowerCase().includes(q)))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 40);

    const boundary = 'This ledger covers actions taken THROUGH the platform — mail sent directly from Gmail/Outlook outside it is not listed here (though its thread is synced).';
    if (!kept.length) {
      return `No recorded ${sendsOnly ? 'sends' : 'actions'} in the last ${days} day${days === 1 ? '' : 's'}${q ? ` matching "${config.query}"` : ''}. ${boundary}`;
    }
    return [
      `Action ledger — last ${days} day${days === 1 ? '' : 's'}${q ? `, matching "${config.query}"` : ''}${sendsOnly ? ', sends only' : ''}:`,
      ...kept.map((l) => `- ${day(l.at)} · ${l.text}`),
      boundary,
    ].join('\n');
  } catch {
    return 'The action ledger could not be read right now — say so rather than guessing what was sent.';
  }
}
