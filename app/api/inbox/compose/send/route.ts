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
    const { to, cc, subject, body: emailBody, attachments: rawAttachments } = body as {
      to: string;
      cc?: string;
      subject: string;
      body: string;
      attachments?: Array<{ filename: string; content: string; mimeType: string }>;
    };
    const attachments: EmailAttachment[] = (rawAttachments || []).map(a => ({
      filename: a.filename,
      content: Buffer.from(a.content, 'base64'),
      mimeType: a.mimeType,
    }));

    if (!to?.trim() || !emailBody?.trim()) {
      return NextResponse.json({ error: 'to and body are required' }, { status: 400 });
    }

    const { data: connections, error: connErr } = await supabase
      .from('connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('provider', ['gmail', 'outlook'])
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (connErr || !connections) {
      return NextResponse.json({ error: 'No active email connection found' }, { status: 400 });
    }

    const connection = connections;

    if (connection.provider === 'gmail') {
      await sendGmailEmail({
        encryptedTokens: connection.encrypted_tokens,
        to,
        cc,
        subject,
        body: emailBody,
        attachments,
      });
    } else if (connection.provider === 'outlook') {
      await sendOutlookEmail({
        encryptedTokens: connection.encrypted_tokens,
        to,
        cc,
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
