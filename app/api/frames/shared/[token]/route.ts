import { NextRequest, NextResponse } from 'next/server';
import { FRAME_MAX_BYTES } from '@/lib/frames/validate-frame';
import { findFrameArtifact, resolveShareToken, resolveLivingFrame } from '@/lib/frames/share';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PUBLIC SERVING DOOR — GET /api/frames/shared/[token] → { html, title, provenance }.
//
// No auth by design: the token IS the credential (frames plan law 6). Everything else is the authed
// door's law, unchanged — JSON only (never text/html: an HTML response from our origin would put a
// frame's inline script next to our session cookies), the same shape, the same single not-found
// body for unknown token / revoked token / vanished artifact / not-a-frame.
//
// REVOCATION IS IMMEDIATE: the share row is re-read on EVERY view and the response is `no-store`.
// A revoked link must die now, not when a cache decides — law 6's revocation clause is worthless if
// a CDN keeps answering for it.
//
// The token is never logged. Ownership is not "checked" here so much as CARRIED: the share row
// names the owner, and the artifact is resolved against THAT user's threads only.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const NOT_FOUND = () =>
  NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const share = await resolveShareToken(adminClient, token);
    if (!share) return NOT_FOUND();

    // Scoped to the SHARE ROW'S owner — the same resolution the authed door performs for a caller.
    const stored = await findFrameArtifact(adminClient, share.userId, share.artifactId);
    if (!stored || !stored.storage_path) return NOT_FOUND();

    // THE BINDING IS THE LIFE (law 4) — the public link is where living matters. A bound
    // (workflow-born) frame resolves to the NEWEST generation of its series, so a dashboard link a
    // client is holding is never a frozen month-old picture. An unbound one-shot resolves to
    // itself, byte for byte. The AUTHED address stays exact-version by design: a version is a
    // record, and the owner's own door must be able to point at one.
    const { artifact, live } = await resolveLivingFrame(adminClient, share.userId, stored);
    if (!artifact.storage_path) return NOT_FOUND();

    const { data: fileData, error: downloadError } = await adminClient.storage
      .from('work-artifacts')
      .download(artifact.storage_path);

    if (downloadError || !fileData) {
      console.error('[Frames] shared storage download error:', downloadError?.message);
      return NextResponse.json(
        { error: 'Failed to retrieve frame' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    // The validator's ceiling is the serving ceiling — a file that outgrew it never renders.
    if (buffer.length > FRAME_MAX_BYTES) {
      return NextResponse.json(
        { error: 'Failed to retrieve frame' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // THE STRUCTURAL STAMP (law 3) — the chip is worn only from a stored provenance field.
    const loose = artifact as unknown as {
      data_provenance?: { computed?: boolean } | null;
      content?: { provenance?: { computed?: boolean } | null } | null;
      source_data?: { provenance?: { computed?: boolean } | null } | null;
    };
    const provenance =
      loose.data_provenance ??
      loose.content?.provenance ??
      loose.source_data?.provenance ??
      null;

    return NextResponse.json(
      {
        html: buffer.toString('utf-8'),
        title: artifact.title ?? 'Frame',
        provenance: provenance ? { computed: provenance.computed === true } : null,
        // The public page may whisper it: this link updates with every run.
        live,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[Frames] shared door error:', (error as Error)?.message);
    return NextResponse.json(
      { error: 'Failed to retrieve frame' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
