import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/log';
import { SEED_KIT_BUCKET, readSeedKit, type SeedKit, type SeedKitFolder } from '@/lib/workspace/seed-kb';

export const maxDuration = 60;

// THE COMPANY SEED KIT — the superadmin's curation door.
// GET returns the manifest; POST adds one file to a named folder; DELETE removes a file or a
// whole folder (storage AND manifest). The bytes live in the private `seed-kits` bucket at
// <companyId>/<folder>/<file>; the manifest lives on companies.settings.seed_kit and is written
// read-modify-write so branding and every other settings key survive untouched.

const MAX_SIZE = 15 * 1024 * 1024;

// The extractor's REAL repertoire (lib/attachments/text-extractor.ts + the indexer's pdf path).
// A file the knowledge base cannot read is not a kit document — reject it at the door.
// Legacy .doc is DELIBERATELY absent: the extractor returns null for it, so it would index with
// NO text and be silently invisible to every workflow reading the folder — the honesty floor
// rejects it here with the fix in the message instead.
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/plain', // markdown IS plain text to the extractor
};

// Browsers report empty/odd mimes for Office files — the extension is the truth of last resort.
function resolveMime(filename: string, browserMime: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const byExt = MIME_BY_EXT[ext];
  if (byExt) return byExt;
  if (Object.values(MIME_BY_EXT).includes(browserMime)) return browserMime;
  return null;
}

// Storage paths get a sanitized name; the manifest keeps the display name the admin uploaded.
function safeSegment(s: string): string {
  return s.normalize('NFKD').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'file';
}

function validFolderName(name: unknown): name is string {
  return typeof name === 'string'
    && name.trim().length >= 1 && name.trim().length <= 60
    && !name.includes('/') && !name.includes('\\');
}

type Guard = {
  error?: NextResponse;
  user?: { id: string; email?: string };
  admin?: SupabaseClient;
  company?: { id: string; name: string; settings: unknown };
};

async function guard(id: string): Promise<Guard> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!await isSuperAdmin(user.id, supabase)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };

  const { createClient: createAdmin } = await import('@supabase/supabase-js');
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: company } = await admin.from('companies').select('id, name, settings').eq('id', id).maybeSingle();
  if (!company) return { error: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }) };

  return { user, admin, company };
}

/** Read-modify-write MERGE — seed_kit is replaced, every other settings key is preserved. */
async function writeManifest(admin: SupabaseClient, id: string, folders: SeedKitFolder[]): Promise<SeedKit> {
  const { data: fresh } = await admin.from('companies').select('settings').eq('id', id).maybeSingle();
  const settings = ((fresh?.settings ?? {}) as Record<string, unknown>);
  const seedKit: SeedKit = { folders, updated_at: new Date().toISOString() };
  await admin.from('companies').update({ settings: { ...settings, seed_kit: seedKit } }).eq('id', id);
  return seedKit;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const g = await guard(id);
    if (g.error) return g.error;
    return NextResponse.json({ seedKit: readSeedKit(g.company!.settings) ?? { folders: [], updated_at: '' } });
  } catch (e) {
    console.error('[platform-admin/seed-kit] GET error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const g = await guard(id);
    if (g.error) return g.error;
    const { admin, company, user } = g;

    const form = await request.formData();
    const folderRaw = form.get('folder');
    const file = form.get('file') as File | null;
    if (!validFolderName(folderRaw)) {
      return NextResponse.json({ error: 'Folder name must be 1-60 characters and contain no slashes' }, { status: 400 });
    }
    const folderName = (folderRaw as string).trim();
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File too large (max 15 MB)' }, { status: 400 });
    // Directory-picked files arrive with their RELATIVE PATH as the multipart filename (found
    // live: "Pack/02_Finance/AP07.pdf" as a display name) — the display name is the BASENAME,
    // always; the folder is already decided by the `folder` field.
    const baseName = (file.name.split(/[\\/]/).pop() ?? file.name).trim() || file.name;
    const mime = resolveMime(baseName, file.type);
    if (!mime) {
      const legacyDoc = /\.doc$/i.test(baseName);
      return NextResponse.json({
        error: legacyDoc
          ? `${baseName}: legacy .doc can't be text-extracted — save it as .docx (or PDF) and upload that.`
          : `Unsupported file type: ${baseName}`,
      }, { status: 400 });
    }

    // Private bucket — idempotent create ("already exists" is fine).
    await admin!.storage.createBucket(SEED_KIT_BUCKET, { public: false, fileSizeLimit: MAX_SIZE }).catch(() => {});

    const path = `${id}/${safeSegment(folderName)}/${safeSegment(baseName)}`;
    const { error: upErr } = await admin!.storage.from(SEED_KIT_BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: mime, upsert: true });
    if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

    const kit = readSeedKit(company!.settings) ?? { folders: [], updated_at: '' };
    const folders = kit.folders.slice();
    let folder = folders.find(f => f.name.toLowerCase() === folderName.toLowerCase());
    if (!folder) { folder = { name: folderName, files: [] }; folders.push(folder); }
    // Same path = a replacement, not a duplicate row.
    folder.files = folder.files.filter(f => f.path !== path);
    folder.files.push({ name: baseName, path, mime, size: file.size });

    const seedKit = await writeManifest(admin!, id, folders);

    await logAudit({
      adminClient: admin!,
      actorUserId: user!.id,
      actorEmail: user!.email,
      action: AUDIT_ACTIONS.SEED_KIT_UPDATE,
      targetType: 'workspace',
      targetId: id,
      workspaceId: id,
      metadata: { op: 'add', folder: folderName, file: baseName, size: file.size },
    });

    return NextResponse.json({ seedKit });
  } catch (e) {
    console.error('[platform-admin/seed-kit] POST error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const g = await guard(id);
    if (g.error) return g.error;
    const { admin, company, user } = g;

    const body = await request.json().catch(() => ({})) as { folder?: string; file?: string };
    if (!validFolderName(body.folder)) return NextResponse.json({ error: 'folder required' }, { status: 400 });
    const folderName = body.folder.trim();

    const kit = readSeedKit(company!.settings) ?? { folders: [], updated_at: '' };
    const folder = kit.folders.find(f => f.name.toLowerCase() === folderName.toLowerCase());
    if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });

    // One file, or the whole folder.
    const doomed = body.file ? folder.files.filter(f => f.name === body.file) : folder.files;
    if (body.file && doomed.length === 0) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    if (doomed.length) {
      const { error: rmErr } = await admin!.storage.from(SEED_KIT_BUCKET).remove(doomed.map(f => f.path));
      // A storage miss must not strand the manifest entry — log and drop it anyway.
      if (rmErr) console.error('[platform-admin/seed-kit] storage remove failed:', rmErr.message);
    }

    let folders: SeedKitFolder[];
    if (body.file) {
      const remaining = folder.files.filter(f => f.name !== body.file);
      folders = kit.folders.map(f => (f === folder ? { ...f, files: remaining } : f));
    } else {
      folders = kit.folders.filter(f => f !== folder);
    }

    const seedKit = await writeManifest(admin!, id, folders);

    await logAudit({
      adminClient: admin!,
      actorUserId: user!.id,
      actorEmail: user!.email,
      action: AUDIT_ACTIONS.SEED_KIT_UPDATE,
      targetType: 'workspace',
      targetId: id,
      workspaceId: id,
      metadata: { op: 'remove', folder: folderName, file: body.file ?? null, removed: doomed.length },
    });

    return NextResponse.json({ seedKit });
  } catch (e) {
    console.error('[platform-admin/seed-kit] DELETE error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
