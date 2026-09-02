'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SLIM KNOWLEDGE PANEL (one-surface plan, Aug 6 — the folder grid's replacement). Knowledge is
// not a destination you browse — files live WITH their work (a room's Files tab, the deliverable
// pool, the composer's attach). This page is the SOVEREIGNTY/AUDIT surface: everything the brain
// can read, in one column — what arrived from where (meetings · email attachments · uploads ·
// generated), whether it's indexed, which project it lives on, search over all of it, and the
// right to remove.
//
// THE FOLDERS SURFACE (Sep 2) — the one column became folder-GROUPED, because a folder stopped
// being a filing convenience and became a product concept:
//   · the seed kit lands per-workspace folder PACKS on every enterprise member at join — and a
//     seeded folder that renders nowhere might as well not exist (the owner's find);
//   · `read_kb_folder` / `match_to_profiles` point a workflow step at a folder BY NAME, so
//     "build a folder of role profiles and aim the matcher at it" is a thing a user must be able
//     to DO here — create, upload into, move into, rename.
// Folder sections are born COLLAPSED (the seed-kit admin page's idiom) and load their files on
// expand; the loose "Files" section leads, expanded, because meetings/attachments/generated land
// there. An EMPTY folder still renders. Search is global and flat — server-side, so it sees the
// whole base and not just what happens to be painted.
//
// HONEST NUMBERS: every count comes from a real COUNT query in lib/knowledge/overview.ts. The old
// route listed 400 rows and called `rows.length` the inventory — a 1,046-file account was told
// "400 indexed". Rows arrive a page at a time; numbers never do.
//
// The folder list is THE SAME `/api/drive/folders` the Studio picker reads, so a folder made here
// is pickable in a workflow step immediately. Deletes are explicit two-step; a folder can only be
// deleted EMPTY (the server refuses otherwise — simplicity over cascade semantics).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VideoCameraIcon, PaperClipIcon, ArrowUpTrayIcon, DocumentTextIcon,
  MagnifyingGlassIcon, XMarkIcon, EnvelopeIcon, FolderIcon, FolderPlusIcon,
  ChevronRightIcon, ChevronDownIcon, PencilIcon, TrashIcon, ArrowRightCircleIcon, PlusIcon,
} from '@heroicons/react/24/outline';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { toast } from 'sonner';

type Kind = 'meeting' | 'attachment' | 'upload' | 'generated';
type KindFilter = 'all' | Kind;
type KbFile = {
  id: string; filename: string; kind: Kind;
  sizeBytes: number | null; indexedAt: string | null; chunks: number; indexed: boolean;
  project: string | null; folderId: string | null; folder: string | null; deletable: boolean;
};
type KbFolder = { id: string; name: string; count: number; isSystem: boolean };
type Overview = {
  counts: { meeting: number; attachment: number; upload: number; generated: number; total: number; indexed: number; pending: number };
  folders: KbFolder[];
  loose: { count: number; files: KbFile[]; hasMore: boolean };
  mail: Array<{ provider: string; email: string }>;
};
type Page = { files: KbFile[]; count: number; hasMore: boolean };

const LS_KEY = 'aug-knowledge-v2'; // v2 — the shape gained folders + a bounded loose page
const PAGE = 50;
const LOOSE = '__loose__'; // the section key for "no folder"

const KIND_META: Record<Kind, { Icon: React.ElementType; word: string; tint: string }> = {
  meeting: { Icon: VideoCameraIcon, word: 'Meeting note', tint: 'bg-emerald-50 text-emerald-600' },
  attachment: { Icon: PaperClipIcon, word: 'Email attachment', tint: 'bg-indigo-50 text-indigo-500' },
  upload: { Icon: ArrowUpTrayIcon, word: 'Upload', tint: 'bg-neutral-100 text-neutral-500' },
  generated: { Icon: DocumentTextIcon, word: 'Generated', tint: 'bg-violet-50 text-violet-500' },
};
const fmtSize = (b: number | null) => b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

const filesUrl = (p: Record<string, string | number | undefined>) =>
  `/api/knowledge/files?${Object.entries(p).filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`;

