import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// DELETE /api/drive/augmtd-files/batch
// Body: { providerFileIds: string[] }
// De-indexes augmtd files (meeting transcripts, workflow artifacts) from the KB
// by deleting knowledge_files rows matched by provider_file_id.
// The underlying meeting/workflow data is not affected.
export async function DELETE(request: NextRequest) {
  try {
    const { providerFileIds } = await request.json() as { providerFileIds: string[] };

    if (!Array.isArray(providerFileIds) || providerFileIds.length === 0) {
      return NextResponse.json({ error: 'providerFileIds must be a non-empty array' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch matching knowledge_files rows — filtered to this user
    const { data: fileRows, error: fetchError } = await adminClient
      .from('knowledge_files')
      .select('id')
      .in('provider_file_id', providerFileIds)
      .eq('user_id', user.id);

    if (fetchError) {
      return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
    }

    if (!fileRows || fileRows.length === 0) {
      return NextResponse.json({ deleted: 0 });
    }

    const ownedIds = fileRows.map((f) => f.id);

    // Delete chunks then files (chunks cascade but be explicit)
    await adminClient.from('knowledge_chunks').delete().in('file_id', ownedIds);
    await adminClient.from('knowledge_files').delete().in('id', ownedIds);

    return NextResponse.json({ deleted: ownedIds.length });
  } catch (error) {
    console.error('[Drive/AugmtdFiles/Batch] Error:', error);
    return NextResponse.json({ error: 'Failed to deindex files' }, { status: 500 });
  }
}
