'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowDownTrayIcon,
  PaperAirplaneIcon,
  DocumentTextIcon,
  PresentationChartBarIcon,
  TableCellsIcon,
  EnvelopeIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  DocumentArtifact,
  DocContent,
  PptxContent,
  XlsxContent,
  EmailContent,
  QAReport,
} from '@/lib/types/inbox';
import { computeVersionedArtifacts, VersionedArtifact } from '@/lib/artifacts/version-utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

function contentType(artifact: DocumentArtifact): 'doc' | 'pptx' | 'xlsx' | 'email' | 'none' {
  if (!artifact.content) return 'none';
  const c = artifact.content as unknown as Record<string, unknown>;
  if ('slides' in c) return 'pptx';
  if ('sheets' in c) return 'xlsx';
  if ('to' in c && 'subject' in c) return 'email';
  if ('sections' in c) return 'doc';
  return 'none';
}

function ArtifactIcon({ artifact, className }: { artifact: DocumentArtifact; className?: string }) {
  const ct = contentType(artifact);
  const type = artifact.type;
  const Icon =
    ct === 'pptx' || type === 'presentation' ? PresentationChartBarIcon
    : ct === 'xlsx' || type === 'spreadsheet' ? TableCellsIcon
    : ct === 'email' || type === 'email' ? EnvelopeIcon
    : DocumentTextIcon;
  return <Icon className={className} />;
}

function shortType(artifact: DocumentArtifact): string {
  const ct = contentType(artifact);
  if (ct === 'pptx' || artifact.type === 'presentation') return 'Presentation';
  if (ct === 'xlsx' || artifact.type === 'spreadsheet') return 'Spreadsheet';
  if (ct === 'email' || artifact.type === 'email') return 'Email';
  return 'Document';
}

// ── Previews ──────────────────────────────────────────────────────────────────

