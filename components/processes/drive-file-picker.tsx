'use client';

import { useState, useEffect, useRef } from 'react';
import {
  DocumentTextIcon,
  TableCellsIcon,
  PresentationChartBarIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

interface KnowledgeFileResult {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes?: number;
  indexed_at?: string;
  source_id: string;
  knowledge_sources?: { provider: string; name: string } | null;
}

export interface PickedDriveFile {
  fileId: string;
  filename: string;
  mimeType: string;
  sourceProvider: string;
  sourceName: string;
}

interface Props {
  onSelect: (file: PickedDriveFile) => void;
  onCancel: () => void;
}

const SOURCE_LABELS: Record<string, string> = {
  google_drive: 'Drive',
  onedrive: 'OneDrive',
  upload: 'Upload',
  augmtd: 'Augmtd',
};

function getFileIcon(mimeType: string) {
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) {
    return TableCellsIcon;
  }
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
    return PresentationChartBarIcon;
  }
  return DocumentTextIcon;
}

export function DriveFilePicker({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeFileResult[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFiles = async (q: string) => {
    setLoading(true);
    try {
      const url = q.length >= 2
        ? `/api/knowledge/files?search=${encodeURIComponent(q)}&limit=20`
        : `/api/knowledge/files?limit=20`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.data ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFiles(''); }, []);

  const handleQueryChange = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchFiles(v), 300);
  };

  return (
    <div className="border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-100">
        <MagnifyingGlassIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
        <input
          type="text"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          placeholder="Search Drive files…"
          autoFocus
          className="flex-1 text-[12px] focus:outline-none placeholder:text-neutral-300"
        />
      </div>
      <div className="max-h-48 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-4">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
        {!loading && results.length === 0 && (
          <p className="text-[11px] text-neutral-400 text-center py-4">No files found</p>
        )}
        {!loading && results.map(file => {
          const Icon = getFileIcon(file.mime_type ?? '');
          const src = file.knowledge_sources;
          const providerLabel = src ? (SOURCE_LABELS[src.provider] ?? src.provider) : 'Drive';
          return (
            <button
              key={file.id}
              type="button"
              onClick={() => onSelect({
                fileId: file.id,
                filename: file.filename,
                mimeType: file.mime_type ?? 'application/octet-stream',
                sourceProvider: src?.provider ?? 'upload',
                sourceName: src?.name ?? providerLabel,
              })}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-neutral-50 text-left border-b border-neutral-50 last:border-0 transition-colors"
            >
              <Icon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
              <span className="flex-1 text-[11px] text-neutral-800 truncate">{file.filename}</span>
              <span className="flex-shrink-0 text-[10px] text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                {providerLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
