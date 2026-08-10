import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';

export const maxDuration = 30;

// POST /api/platform-admin/companies/[id]/logo — upload a client logo for the branded entry.
// Public `branding` bucket (the landing serves unauthenticated; the sidebar co-brand is a plain
// <img>); raster images only (no SVG — direct navigation to a public SVG executes script).
// Returns { url } and stamps settings.branding.logo_url in the same motion.

const MAX_SIZE = 2 * 1024 * 1024;
const ALLOWED: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: 'Logo too large (max 2 MB)' }, { status: 400 });
    const ext = ALLOWED[file.type];
    if (!ext) return NextResponse.json({ error: 'PNG, JPEG, or WebP only' }, { status: 400 });

    const { createClient: createAdmin } = await import('@supabase/supabase-js');
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: company } = await admin.from('companies').select('id, settings').eq('id', id).maybeSingle();
    if (!company) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    // Public bucket — idempotent create ("already exists" is fine).
    await admin.storage.createBucket('branding', { public: true, fileSizeLimit: MAX_SIZE }).catch(() => {});

    const path = `logos/${id}.${ext}`;
    const { error: upErr } = await admin.storage.from('branding')
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
    if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

    const { data: pub } = admin.storage.from('branding').getPublicUrl(path);
    const url = `${pub.publicUrl}?v=${Date.now()}`; // cache-bust: upsert keeps the same path

    const settings = (company.settings ?? {}) as Record<string, unknown>;
    const branding = (settings.branding ?? {}) as Record<string, unknown>;
    await admin.from('companies').update({ settings: { ...settings, branding: { ...branding, logo_url: url } } }).eq('id', id);

    return NextResponse.json({ url });
  } catch (e) {
    console.error('[platform-admin/logo] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
