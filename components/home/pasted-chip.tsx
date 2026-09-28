'use client';

// THE PASTED-TEXT CHIP (W22.B — components/home/paste-material.ts has the law). One chip per pasted
// piece: its name and size, expandable to the full text (rendered as TEXT — never markup), and, in the
// composer, removable before send.

import React, { useState } from 'react';
import { DocumentTextIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { pasteSize, type PastedPiece } from './paste-material';

export function PastedChip({ piece, onRemove }: { piece: PastedPiece; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex max-w-full flex-col items-stretch">
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11.5px] text-neutral-600">
        <DocumentTextIcon className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="min-w-0 truncate text-left hover:text-neutral-900" title={open ? 'Hide the pasted text' : 'Show the pasted text'}>
          {piece.name}
        </button>
        <span className="flex-shrink-0 text-neutral-400">· {pasteSize(piece)}</span>
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label="Remove pasted text" className="-mr-0.5 flex-shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
            <XMarkIcon className="h-3 w-3" />
          </button>
        )}
      </span>
      {open && (
        <pre className="mt-1 max-h-64 max-w-[36rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-left font-sans text-[12px] leading-[1.5] text-neutral-700">{piece.text}</pre>
      )}
    </span>
  );
}
