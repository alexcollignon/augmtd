import { createClient } from '@/lib/supabase/server';
import { findFrameArtifact } from '@/lib/frames/share';
import { FrameFullView } from './frame-full-view';
import { usableVersions, type FrameVersionMeta } from './frame-version-picker';

// ── THE FRAME HAS AN ADDRESS (frames plan, Phase 1): every frame is deep-linkable at
// /frames/[id] — the full-screen view of the SAME renderer the cards mount. Auth is the (main)
// layout's job (it redirects to /login); scoping is the API's (a foreign or unknown id gets the
// same honest not-found line the card renders, never a redirect loop). Phase 3's share tokens ride
// this same route — one address, two doors.

export const metadata = { title: 'Frame — AUGMTD' };

export default async function FramePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // THE BINDING + THE SERIES, read through THE ONE RESOLUTION (law 4 · THE FRAME SERIES). The bar
  // needs two things: is this frame a living series (the share moment's second sentence), and what
  // earlier generations exist (the version picker). Both ride the SAME caller-scoped artifact read,
  // on the caller's own RLS session — never a second download of the payload just to read meta.
  // Failure = live:false and no history (a bar that over-claims is worse than one that stays quiet).
  let live = false;
  let versions: FrameVersionMeta[] = [];
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const artifact = await findFrameArtifact(supabase, user.id, id);
      const loose = artifact as unknown as {
        binding?: { workflowId?: string } | null;
        versions?: unknown;
      } | null;
      live = !!loose?.binding?.workflowId;
      versions = usableVersions(loose?.versions);
    }
  } catch { /* the card's own door still tells the truth about the frame */ }

  return <FrameFullView artifactId={id} live={live} versions={versions} />;
}
