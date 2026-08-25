'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { MarkdownText } from '@/components/work/chat-message';
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
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import {
  DocumentArtifact,
  DocContent,
  PptxContent,
  XlsxContent,
  EmailContent,
  QAReport,
} from '@/lib/types/inbox';
import { computeVersionedArtifacts, latestVersions, VersionedArtifact } from '@/lib/artifacts/version-utils';
import { FrameCard } from '@/components/frames/frame-card';

// ── Helpers ───────────────────────────────────────────────────────────────────

export function contentType(artifact: DocumentArtifact): 'doc' | 'pptx' | 'xlsx' | 'email' | 'none' {
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
    type === 'frame' ? Squares2X2Icon
    : ct === 'pptx' || type === 'presentation' ? PresentationChartBarIcon
    : ct === 'xlsx' || type === 'spreadsheet' ? TableCellsIcon
    : ct === 'email' || type === 'email' ? EnvelopeIcon
    : DocumentTextIcon;
  return <Icon className={className} />;
}

function shortType(artifact: DocumentArtifact): string {
  const ct = contentType(artifact);
  if (artifact.type === 'frame') return 'Frame';
  if (ct === 'pptx' || artifact.type === 'presentation') return 'Presentation';
  if (ct === 'xlsx' || artifact.type === 'spreadsheet') return 'Spreadsheet';
  if (ct === 'email' || artifact.type === 'email') return 'Email';
  return 'Document';
}

// ── Previews ──────────────────────────────────────────────────────────────────

