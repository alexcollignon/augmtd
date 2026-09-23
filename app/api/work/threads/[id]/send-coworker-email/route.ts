import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { sendCoworkerEmail } from '@/lib/tools';
import { claimCommit, recordCommitResult, releaseCommitClaim } from '@/lib/work/commit-door';

// User-confirmed send of a coworker email draft (Resend, from the coworker's own address).
// The model NEVER hits this — it only drafts (compose_email); the user reviews/edits the
// card and clicks Send, which lands here. Distinct from /send-email (connected Gmail/Outlook).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: threadId } = await params;
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { to, cc, subject, body, agentId, draftId } = await req.json();

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Thread must belong to the user.
    const { data: thread } = await admin.from('work_threads').select('user_id').eq('id', threadId).maybeSingle();
    if (!thread || thread.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // The sending coworker must belong to the user.
    if (agentId) {
      const { data: agent } = await admin.from('custom_agents').select('id').eq('id', agentId).eq('user_id', user.id).maybeSingle();
      if (!agent) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const mail = {
      to: Array.isArray(to) ? to : [],
      cc: Array.isArray(cc) ? cc : [],
      subject: String(subject ?? ''),
      body: String(body ?? ''),
    };

    // The draft's own message row — read ONCE, used for the already-sent check and the stamp.
    type DraftMsg = { id: string; metadata: { email_drafts?: Array<{ id?: string; sent_at?: string }> } | null };
    let draftMsg: DraftMsg | null = null;
    let draftIdx = -1;
    if (draftId) {
      const { data: msgs } = await admin.from('work_messages')
        .select('id, metadata').eq('thread_id', threadId)
        .order('created_at', { ascending: false }).limit(25);
      for (const m of (msgs ?? []) as DraftMsg[]) {
        const drafts = m.metadata?.email_drafts;
        if (!Array.isArray(drafts)) continue;
        const i = drafts.findIndex(d => d.id === draftId);
        if (i >= 0) { draftMsg = m; draftIdx = i; break; }
      }
      // A SENT DRAFT STAYS SENT (W0.4): a second click on a card whose draft already went is the
      // truth to report, never a second email.
      const stamped = draftMsg?.metadata?.email_drafts?.[draftIdx]?.sent_at;
      if (stamped) return NextResponse.json({ ok: true, alreadySent: true, sentAt: stamped });
    }

    // ── THE COMMIT DOOR (W0.4 — EXACTLY-ONCE DEEDS): one atomic claim per draft (or, draftless, per
    // exact message). A double-click loses the claim and never mails twice; a failure releases it.
    const idemKey = draftId
      ? `coworker_email:${threadId}:${String(draftId)}`
      : `coworker_email:${threadId}:${createHash('sha256').update(JSON.stringify(mail)).digest('hex').slice(0, 24)}`;
    const claim = await claimCommit(supabase, user.id, {
      idempotencyKey: idemKey, actionType: 'coworker_email',
      payload: { threadId, draftId: draftId ?? null, to: mail.to, cc: mail.cc, subject: mail.subject },
    });
    if (claim.status === 'duplicate') {
      if (claim.priorResult == null) {
        return NextResponse.json({ error: 'That email is already on its way.' }, { status: 409 });
      }
      return NextResponse.json({ ok: true, alreadySent: true, result: claim.priorResult });
    }

    let res: Awaited<ReturnType<typeof sendCoworkerEmail>>;
    try {
      res = await sendCoworkerEmail(admin, user.id, agentId, mail);
    } catch (e) {
      if (claim.status === 'claimed') await releaseCommitClaim(supabase, user.id, idemKey);
      throw e;
    }
    if (!res.ok) {
      if (claim.status === 'claimed') await releaseCommitClaim(supabase, user.id, idemKey);
      return NextResponse.json({ error: res.error }, { status: 400 });
    }
    if (claim.status === 'claimed') {
      await recordCommitResult(supabase, user.id, idemKey, `Sent to ${mail.to[0] ?? 'recipient'}`);
    }

    // Persist the "sent" state on the draft in its message metadata so reload shows it sent.
    if (draftMsg && draftIdx >= 0) {
      const drafts = [...(draftMsg.metadata?.email_drafts ?? [])];
      drafts[draftIdx] = { ...drafts[draftIdx], sent_at: new Date().toISOString() };
      const { error: stampErr } = await admin.from('work_messages')
        .update({ metadata: { ...draftMsg.metadata, email_drafts: drafts } }).eq('id', draftMsg.id);
      if (stampErr) console.error('[send-coworker-email] sent_at stamp failed (the ledger holds the send):', stampErr.message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[send-coworker-email] error:', err);
    return NextResponse.json({ error: 'Failed to send.' }, { status: 500 });
  }
}
