'use client';

import { StopIcon } from '@heroicons/react/24/solid';

interface ActiveRecordingBannerProps {
  title: string;
  elapsed: number;
  onStop: () => void;
  onClick: () => void;
}

function formatElapsed(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function ActiveRecordingBanner({
  title,
  elapsed,
  onStop,
  onClick,
}: ActiveRecordingBannerProps) {
  return (
    <div className="mx-2 mb-1">
      <div
        onClick={onClick}
        className="flex items-center gap-2.5 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg cursor-pointer hover:bg-red-100/60 transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-neutral-900 truncate">{title}</p>
          <span className="text-[11px] font-mono font-medium text-red-600">
            {formatElapsed(elapsed)}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-neutral-900 text-white hover:bg-neutral-700 transition-colors flex-shrink-0"
          title="Stop &amp; transcribe"
        >
          <StopIcon className="w-3 h-3" />
          Stop
        </button>
      </div>
    </div>
  );
}