// THE READER (owner, Aug 9): a delivered document is READ, not scanned like chat — reading
// measure (~68ch), 15px/1.75 body, breathing room between sections, real heading scale.
export function DocPreview({ content }: { content: DocContent }) {
  return (
    <div className="mx-auto max-w-[68ch] text-[15px]">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-neutral-900 leading-snug tracking-[-0.01em]">{content.title}</h1>
        {content.subtitle && (
          <p className="text-[14px] text-neutral-500 mt-1.5">{content.subtitle}</p>
        )}
      </div>
      {content.sections.map((section, i) => (
        <div key={i} className="mt-6 first:mt-0">
          {section.heading && (
            <h2
              className={
                section.level === 1
                  ? 'text-[16px] font-semibold text-neutral-900 border-b border-neutral-100 pb-1.5 mb-2.5'
                  : 'text-[14.5px] font-semibold text-neutral-800 mb-2'
              }
            >
              {section.heading}
            </h2>
          )}
          <div className="space-y-3">
            {section.paragraphs.map((p, pi) => (
              <div key={pi} className="text-neutral-700 text-[14.5px] leading-[1.75] prose prose-sm prose-neutral max-w-none prose-p:my-0 prose-li:my-0.5">
                <MarkdownText content={p} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PptxPreview({ content }: { content: PptxContent }) {
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

export function XlsxPreview({ content }: { content: XlsxContent }) {
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

export function EmailPreview({ content, artifact, threadId, onSent }: EmailPreviewProps) {
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
  onNavigate: (id: string) => void;
  onArtifactsUpdate?: (artifacts: DocumentArtifact[]) => void;
}

function ArtifactDetailView({ artifact, threadId, allArtifacts, onBack, onClose, onNavigate, onArtifactsUpdate }: ArtifactDetailViewProps) {
  const ct = contentType(artifact);

  // All versions of this document, oldest first
  const versionGroup = useMemo(() => {
    const all = computeVersionedArtifacts(allArtifacts);
    return all
      .filter(a => a.groupId === artifact.groupId)
      .sort((a, b) => a.versionIndex - b.versionIndex);
  }, [allArtifacts, artifact.groupId]);

  const hasVersions = versionGroup.length > 1;
  const prevVersion = hasVersions ? versionGroup[artifact.versionIndex - 1] : null;
  const nextVersion = hasVersions ? versionGroup[artifact.versionIndex + 1] : null;

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
            </p>
          </div>

          {/* Version navigator */}
          {hasVersions && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={() => prevVersion && onNavigate(prevVersion.id!)}
                disabled={!prevVersion}
                className="p-1 rounded hover:bg-neutral-100 text-neutral-400 disabled:opacity-30 transition-colors"
                title="Previous version"
              >
                <ChevronLeftIcon className="w-3 h-3" />
              </button>
              <span className="font-mono text-[10px] text-neutral-400 px-0.5 min-w-[28px] text-center">
                {artifact.versionLabel}
              </span>
              <button
                onClick={() => nextVersion && onNavigate(nextVersion.id!)}
                disabled={!nextVersion}
                className="p-1 rounded hover:bg-neutral-100 text-neutral-400 disabled:opacity-30 transition-colors"
                title="Next version"
              >
                <ChevronRightIcon className="w-3 h-3" />
              </button>
            </div>
          )}

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

        {/* Preview content — A FRAME IS NOT PREVIEWED, IT IS RENDERED (frames plan law 2/5):
            it lives where its work lives, through the ONE renderer, edge-to-edge in this panel. */}
        {artifact.type === 'frame' && artifact.id ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* The ADDRESS is one more click from the panel (the Claude idiom): chat card →
                side panel → full screen. */}
            <div className="flex items-center justify-end px-4 py-1.5 border-b border-neutral-100 flex-shrink-0">
              {/* A Link, NOT a plain <a>: a full document navigation would land the address on a
                  fresh history, and its back arrow could then only guess where you came from. */}
              <Link
                href={`/frames/${artifact.id}`}
                className="text-[11.5px] font-medium text-neutral-400 hover:text-indigo-600 transition-colors"
              >
                Full screen →
              </Link>
            </div>
            <div className="flex-1 min-h-0">
              <FrameCard artifactId={artifact.id} title={artifact.title} full />
            </div>
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto px-6 py-6">
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
        )}

      </div>
    </div>
  );
}

// ── Thread-scoped artifacts panel ─────────────────────────────────────────────

interface ThreadArtifactsPanelProps {
  thread: { id: string; title: string; artifacts?: DocumentArtifact[] };
  onClose: () => void;
  onArtifactsUpdate?: (artifacts: DocumentArtifact[]) => void;
  viewSignal?: number;
  initialDetailId?: string | null;
  activeArtifactId?: string | null;
}

export function ThreadArtifactsPanel({ thread, onClose, onArtifactsUpdate, initialDetailId, activeArtifactId, viewSignal }: ThreadArtifactsPanelProps) {
  const [detailId, setDetailId] = useState<string | null>(initialDetailId ?? null);

  const versioned = useMemo(
    () => computeVersionedArtifacts(thread.artifacts ?? [])
      .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()),
    [thread.artifacts]
  );

  const detailArtifact = versioned.find(a => a.id === detailId) ?? null;

  // Sync when parent selects an artifact (e.g. on generation or clicking inline chip)
  // viewSignal increments on every chip click so this fires even if the id didn't change
  useEffect(() => {
    if (activeArtifactId) setDetailId(activeArtifactId);
  }, [activeArtifactId, viewSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // If showing detail but artifact no longer exists, go back to list
  useEffect(() => {
    if (detailId && !detailArtifact) setDetailId(null);
  }, [detailId, detailArtifact]);

  // Collapsed list: one row per document group (latest version)
  const listItems = useMemo(() => latestVersions(versioned), [versioned]);

  if (detailArtifact) {
    return (
      <ArtifactDetailView
        artifact={detailArtifact}
        threadId={thread.id}
        allArtifacts={thread.artifacts ?? []}
        onBack={() => setDetailId(null)}
        onClose={onClose}
        onNavigate={id => setDetailId(id)}
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

        {/* List — one row per document, showing latest version */}
        <div className="flex-1 overflow-y-auto">
          {listItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
              <DocumentTextIcon className="w-8 h-8 text-neutral-200" />
              <p className="text-[13px] text-neutral-400 text-center">No artifacts yet</p>
            </div>
          ) : (
            listItems.map(a => (
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
                  <p className="text-[12.5px] truncate leading-snug text-neutral-700">{a.title}</p>
                  <p className="text-[11px] text-neutral-400 mt-0.5 leading-snug">
                    {shortType(a)}
                    {a.versionTotal > 1 && (
                      <span className="ml-1.5 font-mono">{a.versionLabel} · {a.versionTotal} versions</span>
                    )}
                  </p>
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

interface FlatArtifact extends VersionedArtifact {
  threadId: string;
  threadTitle: string;
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
  // Flatten all artifacts across all threads — latest version per group only, newest first
  const allFlat: FlatArtifact[] = threads
    .flatMap(t =>
      latestVersions(computeVersionedArtifacts(t.artifacts ?? [])).map(a => ({
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
                  }`}>{a.title}</p>
                  <p className="text-[11px] text-neutral-400 truncate leading-snug mt-0.5">
                    {a.threadTitle}
                    {a.versionTotal > 1 && (
                      <span className="ml-1.5 font-mono">{a.versionTotal} versions</span>
                    )}
                  </p>
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
