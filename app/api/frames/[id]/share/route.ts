import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { findFrameArtifact, getOrCreateShare, revokeShare } from '@/lib/frames/share';
import { getWorkspaceFeatures } from '@/lib/workspace/features';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SHARE DOOR — POST creates (or returns) the link · DELETE revokes it. Frames plan law 6.
//
// OWNERSHIP FIRST, exactly as the authed serving door does it: the artifact is resolved against the
// CALLER'S OWN threads through the CALLER'S OWN RLS client, before the admin client exists. Not the
// caller's, unknown, or not a frame → the SAME 404. Only the owner shares.
//
// THE SOVEREIGN FLOOR: `features.email === false` (the corporate/air-gapped class) NEVER gets a
// share link. This is the ONE refusal that speaks its reason — it is POLICY, not secrecy, and a
// silent 404 there would send an admin hunting a bug instead of reading a boundary. It is checked
// BEFORE any row is written, so a sovereign workspace cannot leave a token behind.
//
// The token itself is never logged, never echoed into an error, and never returned as an absolute
// URL — the client composes the origin, so the server keeps no opinion about which host is public.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

async function ownedFrame(id: string) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const artifact = await findFrameArtifact(supabase, user.id, id);
  if (!artifact) return { error: NOT_FOUND() };

  return { userId: user.id, supabase };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: artifactId } = await params;
  try {
    const resolved = await ownedFrame(artifactId);
    if ('error' in resolved) return resolved.error;

    // THE SOVEREIGN FLOOR — before any write.
    const features = await getWorkspaceFeatures(resolved.userId, resolved.supabase);
    if (features.email === false) {
      return NextResponse.json({ error: 'Sharing is disabled for this workspace.' }, { status: 403 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { token, created } = await getOrCreateShare(adminClient, resolved.userId, artifactId);

    return NextResponse.json({ url: `/frames/shared/${token}`, created });
  } catch (error) {
    // The message is deliberately generic — a share error must never carry a token.
    console.error('[Frames] share error:', (error as Error)?.message);
    return NextResponse.json({ error: 'Failed to create the link' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: artifactId } = await params;
  try {
    const resolved = await ownedFrame(artifactId);
    if ('error' in resolved) return resolved.error;

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // Idempotent by design: revoking a link that was never created is still a revoked link.
    await revokeShare(adminClient, resolved.userId, artifactId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Frames] revoke error:', (error as Error)?.message);
    return NextResponse.json({ error: 'Failed to revoke the link' }, { status: 500 });
  }
}