export default function KnowledgePanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<KindFilter>('all');
  const [q, setQ] = useState('');

  // Per-section pages, keyed by folder id (or LOOSE). A folder loads on first expand and is kept.
  const [pages, setPages] = useState<Record<string, Page>>({});
  const [busySection, setBusySection] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set([LOOSE]));

  const [search, setSearch] = useState<{ files: KbFile[]; loading: boolean } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmFolderDel, setConfirmFolderDel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [uploading, setUploading] = useState(false);
  // The upload lands in the folder you last opened — the folder you are looking at is the folder
  // you mean. Never a hidden default: the control beside Upload always says where it will go.
  const [uploadTo, setUploadTo] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const uploadAnchor = useRef<HTMLButtonElement>(null);
  const [uploadPick, setUploadPick] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── THE READS ────────────────────────────────────────────────────────────────────────────────
  const loadPage = useCallback(async (folderId: string | null, k: KindFilter, offset = 0) => {
    const key = folderId ?? LOOSE;
    setBusySection(key);
    try {
      const r = await fetch(filesUrl({ folderId: folderId ?? 'none', kind: k, offset, limit: PAGE }));
      if (!r.ok) return;
      const p = await r.json() as Page;
      setPages((prev) => ({
        ...prev,
        [key]: offset === 0 ? p : { ...p, files: [...(prev[key]?.files ?? []), ...p.files] },
      }));
    } catch { /* the next refresh shows the truth */ } finally { setBusySection(null); }
  }, []);

  const refresh = useCallback(async (k: KindFilter) => {
    try {
      const r = await fetch(`/api/knowledge/overview?kind=${k}`);
      if (!r.ok) return;
      const d = await r.json() as Overview;
      if (!d?.counts) return;
      setData(d);
      // Server truth wins INCLUDING deletions — the loose page is replaced, never merged.
      setPages((prev) => ({ ...prev, [LOOSE]: { files: d.loose.files, count: d.loose.count, hasMore: d.loose.hasMore } }));
      if (k === 'all') saveLS(LS_KEY, d);
    } catch { /* keep the last good */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const cached = loadLS<Overview>(LS_KEY);
    if (cached?.counts && cached.folders) {
      setData(cached);
      setPages({ [LOOSE]: { files: cached.loose.files, count: cached.loose.count, hasMore: cached.loose.hasMore } });
      setLoading(false);
    }
    void refresh('all');
  }, [refresh]);

  // A kind change re-reads everything: the counts, the loose page, and every OPEN folder — a
  // filter that only hid painted rows would make every number on the page a guess.
  const pickKind = (k: KindFilter) => {
    setKind(k);
    setPages({});
    void refresh(k);
    for (const id of open) if (id !== LOOSE) void loadPage(id, k);
  };

  // SEARCH IS SERVER-SIDE (it must see the whole base, not the painted slice): filename matches
  // come back first, and the semantic hits — which /api/drive/search returns as bare ids — are
  // hydrated through the same files door and folded in. Results render FLAT, ungrouped.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const needle = q.trim();
    if (needle.length < 2) { setSearch(null); return; }
    setSearch((s) => ({ files: s?.files ?? [], loading: true }));
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const byName = await fetch(filesUrl({ q: needle, kind, limit: 60 }))
            .then((r) => (r.ok ? r.json() as Promise<Page> : null));
          const ids = await fetch(`/api/drive/search?q=${encodeURIComponent(needle)}`)
            .then((r) => (r.ok ? r.json() : null)).then((d) => (d?.fileIds ?? []) as string[]).catch(() => []);
          const have = new Set((byName?.files ?? []).map((f) => f.id));
          const missing = ids.filter((id) => !have.has(id));
          const bySemantic = missing.length
            ? await fetch(filesUrl({ ids: missing.join(','), kind, limit: 60 }))
              .then((r) => (r.ok ? r.json() as Promise<Page> : null)).catch(() => null)
            : null;
          setSearch({ files: [...(byName?.files ?? []), ...(bySemantic?.files ?? [])], loading: false });
        } catch { setSearch({ files: [], loading: false }); }
      })();
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, kind]);

  const toggleFolder = (f: KbFolder) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(f.id)) next.delete(f.id);
      else { next.add(f.id); setUploadTo(f.id); if (!pages[f.id]) void loadPage(f.id, kind); }
      return next;
    });
  };

  // ── THE DEEDS ────────────────────────────────────────────────────────────────────────────────
  const del = async (f: KbFile) => {
    setConfirmDel(null);
    setPages((prev) => Object.fromEntries(Object.entries(prev).map(([k, p]) =>
      [k, { ...p, files: p.files.filter((x) => x.id !== f.id) }]))); // optimistic
    setSearch((s) => s ? { ...s, files: s.files.filter((x) => x.id !== f.id) } : s);
    try {
      const res = await fetch(`/api/drive/uploads/${f.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
    } catch { toast.error('Could not remove that file'); }
    void refresh(kind);
  };

  const move = async (f: KbFile, folderId: string | null, folderName: string) => {
    const from = f.folderId ?? LOOSE;
    setPages((prev) => ({ ...prev, [from]: prev[from]
      ? { ...prev[from], files: prev[from].files.filter((x) => x.id !== f.id), count: Math.max(0, prev[from].count - 1) }
      : prev[from] }));
    setSearch((s) => s ? { ...s, files: s.files.map((x) => x.id === f.id ? { ...x, folderId, folder: folderId ? folderName : null } : x) } : s);
    try {
      const res = await fetch('/api/drive/move', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'kb_file', id: f.id, folderId }),
      });
      if (!res.ok) throw new Error();
      toast.success(folderId ? `Moved to ${folderName}` : 'Moved out of its folder');
    } catch { toast.error('Could not move that file'); }
    void refresh(kind);
    if (folderId && pages[folderId]) void loadPage(folderId, kind);
  };

  const createFolder = async (name: string): Promise<string | null> => {
    const n = name.trim();
    if (!n) return null;
    try {
      const res = await fetch('/api/drive/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.id) throw new Error(d?.error ?? 'failed');
      toast.success(`Created ${n}`);
      await refresh(kind);
      return d.id as string;
    } catch (e) {
      toast.error(e instanceof Error && e.message !== 'failed' ? e.message : 'Could not create that folder');
      return null;
    }
  };

  const renameFolder = async (id: string, name: string) => {
    const n = name.trim();
    setRenaming(null);
    if (!n) return;
    try {
      const res = await fetch(`/api/drive/folders/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? 'failed');
      // THE RENAME HEAL SPEAKS ITS CONSEQUENCE — a silent re-point is indistinguishable from a
      // rename that quietly broke a task. Say what followed the name.
      const followed = [
        d?.repointedSteps ? `${d.repointedSteps} workflow step${d.repointedSteps === 1 ? '' : 's'} updated` : null,
        d?.manifestMoved ? 'matching index moved' : null,
      ].filter(Boolean);
      toast.success(followed.length ? `Renamed — ${followed.join(' · ')}` : `Renamed to ${n}`);
    } catch (e) { toast.error(e instanceof Error && e.message !== 'failed' ? e.message : 'Could not rename that folder'); }
    void refresh(kind);
  };

  const deleteFolder = async (id: string) => {
    setConfirmFolderDel(null);
    try {
      const res = await fetch(`/api/drive/folders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'failed');
    } catch (e) { toast.error(e instanceof Error && e.message !== 'failed' ? e.message : 'Could not delete that folder'); }
    if (uploadTo === id) setUploadTo(null);
    void refresh(kind);
  };

  const upload = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (!picked.length || uploading) return;
    setUploading(true);
    const folderId = uploadTo;
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
        // THE FILE LANDS IN ITS FOLDER AT REGISTRATION — never a post-move (a move would race the
        // background indexer and leave the row briefly loose, which is what the row would show).
        await fetch('/api/drive/upload/confirm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: u.storagePath, filename: u.filename, mimeType: u.mimeType, ...(folderId ? { folderId } : {}) }),
        });
      }
      await refresh(kind);
      if (folderId) {
        setOpen((prev) => new Set(prev).add(folderId));
        await loadPage(folderId, kind);
      }
    } catch { /* the refresh shows the truth */ } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── RENDER ───────────────────────────────────────────────────────────────────────────────────
  const c = data?.counts;
  const folders = data?.folders ?? [];
  const uploadFolderName = folders.find((f) => f.id === uploadTo)?.name ?? null;

  const chip = (key: KindFilter, label: string, n?: number) => (
    <button key={key} onClick={() => pickKind(key)}
      className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${kind === key
        ? 'bg-indigo-50 text-indigo-700' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100'}`}>
      {label}{typeof n === 'number' ? <span className={kind === key ? 'text-indigo-400' : 'text-neutral-400'}> {n}</span> : null}
    </button>
  );

  const fileRow = (f: KbFile, showFolder = false) => {
    const meta = KIND_META[f.kind];
    return (
      <div key={f.id} className="group flex items-center gap-3 px-4 py-2.5">
        <span className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${meta.tint}`}>
          <meta.Icon className="w-3.5 h-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-neutral-800">{f.filename}</span>
          <span className="block text-[11.5px] text-neutral-400">
            {meta.word}
            {showFolder && f.folder ? ` · ${f.folder}` : ''}
            {f.project ? ` · ${f.project}` : ''}
            {f.indexedAt ? ` · ${fmtDate(f.indexedAt)}` : ''}
            {f.sizeBytes ? ` · ${fmtSize(f.sizeBytes)}` : ''}
          </span>
        </span>
        <span className="flex-shrink-0 text-[11px] text-neutral-300">
          {f.indexed ? `indexed · ${f.chunks} ${f.chunks === 1 ? 'chunk' : 'chunks'}` : <span className="text-amber-500">processing</span>}
        </span>
        <MoveControl file={f} folders={folders} onMove={move} onCreateFolder={createFolder} />
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
  };

  const sectionBody = (key: string, folderId: string | null) => {
    const p = pages[key];
    if (!p) return <p className="px-4 py-3 text-[12px] text-neutral-400">{busySection === key ? 'Loading…' : ''}</p>;
    if (p.count === 0) {
      return (
        <p className="px-4 py-3 text-[12px] text-neutral-400">
          {folderId ? 'Nothing filed here yet — upload into it, or move a file in.' : 'Nothing loose here.'}
        </p>
      );
    }
    return (
      <>
        {p.files.map((f) => fileRow(f))}
        {p.hasMore && (
          <button onClick={() => void loadPage(folderId, kind, p.files.length)} disabled={busySection === key}
            className="w-full px-4 py-2.5 text-left text-[12px] font-medium text-indigo-600 hover:bg-indigo-50/60 transition-colors disabled:opacity-50">
            {busySection === key ? 'Loading…' : `Show all ${p.count}`}
          </button>
        )}
      </>
    );
  };

  return (
    <div className="max-w-3xl mx-auto w-full px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold text-neutral-900 tracking-tight">Knowledge</h1>
          <p className="mt-1 text-[13px] text-neutral-500 leading-relaxed">
            Everything the brain can read — indexed, searchable, and yours to remove. Group files
            into folders and a task can read the whole folder as its source of truth.
          </p>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <button onClick={() => { setCreating(true); setNewFolder(''); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-[13px] font-medium text-neutral-700 hover:bg-neutral-50 transition-colors">
            <FolderPlusIcon className="w-4 h-4" />New folder
          </button>
          <input ref={fileRef} type="file" multiple className="hidden"
            accept=".pdf,.docx,.txt,.csv,.xlsx,.pptx,.md,.jpg,.jpeg,.png"
            onChange={(e) => void upload(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            <ArrowUpTrayIcon className="w-4 h-4" />{uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>

      {/* WHERE AN UPLOAD LANDS IS A CHOICE, SPOKEN — not a mystery pill fused to the button. It
          sits on its own line, says the word "to", wears a folder icon and a caret, and opens the
          same picker every other folder door on this page opens. The smart default (the folder you
          last opened) survives, but it is never a secret: the control always reads its own state. */}
      <div className="mt-3 flex items-center gap-1.5 text-[12px] text-neutral-500">
        <span>Uploads go to</span>
        <button ref={uploadAnchor} onClick={() => setUploadPick((v) => !v)} disabled={uploading}
          title={uploadFolderName
            ? `New uploads will be filed in "${uploadFolderName}" — click to change`
            : 'New uploads will not be filed in any folder — click to choose one'}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-medium transition-colors disabled:opacity-50 ${uploadFolderName
            ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
            : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}>
          <FolderIcon className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="max-w-[200px] truncate">{uploadFolderName ?? 'No folder'}</span>
          <ChevronDownIcon className="w-3 h-3 flex-shrink-0 opacity-60" />
        </button>
      </div>
      <AnchoredPopover anchorRef={uploadAnchor} open={uploadPick} onClose={() => setUploadPick(false)} align="left" width={240}>
        <FolderPickerPanel
          folders={folders} clearLabel="No folder"
          onClear={() => { setUploadTo(null); setUploadPick(false); }}
          onSelect={(f) => { setUploadTo(f.id); setUploadPick(false); }}
          onCreate={async (n) => { const id = await createFolder(n); if (id) setUploadTo(id); setUploadPick(false); }}
        />
      </AnchoredPopover>

      {creating && (
        <div className="mt-3 flex items-center gap-2">
          <input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { void createFolder(newFolder).then(() => { setCreating(false); setNewFolder(''); }); }
              if (e.key === 'Escape') { setCreating(false); setNewFolder(''); }
            }}
            placeholder="Folder name…"
            className="w-64 rounded-lg border border-indigo-200 px-2.5 py-1.5 text-[13px] text-neutral-800 outline-none focus:border-indigo-400" />
          <button onClick={() => void createFolder(newFolder).then(() => { setCreating(false); setNewFolder(''); })}
            className="text-[12px] font-medium text-indigo-600 hover:text-indigo-700">Create</button>
          <button onClick={() => { setCreating(false); setNewFolder(''); }} className="text-[12px] text-neutral-400 hover:text-neutral-600">Cancel</button>
        </div>
      )}

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

      {loading && !data && (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 space-y-2" aria-hidden>
          <div className="h-10 rounded-lg bg-neutral-100 animate-pulse" />
          <div className="h-10 rounded-lg bg-neutral-100 animate-pulse" />
          <div className="h-10 rounded-lg bg-neutral-100 animate-pulse" />
        </div>
      )}

      {/* SEARCH IS FLAT — a global result set is not a filing view. */}
      {search ? (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
          {search.loading && search.files.length === 0 && <p className="p-6 text-[13px] text-neutral-400">Searching…</p>}
          {!search.loading && search.files.length === 0 && <p className="p-6 text-[13px] text-neutral-400">Nothing matches that.</p>}
          {search.files.map((f) => fileRow(f, true))}
        </div>
      ) : data ? (
        <div className="mt-4 space-y-2">
          {/* The loose section leads and is expanded — meetings, attachments and generated work
              land here, so on most accounts this IS the knowledge base. */}
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <button onClick={() => setOpen((p) => { const n = new Set(p); if (n.has(LOOSE)) n.delete(LOOSE); else { n.add(LOOSE); setUploadTo(null); } return n; })}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-neutral-50 transition-colors">
              <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${open.has(LOOSE) ? 'rotate-90' : ''}`} />
              <DocumentTextIcon className="w-4 h-4 text-neutral-400" />
              <span className="flex-1 text-[13px] font-medium text-neutral-800">Files</span>
              <span className="text-[11.5px] text-neutral-400">{data.loose.count}</span>
            </button>
            {open.has(LOOSE) && <div className="border-t border-neutral-100 divide-y divide-neutral-100">{sectionBody(LOOSE, null)}</div>}
          </div>

          {folders.map((f) => (
            <div key={f.id} className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
              <div className="group flex items-center gap-2 px-4 py-2.5 hover:bg-neutral-50 transition-colors">
                <button onClick={() => toggleFolder(f)} className="flex flex-1 min-w-0 items-center gap-2 text-left">
                  <ChevronRightIcon className={`w-3.5 h-3.5 flex-shrink-0 text-neutral-400 transition-transform ${open.has(f.id) ? 'rotate-90' : ''}`} />
                  <FolderIcon className="w-4 h-4 flex-shrink-0 text-neutral-400" />
                  {renaming?.id === f.id ? (
                    <input autoFocus value={renaming.name} onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void renameFolder(f.id, renaming.name); if (e.key === 'Escape') setRenaming(null); }}
                      onBlur={() => void renameFolder(f.id, renaming.name)}
                      className="min-w-0 flex-1 rounded border border-indigo-200 px-1.5 py-0.5 text-[13px] text-neutral-800 outline-none" />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">{f.name}</span>
                  )}
                  <span className="flex-shrink-0 text-[11.5px] text-neutral-400">{f.count}</span>
                </button>
                {!f.isSystem && renaming?.id !== f.id && (
                  <span className="flex-shrink-0 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setRenaming({ id: f.id, name: f.name })}
                      title="Rename — workflow steps pointing at this folder follow the rename"
                      className="text-neutral-300 hover:text-neutral-600 transition-colors"><PencilIcon className="w-3.5 h-3.5" /></button>
                    {/* DELETE IS OFFERED ONLY ON AN EMPTY FOLDER — no cascade question to answer. */}
                    {f.count === 0 && (confirmFolderDel === f.id ? (
                      <span className="flex items-center gap-1.5">
                        <button onClick={() => void deleteFolder(f.id)} className="rounded-md bg-red-50 px-2 py-0.5 text-[11.5px] font-medium text-red-600 hover:bg-red-100">Delete</button>
                        <button onClick={() => setConfirmFolderDel(null)} className="text-[11.5px] text-neutral-400 hover:text-neutral-600">Keep</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmFolderDel(f.id)} title="Delete this empty folder"
                        className="text-neutral-300 hover:text-red-500 transition-colors"><TrashIcon className="w-3.5 h-3.5" /></button>
                    ))}
                  </span>
                )}
              </div>
              {open.has(f.id) && <div className="border-t border-neutral-100 divide-y divide-neutral-100">{sectionBody(f.id, f.id)}</div>}
            </div>
          ))}

          {folders.length === 0 && data.loose.count === 0 && (
            <p className="rounded-xl border border-neutral-200 bg-white p-6 text-[13px] text-neutral-400">
              Nothing here yet — attach a file in any conversation, or upload one above.
            </p>
          )}
        </div>
      ) : null}

      <p className="mt-4 text-[12px] text-neutral-300">
        Removing a file deletes its indexed content. Meeting notes are managed from Meetings.
        A folder can be deleted once it is empty.
      </p>
    </div>
  );
}

