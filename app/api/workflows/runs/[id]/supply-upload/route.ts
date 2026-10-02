// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ATTACH DOOR (relay canvas, THE WAVE part 1) — a parked input station takes a FILE.
//
// The station already took a paste and a document already in Knowledge. The thing a person most
// often has at run time is neither: it is a file on their desk. This route is the third hand —
// upload → extract → index into Knowledge → hand the caller a `kbFileId` it then supplies through
// THE ONE RESUME DOOR (`{ input: { kbFileId } }`). It answers no station itself: it makes the
// material real, and the existing door remains the only place a run is answered.
//
// TWO LAWS, BOTH DELIBERATE, BOTH GATED:
//
//  1. A SUPPLY IS AN ANSWER, NOT AN ARRIVAL. This route NEVER fires the `file` door seam — no
//     `checkSourceReactions`, no `onIndexed` listener handed to the indexer. A person directing a
//     file AT A SPECIFIC PARKED RUN is not a thing "arriving" in Knowledge: firing doors here would
//     let answering run 1 of a workflow spawn run 2 of the same workflow off its own answer. The
//     shared indexer takes its door seam as an EXPLICIT argument precisely so a non-door caller
//     like this one cannot fire it by accident — we simply never pass it.
//
//  2. THE TEXT IS REAL AT RETURN. Extraction is SYNCHRONOUS (the chat-attach idiom, not Drive's
//     background confirm): the station refuses a document with no text in hand, so returning a
//     kbFileId whose content is still pending would hand the person a door that then refuses them.
//     No readable text → an honest 422 naming the remedy, and the storage object AND any KB row are
//     removed — never a hollow row left behind claiming to be material.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Extraction + embedding of a ≤4MB document runs inline (law 2) — this ceiling covers it.
export const maxDuration = 300;

// THE ALLOWLIST, THE SIZE CEILING (the chat-attach guard's class, 4MB), the user-scoped storage, the
// shared indexer, the honest 422 and the nothing-hollow cleanup all live in ONE place now —
// lib/workflows/material-ingest.ts — shared with the Run-with-material sheet's file door. This route
// keeps what is ITS OWN: the run's visibility rule and the provenance (`run:<id>`).

// POST /api/workflows/runs/[id]/supply-upload  — multipart, field `file`.
// → { kbFileId, name }, which the caller hands to the resume door as { input: { kbFileId } }.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // THE SAME VISIBILITY RULE AS THE DOOR IT FEEDS — `canResumeRun`, imported, never re-implemented.
    // A refusal is indistinguishable from a missing run: a stranger learns nothing by probing here,
    // and the upload door can never be wider than the answer door it exists to serve.
    const { canResumeRun } = await import('@/lib/workflows/handoffs');
    const auth = await canResumeRun(admin, runId, user.id);
    if (!auth.ok || !auth.run) return NextResponse.json({ error: 'run not found' }, { status: 404 });

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    // User-scoped, and marked as what it is: material handed to a specific run. NOTE: no door seam
    // is handed to the ingest (law 1 — it has none to hand; see material-ingest.ts).
    const { ingestMaterialFile } = await import('@/lib/workflows/material-ingest');
    const res = await ingestMaterialFile(admin, user.id, file, {
      storagePrefix: `${user.id}/supply/${runId}`,
      ref: `run:${runId}`,
      oversizeRemedy: 'Upload it in Knowledge instead, then pin it here.',
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

    return NextResponse.json({
      kbFileId: res.kbFileId,
      name: res.name,
    });
  } catch (e) {
    console.error('[supply-upload]', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
