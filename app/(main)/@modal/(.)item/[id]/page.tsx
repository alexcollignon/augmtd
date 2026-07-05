import { ItemDetailModal } from '@/components/home/item-detail-modal';

// ── Intercepting route: when the Home soft-navigates to /item/[id], this catches it and renders the
// item-detail as a centered wide modal OVER the Home (the URL is real — /item/[id] — so back /
// refresh / deep-link work; a hard visit falls through to the full page at (main)/item/[id]).
export default async function InterceptedItemModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItemDetailModal id={id} />;
}
