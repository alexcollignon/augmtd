import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { listDriveContents } from '@/lib/knowledge/google-drive';
import { listOneDriveContents } from '@/lib/knowledge/onedrive';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get('provider');
  const connectionId = searchParams.get('connection_id');
  const folderId = searchParams.get('folder_id') ?? undefined; // undefined = root

  if (provider !== 'google_drive' && provider !== 'onedrive') {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  const connectionProvider = provider === 'google_drive' ? 'gmail' : 'outlook';

  let query = supabase
    .from('connections')
    .select('id, metadata')
    .eq('user_id', user.id)
    .eq('provider', connectionProvider)
    .eq('status', 'active');

  if (connectionId) query = query.eq('id', connectionId);

  const { data: connections } = await query.limit(1);
  const connection = connections?.[0];
  const encryptedTokens = connection?.metadata?.tokens;

  if (!encryptedTokens) {
    return NextResponse.json(
      { error: `No active ${connectionProvider} connection` },
      { status: 400 }
    );
  }

  try {
    const items =
      provider === 'google_drive'
        ? await listDriveContents(encryptedTokens, folderId)
        : await listOneDriveContents(encryptedTokens, folderId);

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[KnowledgeFolders] Error listing contents:', err);
    return NextResponse.json({ error: 'Failed to list folder contents' }, { status: 500 });
  }
}
