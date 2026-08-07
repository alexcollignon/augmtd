'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SLIM KNOWLEDGE PANEL (one-surface plan, Aug 6 — the folder grid's replacement). Knowledge is
// not a destination you browse — files live WITH their work (a room's Files tab, the deliverable
// pool, the composer's attach). This page is the SOVEREIGNTY/AUDIT surface: everything the brain
// can read, in one column — what arrived from where (meetings · email attachments · uploads ·
// generated), whether it's indexed, which project it lives on, search over all of it, and the
// right to remove. One overview read; instant-load from LS; deletes are explicit two-step.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  VideoCameraIcon, PaperClipIcon, ArrowUpTrayIcon, DocumentTextIcon,
  MagnifyingGlassIcon, XMarkIcon, EnvelopeIcon,
} from '@heroicons/react/24/outline';
import { loadLS, saveLS } from '@/lib/utils/local-cache';

type KbFile = {
  id: string; filename: string; kind: 'meeting' | 'attachment' | 'upload' | 'generated';
  sizeBytes: number | null; indexedAt: string | null; chunks: number; indexed: boolean;
  project: string | null; deletable: boolean;
};
type Overview = {
  counts: { meeting: number; attachment: number; upload: number; generated: number; total: number; indexed: number; pending: number };
  files: KbFile[];
  mail: Array<{ provider: string; email: string }>;
};

const LS_KEY = 'aug-knowledge-v1';
const KIND_META: Record<KbFile['kind'], { Icon: React.ElementType; word: string; tint: string }> = {
  meeting:    { Icon: VideoCameraIcon,  word: 'Meeting note',      tint: 'bg-emerald-50 text-emerald-600' },
  attachment: { Icon: PaperClipIcon,    word: 'Email attachment',  tint: 'bg-indigo-50 text-indigo-500' },
  upload:     { Icon: ArrowUpTrayIcon,  word: 'Upload',            tint: 'bg-neutral-100 text-neutral-500' },
  generated:  { Icon: DocumentTextIcon, word: 'Generated',         tint: 'bg-violet-50 text-violet-500' },
};
const fmtSize = (b: number | null) => b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

