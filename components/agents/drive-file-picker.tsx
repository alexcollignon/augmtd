'use client';

import { useState, useEffect, useRef } from 'react';
import {
  MagnifyingGlassIcon,
  XMarkIcon,
  DocumentTextIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

interface DriveFile {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  indexed_at: string;
  chunk_count: number;
}

interface Props {
  alreadyAttached: string[];  // knowledge_file_ids already on this agent
  onConfirm: (files: Array<{ knowledge_file_id: string; name: string }>) => void;
  onClose: () => void;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(mimeType: string): string {
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('word')) return 'Word';
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'Sheet';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'Slides';
  if (mimeType.includes('text')) return 'Text';
  return 'File';
}

export function DriveFilePicker({ alreadyAttached, onConfirm, onClose }: Props) {
  const [files, setFiles]       = useState<DriveFile[]>([]);
  const [loading, setLoading]   = useState(true);
  const [query, setQuery]       = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchRef               = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/drive/kb-files')
      .then((r) => r.json())
      .then((data: DriveFile[]) => setFiles(Array.isArray(data) ? data : []))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 50);
  }, []);

  const filtered = files.filter((f) =>
    f.filename.toLowerCase().includes(query.toLowerCase())
  );

  function toggle(fileId: string) {
    if (alreadyAttached.includes(fileId)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(fileId) ? next.delete(fileId) : next.add(fileId);
      return next;
    });
  }

  function handleConfirm() {
    const toAdd = files
      .filter((f) => selected.has(f.id))
      .map((f) => ({ knowledge_file_id: f.id, name: f.filename }));
    onConfirm(toAdd);
  }

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-[480px] max-h-[520px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 flex-shrink-0">
          <p className="text-[13px] font-semibold text-neutral-900">Choose from Drive</p>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-neutral-100 transition-colors">
            <XMarkIcon className="w-4 h-4 text-neutral-400" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-neutral-100 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-50 border border-neutral-200">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files…"
              className="flex-1 bg-transparent text-[12.5px] text-neutral-900 placeholder-neutral-400 focus:outline-none"
            />
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-2.5">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-7 h-7 rounded-lg bg-neutral-100 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-2.5 bg-neutral-100 rounded-full w-3/4" />
                    <div className="h-2 bg-neutral-100 rounded-full w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[12.5px] text-neutral-400">
                {query ? 'No files match your search.' : 'No files in your Drive yet.'}
              </p>
            </div>
          ) : (
            <div className="py-1">
              {filtered.map((file) => {
                const isAttached = alreadyAttached.includes(file.id);
                const isSelected = selected.has(file.id);
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => toggle(file.id)}
                    disabled={isAttached}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isAttached
                        ? 'opacity-40 cursor-not-allowed'
                        : isSelected
                        ? 'bg-indigo-50'
                        : 'hover:bg-neutral-50'
                    }`}
                  >
                    {/* Icon */}
                    <div className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                      <DocumentTextIcon className="w-3.5 h-3.5 text-neutral-500" />
                    </div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] text-neutral-800 truncate leading-snug">{file.filename}</p>
                      <p className="text-[11px] text-neutral-400 mt-0.5">
                        {fileTypeLabel(file.mime_type)}
                        {file.size_bytes ? ` · ${formatBytes(file.size_bytes)}` : ''}
                        {file.chunk_count > 0 ? ` · ${file.chunk_count} chunks` : ''}
                      </p>
                    </div>

                    {/* Check */}
                    <div className={`w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-600'
                        : isAttached
                        ? 'border-neutral-300 bg-neutral-200'
                        : 'border-neutral-300'
                    }`}>
                      {(isSelected || isAttached) && <CheckIcon className="w-2.5 h-2.5 text-white" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-100 flex-shrink-0">
          <p className="text-[11.5px] text-neutral-400">
            {selected.size > 0 ? `${selected.size} file${selected.size > 1 ? 's' : ''} selected` : 'Select files to attach'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-[12px] text-neutral-600 hover:bg-neutral-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selected.size === 0}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-[12px] font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Add {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
