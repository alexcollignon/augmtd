import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
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
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />Back to Home
        </Link>
      </div>
      {/* Body — the ItemDetail owns its own scroll (thread scrolls, composer docks at the bottom). */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="mx-auto max-w-3xl w-full flex-1 min-h-0 flex flex-col">
          <ItemDetail id={id} angle={angle ?? null} kind={(kind as ItemKind) ?? 'email'} />
        </div>
      </div>
    </div>
  );
}
