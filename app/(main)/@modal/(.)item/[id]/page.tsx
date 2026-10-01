import { redirect } from 'next/navigation';
import { ItemDetailModal } from '@/components/home/item-detail-modal';
import { itemAddressOf } from '@/lib/room/presentation';

// ── Intercepting route: when the Home soft-navigates to /item/[id], this catches it and renders the
// item-detail as a centered wide modal OVER the Home (the URL is real — /item/[id] — so back /
// refresh / deep-link work; a hard visit falls through to the full page at (main)/item/[id]).
export default async function InterceptedItemModal({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ angle?: string; kind?: string }>;
}) {
  const { id } = await params;
  const { angle, kind } = await searchParams;
  // THE ADDRESS LAW (the full page's rule, the same parser): a prefixed id redirects to the canonical form.
  const addr = itemAddressOf(id, kind ?? null, { angle });
  if (addr.redirect) redirect(addr.redirect);
  return <ItemDetailModal id={addr.id} />;
}
