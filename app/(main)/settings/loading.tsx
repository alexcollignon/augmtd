export default function SettingsLoading() {
  return (
    <>
      {/* Settings left nav skeleton */}
      <div className="w-[200px] flex-shrink-0 p-2">
        <div className="h-full rounded-2xl bg-white shadow-sm p-3 flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 rounded-lg bg-neutral-100 animate-pulse" />
          ))}
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex-1 p-2">
        <div className="h-full rounded-2xl bg-white shadow-sm" />
      </div>
    </>
  );
}
