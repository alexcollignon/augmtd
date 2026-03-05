'use client';

import { useState, useEffect, useRef } from 'react';
import { MagnifyingGlassIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

interface KnowledgeFile {
  id: string;
  source_id: string;
  filename: string;
  mime_type: string;
  extracted_text: string | null;
  size_bytes: number | null;
  last_modified_at: string | null;
  indexed_at: string;
  similarity?: number;
}

interface FileBrowserProps {
  sourcesById: Record<string, { folder_name: string }>;
  refreshKey: number;
}

const PAGE_SIZE = 20;

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function FileBrowser({ sourcesById, refreshKey }: FileBrowserProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 300);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    async function fetchFiles() {
      setLoading(true);
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);

      try {
        const res = await fetch(`/api/knowledge/files?${params}`);
        const json = await res.json();
        if (!cancelled) {
          setFiles(json.data ?? []);
          setTotal(json.total ?? 0);
        }
      } catch (err) {
        console.error('[FileBrowser] Fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchFiles();
    return () => { cancelled = true; };
  }, [debouncedSearch, offset, refreshKey]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div>
      {/* Search bar */}
      <div className="relative mb-4">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search across all files…"
          className="w-full pl-9 pr-4 py-2 text-[13px] border border-neutral-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
        />
      </div>

      {/* File list */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-[13px] text-neutral-500">
          <svg className="animate-spin w-4 h-4 mr-2 text-indigo-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading…
        </div>
      ) : files.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-neutral-500">
          {Object.keys(sourcesById).length === 0
            ? 'Start by connecting a folder above'
            : debouncedSearch
            ? 'No files match your search'
            : 'No files indexed yet — sync a source above'}
        </div>
      ) : (
        <div className="divide-y divide-neutral-100 border border-neutral-200">
          {files.map((file) => {
            const source = sourcesById[file.source_id];
            const isExpanded = expandedId === file.id;
            return (
              <div key={file.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : file.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 transition-colors text-left"
                >
                  <span className="flex-shrink-0 text-neutral-400">
                    {isExpanded ? (
                      <ChevronDownIcon className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRightIcon className="w-3.5 h-3.5" />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-neutral-900 truncate block">{file.filename}</span>
                    <span className="text-[11.5px] text-neutral-500">
                      {source?.folder_name ?? ''}
                    </span>
                  </span>
                  <div className="flex-shrink-0 flex items-center gap-3 text-[11.5px] text-neutral-400">
                    {file.similarity !== undefined && (
                      <span className="text-indigo-600 font-medium">
                        {Math.round(file.similarity * 100)}% match
                      </span>
                    )}
                    <span>{formatBytes(file.size_bytes)}</span>
                    <span suppressHydrationWarning>{formatDate(file.last_modified_at)}</span>
                  </div>
                </button>
                {isExpanded && file.extracted_text && (
                  <div className="px-10 pb-4">
                    <p className="text-[10.5px] font-medium text-neutral-400 uppercase tracking-wide mb-1.5">Content preview</p>
                    <p className="text-[12.5px] text-neutral-600 leading-relaxed line-clamp-4">
                      {file.extracted_text.slice(0, 400)}
                      {file.extracted_text.length > 400 && '…'}
                    </p>
                  </div>
                )}
                {isExpanded && !file.extracted_text && (
                  <div className="px-10 pb-4 text-[12px] text-neutral-400 italic">
                    No text extracted for this file type
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && !debouncedSearch && (
        <div className="flex items-center justify-between mt-4 text-[12px] text-neutral-500">
          <span>{total} files total</span>
          <div className="flex gap-1">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-1.5 border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition-colors"
            >
              Previous
            </button>
            <span className="px-3 py-1.5 border border-neutral-200 bg-neutral-50">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="px-3 py-1.5 border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
