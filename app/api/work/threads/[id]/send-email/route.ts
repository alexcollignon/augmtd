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
    const { artifactId, to, cc, attachArtifactIds = [] } = body as {
      artifactId: string;
      to?: string;
      cc?: string;
      attachArtifactIds?: string[];
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

    // Fetch an active email connection for this user
    const { data: connection } = await adminClient
      .from('connections')
      .select('provider, encrypted_tokens')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('provider', ['gmail', 'outlook'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!connection) {
      return NextResponse.json({ error: 'No active email connection found' }, { status: 422 });
    }

    if (connection.provider === 'gmail') {
      await sendGmailEmail({
        encryptedTokens: connection.encrypted_tokens,
        to: resolvedTo,
        cc: resolvedCc || undefined,
        subject: emailContent.subject,
        body: emailContent.body,
        attachments: emailAttachments,
      });
    } else {
      await sendOutlookEmail({
        encryptedTokens: connection.encrypted_tokens,
        to: resolvedTo,
        cc: resolvedCc || undefined,
        subject: emailContent.subject,
        body: emailContent.body,
        attachments: emailAttachments,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[SendEmail] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send email' },
      { status: 500 }
    );
  }
}
