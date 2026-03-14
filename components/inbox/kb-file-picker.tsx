'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, MagnifyingGlassIcon, DocumentIcon } from '@heroicons/react/24/outline';

interface KbFile {
  id: string;
  filename: string;
  size_bytes: number | null;
}

interface KbFilePickerProps {
  onSelect: (files: { id: string; filename: string }[]) => void;
  onClose: () => void;
}

export default function KbFilePicker({ onSelect, onClose }: KbFilePickerProps) {
  const [files, setFiles] = useState<KbFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/knowledge/files?limit=100')
      .then(r => r.json())
      .then(({ data }) => {
        setFiles(data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const toggleFile = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAttach = () => {
    const chosen = files.filter(f => selected.has(f.id)).map(f => ({ id: f.id, filename: f.filename }));
    onSelect(chosen);
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const filtered = files.filter(f =>
    f.filename.toLowerCase().includes(search.toLowerCase())
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-[400px] max-h-[480px] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
          <span className="text-[13px] font-semibold text-neutral-900">Attach from knowledge base</span>
          <button onClick={onClose} className="p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-neutral-100">
          <div className="flex items-center gap-2 px-2 py-1.5 bg-neutral-50 rounded-lg">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search files…"
              className="flex-1 text-[12px] bg-transparent outline-none text-neutral-700 placeholder-neutral-400"
              autoFocus
            />
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <div className="px-4 py-6 text-center text-[12px] text-neutral-400">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-neutral-400">
              {files.length === 0 ? 'No files in your knowledge base' : 'No files match your search'}
            </div>
          ) : (
            filtered.map(file => (
              <button
                key={file.id}
                onClick={() => toggleFile(file.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 transition-colors text-left ${selected.has(file.id) ? 'bg-indigo-50' : ''}`}
              >
                <div className={`w-4 h-4 flex-shrink-0 rounded border ${selected.has(file.id) ? 'bg-indigo-600 border-indigo-600' : 'border-neutral-300'} flex items-center justify-center`}>
                  {selected.has(file.id) && (
                    <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  )}
                </div>
                <DocumentIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                <span className="flex-1 text-[12px] text-neutral-800 truncate">{file.filename}</span>
                {file.size_bytes && (
                  <span className="text-[11px] text-neutral-400 flex-shrink-0">{formatSize(file.size_bytes)}</span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-neutral-200">
          <button
            onClick={handleAttach}
            disabled={selected.size === 0}
            className="w-full py-2 text-[12px] font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {selected.size === 0 ? 'Attach' : `Attach (${selected.size})`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
