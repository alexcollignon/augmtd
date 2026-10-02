// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MATERIAL DOOR'S FILE HAND (owner request, Oct 2): "Run with material" took pasted text only and
// pointed a person with a file elsewhere ("upload it to Knowledge and pin it in Studio"). This route
// lets the sheet take the file itself: upload → extract → index into the caller's own Knowledge →
// hand back `{ kbFileId, name, chars }`, which the sheet then sends to THE ONE RUN DOOR
// (POST /api/workflows/[id]/run `{ material: { files: [{ kbFileId }] } }`). It starts no run itself.
//
// Everything a file IS here — allowlist, 4MB ceiling, user-scoped storage, the shared indexer, the
// honest 422, nothing hollow left behind, NO door seam fired — is lib/workflows/material-ingest.ts,
// the same function the input station's attach rides. This route owns only what is its own:
//   • VISIBILITY = THE RUN DOOR'S: the workflow is read through the caller's RLS client (owner or a
//     member it is shared with), behind the same `studio` feature gate. A refusal reads as missing.
//   • PROVENANCE: `workflow:<id>` until a run carries the file (the run door re-stamps `run:<id>`).
//   • DELETE takes back ONLY what this door made and no run has used yet (ref still
//     `workflow:<id>`, stored under the caller's own material prefix) — "Remove" in the sheet never
//     deletes a document the person already had in Knowledge, nor one a run has read.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireFeature, handleWorkspaceError } from '@/lib/workspace/require-feature';

// Extraction + embedding of a ≤4MB document runs inline (the text is real at return).
export const maxDuration = 300;

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function visibleWorkflow(
  supabase: Awaited<ReturnType<typeof createClient>>, workflowId: string,
): Promise<boolean> {
  const { data, error } = await supabase.from('workflows').select('id').eq('id', workflowId).maybeSingle();
  return !error && !!data;
}

const prefixFor = (userId: string, workflowId: string) => `${userId}/supply/material/${workflowId}`;

// POST /api/workflows/[id]/material-upload — multipart, field `file`. → { kbFileId, name, chars }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workflowId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try { await requireFeature('studio', supabase, user.id); } catch (err) { return handleWorkspaceError(err); }
    if (!(await visibleWorkflow(supabase, workflowId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const { ingestMaterialFile } = await import('@/lib/workflows/material-ingest');
    const res = await ingestMaterialFile(adminClient(), user.id, file, {
      storagePrefix: prefixFor(user.id, workflowId),
      ref: `workflow:${workflowId}`,
      oversizeRemedy: 'Upload it in Knowledge instead and pin it to this workflow in Studio.',
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ kbFileId: res.kbFileId, name: res.name, chars: res.chars });
  } catch (e) {
    console.error('[material-upload]', e);
    return NextResponse.json({ error: 'That file did not go through — try again.' }, { status: 500 });
  }
}

// DELETE /api/workflows/[id]/material-upload?kbFileId=… — take back an unused upload of this door.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workflowId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const kbFileId = (request.nextUrl.searchParams.get('kbFileId') ?? '').trim();
    if (!kbFileId) return NextResponse.json({ error: 'kbFileId is required' }, { status: 400 });

    const admin = adminClient();
    const { data: row, error } = await admin.from('knowledge_files')
      .select('id, storage_path, origin')
      .eq('id', kbFileId).eq('user_id', user.id).maybeSingle();
    if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
    const r = row as { storage_path?: string | null; origin?: { ref?: string } | null } | null;
    const path = String(r?.storage_path ?? '');
    // ONLY OURS, ONLY UNUSED: anything else is kept, and the answer is the same quiet "kept".
    if (!r || r.origin?.ref !== `workflow:${workflowId}` || !path.startsWith(`${prefixFor(user.id, workflowId)}/`)) {
      return NextResponse.json({ removed: false });
    }
    try { await admin.storage.from('drive-uploads').remove([path]); } catch { /* best-effort */ }
    const { error: cErr } = await admin.from('knowledge_chunks').delete().eq('file_id', kbFileId);
    const { error: fErr } = await admin.from('knowledge_files').delete().eq('id', kbFileId).eq('user_id', user.id);
    if (cErr || fErr) return NextResponse.json({ error: 'failed' }, { status: 500 });
    return NextResponse.json({ removed: true });
  } catch (e) {
    console.error('[material-upload] delete', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
