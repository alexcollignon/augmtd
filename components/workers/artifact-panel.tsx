'use client';

import { useState, useEffect } from 'react';
import {
  XMarkIcon,
  ArrowDownTrayIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  PresentationChartBarIcon,
  TableCellsIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import { FrameCard } from '@/components/frames/frame-card';
import type {
  ArtifactContent,
  DocContent,
  PptxContent,
  XlsxContent,
  EmailContent,
} from '@/lib/types/inbox';

interface ArtifactMeta {
  content: ArtifactContent | null;
  title: string;
  type: string;
  generated_at: string;
  has_file: boolean;
  thread_id?: string; // actual thread containing the artifact (may differ from URL param)
}

interface ArtifactPanelProps {
  artifactId: string;
  threadId: string;
  onClose: () => void;
  onNewVersion?: (title: string) => void;
}

export function ArtifactPanel({ artifactId, threadId, onClose }: ArtifactPanelProps) {
  const [meta, setMeta] = useState<ArtifactMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setMeta(null);
    fetch(`/api/work/threads/${threadId}/artifacts/${artifactId}/content`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setMeta(data); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [threadId, artifactId]);

  async function handleDownload() {
    if (isDownloading) return;
    setIsDownloading(true);
    // Use the authoritative thread_id returned by the content API — may differ from URL param
    const effectiveThreadId = meta?.thread_id ?? threadId;
    try {
      const res = await fetch(`/api/work/threads/${effectiveThreadId}/download?artifactId=${artifactId}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta?.title ?? 'document';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  }

  function relativeTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3_600_000);
    if (h < 1) return 'just now';
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  const TypeIcon = !meta ? DocumentTextIcon
    : meta.type === 'frame' ? Squares2X2Icon
    : meta.type === 'email' ? EnvelopeIcon
    : meta.type === 'presentation' ? PresentationChartBarIcon
    : meta.type === 'spreadsheet' ? TableCellsIcon
    : DocumentTextIcon;

  return (
    <div className="w-full flex-shrink-0 border-l border-neutral-100 flex flex-col bg-white overflow-hidden">
      {/* Panel header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-neutral-100">
        <div className="w-6 h-6 rounded-md bg-indigo-50 flex items-center justify-center flex-shrink-0">
          <TypeIcon className="w-3.5 h-3.5 text-indigo-500" />
        </div>
        <p className="flex-1 min-w-0 text-[12.5px] font-semibold text-neutral-800 truncate">
          {isLoading ? 'Loading…' : (meta?.title ?? 'Document')}
        </p>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {meta?.has_file && (
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              title="Download"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            title="Close"
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="px-5 py-8 space-y-3 animate-pulse">
            <div className="h-4 bg-neutral-100 rounded-full w-3/4" />
            <div className="h-3 bg-neutral-100 rounded-full w-full" />
            <div className="h-3 bg-neutral-100 rounded-full w-5/6" />
            <div className="h-3 bg-neutral-100 rounded-full w-2/3" />
            <div className="h-4 bg-neutral-100 rounded-full w-1/2 mt-6" />
            <div className="h-3 bg-neutral-100 rounded-full w-full" />
            <div className="h-3 bg-neutral-100 rounded-full w-4/5" />
          </div>
        )}

        {!isLoading && !meta && (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
            <p className="text-[13px] text-neutral-500">Could not load document preview.</p>
          </div>
        )}

        {/* A FRAME IS RENDERED, NOT PREVIEWED (frames plan law 2/5) — the ONE renderer, in the
            room that produced it. Its inline script is confined to FrameCard's sandboxed iframe. */}
        {!isLoading && meta && meta.type === 'frame' && (
          <div className="h-full min-h-0">
            <FrameCard artifactId={artifactId} title={meta.title} full />
          </div>
        )}

        {!isLoading && meta && meta.type !== 'frame' && (
          <div className="px-5 py-6">
            {meta.generated_at && (
              <p className="text-[10.5px] text-neutral-400 mb-5">
                Generated {relativeTime(meta.generated_at)}
              </p>
            )}

            {!meta.content && meta.has_file && (
              <p className="text-[13px] text-neutral-500 italic">
                Preview not available — use Download to open.
              </p>
            )}

            {meta.content && meta.type === 'email' && (
              <EmailPreview content={meta.content as EmailContent} />
            )}

            {meta.content && meta.type === 'document' && (
              <DocPreview content={meta.content as DocContent} />
            )}

            {meta.content && meta.type === 'presentation' && (
              <PptxPreview content={meta.content as PptxContent} />
            )}

            {meta.content && meta.type === 'spreadsheet' && (
              <XlsxPreview content={meta.content as XlsxContent} />
            )}
          </div>
        )}
      </div>

    </div>
  );
}

// ── Content renderers ─────────────────────────────────────────────────────────

function DocPreview({ content }: { content: DocContent }) {
  return (
    <div className="space-y-5">
      <h1 className="text-[15px] font-bold text-neutral-900 leading-snug">{content.title}</h1>
      {content.subtitle && (
        <p className="text-[12.5px] text-neutral-500 -mt-3">{content.subtitle}</p>
      )}
      {(content.sections ?? []).map((section, i) => (
        <div key={i} className="space-y-1.5">
          {section.heading && (
            <h2 className="text-[12.5px] font-semibold text-neutral-800 uppercase tracking-wide">
              {section.heading}
            </h2>
          )}
          {(section.paragraphs ?? []).map((p, j) => (
            <p key={j} className="text-[13px] text-neutral-700 leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function EmailPreview({ content }: { content: EmailContent }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5 pb-4 border-b border-neutral-100">
        {content.to && (
          <div className="flex gap-2 text-[12.5px]">
            <span className="text-neutral-400 w-8 flex-shrink-0">To</span>
            <span className="text-neutral-800">{content.to}</span>
          </div>
        )}
        {content.cc && (
          <div className="flex gap-2 text-[12.5px]">
            <span className="text-neutral-400 w-8 flex-shrink-0">Cc</span>
            <span className="text-neutral-800">{content.cc}</span>
          </div>
        )}
        <div className="flex gap-2 text-[12.5px]">
          <span className="text-neutral-400 w-8 flex-shrink-0">Re</span>
          <span className="text-neutral-800 font-medium">{content.subject}</span>
        </div>
      </div>
      <div className="space-y-3">
        {content.body.split(/\n{2,}/).map((para, i) => (
          <p key={i} className="text-[13px] text-neutral-700 leading-relaxed whitespace-pre-line">
            {para}
          </p>
        ))}
      </div>
    </div>
  );
}

function PptxPreview({ content }: { content: PptxContent }) {
  return (
    <div className="space-y-4">
      <h1 className="text-[15px] font-bold text-neutral-900">{content.title}</h1>
      {content.subtitle && <p className="text-[12.5px] text-neutral-500 -mt-2">{content.subtitle}</p>}
      {(content.slides ?? []).map((slide, i) => (
        <div key={i} className="rounded-xl border border-neutral-100 p-4 space-y-2">
          <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">
            Slide {i + 1}
          </p>
          <p className="text-[13px] font-semibold text-neutral-800">{slide.title}</p>
          {(slide.bullets ?? []).length > 0 && (
            <ul className="space-y-1">
              {slide.bullets!.map((b, j) => (
                <li key={j} className="flex items-start gap-2 text-[12.5px] text-neutral-700">
                  <span className="text-neutral-300 flex-shrink-0 mt-px">·</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {slide.notes && (
            <p className="text-[11.5px] text-neutral-400 italic border-t border-neutral-100 pt-2 mt-2">
              {slide.notes}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function XlsxPreview({ content }: { content: XlsxContent }) {
  return (
    <div className="space-y-5">
      <h1 className="text-[15px] font-bold text-neutral-900">{content.title}</h1>
      {(content.sheets ?? []).map((sheet, i) => (
        <div key={i} className="space-y-2">
          <p className="text-[12px] font-semibold text-neutral-600">{sheet.name}</p>
          {sheet.summary && (
            <p className="text-[12px] text-neutral-500 italic">{sheet.summary}</p>
          )}
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="bg-neutral-50">
                  {sheet.headers.map((h, j) => (
                    <th key={j} className="px-3 py-2 text-left text-neutral-600 font-semibold border-b border-neutral-200">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-neutral-100 last:border-0">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-neutral-700">
                        {cell ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
