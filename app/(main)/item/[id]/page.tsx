import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { guardFeaturePage } from '@/lib/workspace/guards';
import { ItemDetail } from '@/components/home/item-detail';

// ── The URL-addressed email item detail as a FULL PAGE — rendered on a direct visit / refresh /
// deep-link (when NOT soft-navigated from the Home, so the intercepting @modal slot doesn't catch
// it). Same content component as the modal (components/home/item-detail). v1: email items only.
export default async function ItemPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ angle?: string }>;
}) {
  await guardFeaturePage('home');
  const { id } = await params;
  const { angle } = await searchParams;

  return (
    <div className="flex-1 min-w-0 h-full overflow-y-auto bg-neutral-50/40">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6">
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors mb-4"
        >
          <ArrowLeftIcon className="w-4 h-4" />Back to Home
        </Link>
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
          <ItemDetail id={id} angle={angle ?? null} />
        </div>
      </div>
    </div>
  );
}