function DocPreview({ content }: { content: DocContent }) {
  return (
    <div className="space-y-4 text-[13.5px]">
      <div>
        <h1 className="text-[18px] font-bold text-neutral-900 leading-snug">{content.title}</h1>
        {content.subtitle && (
          <p className="text-[13px] text-neutral-500 mt-1">{content.subtitle}</p>
        )}
      </div>
      {content.sections.map((section, i) => (
        <div key={i} className="space-y-1.5">
          {section.heading && (
            <h2
              className={
                section.level === 1
                  ? 'text-[14px] font-semibold text-neutral-800 border-b border-neutral-100 pb-1'
                  : 'text-[13px] font-medium text-neutral-700'
              }
            >
              {section.heading}
            </h2>
          )}
          {section.paragraphs.map((p, pi) => (
            <p key={pi} className="text-neutral-700 leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function PptxPreview({ content }: { content: PptxContent }) {
  return (
    <div className="space-y-3">
      {content.slides.map((slide, i) => (
        <div
          key={i}
          className={`rounded-xl overflow-hidden border ${
            slide.layout === 'title' ? 'bg-indigo-600 border-indigo-700' : 'bg-white border-neutral-200'
          }`}
        >
          <div className={`px-5 py-4 ${slide.layout === 'title' ? 'py-8 text-center' : ''}`}>
            <p
              className={`font-semibold leading-snug ${
                slide.layout === 'title' ? 'text-white text-[15px]' : 'text-neutral-800 text-[13px]'
              }`}
            >
              {i === 0 ? '' : <span className="text-neutral-400 font-normal mr-1.5">{i}.</span>}
              {slide.title}
            </p>
            {slide.bullets && slide.bullets.length > 0 && (
              <ul className="mt-2.5 space-y-1">
                {slide.bullets.map((b, bi) => (
                  <li key={bi} className="flex items-start gap-2 text-[12.5px] text-neutral-600">
                    <span className="text-neutral-300 mt-px select-none">·</span>
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function XlsxPreview({ content }: { content: XlsxContent }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const sheet = content.sheets[activeIdx] ?? content.sheets[0];
  if (!sheet) return <p className="text-[13px] text-neutral-400">No data</p>;

  return (
    <div className="space-y-2">
      {content.sheets.length > 1 && (
        <div className="flex gap-1.5 flex-wrap mb-3">
          {content.sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${
                i === activeIdx
                  ? 'bg-neutral-200 text-neutral-800 font-medium'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet.summary && (
        <p className="text-[12px] text-neutral-500 italic mb-2">{sheet.summary}</p>
      )}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200">
              {sheet.headers.map((h, i) => (
                <th key={i} className="text-left px-3 py-2 font-medium text-neutral-700 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-neutral-50/60'}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-neutral-700 whitespace-nowrap">
                    {cell ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface EmailPreviewProps {
  content: EmailContent;
  artifact: DocumentArtifact;
  threadId: string;
  onSent: (sentAt: string, sentTo: string) => void;
}

function EmailPreview({ content, artifact, threadId, onSent }: EmailPreviewProps) {
  const [to, setTo] = useState(content.to || '');
  const [cc, setCc] = useState(content.cc || '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    if (!to.trim()) { setError('To field is required'); return; }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work/threads/${threadId}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifactId: artifact.id, to: to.trim(), cc: cc.trim() || undefined }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Send failed');
      }
      const { sentAt, sentTo } = await res.json();
      onSent(sentAt, sentTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      {artifact.sent_at && (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-50 border border-green-100 text-[12px] text-green-700">
          <CheckCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
          Sent to {artifact.sent_to} · {new Date(artifact.sent_at).toLocaleDateString()}
        </div>
      )}

      {/* Fields */}
      <div className="space-y-2">
        <div>
          <label className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">To</label>
          <input
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className="mt-1 w-full text-[13px] bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:bg-white"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">CC</label>
          <input
            value={cc}
            onChange={e => setCc(e.target.value)}
            placeholder="Optional"
            className="mt-1 w-full text-[13px] bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:bg-white"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">Subject</label>
          <p className="mt-1 w-full text-[13px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
            {content.subject}
          </p>
        </div>
      </div>

      {/* Body */}
      <div>
        <label className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">Body</label>
        <div className="mt-1 text-[13px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-3 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
          {content.body}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-[12px] text-red-600">
          <ExclamationTriangleIcon className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      {!artifact.sent_at && (
        <button
          onClick={handleSend}
          disabled={sending || !to.trim()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <PaperAirplaneIcon className="w-4 h-4" />
          {sending ? 'Sending…' : 'Send email'}
        </button>
      )}
    </div>
  );
}

// ── QA report panel ───────────────────────────────────────────────────────────

function QAPanel({ report }: { report: QAReport }) {
  const [open, setOpen] = useState(false);
  const scoreColor = report.score >= 80 ? 'text-green-600' : report.score >= 60 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="border-t border-neutral-100 pt-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className={`text-[12px] font-semibold ${scoreColor}`}>{report.score}/100</span>
        <span className="text-[12px] text-neutral-500 flex-1 truncate">{report.summary}</span>
        <span className="text-[11px] text-neutral-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && report.issues.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {report.issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px]">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                issue.severity === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {issue.severity}
              </span>
              <span className="text-neutral-600 leading-relaxed">{issue.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Thread-scoped artifact detail view ───────────────────────────────────────

interface ArtifactDetailViewProps {
  artifact: VersionedArtifact;
  threadId: string;
  allArtifacts: DocumentArtifact[];
  onBack: () => void;
  onClose: () => void;
  onArtifactsUpdate?: (artifacts: DocumentArtifact[]) => void;
}

function ArtifactDetailView({ artifact, threadId, allArtifacts, onBack, onClose, onArtifactsUpdate }: ArtifactDetailViewProps) {
  const ct = contentType(artifact);

  function handleSent(sentAt: string, sentTo: string) {
    if (onArtifactsUpdate) {
      onArtifactsUpdate(allArtifacts.map(a =>
        a.id === artifact.id ? { ...a, sent_at: sentAt, sent_to: sentTo } : a
      ));
    }
  }

  return (
    <div className="flex flex-col h-full bg-neutral-50 p-2">
      <div className="flex flex-col flex-1 rounded-2xl bg-white shadow-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-neutral-100 flex-shrink-0">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors flex-shrink-0"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
          <ArtifactIcon artifact={artifact} className="w-4 h-4 text-neutral-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] font-medium text-neutral-700 truncate">
              {artifact.title}
              {artifact.versionLabel && (
                <span className="ml-1.5 font-mono text-[10px] text-neutral-400 font-normal">{artifact.versionLabel}</span>
              )}
            </p>
          </div>
          {artifact.storage_path && (
            <button
              onClick={() => window.open(`/api/work/threads/${threadId}/download?artifactId=${artifact.id}`)}
              className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors flex-shrink-0"
              title="Download"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors flex-shrink-0"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Preview content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {ct === 'doc' && artifact.content && <DocPreview content={artifact.content as DocContent} />}
          {ct === 'pptx' && artifact.content && <PptxPreview content={artifact.content as PptxContent} />}
          {ct === 'xlsx' && artifact.content && <XlsxPreview content={artifact.content as XlsxContent} />}
          {ct === 'email' && artifact.content && (
            <EmailPreview
              content={artifact.content as EmailContent}
              artifact={artifact}
              threadId={threadId}
              onSent={handleSent}
            />
          )}
          {ct === 'none' && (
            <p className="text-[13px] text-neutral-400 text-center pt-8">No preview available</p>
          )}
          {artifact.qa_report && <QAPanel report={artifact.qa_report} />}
        </div>

      </div>
    </div>
  );
}

// ── Thread-scoped artifacts panel ─────────────────────────────────────────────

interface ThreadArtifactsPanelProps {
  thread: { id: string; title: string; artifacts?: DocumentArtifact[] };
  onClose: () => void;
  onArtifactsUpdate?: (artifacts: DocumentArtifact[]) => void;
  initialDetailId?: string | null;
  activeArtifactId?: string | null;
}

export function ThreadArtifactsPanel({ thread, onClose, onArtifactsUpdate, initialDetailId, activeArtifactId }: ThreadArtifactsPanelProps) {
  const [detailId, setDetailId] = useState<string | null>(initialDetailId ?? null);

  const versioned = useMemo(
    () => computeVersionedArtifacts(thread.artifacts ?? [])
      .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()),
    [thread.artifacts]
  );

  const detailArtifact = versioned.find(a => a.id === detailId) ?? null;

  // Sync when parent selects an artifact (e.g. on generation or clicking inline chip)
  useEffect(() => {
    if (activeArtifactId && activeArtifactId !== detailId) setDetailId(activeArtifactId);
  }, [activeArtifactId]); // eslint-disable-line react-hooks/exhaustive-deps

  // If showing detail but artifact no longer exists, go back to list
  useEffect(() => {
    if (detailId && !detailArtifact) setDetailId(null);
  }, [detailId, detailArtifact]);

  if (detailArtifact) {
    return (
      <ArtifactDetailView
        artifact={detailArtifact}
        threadId={thread.id}
        allArtifacts={thread.artifacts ?? []}
        onBack={() => setDetailId(null)}
        onClose={onClose}
        onArtifactsUpdate={onArtifactsUpdate}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-neutral-50 p-2">
      <div className="flex flex-col flex-1 rounded-2xl bg-white shadow-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 flex-shrink-0">
          <p className="text-[12.5px] font-medium text-neutral-600">Artifacts</p>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {versioned.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
              <DocumentTextIcon className="w-8 h-8 text-neutral-200" />
              <p className="text-[13px] text-neutral-400 text-center">No artifacts yet</p>
            </div>
          ) : (
            versioned.map(a => (
              <div
                key={a.id ?? a.generated_at}
                onClick={() => setDetailId(a.id ?? null)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setDetailId(a.id ?? null); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-neutral-50 hover:bg-neutral-50 transition-colors group cursor-pointer"
              >
                <ArtifactIcon artifact={a} className="w-4 h-4 flex-shrink-0 text-neutral-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] truncate leading-snug text-neutral-700">
                    {a.title}
                    {a.versionLabel && (
                      <span className="ml-1.5 font-mono text-[10px] text-neutral-400 font-normal">{a.versionLabel}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-neutral-400 mt-0.5 leading-snug">{shortType(a)}</p>
                </div>
                {a.storage_path && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      window.open(`/api/work/threads/${thread.id}/download?artifactId=${a.id}`);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-all flex-shrink-0"
                    title="Download"
                  >
                    <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}

// ── Global all-artifacts panel ────────────────────────────────────────────────

interface FlatArtifact extends DocumentArtifact {
  threadId: string;
  threadTitle: string;
  versionLabel: string;
}

interface AllArtifactsPanelProps {
  threads: Array<{ id: string; title: string; artifacts?: DocumentArtifact[] }>;
  activeArtifactId: string | null;
  onClose: () => void;
  onSelectThread: (threadId: string, artifactId: string) => void;
}

export function AllArtifactsPanel({
  threads,
  activeArtifactId,
  onClose,
  onSelectThread,
}: AllArtifactsPanelProps) {
  // Flatten all artifacts across all threads, sorted newest first
  const allFlat: FlatArtifact[] = threads
    .flatMap(t =>
      computeVersionedArtifacts(t.artifacts ?? []).map(a => ({
        ...a,
        threadId: t.id,
        threadTitle: t.title,
      }))
    )
    .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());

  const [activeId, setActiveId] = useState<string | null>(
    activeArtifactId ?? allFlat[0]?.id ?? null
  );

  // Sync when parent opens the panel via "View document"
  useEffect(() => {
    if (activeArtifactId && activeArtifactId !== activeId) {
      setActiveId(activeArtifactId);
    }
  }, [activeArtifactId]); // eslint-disable-line react-hooks/exhaustive-deps

  const artifact = allFlat.find(a => a.id === activeId) ?? allFlat[0] ?? null;

  function handleDownload(a: FlatArtifact) {
    if (!a.id) return;
    window.open(`/api/work/threads/${a.threadId}/download?artifactId=${a.id}`);
  }

  return (
    <div className="flex flex-col h-full bg-neutral-50 p-2">
      <div className="flex flex-col flex-1 rounded-2xl bg-white shadow-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 flex-shrink-0">
          <p className="text-[12.5px] font-medium text-neutral-600">Artifacts</p>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {allFlat.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
              <DocumentTextIcon className="w-8 h-8 text-neutral-200" />
              <p className="text-[13px] text-neutral-400 text-center">No artifacts yet</p>
              <p className="text-[12px] text-neutral-300 text-center max-w-[180px]">
                Documents generated in your chats will appear here
              </p>
            </div>
          ) : (
            allFlat.map(a => (
              <div
                key={a.id ?? a.generated_at}
                onClick={() => {
                  setActiveId(a.id ?? null);
                  if (a.id) onSelectThread(a.threadId, a.id);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setActiveId(a.id ?? null); if (a.id) onSelectThread(a.threadId, a.id); } }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-neutral-50 transition-colors group cursor-pointer ${
                  (a.id ?? null) === activeId ? 'bg-indigo-50' : 'hover:bg-neutral-50'
                }`}
              >
                <ArtifactIcon artifact={a} className={`w-4 h-4 flex-shrink-0 ${
                  (a.id ?? null) === activeId ? 'text-indigo-500' : 'text-neutral-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-[12.5px] truncate leading-snug ${
                    (a.id ?? null) === activeId ? 'text-indigo-700 font-medium' : 'text-neutral-700'
                  }`}>
                    {a.title}
                    {a.versionLabel && (
                      <span className="ml-1.5 font-mono text-[10px] text-neutral-400 font-normal">{a.versionLabel}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-neutral-400 truncate leading-snug mt-0.5">{a.threadTitle}</p>
                </div>
                {a.storage_path && (
                  <button
                    onClick={e => { e.stopPropagation(); handleDownload(a); }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-all flex-shrink-0"
                    title="Download"
                  >
                    <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}
