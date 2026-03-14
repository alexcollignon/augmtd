import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { readDriveFile } from '@/lib/knowledge/google-drive';
import { readOneDriveFile } from '@/lib/knowledge/onedrive';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const fileId = request.nextUrl.searchParams.get('fileId');
    if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 });

    // Get file metadata + source id (RLS-safe via user client)
    const { data: file } = await supabase
      .from('knowledge_files')
      .select('id, filename, mime_type, provider_file_id, source_id')
      .eq('id', fileId)
      .eq('user_id', user.id)
      .single();

    if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    // Get source + connection tokens via admin client (knowledge_sources has restrictive RLS)
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: source } = await adminClient
      .from('knowledge_sources')
      .select('provider')
      .eq('id', file.source_id)
      .single();

    if (!source) return NextResponse.json({ error: 'Source not found' }, { status: 404 });

    const connectionProvider = source.provider === 'google_drive' ? 'gmail' : 'outlook';
    const { data: connection } = await adminClient
      .from('connections')
      .select('metadata')
      .eq('user_id', user.id)
      .eq('provider', connectionProvider)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (!connection?.metadata?.tokens) {
      return NextResponse.json({ error: 'No active connection found' }, { status: 404 });
    }

    const encryptedTokens: string = connection.metadata.tokens;

    let content: Buffer | string | null;
    if (source.provider === 'google_drive') {
      content = await readDriveFile(encryptedTokens, file.provider_file_id, file.mime_type);
    } else {
      content = await readOneDriveFile(encryptedTokens, file.provider_file_id);
    }

    if (!content) return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });

    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    return NextResponse.json({
      filename: file.filename,
      content: buffer.toString('base64'),
      mimeType: file.mime_type || 'application/octet-stream',
    });
  } catch (err) {
    console.error('[kb/attachment] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch file' }, { status: 500 });
  }
}
