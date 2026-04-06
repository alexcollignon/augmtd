'use client';

import { useEffect, useRef } from 'react';

interface LiveNotepadProps {
  title: string;
  elapsed: number;
  notes: string;
  onNotesChange: (notes: string) => void;
  /** 'recording' for in-person, 'bot' for meeting assistant */
  source: 'recording' | 'bot';
}

function formatElapsed(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function LiveNotepad({
  title,
  elapsed,
  notes,
  onNotesChange,
  source,
}: LiveNotepadProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the textarea when it appears
  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
          <span className="text-[11px] font-mono font-medium text-red-600">
            {source === 'recording' ? formatElapsed(elapsed) : 'Live'}
          </span>
          <span className="text-[11px] text-neutral-400">
            {source === 'recording' ? 'Recording in-person' : 'Meeting assistant recording'}
          </span>
        </div>
        <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
      </div>

      {/* Notes area */}
      <div className="flex-1 px-6 pb-6">
        <textarea
          ref={textareaRef}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Jot down key points, decisions, action items…&#10;&#10;Your notes guide what the AI will emphasise in the summary."
          className="w-full h-full min-h-[200px] text-[14px] text-neutral-800 leading-relaxed resize-none outline-none placeholder:text-neutral-300 bg-transparent"
        />
      </div>
    </div>
  );
}
