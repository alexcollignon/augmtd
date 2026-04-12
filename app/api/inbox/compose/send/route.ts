import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendGmailEmail, EmailAttachment } from '@/lib/google/gmail';
import { sendOutlookEmail } from '@/lib/microsoft/outlook';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { to, cc, bcc, subject, body: emailBody, attachments: rawAttachments, connectionId } = body as {
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      attachments?: Array<{ filename: string; content: string; mimeType: string }>;
      connectionId?: string;
    };
    const attachments: EmailAttachment[] = (rawAttachments || []).map(a => ({
      filename: a.filename,
      content: Buffer.from(a.content, 'base64'),
      mimeType: a.mimeType,
    }));

    if (!to?.trim() || !emailBody?.trim().replace(/<[^>]*>/g, '')) {
      return NextResponse.json({ error: 'to and body are required' }, { status: 400 });
    }

    let connQuery = supabase
      .from('connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('provider', ['gmail', 'outlook']);

    if (connectionId) {
      connQuery = (connQuery as any).eq('id', connectionId);
    } else {
      connQuery = (connQuery as any).order('created_at', { ascending: true }).limit(1);
    }

    const { data: connection, error: connErr } = await (connQuery as any).maybeSingle();

    if (connErr || !connection) {
      return NextResponse.json({ error: 'No active email connection found' }, { status: 400 });
    }

    if (connection.provider === 'gmail') {
      await sendGmailEmail({
        encryptedTokens: connection.metadata.tokens,
        to,
        cc,
        bcc,
        subject,
        body: emailBody,
        attachments,
      });
    } else if (connection.provider === 'outlook') {
      await sendOutlookEmail({
        encryptedTokens: connection.metadata.tokens,
        to,
        cc,
        bcc,
        subject,
        body: emailBody,
        attachments,
      });
    } else {
      return NextResponse.json({ error: 'Unsupported email provider' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[ComposeSend] POST error:', err);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
