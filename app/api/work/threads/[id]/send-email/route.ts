import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { EmailContent, DocumentArtifact } from '@/lib/types/inbox';
import { sendGmailEmail, EmailAttachment } from '@/lib/google/gmail';
import { sendOutlookEmail } from '@/lib/microsoft/outlook';

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getFileExtForArtifact(type: string): string {
  switch (type) {
    case 'presentation': return 'pptx';
    case 'spreadsheet': return 'xlsx';
    default: return 'docx';
  }
}

// POST /api/work/threads/[id]/send-email
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify thread belongs to user and load artifacts
    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, artifacts, artifact')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const body = await request.json();
    const { artifactId, to, cc, attachArtifactIds = [], connectionId } = body as {
      artifactId: string;
      to?: string;
      cc?: string;
      attachArtifactIds?: string[];
      connectionId?: string;
    };

    // Resolve artifact list (prefer artifacts array, fall back to legacy singular)
    const allArtifacts: DocumentArtifact[] = (() => {
      const arr = (thread.artifacts ?? []) as DocumentArtifact[];
      if (arr.length > 0) return arr;
      if (thread.artifact) return [thread.artifact as DocumentArtifact];
      return [];
    })();

    const emailArtifact = allArtifacts.find((a) => a.id === artifactId);
    if (!emailArtifact || emailArtifact.type !== 'email') {
      return NextResponse.json({ error: 'Email artifact not found' }, { status: 404 });
    }

    const emailContent = emailArtifact.content as EmailContent;
    if (!emailContent) {
      return NextResponse.json({ error: 'Email artifact has no content' }, { status: 422 });
    }

    // Resolve To / CC: request body overrides take precedence
    const resolvedTo = (to?.trim()) || emailContent.to;
    const resolvedCc = (cc?.trim()) || emailContent.cc || '';

    if (!resolvedTo) {
      return NextResponse.json({ error: 'Recipient (To) is required' }, { status: 422 });
    }

    // Download file attachments from storage
    const adminClient = getAdminClient();
    const emailAttachments: EmailAttachment[] = [];

    for (const attachId of attachArtifactIds) {
      const attachArtifact = allArtifacts.find((a) => a.id === attachId);
      if (!attachArtifact?.storage_path) continue;

      const { data: blob, error: dlErr } = await adminClient.storage
        .from('work-artifacts')
        .download(attachArtifact.storage_path);

      if (dlErr || !blob) {
        console.error(`[SendEmail] Failed to download attachment ${attachId}:`, dlErr);
        continue;
      }

      const buffer = Buffer.from(await blob.arrayBuffer());
      const ext = getFileExtForArtifact(attachArtifact.type);
      const filename = `${attachArtifact.title ?? 'document'}.${ext}`;
      const mimeType =
        ext === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        : ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      emailAttachments.push({ filename, content: buffer, mimeType });
    }

    // Fetch the specified connection, or fall back to the latest active one
    let connectionQuery = adminClient
      .from('connections')
      .select('provider, metadata')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('provider', ['gmail', 'outlook']);

    if (connectionId) {
      connectionQuery = connectionQuery.eq('id', connectionId);
    } else {
      connectionQuery = connectionQuery.order('created_at', { ascending: false }).limit(1);
    }

    const { data: connection } = await connectionQuery.single();

    if (!connection) {
      return NextResponse.json({ error: 'No active email connection found' }, { status: 422 });
    }

    const encryptedTokens = (connection.metadata as any)?.tokens as string;
    if (!encryptedTokens) {
      return NextResponse.json({ error: 'Connection has no tokens' }, { status: 422 });
    }

    if (connection.provider === 'gmail') {
      await sendGmailEmail({
        encryptedTokens,
        to: resolvedTo,
        cc: resolvedCc || undefined,
        subject: emailContent.subject,
        body: emailContent.body,
        attachments: emailAttachments,
      });
    } else {
      await sendOutlookEmail({
        encryptedTokens,
        to: resolvedTo,
        cc: resolvedCc || undefined,
        subject: emailContent.subject,
        body: emailContent.body,
        attachments: emailAttachments,
      });
    }

    const sentAt = new Date().toISOString();

    // 1. Persist sent_at + sent_to on the artifact in work_threads.artifacts
    const { data: freshThread } = await adminClient
      .from('work_threads')
      .select('artifacts, artifact')
      .eq('id', threadId)
      .single();

    if (freshThread) {
      const updatedArtifacts = (freshThread.artifacts as DocumentArtifact[] ?? []).map((a) =>
        a.id === artifactId ? { ...a, sent_at: sentAt, sent_to: resolvedTo } : a
      );
      const latestArtifact = updatedArtifacts[updatedArtifacts.length - 1];
      await adminClient
        .from('work_threads')
        .update({ artifacts: updatedArtifacts, artifact: latestArtifact })
        .eq('id', threadId);
    }

    // 2. Log activity signal
    await adminClient.from('learning_signals').insert({
      user_id: user.id,
      signal_type: 'email_sent',
      signal_data: {
        thread_id: threadId,
        artifact_id: artifactId,
        subject: emailContent.subject,
        sent_to: resolvedTo,
        provider: connection.provider,
        sent_at: sentAt,
      },
    }).then(({ error }) => { if (error) console.error('[SendEmail] Signal log error:', error); });

    // 3. Mark linked inbox item completed (if any)
    await adminClient
      .from('inbox_items')
      .update({ execution_status: 'completed' })
      .eq('work_thread_id', threadId)
      .eq('user_id', user.id)
      .then(({ error }) => { if (error) console.error('[SendEmail] Inbox update error:', error); });

    return NextResponse.json({ success: true, sentAt, sentTo: resolvedTo });
  } catch (error) {
    console.error('[SendEmail] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send email' },
      { status: 500 }
    );
  }
}
