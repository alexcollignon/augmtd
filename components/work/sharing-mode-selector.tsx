'use client';

interface Props {
  value: 'live' | null;
  onChange: (mode: 'live' | null) => void;
  disabled?: boolean;
}

export function SharingModeSelector({ value, onChange, disabled }: Props) {
  const shared = value === 'live';
  return (
    <div className="flex rounded-lg border border-neutral-200 overflow-hidden w-fit">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(null)}
        className={`px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          !shared ? 'bg-neutral-800 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50 border-r border-neutral-200'
        }`}
      >
        Private
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('live')}
        className={`px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          shared ? 'bg-indigo-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'
        }`}
      >
        Shared
      </button>
    </div>
  );
}
