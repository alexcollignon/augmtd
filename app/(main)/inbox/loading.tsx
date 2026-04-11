export default function InboxLoading() {
  return (
    <div className="flex-1 min-h-0 relative overflow-hidden">
      <div className="absolute inset-0 flex min-h-0 overflow-hidden">

        {/* Left: email list skeleton */}
        <div className="w-[272px] flex-shrink-0 flex flex-col bg-neutral-50 p-2">
          <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
            {/* Toolbar */}
            <div className="flex-shrink-0 h-10 border-b border-neutral-100 flex items-center px-3 gap-2">
              <div className="w-24 h-5 rounded-full bg-neutral-100 animate-pulse" />
              <div className="ml-auto flex items-center gap-1">
                <div className="w-5 h-5 rounded bg-neutral-100 animate-pulse" />
                <div className="w-5 h-5 rounded bg-neutral-100 animate-pulse" />
              </div>
            </div>
            {/* Item rows */}
            <div className="flex-1 overflow-hidden p-2 flex flex-col gap-1.5">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5 px-2 py-2.5 rounded-xl">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 rounded bg-neutral-100 animate-pulse"
                      style={{ width: `${55 + (i % 3) * 15}%`, animationDelay: `${i * 60}ms` }}
                    />
                    <div className="ml-auto h-2.5 w-8 rounded bg-neutral-100 animate-pulse" />
                  </div>
                  <div
                    className="h-2.5 rounded bg-neutral-100 animate-pulse"
                    style={{ width: `${70 + (i % 4) * 8}%`, animationDelay: `${i * 60 + 30}ms` }}
                  />
                  <div
                    className="h-2.5 rounded bg-neutral-100 animate-pulse"
                    style={{ width: `${40 + (i % 3) * 10}%`, animationDelay: `${i * 60 + 60}ms` }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center: detail panel skeleton */}
        <div className="flex-1 min-w-0 flex flex-col bg-neutral-50 pl-2 pt-2 pb-2">
          <div className="flex-1 rounded-2xl bg-white shadow-sm overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-neutral-100">
              <div className="h-4 w-3/5 rounded bg-neutral-100 animate-pulse mb-3" />
              <div className="flex items-center gap-2">
                <div className="h-3 w-24 rounded bg-neutral-100 animate-pulse" />
                <div className="h-3 w-32 rounded bg-neutral-100 animate-pulse" />
              </div>
            </div>
            {/* Body */}
            <div className="flex-1 px-6 pt-5 flex flex-col gap-3">
              <div className="h-3 rounded bg-neutral-100 animate-pulse w-full" style={{ animationDelay: '60ms' }} />
              <div className="h-3 rounded bg-neutral-100 animate-pulse w-5/6" style={{ animationDelay: '90ms' }} />
              <div className="h-3 rounded bg-neutral-100 animate-pulse w-4/5" style={{ animationDelay: '120ms' }} />
              <div className="h-3 rounded bg-neutral-100 animate-pulse w-full" style={{ animationDelay: '150ms' }} />
              <div className="h-3 rounded bg-neutral-100 animate-pulse w-3/4" style={{ animationDelay: '180ms' }} />
              <div className="mt-2 h-3 rounded bg-neutral-100 animate-pulse w-full" style={{ animationDelay: '210ms' }} />
              <div className="h-3 rounded bg-neutral-100 animate-pulse w-5/6" style={{ animationDelay: '240ms' }} />
            </div>
          </div>
        </div>

        {/* Right: calendar panel skeleton */}
        <div className="w-[316px] flex-shrink-0 flex flex-col bg-neutral-50 p-2">
          <div className="flex-1 rounded-2xl bg-white shadow-sm overflow-hidden flex flex-col">
            {/* Calendar header */}
            <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-neutral-100 flex items-center gap-2">
              <div className="h-3.5 w-24 rounded bg-neutral-100 animate-pulse" />
              <div className="ml-auto h-3.5 w-14 rounded bg-neutral-100 animate-pulse" />
            </div>
            {/* Calendar grid placeholder */}
            <div className="px-4 pt-3 flex flex-col gap-2">
              <div className="grid grid-cols-7 gap-1 mb-1">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="h-2.5 rounded bg-neutral-100 animate-pulse" style={{ animationDelay: `${i * 30}ms` }} />
                ))}
              </div>
              {Array.from({ length: 5 }).map((_, row) => (
                <div key={row} className="grid grid-cols-7 gap-1">
                  {Array.from({ length: 7 }).map((_, col) => (
                    <div
                      key={col}
                      className="h-6 rounded-lg bg-neutral-100 animate-pulse"
                      style={{ animationDelay: `${(row * 7 + col) * 20}ms` }}
                    />
                  ))}
                </div>
              ))}
            </div>
            {/* Upcoming events */}
            <div className="px-4 pt-4 flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1 py-2 border-b border-neutral-50">
                  <div className="h-3 rounded bg-neutral-100 animate-pulse" style={{ width: `${60 + i * 10}%`, animationDelay: `${i * 80}ms` }} />
                  <div className="h-2.5 w-20 rounded bg-neutral-100 animate-pulse" style={{ animationDelay: `${i * 80 + 30}ms` }} />
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
