import { guardFeaturePage } from '@/lib/workspace/guards';
import { ItemDetail, type ItemKind } from '@/components/home/item-detail';

// ── The URL-addressed Home item detail as a FULL PAGE — rendered on a direct visit / refresh /
// deep-link (when NOT soft-navigated from the Home, so the intercepting @modal slot doesn't catch
// it). Renders the SAME ItemDetail as the in-content deep-dive, on the page background with the
// app sidebar already visible from the layout. `kind` (email | meeting | commitment | followup)
// selects the variant; absent → email (the default).
export default async function ItemPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ angle?: string; kind?: string }>;
}) {
  await guardFeaturePage(null);
  const { id } = await params;
  const { angle, kind } = await searchParams;

  return (
    // THE ROOM OWNS ITS CHROME (Sep 7 — the one room grammar): the item room's own 52px header
    // carries back (the BackLink idiom, unchanged: it returns where you came from and falls back
    // to the Home only on a genuinely cold arrival). The page-level back bar it used to wear was
    // a second back affordance stacked on the first — exactly the "two places, one fact" the walk
    // called out. The project room has never had one.
    <div className="flex-1 min-w-0 h-full flex flex-col bg-white">
      <ItemDetail id={id} angle={angle ?? null} kind={(kind as ItemKind) ?? 'email'} />
    </div>
  );
}
