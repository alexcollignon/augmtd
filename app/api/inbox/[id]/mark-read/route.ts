import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOAuth2Client } from '@/lib/google/oauth';
import { google } from 'googleapis';
import { getGraphClient } from '@/lib/microsoft/outlook';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get inbox item + linked email + connection in one go
    const { data: item } = await supabase
      .from('inbox_items')
      .select('id, is_read, source_id, connection_id, source_data')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (item.is_read) return NextResponse.json({ ok: true }); // already read

    const { data: connection } = await supabase
      .from('connections')
      .select('id, provider, metadata')
      .eq('id', item.connection_id)
      .eq('user_id', user.id)
      .single();

    if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    const encryptedTokens: string = connection.metadata?.tokens;
    if (!encryptedTokens) return NextResponse.json({ error: 'No tokens' }, { status: 400 });

    // Fetch the email row to get the provider-internal ID from metadata
    const { data: email } = await supabase
      .from('emails')
      .select('metadata')
      .eq('id', item.source_id)
      .eq('user_id', user.id)
      .single();

    // Mark read on the provider
    if (connection.provider === 'gmail') {
      const gmailId = (email?.metadata as any)?.gmail_id;
      if (gmailId) {
        try {
          const tokens = JSON.parse(Buffer.from(encryptedTokens, 'base64').toString());
          const oauth2Client = getOAuth2Client();
          oauth2Client.setCredentials(tokens);
          if (tokens.expiry_date && tokens.expiry_date < Date.now() + 5 * 60 * 1000) {
            const { credentials } = await oauth2Client.refreshAccessToken();
            oauth2Client.setCredentials(credentials);
            const newEncrypted = Buffer.from(JSON.stringify(credentials)).toString('base64');
            await supabase.from('connections').update({ metadata: { ...connection.metadata, tokens: newEncrypted } }).eq('id', connection.id);
          }
          const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
          await gmail.users.messages.modify({
            userId: 'me',
            id: gmailId,
            requestBody: { removeLabelIds: ['UNREAD'] },
          });
        } catch (err) {
          console.error('[mark-read] Gmail modify failed:', err);
          // Non-fatal — still mark read in our DB
        }
      }
    } else {
      // Outlook
      const outlookId = (email?.metadata as any)?.outlook_id;
      if (outlookId) {
        try {
          const onTokenRefresh = async (newTokens: { accessToken: string; refreshToken: string; expiresOn: string }) => {
            const newEncrypted = Buffer.from(JSON.stringify(newTokens)).toString('base64');
            await supabase.from('connections').update({ metadata: { ...connection.metadata, tokens: newEncrypted } }).eq('id', connection.id);
          };
          const graphClient = await getGraphClient(encryptedTokens, onTokenRefresh);
          await graphClient.api(`/me/messages/${outlookId}`).patch({ isRead: true });
        } catch (err) {
          console.error('[mark-read] Outlook patch failed:', err);
          // Non-fatal
        }
      }
    }

    // Update our DB
    await supabase.from('inbox_items').update({ is_read: true }).eq('id', id).eq('user_id', user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[mark-read] error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
