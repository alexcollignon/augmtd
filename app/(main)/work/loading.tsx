export default function WorkLoading() {
  return (
    <div className="flex flex-1 min-w-0 overflow-hidden bg-neutral-50">
      {/* Thread list skeleton */}
      <div className="w-[220px] flex-shrink-0 flex flex-col bg-neutral-50 p-2">
        <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden p-3 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-neutral-100 animate-pulse" />
          ))}
        </div>
      </div>
      {/* Main chat area skeleton */}
      <div className="flex-1 flex flex-col p-2">
        <div className="flex-1 rounded-2xl bg-white shadow-sm" />
      </div>
    </div>
  );
}