// ── THE ONE PICKER GRAMMAR, folder edition (mirrors ProjectPickerPanel): search leads, "New
// folder…" on top with the query pre-filled, the clear row, then the folders name-sorted. Every
// folder door on this page renders THIS panel; only the consequence differs. ────────────────────
function FolderPickerPanel({ folders, onSelect, onCreate, onClear, clearLabel }: {
  folders: KbFolder[];
  onSelect: (f: KbFolder) => void;
  onCreate: (name: string) => void | Promise<void>;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = (q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : folders)
    .slice().sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-lg p-1 cursor-default">
      {creating ? (
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && name.trim()) void onCreate(name.trim()); if (e.key === 'Escape') { setCreating(false); setName(''); } }}
          placeholder="New folder name…"
          className="w-full rounded-lg border border-indigo-200 px-2 py-1.5 text-[12.5px] text-neutral-800 outline-none" />
      ) : (
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && filtered.length === 1) onSelect(filtered[0]); }}
          placeholder="Search folders…"
          className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-[12.5px] text-neutral-800 outline-none focus:border-indigo-300" />
      )}
      {!creating && (
        <button onClick={() => { setName(query.trim()); setCreating(true); }}
          className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 mt-1 text-left text-[12.5px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors">
          <PlusIcon className="w-3 h-3 flex-shrink-0" />{q && filtered.length === 0 ? `Create "${query.trim()}"…` : 'New folder…'}
        </button>
      )}
      {!creating && onClear && (
        <button onClick={onClear}
          className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 transition-colors">
          <span className="w-3 h-3 flex-shrink-0 text-center leading-3">×</span>{clearLabel ?? 'No folder'}
        </button>
      )}
      <div className="max-h-52 overflow-y-auto border-t border-neutral-100 mt-1 pt-1">
        {filtered.map((f) => (
          <button key={f.id} onClick={() => onSelect(f)}
            className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-neutral-700 hover:bg-indigo-50 transition-colors">
            <FolderIcon className="w-3 h-3 flex-shrink-0 text-neutral-400" />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="flex-shrink-0 text-[11px] text-neutral-300">{f.count}</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="px-2 py-1.5 text-[12px] text-neutral-400">{q ? 'No match — create it above.' : 'No folders yet.'}</p>}
      </div>
    </div>
  );
}

/** The per-row "Move to…" door — portaled (THE OVERLAY LAW), the same picker grammar. */
function MoveControl({ file, folders, onMove, onCreateFolder }: {
  file: KbFile;
  folders: KbFolder[];
  onMove: (f: KbFile, folderId: string | null, folderName: string) => void | Promise<void>;
  onCreateFolder: (name: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span ref={ref} className="relative inline-flex flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((v) => !v)} title="Move to a folder"
        className={`text-neutral-300 hover:text-indigo-600 transition-all ${open ? 'opacity-100 text-indigo-600' : 'opacity-0 group-hover:opacity-100'}`}>
        <ArrowRightCircleIcon className="w-4 h-4" />
      </button>
      <AnchoredPopover anchorRef={ref} open={open} onClose={() => setOpen(false)} align="right" width={240}>
        <FolderPickerPanel
          folders={folders}
          clearLabel="No folder"
          {...(file.folderId ? { onClear: () => { setOpen(false); void onMove(file, null, ''); } } : {})}
          onSelect={(f) => { setOpen(false); void onMove(file, f.id, f.name); }}
          onCreate={async (n) => {
            const id = await onCreateFolder(n);
            setOpen(false);
            if (id) void onMove(file, id, n);
          }}
        />
      </AnchoredPopover>
    </span>
  );
}