export default function KnowledgePanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | KbFile['kind']>('all');
  const [q, setQ] = useState('');
  const [semanticIds, setSemanticIds] = useState<Set<string> | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => fetch('/api/knowledge/overview').then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d?.counts) { setData(d); saveLS(LS_KEY, d); } })
    .catch(() => {}).finally(() => setLoading(false));
  useEffect(() => {
    const cached = loadLS<Overview>(LS_KEY);
    if (cached?.counts) { setData(cached); setLoading(false); }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search: filename substring is INSTANT; content search (semantic, the same brain retrieval)
  // rides in debounced and widens the match set — never replaces the instant one.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const needle = q.trim();
    if (needle.length < 2) { setSemanticIds(null); return; }
    debounceRef.current = setTimeout(() => {
      fetch(`/api/drive/search?q=${encodeURIComponent(needle)}`).then((r) => (r.ok ? r.json() : null))
        .then((d) => setSemanticIds(new Set((d?.fileIds ?? []) as string[])))
        .catch(() => {});
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  const files = useMemo(() => {
    const all = data?.files ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((f) =>
      (filter === 'all' || f.kind === filter) &&
      (!needle || f.filename.toLowerCase().includes(needle) || (semanticIds?.has(f.id) ?? false)));
  }, [data, filter, q, semanticIds]);

  const del = async (f: KbFile) => {
    setConfirmDel(null);
    setData((d) => d ? { ...d, files: d.files.filter((x) => x.id !== f.id) } : d); // optimistic
    try {
      const res = await fetch(`/api/drive/uploads/${f.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
    } catch { void refresh(); } // restore truth on failure
  };

  const upload = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (!picked.length || uploading) return;
    setUploading(true);
    try {
      const pres = await fetch('/api/drive/upload/presign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: picked.map((f) => ({ filename: f.name, mimeType: f.type || 'application/octet-stream', size: f.size })) }),
      }).then((r) => (r.ok ? r.json() : null));
      for (const u of ((pres?.uploads ?? []) as Array<{ signedUrl: string; storagePath: string; filename: string; mimeType: string }>)) {
        const f = picked.find((x) => x.name === u.filename);
        if (!f) continue;
        const put = await fetch(u.signedUrl, { method: 'PUT', headers: { 'Content-Type': u.mimeType }, body: f });
        if (!put.ok) continue;
        await fetch('/api/drive/upload/confirm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: u.storagePath, filename: u.filename, mimeType: u.mimeType }),
        });
      }
      await refresh();
    } catch { /* the refresh shows the truth */ } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const c = data?.counts;
  const chip = (key: 'all' | KbFile['kind'], label: string, n?: number) => (
    <button key={key} onClick={() => setFilter(key)}
      className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${filter === key
        ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100'}`}>
      {label}{typeof n === 'number' ? <span className={filter === key ? 'text-indigo-400' : 'text-neutral-400'}> {n}</span> : null}
    </button>
  );

  return (
    <div className="max-w-3xl mx-auto w-full px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold text-neutral-900 tracking-tight">Knowledge</h1>
          <p className="mt-1 text-[13px] text-neutral-500 leading-relaxed">
            Everything the brain can read — indexed, searchable, and yours to remove. Files live with
            their work: attach from any conversation, find them in a room&rsquo;s Files tab.
          </p>
        </div>
        <input ref={fileRef} type="file" multiple className="hidden"
          accept=".pdf,.docx,.txt,.csv,.xlsx,.pptx,.md,.jpg,.jpeg,.png"
          onChange={(e) => void upload(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          <ArrowUpTrayIcon className="w-4 h-4" />{uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {/* THE AUDIT LINE — indexing status + where attachments arrive from (the connected mail). */}
      {c && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${c.pending > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
            {c.indexed} indexed{c.pending > 0 ? ` · ${c.pending} processing` : ''}
          </span>
          {data!.mail.map((m) => (
            <span key={m.email || m.provider} className="flex items-center gap-1">
              <EnvelopeIcon className="w-3.5 h-3.5" />{m.email || m.provider}
            </span>
          ))}
        </div>
      )}

      {/* Sources = filter chips (counts speak the inventory). */}
      <div className="mt-5 flex flex-wrap items-center gap-1">
        {chip('all', 'All', c?.total)}
        {chip('meeting', 'Meetings', c?.meeting)}
        {chip('attachment', 'Attachments', c?.attachment)}
        {chip('upload', 'Uploads', c?.upload)}
        {chip('generated', 'Generated', c?.generated)}
      </div>

      <div className="relative mt-3">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or content…"
          className="w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-3 py-2.5 text-[13.5px] text-neutral-800 placeholder:text-neutral-400 outline-none focus:border-indigo-300" />
      </div>

      <div className="mt-4 rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
        {loading && !data && (
          <div className="p-4 space-y-2" aria-hidden>
            <div className="h-10 rounded-lg bg-neutral-100 animate-pulse" />
            <div className="h-10 rounded-lg bg-neutral-100 animate-pulse" />
            <div className="h-10 rounded-lg bg-neutral-100 animate-pulse" />
          </div>
        )}
        {!loading && files.length === 0 && (
          <p className="p-6 text-[13px] text-neutral-400">
            {q ? 'Nothing matches that.' : 'Nothing here yet — attach a file in any conversation, or upload one above.'}
          </p>
        )}
        {files.map((f) => {
          const meta = KIND_META[f.kind];
          return (
            <div key={f.id} className="group flex items-center gap-3 px-4 py-2.5">
              <span className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${meta.tint}`}>
                <meta.Icon className="w-3.5 h-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-neutral-800">{f.filename}</span>
                <span className="block text-[11.5px] text-neutral-400">
                  {meta.word}{f.project ? ` · ${f.project}` : ''}{f.indexedAt ? ` · ${fmtDate(f.indexedAt)}` : ''}{f.sizeBytes ? ` · ${fmtSize(f.sizeBytes)}` : ''}
                </span>
              </span>
              <span className="flex-shrink-0 text-[11px] text-neutral-300">
                {f.indexed ? `indexed · ${f.chunks} ${f.chunks === 1 ? 'chunk' : 'chunks'}` : <span className="text-amber-500">processing</span>}
              </span>
              {f.deletable ? (
                confirmDel === f.id ? (
                  <span className="flex-shrink-0 flex items-center gap-1.5">
                    <button onClick={() => void del(f)} className="rounded-md bg-red-50 px-2 py-1 text-[11.5px] font-medium text-red-600 hover:bg-red-100 transition-colors">Remove</button>
                    <button onClick={() => setConfirmDel(null)} className="text-[11.5px] text-neutral-400 hover:text-neutral-600">Keep</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDel(f.id)} title="Remove from the knowledge base"
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-red-500 transition-all">
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                )
              ) : (
                // A meeting note lives with its meeting — it leaves the KB from there.
                <span className="flex-shrink-0 w-4" title="Lives with its meeting — manage it there" />
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[12px] text-neutral-300">
        Removing a file deletes its indexed content. Meeting notes are managed from Meetings.
      </p>
    </div>
  );
}
