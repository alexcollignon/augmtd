// ─── forward_email — forward an item's email to new recipient(s) ──────────────
// The S5 proof-of-agnosticism capability. Today "forward the deck to finance" is
// a [You] step (no tool); registering THIS executor + one CAPABILITY_MAP row flips
// the SAME step to [System] — with NO edits to proposeOwner / the classifier / the
// assembler (all map-driven). It's a real send → irreversible → it stays behind the
// prepare → approve → execute gate (mirrors send_calendar_invite).
//
// It loads the original email on the item (subject/body/from — from `inbox_items.
// source_data`, or the linked `emails` row), composes a standard forward
// ("---------- Forwarded message ----------" + the original), and sends via the
// user's connected Gmail/Outlook mailbox (send-AS-user, the same path as
// /api/compose/send), falling back to the OAuth-free coworker channel
// (`sendCoworkerEmail`, Reply-To the user) when no mailbox is connected.
//
// Non-fatal: returns a human-readable status string (never throws), so a workflow
// step / the execute route reports cleanly. Instance-honest: it NEVER invents a
// recipient — an empty `to` is a hard error (the card makes the user fill it in).

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendGmailEmail } from '@/lib/google/gmail';
import { sendOutlookEmail } from '@/lib/microsoft/outlook';
import { resolveConnectionForItem } from '@/lib/inbox/resolve-connection';
import { sendCoworkerEmail } from './coworker-email';

export interface ForwardEmailConfig {
  emailId?: string;              // an `emails` row id (fallback source of the original)
  threadId?: string;             // an `inbox_items` id (the Home item — primary source)
  to: string[];                  // recipient email(s) — REQUIRED, never invented
  cc?: string[];
  note?: string;                 // an optional lead-in note above the forwarded content
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanList = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter((e) => EMAIL_RE.test(e)))].slice(0, 20);

// The forwarded-content block a normal mail client produces. `body` may be HTML or plain text — we
// escape nothing (it's re-sent as the user's own mail body, HTML-capable via the send-as-user path).
function buildForwardBody(orig: { subject: string; from: string; date: string; body: string }, note?: string): string {
  const header =
    `---------- Forwarded message ----------\n` +
    `From: ${orig.from || '(unknown)'}\n` +
    (orig.date ? `Date: ${orig.date}\n` : '') +
    `Subject: ${orig.subject || '(no subject)'}\n`;
  const lead = (note || '').trim();
  // Convert the plain header to <br>-joined HTML lines so it renders in an HTML mail client, and inline
  // the original body (which is already HTML from the inbox store) below it.
  const headerHtml = header.split('\n').map((l) => l).join('<br>');
  const leadHtml = lead ? `<p>${lead.replace(/\n/g, '<br>')}</p>` : '';
  return `${leadHtml}<div>${headerHtml}</div><br><div>${orig.body || ''}</div>`;
}

// Load the original email the item points at. Primary source is the `inbox_items` row (source_data has
// subject/body/from/received_at/provider for email-kind items); `emails` by id is the fallback.
async function loadOriginal(
  supabase: SupabaseClient,
  userId: string,
  cfg: ForwardEmailConfig,
): Promise<{ subject: string; from: string; date: string; body: string; item: Record<string, unknown> | null } | null> {
  // 1. The Home item (threadId = inbox_items.id).
  if (cfg.threadId) {
    const { data: item } = await supabase
      .from('inbox_items')
      .select('*')
      .eq('id', cfg.threadId)
      .eq('user_id', userId)
      .maybeSingle();
    if (item) {
      const sd = (item.source_data ?? {}) as Record<string, unknown>;
      let body = typeof sd.body === 'string' ? (sd.body as string) : '';
      const subject = typeof sd.subject === 'string' ? (sd.subject as string) : String((item as { work_title?: string }).work_title || '');
      const from = String(sd.from_name || sd.from || sd.from_address || '');
      const date = typeof sd.received_at === 'string' ? new Date(sd.received_at as string).toLocaleString() : '';
      // If source_data has no body but links an `emails` row, pull the richer body from there.
      if (!body && typeof sd.email_id === 'string') {
        const { data: e } = await supabase.from('emails').select('body').eq('id', sd.email_id).eq('user_id', userId).maybeSingle();
        if (e && typeof e.body === 'string') body = e.body as string;
      }
      return { subject, from, date, body, item };
    }
  }
  // 2. Direct `emails` row (emailId).
  if (cfg.emailId) {
    const { data: e } = await supabase
      .from('emails')
      .select('subject, body, from_name, from_address, received_at')
      .eq('id', cfg.emailId).eq('user_id', userId).maybeSingle();
    if (e) {
      return {
        subject: (e.subject as string) || '',
        from: String((e.from_name as string) || (e.from_address as string) || ''),
        date: e.received_at ? new Date(e.received_at as string).toLocaleString() : '',
        body: typeof e.body === 'string' ? (e.body as string) : '',
        item: null,
      };
    }
  }
  return null;
}

