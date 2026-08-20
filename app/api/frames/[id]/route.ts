import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { FRAME_MAX_BYTES } from '@/lib/frames/validate-frame';
import type { DocumentArtifact } from '@/lib/types/inbox';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SERVING DOOR for frames — GET /api/frames/[id] → { html, title, provenance }.
//
// WHY JSON AND NOT text/html: an HTML response served from OUR origin would be same-origin with
// the app if it were ever navigated to or iframed by URL — its inline script would sit next to our
// session cookies. The frame's HTML therefore travels as a STRING inside JSON and is mounted only
// through `FrameCard`'s sandboxed `srcDoc` iframe (opaque origin, no allow-same-origin). One
// renderer, one boundary — frames plan law 2.
//
// OWNERSHIP: the artifact is resolved by scanning the CALLER'S OWN threads' artifacts (the same
// shape `read_team_work` / the artifact-open path use — jsonb `contains` is unreliable for partial
// object matches, so we fetch the caller-scoped rows and find in JS). The caller's own RLS client
// does the scoping read; the admin client is touched only AFTER that proof, to pull the file out of
// storage.
//
// NO EXISTENCE ORACLE: unknown id, someone else's artifact, and "exists but isn't a frame" all
// return the SAME 404 body. A caller can never learn that an id exists.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: artifactId } = await params;
  // VERSIONS ARE THE OWNER'S (THE FRAME SERIES): `?v=<n>` reads one PREVIOUS generation of this
  // same identity. Only the owner's authed door offers it — the public token door serves the
  // present and ignores `?v`, because old numbers are a retention surface a link must not widen.
  const askedRaw = _request.nextUrl.searchParams.get('v');
  const askedVersion = askedRaw && /^\d+$/.test(askedRaw) ? Number(askedRaw) : null;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // The caller's own threads only — ownership is the query's WHERE clause, not a later check.
    const { data: threads } = await supabase
      .from('work_threads')
      .select('artifacts')
      .eq('user_id', user.id)
      .not('artifacts', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(400);

    let artifact: DocumentArtifact | null = null;
    for (const t of (threads ?? []) as Array<{ artifacts: DocumentArtifact[] | null }>) {
      const arts = Array.isArray(t.artifacts) ? t.artifacts : [];
      const hit = arts.find((a) => a?.id === artifactId);
      if (hit) { artifact = hit; break; }
    }

    // Not the caller's, doesn't exist, or isn't a frame — one indistinguishable answer.
    if (!artifact || artifact.type !== 'frame' || !artifact.storage_path) return NOT_FOUND();

    // ── THE SERIES (frames plan, THE FRAME SERIES): the head carries its previous generations.
    // Meta is always served (the version picker); bytes follow `?v` when one was asked for. ──
    const series = artifact as unknown as {
      version?: number;
      versions?: Array<{ v?: number; storagePath?: string; generatedAt?: string | null }>;
    };
    const stored = Array.isArray(series.versions) ? series.versions : [];
    const headVersion = typeof series.version === 'number' && series.version > 0
      ? series.version
      : (stored.length ? Math.max(...stored.map((e) => (typeof e?.v === 'number' ? e.v : 0))) + 1 : 1);
    const versionsMeta = [
      ...stored
        .filter((e) => typeof e?.v === 'number' && e.storagePath)
        .map((e) => ({ v: e.v as number, generatedAt: e.generatedAt ?? null })),
      { v: headVersion, generatedAt: artifact.generated_at ?? null },
    ];

    // A version that does not exist is INDISTINGUISHABLE from an unknown id — same 404 body.
    let servePath = artifact.storage_path;
    let viewing: { v: number; generatedAt: string | null } | null = null;
    if (askedVersion !== null && askedVersion !== headVersion) {
      const hit = stored.find((e) => e?.v === askedVersion && e.storagePath);
      if (!hit) return NOT_FOUND();
      servePath = hit.storagePath as string;
      viewing = { v: askedVersion, generatedAt: hit.generatedAt ?? null };
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: fileData, error: downloadError } = await adminClient.storage
      .from('work-artifacts')
      .download(servePath);

    if (downloadError || !fileData) {
      console.error('[Frames] storage download error:', downloadError);
      return NextResponse.json({ error: 'Failed to retrieve frame' }, { status: 500 });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    // The validator's ceiling is the serving ceiling — a file that outgrew it never renders.
    if (buffer.length > FRAME_MAX_BYTES) {
      console.warn('[Frames] frame exceeds the validator cap, refusing to serve:', artifactId, buffer.length);
      return NextResponse.json({ error: 'Failed to retrieve frame' }, { status: 500 });
    }

    // THE STRUCTURAL STAMP (law 3): the chip is worn only from a stored provenance field —
    // never inferred from the HTML. Read where the production door may have stamped it.
    const loose = artifact as unknown as {
      data_provenance?: { computed?: boolean } | null;
      content?: { provenance?: { computed?: boolean } | null } | null;
      source_data?: { provenance?: { computed?: boolean } | null } | null;
      binding?: { workflowId?: string; refresh?: string } | null;
    };
    const provenance =
      loose.data_provenance ??
      loose.content?.provenance ??
      loose.source_data?.provenance ??
      null;

    // THE BINDING, ADDITIVE (law 4): the derivation this frame re-materializes from, so the
    // surfaces can say quietly that it is live. THIS DOOR STAYS EXACT-VERSION — it serves the
    // artifact the caller addressed, never a newer sibling: a version is a record, and the Frames
    // tab already lists the series newest-first. Only the SHARE resolves to the living newest.
    const binding = loose.binding?.workflowId
      ? { workflowId: String(loose.binding.workflowId) }
      : null;

    return NextResponse.json({
      html: buffer.toString('utf-8'),
      title: artifact.title ?? 'Frame',
      provenance: provenance ? { computed: provenance.computed === true } : null,
      binding,
      // Meta only, oldest-first as stored (the head is last — the present).
      versions: versionsMeta,
      // Present ONLY when a past generation is on screen; the head serves `null`.
      viewing,
    });
  } catch (error) {
    console.error('[Frames] Error:', error);
    return NextResponse.json({ error: 'Failed to retrieve frame' }, { status: 500 });
  }
}
