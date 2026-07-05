import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { buildVoiceBlock } from '@/lib/context/voice-context';

export const maxDuration = 30;

// ── Universal drafter — "actions follow intent". Given ANY Home item (meeting / commitment /
// awareness / email), infer the natural recipient(s) and draft the message the user would send, in
// their voice. Powers the deep-dive compose panel: the user reviews/edits/sends via /api/compose/send.
//
// POST /api/compose/draft { kind, entityId, intent? }
//   → { to[], cc[], subject, bodyHTML, recipientName? }
//
// Recipient inference is BEST-EFFORT and never invents an address: if none resolves we return an
// empty `to` + a `recipientName` so the UI shows who it's likely for and the user fills the address.

type Kind = 'meeting' | 'commitment' | 'awareness' | 'email';

const EMAIL_RE = /[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/;
const extractEmail = (s?: string | null): string | null => (s ? (s.match(EMAIL_RE)?.[0] ?? null) : null);
const extractName = (s?: string | null): string | null => {
  if (!s) return null;
  const t = s.replace(/<[^>]*>/g, '').trim().replace(/^"|"$/g, '').trim();
  return t && !EMAIL_RE.test(t) ? t : null;
};

function paraHTML(text: string): string {
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .filter((p) => p !== '<p></p>')
    .join('');
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { kind, entityId, intent } = (await request.json()) as { kind: Kind; entityId: string; intent?: string };
    if (!entityId || !kind) return NextResponse.json({ error: 'kind and entityId are required' }, { status: 400 });

    // The user's own addresses — never draft TO yourself.
    const userEmails = new Set<string>([(user.email ?? '').toLowerCase()].filter(Boolean));
    try {
      const { data: conns } = await supabase.from('connections').select('metadata, provider_account_id').eq('user_id', user.id);
      for (const c of (conns ?? []) as Array<{ metadata: { email?: string } | null; provider_account_id?: string }>) {
        const e = (c.metadata?.email || c.provider_account_id || '').toLowerCase();
        if (e) userEmails.add(e);
      }
    } catch { /* non-fatal */ }
    const isSelf = (e?: string | null) => !!e && userEmails.has(e.toLowerCase());

    let userName = 'me';
    try {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      if (prof?.full_name) userName = String(prof.full_name);
    } catch { /* keep default */ }

    // Resolved fields.
    let to: string[] = [];
    let recipientName: string | null = null;
    let subject = '';
    // The prompt describing what to write + the context the model grounds on.
    let task = '';
    let context = '';
    // The best recipient email we can find for the voice block (per-recipient tone).
    let voiceRecipient: string | null = null;

    if (kind === 'meeting') {
      // entityId = the meeting transcript id. Pull its calendar event's attendees (minus the user).
      const { data: tr } = await supabase
        .from('meeting_transcripts')
        .select('id, title, summary, suggested_next_step, calendar_event_id, decisions')
        .eq('id', entityId).eq('user_id', user.id).maybeSingle();
      if (!tr) return NextResponse.json({ error: 'not found' }, { status: 404 });

      let attendees: Array<{ email?: string; name?: string; displayName?: string }> = [];
      let title = (tr.title as string) || 'our meeting';
      if (tr.calendar_event_id) {
        const { data: ev } = await supabase
          .from('calendar_events')
          .select('title, attendees')
          .eq('id', tr.calendar_event_id).eq('user_id', user.id).maybeSingle();
        if (ev) {
          attendees = (ev.attendees ?? []) as typeof attendees;
          if (ev.title) title = ev.title as string;
        }
      }
      const others = attendees.filter((a) => a.email && !isSelf(a.email));
      to = others.map((a) => a.email!).filter(Boolean).slice(0, 20);
      recipientName = others[0]?.name || others[0]?.displayName || null;
      voiceRecipient = to[0] ?? null;

      subject = `Follow-up: ${title}`;
      const nextStep = (tr.suggested_next_step as string) || '';
      context = [
        `Meeting: ${title}`,
        (tr.summary as string) ? `Summary:\n${(tr.summary as string).slice(0, 2000)}` : '',
        nextStep ? `Suggested next step: ${nextStep}` : '',
      ].filter(Boolean).join('\n\n');
      task = intent?.trim()
        ? intent.trim()
        : `Write a brief follow-up email to the meeting attendees, summarizing what was decided and confirming the next step. Keep it warm and concise.`;
    } else if (kind === 'commitment') {
      // entityId = the commitment id. Recipient = its counterparty; source thread's sender as fallback.
      const { data: c } = await supabase
        .from('commitments')
        .select('id, description, counterparty, direction, source, source_id, due_date')
        .eq('id', entityId).eq('user_id', user.id).maybeSingle();
      if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 });

      let email = extractEmail(c.counterparty as string | null);
      recipientName = extractName(c.counterparty as string | null);
      let sourceSubject: string | null = null;
      let sourceBody: string | null = null;
      if ((!email || !recipientName) && c.source === 'email' && c.source_id) {
        const { data: e } = await supabase
          .from('emails')
          .select('subject, body, from_name, from_address')
          .eq('id', c.source_id).eq('user_id', user.id).maybeSingle();
        if (e) {
          sourceSubject = (e.subject as string) || null;
          sourceBody = typeof e.body === 'string' ? (e.body as string).replace(/\s+/g, ' ').trim().slice(0, 1500) : null;
          if (!email && !isSelf(e.from_address as string)) email = extractEmail(e.from_address as string);
          if (!recipientName) recipientName = (e.from_name as string) || extractName(e.from_address as string);
        }
      }
      if (email && !isSelf(email)) to = [email];
      voiceRecipient = to[0] ?? null;

      subject = sourceSubject ? `Re: ${sourceSubject}` : `Following up`;
      context = [
        `What you owe / committed to: ${c.description ?? ''}`,
        (c.due_date as string) ? `Due: ${c.due_date}` : '',
        recipientName ? `Recipient: ${recipientName}` : '',
        sourceBody ? `From the original message:\n${sourceBody}` : '',
      ].filter(Boolean).join('\n\n');
      task = intent?.trim()
        ? intent.trim()
        : `Write a short email delivering (or clearly setting a time for) what you committed to: "${c.description ?? ''}". Address ${recipientName || 'the recipient'} directly, be helpful and specific.`;
    } else {
      // awareness | email — entityId = an inbox item id. Recipient = the sender. Draft a reply.
      const { data: item } = await supabase
        .from('inbox_items')
        .select('id, work_title, source_data')
        .eq('id', entityId).eq('user_id', user.id).maybeSingle();
      if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });
      const sd = (item.source_data ?? {}) as Record<string, unknown>;
      const from = String(sd.from || sd.from_address || '');
      const email = extractEmail(from);
      recipientName = (sd.from_name as string) || extractName(from);
      if (email && !isSelf(email)) to = [email];
      voiceRecipient = to[0] ?? null;

      const subj = String(sd.subject || item.work_title || '');
      subject = subj ? (/^re:/i.test(subj) ? subj : `Re: ${subj}`) : 'Re: your message';
      context = [
        subj ? `Subject: ${subj}` : '',
        from ? `From: ${from}` : '',
        typeof sd.body === 'string' ? `Message:\n${(sd.body as string).slice(0, 2500)}` : '',
      ].filter(Boolean).join('\n\n');
      task = intent?.trim()
        ? intent.trim()
        : `Write a concise, appropriate reply to the message below in ${userName}'s voice.`;
    }

    // Draft in the user's voice — same voice block the reply drafter uses (per-recipient tone).
    let body = '';
    try {
      const voiceBlock = await buildVoiceBlock(user.id, voiceRecipient, supabase).catch(() => '');
      const { client: ai, model } = await getAIClient(user.id, 'conversation', supabase);
      const res = await aiCreate(ai, {
        model, max_tokens: 600, temperature: 0.6,
        messages: [{ role: 'user', content:
          `${voiceBlock ? voiceBlock + '\n\n' : ''}` +
          `You are ${userName}. ${task}\n\n` +
          `Write the message in ${userName}'s voice and sign as ${userName} — NEVER sign as anyone else. ` +
          `Return ONLY the message body — no subject line, no preamble, no surrounding quotes. Keep it ready to send.\n\n` +
          `--- CONTEXT ---\n${context}` }],
      });
      body = res.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      console.error('[compose/draft] drafting failed:', e);
    }

    return NextResponse.json({
      to,
      cc: [],
      subject,
      bodyHTML: body ? paraHTML(body) : '',
      recipientName: recipientName ?? null,
    });
  } catch (error) {
    console.error('[compose/draft] error:', error);
    return NextResponse.json({ error: 'Could not draft the message.' }, { status: 500 });
  }
}
