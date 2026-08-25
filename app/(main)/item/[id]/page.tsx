import { BackLink } from '@/components/ui';
import { guardFeaturePage } from '@/lib/workspace/guards';
import { ItemDetail, type ItemKind } from '@/components/home/item-detail';

// ── The URL-addressed Home item detail as a FULL PAGE — rendered on a direct visit / refresh /
// deep-link (when NOT soft-navigated from the Home, so the intercepting @modal slot doesn't catch
// it). Renders the SAME ItemDetail as the in-content deep-dive (with a ← Back to Home bar), on the
// page background with the app sidebar already visible from the layout. `kind` (email | meeting |
// commitment | followup) selects the variant; absent → email (the default).
export default async function ItemPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ angle?: string; kind?: string }>;
}) {
  await guardFeaturePage('home');
  const { id } = await params;
  const { angle, kind } = await searchParams;

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-white">
      {/* Back bar — mirrors the deep-dive shell */}
      <div className="flex-shrink-0 flex items-center px-5 py-3 border-b border-neutral-200 bg-white/95 backdrop-blur">
        {/* THE SAME CLASS as the frame address: this page is reached from an entity room, a
            workflow's standing commitment, the timeline — not only the Home. Back returns where
            you came from; the Home is the fallback for a genuinely cold arrival (a refresh or a
            deep link), which is this page's whole reason to exist. The @modal twin keeps its own
            router.back() self-dismiss — that intercept ALWAYS has the Home underneath it. */}
        <BackLink fallback="/home">Back to Home</BackLink>
      </div>
      {/* Body — the ItemDetail owns its own scroll (thread scrolls, composer docks) AND its own
          centering/width: single column caps at the classic readable width; a two-column breakdown
          widens (main + tasks panel) via DeepDiveShell. */}
      <div className="flex-1 min-h-0 flex flex-col px-2 sm:px-4">
        <ItemDetail id={id} angle={angle ?? null} kind={(kind as ItemKind) ?? 'email'} />
      </div>
    </div>
  );
}
