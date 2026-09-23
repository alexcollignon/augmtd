import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadUserRules } from '@/lib/inbox/rules/load';
import { classifyItem, type ItemType } from '@/lib/inbox/classify-item';
import { getUnderstanding, type ItemRelevance } from '@/lib/inbox/item-understanding';
import { buildInviteObject, type InviteObject } from '@/lib/present/invite-object';

export const maxDuration = 15;

// GET /api/inbox/[id]/thread — the full email thread for one inbox item, RLS-safe (cookie client).
// Loads the thread AS THE INBOX DOES: it resolves the item's thread_id, then queries the `emails`
// table for every message sharing that thread (user-scoped, oldest→newest by received_at) and
// returns them as SEPARATE messages — so the item-detail can render collapsible message cards
// (latest expanded, older collapsed), exactly like the inbox WorkDetailPanel, instead of one blob.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: item, error: itemErr } = await supabase
    .from('inbox_items')
    .select('id, work_title, source_data, created_at, work_state, rule_type, type_override, status, source, project_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (itemErr) console.warn('[inbox/thread] item read failed:', itemErr.message);
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sd = (item.source_data ?? {}) as Record<string, any>;
  const threadId: string | null = sd.thread_id ?? null;
  const emailId: string | null = sd.email_id ?? null;

  const subject = item.work_title || sd.subject || '(no subject)';

  // ONE BRAIN: the label-era project chip died; the deep-dive's entity control resolves membership itself.
  const projectName: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type EmailRow = Record<string, any>;
  const SELECT = 'id, message_id, from_address, from_name, subject, body, html_body, received_at, is_from_user, to_addresses, cc_addresses';

  // ── W8.4 · ONE FLIGHT, NOT FOUR (dev logs, Sep 23: this door took 3.6–7.4s on an open). Every read
  // after the item keys on the item alone, so the rules, the thread and the invite object now run
  // in ONE parallel wave instead of back to back (auth → item → rules → thread → [email] → invite ×
  // its own 2–4 reads). The rules are handed to classifyItem DIRECTLY — the module-global
  // rules setter (classify-item.ts) was a cross-request race (two users' opens could classify under each other's
  // rules on one warm instance).
  const [rules, threadRows, invite] = await Promise.all([
    loadUserRules(user.id, supabase).catch(() => null),
    (async (): Promise<EmailRow[]> => {
      // Primary path: all emails sharing this thread_id, ordered oldest→newest (the inbox pattern).
      if (threadId) {
        const { data, error: tErr } = await supabase
          .from('emails')
          .select(SELECT)
          .eq('user_id', user.id)
          .eq('thread_id', threadId)
          .order('received_at', { ascending: true });
        if (tErr) console.warn('[inbox/thread] thread read failed:', tErr.message);
        if (data?.length) return data;
      }
      // Fallback: single message by its email_id (thread never stitched / single-message thread).
      if (emailId) {
        const { data, error: eErr } = await supabase
          .from('emails')
          .select(SELECT)
          .eq('user_id', user.id)
          .eq('id', emailId)
          .maybeSingle();
        if (eErr) console.warn('[inbox/thread] email read failed:', eErr.message);
        if (data) return [data];
      }
      return [];
    })(),
    // INVITES ARE EVENTS (W7.4): an item holding a PARSED invite is served as its meeting — the
    // linked calendar row's live spec (RSVP verbs only for an invitee) or, with no row, the invite's
    // own facts with no verbs. Null = not an invite object; the mount renders the mail. Never fails.
    buildInviteObject(supabase, user.id, sd).catch(() => null as InviteObject | null),
  ]);
  const rows: EmailRow[] = threadRows;

  // Resolve the item's REAL type so the deep-dive header badge matches the classification — an FYI/
  // `noted` newsletter must never read "Reply needed". The user's rules drive the deterministic tier.
  // Gate on the item's own classification, never sender/subject keywords.
  let itemType: ItemType = 'fyi';
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    itemType = classifyItem(item as any, rules);
  } catch { /* fall back to fyi */ }

  // The item's understood RELEVANCE (reply | action | awareness) — the SINGLE signal that drives the
  // deep-dive's primary surface (reply → composer open; awareness → composer collapsed + Dismiss lead;
  // action → action lead) AND keeps it coherent with the generated plan (same signal both places).
  // Non-fatal: missing understanding → null → the client falls back to today's composer-open behavior.
  const relevance: ItemRelevance | null = getUnderstanding(item)?.relevance ?? null;

  // Render-ready messages — one card per message, like the inbox thread cards. Field names mirror
  // the `emails` columns so the shared <ThreadMessages/> component (used by both the inbox and the
  // Home item-detail) can consume these rows directly, including HTML bodies + To/CC recipients.
  const messages = rows.map((e) => {
    const body: string | null = typeof e.body === 'string' ? e.body : null;
    return {
      id: e.id as string,
      from: (e.from_address as string) ?? null,
      fromName: (e.from_name as string) ?? null,
      subject: (e.subject as string) ?? null,
      receivedAt: (e.received_at as string) ?? null,
      body,
      html_body: typeof e.html_body === 'string' ? (e.html_body as string) : null,
      snippet: body ? body.replace(/\s+/g, ' ').trim().slice(0, 240) : '',
      isFromUser: !!e.is_from_user,
      to_addresses: Array.isArray(e.to_addresses) ? (e.to_addresses as string[]) : null,
      cc_addresses: Array.isArray(e.cc_addresses) ? (e.cc_addresses as string[]) : null,
    };
  });

  // Header fields come from the newest message when we have one, else the inbox item's source_data.
  const newest = messages[messages.length - 1];
  return NextResponse.json({
    id: item.id,
    subject,
    // The classified type — drives the deep-dive header badge so it reflects reality (needs_reply →
    // "Reply needed"; fyi → "For awareness"; etc.), instead of always claiming "Reply needed".
    type: itemType,
    // The understood relevance — drives the deep-dive's PRIMARY surface (reply=composer / awareness=
    // dismiss+collapsed / action=action) so the visible action + the plan can't disagree.
    relevance,
    projectId: item.project_id ?? null,
    projectName,
    // The AI best-guess initiative label (for the Add-to-project pre-suggestion when unassigned).
    initiative: getUnderstanding(item)?.initiative ?? null,
    fromName: newest?.fromName ?? sd.from_name ?? null,
    fromAddress: newest?.from ?? sd.from ?? null,
    receivedAt: newest?.receivedAt ?? sd.received_at ?? item.created_at ?? null,
    // WHAT CAME WITH IT (Sep 9, the item-context drawer): the item's own stored attachments, as
    // the ONE viewer's file shape — `ref` is the same {kind:'attachment', path} address the
    // project room's Files list has always used, so one lightbox serves both. A file whose upload
    // was skipped (unsupported storage MIME) has no path and is NOT offered as viewable.
    attachments: (Array.isArray(sd.attachments) ? sd.attachments : [])
      .filter((a: { storagePath?: string }) => typeof a?.storagePath === 'string' && a.storagePath)
      .map((a: { filename?: string; mimeType?: string; size?: number; storagePath: string }) => ({
        name: a.filename ?? 'Attachment',
        mime: a.mimeType ?? null,
        size: typeof a.size === 'number' ? a.size : null,
        ref: { kind: 'attachment' as const, path: a.storagePath },
      })),
    // Separate messages (oldest→newest). Empty when neither thread_id nor email_id resolved.
    messages,
    // The meeting this item IS, when it is an invitation (W7.4). Null for ordinary mail.
    invite,
    // Legacy fallback body (used only if messages is empty) — the inbox item's own stored body.
    body: typeof sd.body === 'string' ? sd.body : null,
  });
}
