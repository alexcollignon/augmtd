export default function InboxCardSkeleton() {
  return (
    <div className="relative w-full px-5 py-4 flex items-start space-x-4 animate-pulse">
      {/* Icon skeleton */}
      <div className="flex-shrink-0 pt-0.5">
        <div className="w-9 h-9 rounded-lg bg-gray-200" />
      </div>

      {/* Content skeleton */}
      <div className="flex-1 min-w-0 space-y-2">
        {/* Title */}
        <div className="h-4 bg-gray-200 rounded w-3/4" />

        {/* Subtitle */}
        <div className="h-3 bg-gray-200 rounded w-1/2" />

        {/* Description */}
        <div className="h-3 bg-gray-200 rounded w-full" />

        {/* Metadata */}
        <div className="flex items-center space-x-2">
          <div className="h-2 bg-gray-200 rounded w-16" />
          <div className="h-2 bg-gray-200 rounded w-20" />
        </div>
      </div>

      {/* CTA button skeleton */}
      <div className="flex-shrink-0 pt-0.5">
        <div className="h-8 w-24 bg-gray-200 rounded-lg" />
      </div>
    </div>
  );
}
