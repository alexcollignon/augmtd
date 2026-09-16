// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROOM'S OWN SHAPE, ONCE (owner screenshot, Sep 8 — the white void).
//
// The route-level `loading.tsx` was built to stop a soft nav freezing on the previous room. But the
// void the owner photographed was NOT that boundary: `EntityRoom` renders
// `conversation={rail ? <ItemRail…/> : null}`, and while `rail` is null the whole conversation
// column renders NOTHING — a blank page, after the segment resolved, with the header already
// painted around it. Two different moments, one shape needed, so the shape lives here and both
// consume it: the route boundary before the segment answers, and the room itself before its view
// lands. A second copy would drift, and a drifting skeleton is worse than none — the fill would
// re-layout instead of landing where its ghost sat (T21's law).
//
// Deliberately dumb: no data, no hooks, no client JS. It exists to be instant, so it is safe in a
// server `loading.tsx` and in a client room alike.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The conversation column's ghost — the room's anatomy in order: the PINNED brief card, the quiet
 * turns beneath it, and the composer holding the floor. The 760px cap is the room's own column.
 */
export function RoomConversationSkeleton({ turnRows = 3, composer = true }: {
  /** How many turn ghosts sit under the pinned card. */
  turnRows?: number;
  /** The composer floor. Off where the host already renders its own composer beneath. */
  composer?: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col" aria-hidden>
      <div className="flex-1 min-h-0 overflow-hidden flex justify-center px-6 pt-8">
        <div className="w-full max-w-[760px] flex flex-col gap-6">
          {/* The pinned card — the brief's paragraph, in the card it actually wears. */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-neutral-200/70 bg-white p-4">
            <div className="h-3 w-full rounded bg-neutral-100 animate-pulse" style={{ animationDelay: '60ms' }} />
            <div className="h-3 w-11/12 rounded bg-neutral-100 animate-pulse" style={{ animationDelay: '90ms' }} />
            <div className="h-3 w-4/5 rounded bg-neutral-100 animate-pulse" style={{ animationDelay: '120ms' }} />
          </div>
          {Array.from({ length: turnRows }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-xl border border-neutral-200/70 bg-white p-4">
              <div className="h-3 rounded bg-neutral-100 animate-pulse" style={{ width: `${52 + (i % 3) * 14}%`, animationDelay: `${150 + i * 70}ms` }} />
              <div className="h-2.5 rounded bg-neutral-100 animate-pulse" style={{ width: `${68 + (i % 2) * 12}%`, animationDelay: `${180 + i * 70}ms` }} />
            </div>
          ))}
        </div>
      </div>
      {/* The composer's ghost holds the seat so the column doesn't jump when the real one mounts. */}
      {composer && (
        <div className="flex-shrink-0 flex justify-center px-6 pb-6 pt-2">
          <div className="w-full max-w-[760px] h-11 rounded-xl border border-neutral-200/70 bg-white" />
        </div>
      )}
    </div>
  );
}
