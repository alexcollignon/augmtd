import { FrameCard } from '@/components/frames/frame-card';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PUBLIC FULL SCREEN — /frames/shared/[token]. Frames plan Phase 3, law 6.
//
// DELIBERATELY OUTSIDE app/(main): no sidebar, no workspace chrome, and NO AUTH. The recipient of a
// share link is not a user of this app and must never be asked to become one — a dead link telling
// someone's client to log in would be wrong twice (it leaks that we exist as a login wall, and it
// hides the actual answer, which is "this link no longer works").
//
// ONE RENDERER (law 2): FrameCard, with the token door as its `endpoint`. Same sandboxed opaque-
// origin iframe as every other surface — the public page gets no looser boundary than the app's.
// The card's `artifactId` is only a fetch key when `endpoint` is given (and its "Open" link never
// renders in `full` mode), so the token stands in for it honestly.
//
// An unknown or revoked token gets the card's own honest line — "This frame isn't available." —
// because the serving door answers 404 and the card renders failure as a sentence, not a crash.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const metadata = { title: 'Shared frame — AUGMTD' };
export const dynamic = 'force-dynamic';

export default async function SharedFramePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <div className="h-screen w-full flex flex-col bg-white">
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-2.5 border-b border-neutral-200">
        <span className="text-[11px] text-neutral-400 tracking-wide">Shared via AUGMTD</span>
      </div>
      <div className="flex-1 min-h-0">
        <FrameCard artifactId={token} endpoint={`/api/frames/shared/${token}`} full />
      </div>
    </div>
  );
}
