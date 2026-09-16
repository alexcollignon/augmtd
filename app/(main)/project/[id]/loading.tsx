import { RoomConversationSkeleton } from '@/components/room/room-skeleton';

// THE NAV PAINTS WITHIN A FRAME (owner walk, Sep 7 — "clicking across projects takes so long").
// Without a route-level loading boundary, a soft nav to another project holds the PREVIOUS room on
// screen until the server segment resolves — the click reads as a freeze. This skeleton is the
// room's own shape (the 52px header line, then the centered conversation column), in the house
// pulse idiom. Deliberately dumb and light: no data, no client JS — it exists to be instant.
export default function ProjectRoomLoading() {
  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <div className="w-full h-full min-h-0 flex flex-col bg-neutral-50">
        {/* The header line — back chevron · name · state · the right-hand chrome. */}
        <div className="flex-shrink-0 flex items-center gap-3 h-[52px] px-5 bg-white border-b border-neutral-200/80">
          <div className="w-4 h-4 rounded bg-neutral-100 animate-pulse" />
          <div className="h-3.5 w-44 rounded bg-neutral-100 animate-pulse" />
          <div className="h-3 w-16 rounded-full bg-neutral-100 animate-pulse" style={{ animationDelay: '60ms' }} />
          <div className="flex-1" />
          <div className="h-6 w-6 rounded-full bg-neutral-100 animate-pulse" style={{ animationDelay: '90ms' }} />
          <div className="h-8 w-20 rounded-lg bg-neutral-100 animate-pulse" style={{ animationDelay: '120ms' }} />
        </div>

        {/* The conversation column — ONE shape, shared with the room's own null-view state
            (components/room/room-skeleton.tsx). The skeleton stands in the page's own shape
            (T21's law): what fills in lands where its ghost already sat, so the paint is a fill
            and never a re-layout. */}
        <RoomConversationSkeleton />
      </div>
    </div>
  );
}
