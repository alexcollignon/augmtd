import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/inbox/[id]/attachment?filename=contract.pdf
// Returns a 60-second signed URL for downloading an attachment stored in Supabase Storage.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: itemId } = await params;
  const filename = request.nextUrl.searchParams.get('filename');

  if (!filename) {
    return NextResponse.json({ error: 'Missing filename parameter' }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load inbox item — must belong to the user
    const { data: item, error: itemError } = await supabase
      .from('inbox_items')
      .select('id, source_data')
      .eq('id', itemId)
      .eq('user_id', user.id)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Find the matching attachment by filename
    const attachments: Array<{ filename: string; storagePath: string }> =
      item.source_data?.attachments || [];
    const attachment = attachments.find(a => a.filename === filename);

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Generate a 60-second signed URL
    const { data: signedData, error: signError } = await supabase.storage
      .from('email-attachments')
      .createSignedUrl(attachment.storagePath, 60);

    if (signError || !signedData?.signedUrl) {
      console.error('[Attachment] Failed to generate signed URL:', signError);
      return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 });
    }

    return NextResponse.json({ signedUrl: signedData.signedUrl });
  } catch (error) {
    console.error('[Attachment] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
