export default function MeetingsLoading() {
  return (
    <main className="flex-1 min-h-0 flex overflow-hidden bg-neutral-50">
      {/* Left panel skeleton */}
      <div className="w-[240px] flex-shrink-0 p-2">
        <div className="h-full rounded-2xl bg-white shadow-sm p-3 flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-neutral-100 animate-pulse" />
          ))}
        </div>
      </div>
      {/* Center panel skeleton */}
      <div className="flex-1 p-2">
        <div className="h-full rounded-2xl bg-white shadow-sm" />
      </div>
      {/* Right panel skeleton */}
      <div className="w-[280px] flex-shrink-0 p-2">
        <div className="h-full rounded-2xl bg-white shadow-sm" />
      </div>
    </main>
  );
}
