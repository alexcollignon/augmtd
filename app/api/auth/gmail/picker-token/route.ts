import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOAuth2Client } from '@/lib/google/oauth';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const connectionId = request.nextUrl.searchParams.get('connectionId');
  if (!connectionId) return NextResponse.json({ error: 'Missing connectionId' }, { status: 400 });

  const { data: connection } = await supabase
    .from('connections')
    .select('id, metadata')
    .eq('id', connectionId)
    .eq('user_id', user.id)
    .eq('provider', 'gmail')
    .eq('status', 'active')
    .single();

  if (!connection) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

  const encryptedTokens = connection.metadata?.tokens;
  if (!encryptedTokens) return NextResponse.json({ error: 'No tokens found' }, { status: 400 });

  const tokens = JSON.parse(Buffer.from(encryptedTokens, 'base64').toString());
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // Refresh proactively if expiring within 5 minutes
  const expiryDate: number | undefined = tokens.expiry_date;
  if (expiryDate && expiryDate < Date.now() + 5 * 60 * 1000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
    const newEncrypted = Buffer.from(JSON.stringify(credentials)).toString('base64');
    await supabase
      .from('connections')
      .update({ metadata: { ...connection.metadata, tokens: newEncrypted } })
      .eq('id', connectionId);
    return NextResponse.json({ accessToken: credentials.access_token });
  }

  return NextResponse.json({ accessToken: tokens.access_token });
}
