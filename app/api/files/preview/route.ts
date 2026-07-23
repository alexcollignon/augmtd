// POST /api/files/preview — resolve a file to something VIEWABLE (5A.3): a short-lived signed URL
// for binaries (PDF/images render inline) or the extracted text. Owner-scoped; refs come from the
// room's Files list. { ref: {kind:'kb', id} | {kind:'attachment', path} } → { url?, text?, mime? }.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { ref } = (await request.json()) as { ref?: { kind: string; id?: string; path?: string } };
    if (!ref?.kind) return NextResponse.json({ error: 'ref required' }, { status: 400 });
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    if (ref.kind === 'kb' && ref.id) {
      const { data: f } = await supabase.from('knowledge_files')
        .select('storage_path, mime_type, extracted_text, filename').eq('id', ref.id).eq('user_id', user.id).maybeSingle();
      if (!f) return NextResponse.json({ error: 'not found' }, { status: 404 });
      if (f.storage_path) {
        const { data: signed } = await admin.storage.from('drive-uploads').createSignedUrl(f.storage_path as string, 600);
        if (signed?.signedUrl) return NextResponse.json({ url: signed.signedUrl, mime: f.mime_type ?? null, name: f.filename });
      }
      return NextResponse.json({ text: String(f.extracted_text ?? '').slice(0, 20000) || null, name: f.filename });
    }
    if (ref.kind === 'deliverable' && ref.id) {
      const { data: d } = await supabase.from('item_deliverables')
        .select('title, content').eq('id', ref.id).eq('user_id', user.id).maybeSingle();
      if (!d) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json({ text: String(d.content ?? '').slice(0, 20000) || null, name: d.title ?? 'Prepared work' });
    }
    if (ref.kind === 'attachment' && ref.path) {
      // Owner check is structural: attachment paths are `${userId}/…` by construction.
      if (!String(ref.path).startsWith(`${user.id}/`)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      const { data: signed } = await admin.storage.from('email-attachments').createSignedUrl(ref.path, 600);
      if (signed?.signedUrl) return NextResponse.json({ url: signed.signedUrl });
      return NextResponse.json({ error: 'unavailable' }, { status: 404 });
    }
    return NextResponse.json({ error: 'unsupported ref' }, { status: 400 });
  } catch (e) {
    console.error('[files/preview]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