/**
 * executeForwardEmail — forward the item's email to new recipient(s). Real send → irreversible.
 * Non-throwing: returns a "Forwarded…" / "Cannot…" / "Failed…" status string.
 */
export async function executeForwardEmail(
  config: ForwardEmailConfig,
  userId: string,
  supabase: SupabaseClient,
): Promise<string> {
  const to = cleanList(config.to);
  const cc = cleanList(config.cc);
  // Instance honesty: never invent a recipient. No valid recipient → a hard, honest error.
  if (to.length === 0) return 'Cannot forward: at least one valid recipient email is required.';

  const orig = await loadOriginal(supabase, userId, config);
  if (!orig) return 'Cannot forward: the original email could not be found.';

  const subject = orig.subject.replace(/^(Fwd:|Fw:)\s*/i, '');
  const fwdSubject = `Fwd: ${subject}`.slice(0, 200);
  const bodyHTML = buildForwardBody(orig, config.note);

  // ── Send AS the user via a connected mailbox (same resolution as /api/inbox send-reply). We resolve
  // the connection the item arrived on when we have the item; else the first active gmail/outlook conn.
  type Conn = { provider?: string; metadata?: { tokens?: string } };
  let connection: Conn | null = null;
  if (orig.item) {
    const resolved = await resolveConnectionForItem(supabase, userId, orig.item as Parameters<typeof resolveConnectionForItem>[2]);
    connection = (resolved as Conn | null) ?? null;
  }
  if (!connection?.metadata?.tokens) {
    const { data } = await supabase
      .from('connections')
      .select('provider, metadata')
      .eq('user_id', userId).eq('status', 'active')
      .in('provider', ['gmail', 'outlook'])
      .order('created_at', { ascending: true })
      .limit(1).maybeSingle();
    if (data) connection = data as Conn;
  }

  try {
    if (connection?.metadata?.tokens && (connection.provider === 'gmail' || connection.provider === 'outlook')) {
      const args = {
        encryptedTokens: connection.metadata.tokens,
        to: to.join(', '),
        cc: cc.length ? cc.join(', ') : undefined,
        subject: fwdSubject,
        body: bodyHTML,
      };
      if (connection.provider === 'gmail') await sendGmailEmail(args);
      else await sendOutlookEmail(args);
      return `Forwarded "${subject}" to ${to.join(', ')}${cc.length ? ` (cc ${cc.join(', ')})` : ''}.`;
    }

    // ── Fallback: no connected mailbox → forward via the OAuth-free coworker channel (Resend), Reply-To
    // the user's login. The body is sent as plain text there.
    const plain = bodyHTML.replace(/<br\s*\/?>(?=)/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const res = await sendCoworkerEmail(supabase, userId, undefined, { to, cc, subject: fwdSubject, body: plain });
    if (!res.ok) return `Failed to forward: ${res.error || 'no mailbox connected and the assistant channel could not send.'}`;
    return `Forwarded "${subject}" to ${to.join(', ')} via your assistant's address.`;
  } catch (err) {
    console.error('[forward_email] failed:', err);
    return `Failed to forward the email: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const forwardEmailDefinition = {
  name: 'forward_email',
  description:
    "Forward an email the user already has to new recipient(s). This sends real mail — it is a commit " +
    "action; use it only with a confirmed recipient. Provide the recipient email(s) and an optional note.",
  input_schema: {
    type: 'object' as const,
    properties: {
      to: { type: 'array', items: { type: 'string' }, description: 'Recipient email address(es).' },
      cc: { type: 'array', items: { type: 'string' }, description: 'Optional CC email address(es).' },
      note: { type: 'string', description: 'Optional lead-in note above the forwarded content.' },
      emailId: { type: 'string', description: 'The id of the email to forward (if forwarding a specific stored email).' },
      threadId: { type: 'string', description: 'The Home item (inbox_items) id whose email to forward.' },
    },
    required: ['to'],
  },
};
