'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SLIM KNOWLEDGE PANEL (one-surface plan, Aug 6 — the folder grid's replacement). Files live
// WITH their work (a room's Files tab, the deliverable pool, the composer's attach), and this was
// the SOVEREIGNTY/AUDIT surface beside them: everything the brain can read, in one column — what
// arrived from where (meetings · email attachments · uploads · generated), whether it's indexed,
// which project it lives on, search over all of it, and the right to remove. Its "never a
// destination you browse" clause was REVISED by the owner on Sep 15 — see below.
//
// THE DOCUMENTS LIBRARY (Sep 15 — the frame moved, the organs did not; docs/documents-library-plan.md).
// The owner revised the Aug 6 clause: this is its own page at /documents, not Settings chrome. With
// the frame came the mental model, because the page was organised three ways at once:
//   · FOLDERS LEAD, PROVENANCE IS METADATA — the kind chips row was an ingestion-path taxonomy
//     nobody thinks in. Provenance survives as the row's icon + word and as a quiet Filter menu
//     (the same `kind` param the API always took — capability kept, taxonomy demoted).
//   · TELEMETRY SPEAKS ONLY WHEN SOMETHING MOVES — the permanent "N indexed" line and the connected
//     mail addresses left (mail custody is Settings → Email's fact). A processing chip renders only
//     while something is actually in flight.
//   · AN UPLOAD LANDS WHERE YOU AIM IT, IN THE MOMENT — the destination rides ON the Upload button,
//     the selected scope IS the default, and the page is a drop zone.
//   · A ROW HAS A DESTINATION — a file row opens THE ONE VIEWER (components/ui/attachment-lightbox).
//   · A FOLDER SPEAKS WHAT DEPENDS ON IT — the read-side twin of the rename heal: the workflow
//     bindings are legible BEFORE the deed, not only in the toast after it.
//   · EXCEPTIONS ON THE ROW — a non-deletable meeting note wears a lock, not an invisible spacer.
//     …and THE LOCK IS A DOOR, NOT A SHRUG (Sep 16, W10): it names Meetings and goes there; and it
//     can say "your meeting" truthfully because only an owner's library ever indexes a transcript.
//
// THE FOLDERS SURFACE (Sep 2) — the one column became folder-GROUPED, because a folder stopped
// being a filing convenience and became a product concept:
//   · the seed kit lands per-workspace folder PACKS on every enterprise member at join — and a
//     seeded folder that renders nowhere might as well not exist (the owner's find);
//   · `read_kb_folder` / `match_to_profiles` point a workflow step at a folder BY NAME, so
//     "build a folder of role profiles and aim the matcher at it" is a thing a user must be able
//     to DO here — create, upload into, move into, rename.
// An EMPTY folder still renders. Search is global and flat — server-side, so it sees the whole
// base and not just what happens to be painted.
//
// THE TWO-PANE LIBRARY (Sep 15, owner's second walk — SUPERSEDES the root-grammar clause that
// ordered folder cards above a flat loose card). One scrolling column stacked every folder's
// contents on top of each other, so the page only ever got longer ("isn't the dropbox model maybe
// best practice? or even finder style? … this way its long and only scrollable"). The shape is now
// the conventional doc-manager one, which is also the platform's OWN inbox/settings grammar:
//   · FOLDERS ARE A RAIL, NOT ACCORDIONS. The left rail lists the scopes — All files, then every
//     folder with its count. Selecting a scope is navigation, not expansion.
//   · ONE SCOPE'S LIST ON SCREEN AT A TIME. The right pane shows exactly the selected scope; the
//     two panes scroll independently, so the rail never scrolls away under a long folder.
//   · A RAIL STAYS CALM. Rename / delete / upload belong to the scope you are IN — they live in the
//     right pane's header, where the thing they act on is named. The rail carries only names,
//     counts, and "New folder".
//   · UNFILED IS NOT A FOLDER (the first walk's correction, still law). It is not a rail row: All
//     files simply shows everything, with each row's folder in its meta line. LOOSE as a page key
//     is gone with it — nothing asks the server for `folderId=none` any more.
//   · BULK IS THE SAME DOORS, MANY TIMES. Selecting rows adds no server surface: Move loops the one
//     move door and Remove loops the one delete door, over the same optimistic cache surgery a
//     single row's deed performs. A selection is PER-VIEW and dies with it — changing scope, kind,
//     or entering search clears it, because a selection you cannot see is a deed you did not mean.
//     And Remove never touches a meeting note: the count on the button is the deletable count.
//   · A DRAG CARRIES THE SELECTION (Sep 16, the owner's third walk — the decided skip of W6 was
//     wrong: bulk Move covers the deed, but not the GESTURE people already know). Dragging a row
//     that is IN the selection drags the whole selection; dragging one that is not drags only it,
//     and never silently joins it to a selection the user did not make. The payload is ids on a
//     PRIVATE dataTransfer type, which is also how the two drag worlds stay apart: the page's
//     OS-file machinery guards on `types.includes('Files')` and an internal drag carries no
//     'Files', so it can never raise the dashed outline or reach the upload door.
//   · THE RAIL'S ALL-FILES ROW IS THE UNFILE DOOR. Every rail row is a drop target, and the one at
//     the top means "out of every folder" — the same move door with a null destination. Dropping
//     already-loose files there is a no-op the cache surgery absorbs (pagesAfterMove skips a file
//     whose folder is already the destination).
//   · PENDING ROWS HAVE EXITS. The processing chip opened a door onto stuck rows and then offered
//     nothing to do about them ("these processing aren't doing anything and stuck"). A row that
//     will never index is not telemetry, it is litter: each deletable row carries a remove, and the
//     footer removes them all behind the same two-step confirm every destructive deed here uses.
//     A pending meeting note keeps its lock — it still leaves from its meeting, and because that
//     makes the chip's number larger than the footer's ("9 processing but remove 8?"), the
//     DIFFERENCE IS SPOKEN WHERE IT APPEARS: a line under the footer naming what stayed behind, in
//     the skip toast's own words. A gap between two numbers on one surface is never left to a
//     hover title on a row below the fold. …AND THE EXIT FOR A ROW THAT SHOULDN'T BE REMOVED IS A
//     RETRY (Sep 16, W9 — the owner's last pending row was a meeting transcript pending since 15
//     July: not removable here, correctly, and nothing would ever index it, because `indexArtifact`
//     swallows its own failures and no retry existed anywhere. "If nothing can happen, it's
//     stuck."). Every pending row carries one, locked or not; it re-runs the indexing from whatever
//     the row already holds (lib/knowledge/reindex.ts). A RETRY THAT CANNOT SUCCEED SAYS WHY, IT
//     NEVER SPINS FOREVER: the reason comes back in the toast and the row stays exactly where it
//     was. There is deliberately no retry-all — removal is one repeated deed on rows that are all
//     already litter, but a re-index is AI spend per file and a failing class would just be
//     hammered in a batch; the rows that can come back come back one at a time.
//   · FINDER'S GRAMMAR ON THE ROW ITSELF. Plain click previews; shift-click extends the range from
//     the last anchor; cmd/ctrl-click toggles one; cmd/ctrl-A takes the painted list. A modified
//     click NEVER opens the viewer — a selection gesture that also navigates is a trap. THE RANGE
//     ANCHOR IS AN ID, NOT A POSITION: these lists churn under the user (refresh, cache surgery,
//     pagination), so a remembered index silently pointed at whichever row had moved into that slot
//     and shift-click degraded to a plain toggle "sometimes". The anchor names a file and is
//     resolved in the list being clicked; anchor gone from this view = toggle, and re-anchor here.
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
  MagnifyingGlassIcon, XMarkIcon, FolderIcon, FunnelIcon, LockClosedIcon,
  ChevronDownIcon, PencilIcon, TrashIcon, ArrowRightCircleIcon, PlusIcon, CheckIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { loadLS, saveLS } from '@/lib/utils/local-cache';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { AttachmentLightbox, type LightboxFile } from '@/components/ui/attachment-lightbox';
import { toast } from 'sonner';

type Kind = 'meeting' | 'attachment' | 'upload' | 'generated';
type KindFilter = 'all' | Kind;
type KbFile = {
  id: string; filename: string; kind: Kind;
  sizeBytes: number | null; indexedAt: string | null; chunks: number; indexed: boolean;
  project: string | null; folderId: string | null; folder: string | null; deletable: boolean;
  // Meeting rows only — the transcript id, which is the note's own address. ADDITIVE and OPTIONAL,
  // so a warm LS page written before this field still paints (those rows simply fall back to the
  // bare lock glyph until the refresh replaces them — no cache key bump needed).
  meetingId?: string;
};
type KbFolder = {
  id: string; name: string; count: number; isSystem: boolean;
  // A FOLDER SPEAKS WHAT DEPENDS ON IT — the workflows bound to it BY NAME (the same
  // FOLDER_CONFIG_KEYS table the rename heal walks). Present ONLY when at least one binds it;
  // absent means nothing depends on this folder, so nothing renders.
  workflows?: { count: number; names: string[] };
};
type Overview = {
  counts: { meeting: number; attachment: number; upload: number; generated: number; total: number; indexed: number; pending: number };
  folders: KbFolder[];
  loose: { count: number; files: KbFile[]; hasMore: boolean };
  mail: Array<{ provider: string; email: string }>;
};
type Page = { files: KbFile[]; count: number; hasMore: boolean };

// v4 — the cached shape's MEANING changed with the rail: the warm list is now the ALL scope, not
// the loose one (the stamped-cache law: a key whose contents mean something new gets a new name).
const LS_KEY = 'aug-knowledge-v4';
const LS_ALL_KEY = 'aug-knowledge-all-v4';
const PAGE = 50;
const ALL = '__all__'; // the scope key for "All files" — the absence of a folder filter, not a folder

// What the upload door accepts — the SAME list the file input declares, so a dropped file and a
// picked file are judged by one rule. A rejected drop says so out loud instead of vanishing.
const ACCEPT = '.pdf,.docx,.txt,.csv,.xlsx,.pptx,.md,.jpg,.jpeg,.png';
const ACCEPT_RE = /\.(pdf|docx|txt|csv|xlsx|pptx|md|jpe?g|png)$/i;

// THE TWO DRAG WORLDS, KEPT APART BY THEIR TYPES. An OS file drag always carries 'Files'; an
// internal row drag carries ONLY this private type. Every window-level handler on this page tests
// for 'Files', every drop target for this — so neither can ever answer for the other, and the
// dashed page outline never fires on a row being moved between folders.
const DRAG_TYPE = 'application/x-augmtd-kb-ids';
const isInternalDrag = (dt: DataTransfer | null) => Array.from(dt?.types ?? []).includes(DRAG_TYPE);

const KIND_META: Record<Kind, { Icon: React.ElementType; word: string; tint: string }> = {
  meeting: { Icon: VideoCameraIcon, word: 'Meeting note', tint: 'bg-emerald-50 text-emerald-600' },
  attachment: { Icon: PaperClipIcon, word: 'Email attachment', tint: 'bg-indigo-50 text-indigo-500' },
  upload: { Icon: ArrowUpTrayIcon, word: 'Upload', tint: 'bg-neutral-100 text-neutral-500' },
  generated: { Icon: DocumentTextIcon, word: 'Generated', tint: 'bg-violet-50 text-violet-500' },
};
const fmtSize = (b: number | null) => b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

// ── THE CACHE SURGERY, WRITTEN ONCE ──────────────────────────────────────────────────────────────
// One file or forty, a move and a remove rewrite the pages map the same way — so the single-row
// deeds and the bulk loops call THESE, and can never drift into disagreeing about what just
// happened on screen. Pure functions: they take the map and give back the map.
/** A removed file leaves every painted scope. (Counts are left to the closing refresh, which asks.) */
const pagesAfterDelete = (prev: Record<string, Page>, ids: Set<string>): Record<string, Page> =>
  Object.fromEntries(Object.entries(prev).map(([k, p]) => [k, { ...p, files: p.files.filter((x) => !ids.has(x.id)) }]));

const withFolder = (files: KbFile[], ids: Set<string>, folderId: string | null, folderName: string): KbFile[] =>
  files.map((x) => ids.has(x.id) ? { ...x, folderId, folder: folderId ? folderName : null } : x);

/** A moved file LEAVES the folder scope it was in; in All files it stays, wearing its new word. */
const pagesAfterMove = (prev: Record<string, Page>, files: KbFile[], folderId: string | null, folderName: string): Record<string, Page> => {
  const next: Record<string, Page> = { ...prev };
  const bySource = new Map<string, Set<string>>();
  for (const f of files) {
    if (!f.folderId || f.folderId === folderId) continue;
    const set = bySource.get(f.folderId) ?? new Set<string>();
    set.add(f.id);
    bySource.set(f.folderId, set);
  }
  for (const [from, ids] of bySource) {
    const p = next[from];
    if (!p) continue;
    next[from] = { ...p, files: p.files.filter((x) => !ids.has(x.id)), count: Math.max(0, p.count - ids.size) };
  }
  const moved = new Set(files.map((f) => f.id));
  if (next[ALL]) next[ALL] = { ...next[ALL], files: withFolder(next[ALL].files, moved, folderId, folderName) };
  return next;
};

/** A BULK DEED IS SMALL REQUESTS, PACED — three in flight, never a burst of forty, and the honest
 *  tally comes back so a partial failure can say so instead of being rounded up to success. */
async function runPool<T>(items: T[], worker: (x: T) => Promise<boolean>, size = 3) {
  let i = 0, ok = 0, failed = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const x = items[i++];
      if (await worker(x)) ok += 1; else failed += 1;
    }
  }));
  return { ok, failed };
}

const filesUrl = (p: Record<string, string | number | undefined>) =>
  `/api/knowledge/files?${Object.entries(p).filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`;

export default function KnowledgePanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<KindFilter>('all');
  const [q, setQ] = useState('');

  // THE SCOPE — ALL or a folder id. One scope's list is on screen at a time; pages are kept per
  // scope so coming back to a folder repaints instantly.
  const [scope, setScope] = useState<string>(ALL);
  const scopeRef = useRef<string>(ALL);
  scopeRef.current = scope;

  const [pages, setPages] = useState<Record<string, Page>>({});
  const [busyScope, setBusyScope] = useState<string | null>(null);

  const [search, setSearch] = useState<{ files: KbFile[]; loading: boolean } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmFolderDel, setConfirmFolderDel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [uploading, setUploading] = useState(false);
  // AN UPLOAD LANDS WHERE YOU AIM IT — the SCOPE is the default aim (the folder you are looking at
  // is the folder you mean; All files means unfiled). `undefined` = follow the scope; anything else
  // is an explicit override the caret picked, and only an override that DIFFERS from the scope's
  // own default is worth naming on the button.
  const [uploadOverride, setUploadOverride] = useState<string | null | undefined>(undefined);

  const fileRef = useRef<HTMLInputElement>(null);
  const uploadAnchor = useRef<HTMLButtonElement>(null);
  const [uploadPick, setUploadPick] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ONE hidden input serves every upload door, so the door that opened it parks its destination
  // here — the picker's result must land where it was aimed, not where the global state points.
  const pendingDest = useRef<string | null>(null);

  const filterAnchor = useRef<HTMLButtonElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  // ── THE SELECTION — per-view, and it dies with the view ──────────────────────────────────────
  // Ids only; the rows themselves are read back out of the list currently painted, which is the
  // same reason the set is cleared whenever that list is replaced (scope · kind · search). A
  // selection spanning lists the user cannot see is a deed nobody meant to authorise.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState<null | 'move' | 'remove'>(null);
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);
  const bulkAnchor = useRef<HTMLButtonElement>(null);
  const [bulkPick, setBulkPick] = useState(false);
  // The anchor of a SHIFT range — the last row the user actually toggled, held BY ID because the
  // list under it churns (a refresh replaces a page with server truth including new arrivals, the
  // cache surgery removes moved/removed rows, pagination appends). An index into a list that has
  // since been rewritten points at whatever moved into that slot, which is how shift-click came to
  // "sometimes work". The id is resolved against the list being clicked, at the moment of the click.
  const anchorIdRef = useRef<string | null>(null);
  // Row-level Move popovers are local to their row; they report here so Escape can yield to them.
  const [rowPopovers, setRowPopovers] = useState(0);

  const clearSelection = useCallback(() => {
    setSelected((s) => (s.size ? new Set<string>() : s));
    anchorIdRef.current = null;
    setConfirmBulkDel(false);
    setBulkPick(false);
  }, []);

  // THE PROCESSING CHIP IS A DOOR — the rows behind the number, fetched on open (never eagerly:
  // most days there is nothing pending and nobody clicks). Best-effort: a failed read says so in
  // one quiet line and the page is untouched, because nothing on it depends on this list.
  const pendingAnchor = useRef<HTMLButtonElement>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [pendingList, setPendingList] = useState<{ files: KbFile[]; loading: boolean; failed: boolean }>({ files: [], loading: false, failed: false });
  // PENDING ROWS HAVE EXITS — the same two-step red idiom the rest of the page uses for a deed that
  // cannot be undone, and a busy flag so a slow sweep can't be fired twice.
  const [confirmPendingAll, setConfirmPendingAll] = useState(false);
  const [pendingBusy, setPendingBusy] = useState(false);
  // …AND THE RETRY — per ROW, because a re-index is a real piece of work (extraction · chunk
  // summaries · embeddings) and the person watching needs to see WHICH row is working.
  const [retrying, setRetrying] = useState<Set<string>>(() => new Set());

  // The page is a drop zone; a RAIL folder row is a drop target within it.
  const [dragging, setDragging] = useState(false);
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  // The rows an internal drag is carrying — held here rather than read back out of the payload,
  // because `getData` is deliberately unreadable during dragover and the drop needs whole files
  // (their CURRENT folder is what tells the cache surgery which scope they are leaving).
  const dragFilesRef = useRef<KbFile[]>([]);
  // The list as painted, for the window-level shortcut: Cmd+A takes what is on screen, and what is
  // on screen changes far more often than it is worth re-registering a listener for.
  const paintedRef = useRef<KbFile[]>([]);

  // THE ONE VIEWER (components/ui/attachment-lightbox) opened on a context, never on one file —
  // the arrows page the list you opened from.
  const [preview, setPreview] = useState<{ files: KbFile[]; index: number } | null>(null);

  // ── THE READS ────────────────────────────────────────────────────────────────────────────────
  /** One scope's page. ALL omits `folderId` ENTIRELY — the server reads an absent param as "no
   *  folder filter" (a `none` would mean unfiled-only, which is a different question). */
  const loadPage = useCallback(async (scopeKey: string, k: KindFilter, offset = 0) => {
    setBusyScope(scopeKey);
    try {
      const r = await fetch(filesUrl({
        ...(scopeKey === ALL ? {} : { folderId: scopeKey }),
        kind: k, offset, limit: PAGE,
      }));
      if (!r.ok) return;
      const p = await r.json() as Page;
      setPages((prev) => ({
        ...prev,
        [scopeKey]: offset === 0 ? p : { ...p, files: [...(prev[scopeKey]?.files ?? []), ...p.files] },
      }));
      // WARM PAINT IS THE ALL SCOPE'S — the one list every visit opens on.
      if (scopeKey === ALL && k === 'all' && offset === 0) saveLS(LS_ALL_KEY, p);
    } catch { /* the next refresh shows the truth */ } finally { setBusyScope(null); }
  }, []);

  /** The chip's own rows — only files with zero chunks, newest first, so a row that has been
   *  "processing" since August is visibly stuck rather than hidden inside a count. */
  const loadPending = useCallback(async () => {
    setPendingList({ files: [], loading: true, failed: false });
    try {
      const r = await fetch(filesUrl({ pending: 1, limit: PAGE }));
      if (!r.ok) throw new Error();
      const p = await r.json() as Page;
      setPendingList({ files: p.files ?? [], loading: false, failed: false });
    } catch { setPendingList({ files: [], loading: false, failed: true }); }
  }, []);

  const refresh = useCallback(async (k: KindFilter) => {
    try {
      const r = await fetch(`/api/knowledge/overview?kind=${k}`);
      if (!r.ok) return;
      const d = await r.json() as Overview;
      if (!d?.counts) return;
      setData(d);
      if (k === 'all') saveLS(LS_KEY, d);
    } catch { /* keep the last good */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const cached = loadLS<Overview>(LS_KEY);
    if (cached?.counts && cached.folders) { setData(cached); setLoading(false); }
    // The overview's `loose` payload is NOT the All-files list any more, so it seeds nothing; the
    // warm list comes from its own stamped key and the real page replaces it.
    const cachedAll = loadLS<Page>(LS_ALL_KEY);
    if (cachedAll?.files) setPages({ [ALL]: cachedAll });
    void refresh('all');
    void loadPage(ALL, 'all');
  }, [refresh, loadPage]);

  // A kind change re-reads everything: the counts and the current scope's page — a filter that only
  // hid painted rows would make every number on the page a guess.
  const pickKind = (k: KindFilter) => {
    setKind(k);
    setPages({});
    clearSelection(); // a filter paints a different list; the old selection is not in it
    void refresh(k);
    void loadPage(scope, k);
  };

  const pickScope = (key: string) => {
    setScope(key);
    clearSelection();
    setUploadOverride(undefined); // a new scope is a new default aim
    setConfirmFolderDel(null);
    setRenaming(null);
    if (!pages[key]) void loadPage(key, kind);
  };

  // SEARCH IS SERVER-SIDE (it must see the whole base, not the painted slice): filename matches
  // come back first, and the semantic hits — which /api/drive/search returns as bare ids — are
  // hydrated through the same files door and folded in. Results render FLAT, ungrouped, and
  // GLOBAL — scoping search to the open folder would hide the file you are hunting for.
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

  // ENTERING OR LEAVING SEARCH REPLACES THE LIST — so it replaces the selection with nothing.
  const inSearch = search !== null;
  useEffect(() => { clearSelection(); }, [inSearch, clearSelection]);

  // ESCAPE CLEARS, CMD+A TAKES THE LIST — both through the ONE yield ladder: a keystroke may only
  // mean one thing at a time, so neither fires while the viewer or any popover owns the key, and
  // neither fires while a field has the caret (a folder name being typed owns its own select-all).
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t instanceof HTMLElement ? t : null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const busySurface = () => !!preview || uploadPick || filterOpen || pendingOpen || bulkPick || rowPopovers > 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!selected.size || busySurface()) return;
        clearSelection();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a') {
        if (typing(e.target) || busySurface()) return;
        const list = paintedRef.current;
        if (!list.length) return;
        e.preventDefault(); // else the browser selects the page's text instead
        setSelected(new Set(list.map((f) => f.id)));
        anchorIdRef.current = list[list.length - 1]?.id ?? null;
        setConfirmBulkDel(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size, preview, uploadPick, filterOpen, pendingOpen, bulkPick, rowPopovers, clearSelection]);

  // ── THE DEEDS ────────────────────────────────────────────────────────────────────────────────
  const del = async (f: KbFile) => {
    setConfirmDel(null);
    setPages((prev) => pagesAfterDelete(prev, new Set([f.id]))); // optimistic
    setSearch((s) => s ? { ...s, files: s.files.filter((x) => x.id !== f.id) } : s);
    try {
      const res = await fetch(`/api/drive/uploads/${f.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
    } catch { toast.error('Could not remove that file'); }
    void refresh(kind);
    void loadPage(scopeRef.current, kind);
  };

  // ── THE PENDING EXITS — the same delete door, reached from the chip ───────────────────────────
  // A row that has been "processing" since August will never index (extraction yielded nothing);
  // leaving it visible with no way out was the complaint. The popover STAYS OPEN through the deed:
  // clearing a stuck list is one motion, and a door that closes itself after each row is a chore.
  const dropPending = (ids: Set<string>) => {
    setPendingList((p) => ({ ...p, files: p.files.filter((f) => !ids.has(f.id)) }));
    setPages((prev) => pagesAfterDelete(prev, ids));
    setSearch((s) => s ? { ...s, files: s.files.filter((x) => !ids.has(x.id)) } : s);
  };

  const removePending = async (f: KbFile) => {
    dropPending(new Set([f.id])); // optimistic — the chip's count follows on the refresh
    try {
      if (!(await fetch(`/api/drive/uploads/${f.id}`, { method: 'DELETE' })).ok) throw new Error();
    } catch {
      toast.error('Could not remove that file');
      void loadPending(); // the list we just edited was a guess; ask again
    }
    void refresh(kind);
    void loadPage(scopeRef.current, kind);
  };

  // THE RETRY — the OTHER exit, and the only one a locked row has. It is not optimistic: the row
  // leaves the pending list when the server says it is indexed, and stays put, unchanged, when it
  // cannot be. A refusal is spoken in the reason the door returned — never "something went wrong".
  const retryPending = async (f: KbFile) => {
    if (retrying.has(f.id) || pendingBusy) return;
    setRetrying((s) => new Set(s).add(f.id));
    try {
      const res = await fetch('/api/knowledge/reindex', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: f.id }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; chunks?: number; reason?: string };
      if (res.ok && d?.ok) {
        toast.success(`Indexed — ${d.chunks} ${d.chunks === 1 ? 'chunk' : 'chunks'}`);
        // It is no longer pending, but it very much still exists — so it leaves THIS list only, and
        // the scope's own page is re-read so the row's meta line stops saying "processing".
        setPendingList((p) => ({ ...p, files: p.files.filter((x) => x.id !== f.id) }));
        void refresh(kind);
        void loadPage(scopeRef.current, kind);
      } else {
        const reason = typeof d?.reason === 'string' && d.reason ? d.reason : 'indexing failed';
        toast.error(reason === 'no extractable content'
          ? 'Couldn’t index this one — no extractable content.'
          : `Couldn’t index this one — ${reason}.`);
      }
    } catch {
      toast.error('Couldn’t index this one — the request failed.');
    } finally {
      setRetrying((s) => { const n = new Set(s); n.delete(f.id); return n; });
    }
  };

  const removeAllPending = async () => {
    // A PENDING MEETING NOTE STILL LIVES WITH ITS MEETING — the button's number is the deletable
    // count, and anything left behind is named rather than silently survived.
    const targets = pendingList.files.filter((f) => f.deletable);
    const skipped = pendingList.files.length - targets.length;
    // Never sweep rows out from under a retry that is still running — its row may be about to come
    // back indexed, and removing it mid-flight would delete a file that just succeeded.
    if (!targets.length || pendingBusy || retrying.size > 0) return;
    setConfirmPendingAll(false);
    setPendingBusy(true);
    dropPending(new Set(targets.map((f) => f.id)));
    const { ok, failed } = await runPool(targets, async (f) => {
      try { return (await fetch(`/api/drive/uploads/${f.id}`, { method: 'DELETE' })).ok; } catch { return false; }
    });
    const line = `Removed ${ok}${skipped ? ` · ${skipped} meeting note${skipped === 1 ? '' : 's'} skipped — they live with their meetings` : ''}`;
    if (failed) { toast.error(`${line} · ${failed} failed`); void loadPending(); } else toast.success(line);
    setPendingBusy(false);
    void refresh(kind);
    void loadPage(scopeRef.current, kind);
  };

  const move = async (f: KbFile, folderId: string | null, folderName: string) => {
    const ids = new Set([f.id]);
    setPages((prev) => pagesAfterMove(prev, [f], folderId, folderName));
    setSearch((s) => s ? { ...s, files: withFolder(s.files, ids, folderId, folderName) } : s);
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
    // A scope that no longer exists is not a place to stand.
    if (scopeRef.current === id) { setScope(ALL); setUploadOverride(undefined); }
    if (uploadOverride === id) setUploadOverride(undefined);
    void refresh(kind);
  };

  // THE DESTINATION IS AN ARGUMENT, NEVER A READ OF GLOBAL STATE — the header cluster passes the
  // folder it displays, a rail drop passes the row it landed on, a pane drop passes the scope.
  // One implementation, three aims, no door able to disagree with what it said it would do.
  const upload = async (list: ArrayLike<File> | null, folderId: string | null) => {
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
        // THE FILE LANDS IN ITS FOLDER AT REGISTRATION — never a post-move (a move would race the
        // background indexer and leave the row briefly loose, which is what the row would show).
        await fetch('/api/drive/upload/confirm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: u.storagePath, filename: u.filename, mimeType: u.mimeType, ...(folderId ? { folderId } : {}) }),
        });
      }
      await refresh(kind);
      // THE UPLOAD SHOWS ITSELF — land on the scope it went to, so the file is visible, not filed
      // into somewhere the user then has to go find.
      const dest = folderId ?? ALL;
      setScope(dest);
      setUploadOverride(undefined);
      await loadPage(dest, kind);
      if (dest !== ALL) void loadPage(ALL, kind);
    } catch { /* the refresh shows the truth */ } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // THE WHOLE PAGE IS A DROP ZONE (the chat composer's idiom, whole-window + a depth counter so a
  // drag crossing a child element never flickers the highlight off). A drop ON a RAIL FOLDER ROW
  // files there — the row under the cursor IS the aim. A drop anywhere else lands in the SCOPE you
  // are looking at, because that is the place the screen is claiming to be.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const railFolderOf = (e: DragEvent) => {
      const el = e.target instanceof Element ? e.target.closest('[data-drop-folder]') : null;
      return el?.getAttribute('data-drop-folder') ?? null;
    };
    const aimOf = (e: DragEvent) => {
      const rail = railFolderOf(e);
      if (rail) return rail;
      return scopeRef.current === ALL ? null : scopeRef.current;
    };
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth += 1; setDragging(true); };
    const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); setDragFolder(railFolderOf(e)); };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) { setDragging(false); setDragFolder(null); }
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setDragging(false); setDragFolder(null);
      const all = Array.from(e.dataTransfer?.files ?? []);
      const ok = all.filter((f) => ACCEPT_RE.test(f.name));
      const skipped = all.filter((f) => !ACCEPT_RE.test(f.name));
      if (skipped.length) toast.error(`Not supported: ${skipped.map((f) => f.name).join(', ')} — PDF, Word, Excel, PowerPoint, CSV, text, Markdown or images.`);
      if (ok.length) void upload(ok, aimOf(e));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploading, kind]);

  /** Aim the one hidden input at a destination, then open it. */
  const pickFilesInto = (folderId: string | null) => {
    pendingDest.current = folderId;
    fileRef.current?.click();
  };

  // ── RENDER ───────────────────────────────────────────────────────────────────────────────────
  const c = data?.counts;
  const folders = data?.folders ?? [];
  const scopeFolder = scope === ALL ? null : folders.find((f) => f.id === scope) ?? null;
  const scopeFolderId = scope === ALL ? null : scope;
  // The aim: the scope's own default unless the caret overrode it. Only a DIFFERENT destination is
  // worth naming on the button — restating the scope you are already in is noise.
  const uploadDest = uploadOverride === undefined ? scopeFolderId : uploadOverride;
  const overrideName = uploadOverride !== undefined && uploadOverride !== scopeFolderId
    ? (uploadOverride === null ? 'Unfiled' : folders.find((f) => f.id === uploadOverride)?.name ?? null)
    : null;

  const page = pages[scope];
  // The footer's number is the DELETABLE pending count — never the chip's, which counts locked
  // meeting notes too. A button that says a number it will not honour is a small lie.
  const pendingDeletable = pendingList.files.filter((f) => f.deletable).length;
  // A COUNT GAP IS SPOKEN WHERE IT APPEARS — the chip says 9, the footer offers 8, and the missing
  // one is a locked meeting note sitting below the popover's scroll fold whose lock only speaks on
  // hover. The difference gets its own line rather than leaving the two numbers to argue.
  const pendingLocked = pendingList.files.length - pendingDeletable;
  const scopeTitle = scopeFolder ? scopeFolder.name : 'All files';
  const scopeCount = page?.count ?? (scopeFolder ? scopeFolder.count : c?.total ?? 0);

  // PROVENANCE IS METADATA, NOT NAVIGATION — the filter keeps the capability the chips row carried
  // and demotes the taxonomy to a menu. The active kind is never hidden: it wears a dismissible chip.
  const KIND_FILTERS: Array<{ key: KindFilter; label: string; n?: number }> = [
    { key: 'all', label: 'All', n: c?.total },
    { key: 'meeting', label: 'Meetings', n: c?.meeting },
    { key: 'attachment', label: 'Attachments', n: c?.attachment },
    { key: 'upload', label: 'Uploads', n: c?.upload },
    { key: 'generated', label: 'Generated', n: c?.generated },
  ];
  const kindWord = KIND_FILTERS.find((f) => f.key === kind)?.label ?? 'All';

  /** The row's own meta line — the viewer wears the same words the row does. */
  const metaLine = (f: KbFile, showFolder: boolean) => [
    KIND_META[f.kind].word,
    showFolder && f.folder ? f.folder : null,
    f.project, f.indexedAt ? fmtDate(f.indexedAt) : null,
    f.indexed ? `indexed · ${f.chunks} ${f.chunks === 1 ? 'chunk' : 'chunks'}` : 'processing',
  ].filter(Boolean).join(' · ');

  const openPreview = (list: KbFile[], f: KbFile) => {
    const i = list.findIndex((x) => x.id === f.id);
    setPreview({ files: list, index: Math.max(0, i) });
  };

  // ── THE BULK DEEDS — the same doors, many times ───────────────────────────────────────────────
  // The painted list IS the selection's universe (that is what "per-view" means), so the rows the
  // bar acts on are read straight back out of it.
  const paintedList: KbFile[] = search ? search.files : (page?.files ?? []);
  paintedRef.current = paintedList;
  const selectedFiles = paintedList.filter((f) => selected.has(f.id));
  const deletableCount = selectedFiles.filter((f) => f.deletable).length;

  const toggleSelect = (list: KbFile[], f: KbFile, shift: boolean) => {
    const idx = list.findIndex((x) => x.id === f.id);
    if (idx < 0) return;
    setConfirmBulkDel(false);
    // THE ANCHOR IS RESOLVED NOW, NOT REMEMBERED AS A POSITION — the row it names is found in the
    // list being clicked. Gone from this view (moved, removed, filtered away, never painted here)
    // means there is no range to extend: the gesture degrades to a plain toggle and re-anchors here,
    // which is exactly what the next shift-click will want.
    const anchorIdx = anchorIdRef.current === null ? -1 : list.findIndex((x) => x.id === anchorIdRef.current);
    setSelected((prev) => {
      const next = new Set(prev);
      // SHIFT SELECTS THE RANGE within the list as painted — never across a list you can't see.
      if (shift && anchorIdx >= 0) {
        const a = Math.min(anchorIdx, idx), b = Math.max(anchorIdx, idx);
        for (let i = a; i <= b; i++) next.add(list[i].id);
        return next;
      }
      if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
      return next;
    });
    anchorIdRef.current = f.id;
  };

  const bulkMove = async (files: KbFile[], folderId: string | null, folderName: string) => {
    if (!files.length || bulkBusy) return;
    setBulkPick(false);
    setBulkBusy('move');
    const ids = new Set(files.map((f) => f.id));
    setPages((prev) => pagesAfterMove(prev, files, folderId, folderName)); // the row's own surgery
    setSearch((s) => s ? { ...s, files: withFolder(s.files, ids, folderId, folderName) } : s);
    const { ok, failed } = await runPool(files, async (f) => {
      try {
        const res = await fetch('/api/drive/move', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'kb_file', id: f.id, folderId }),
        });
        return res.ok;
      } catch { return false; }
    });
    const line = folderId ? `Moved ${ok} to ${folderName}` : `Moved ${ok} out of their folders`;
    // A PARTIAL FAILURE SAYS SO — the closing refresh then shows which is which.
    if (failed) toast.error(`${line} · ${failed} failed`); else toast.success(line);
    clearSelection(); // never a bar left standing over rows that already moved
    setBulkBusy(null);
    void refresh(kind);
    void loadPage(scopeRef.current, kind);
    const sources = new Set(files.map((f) => f.folderId).filter((x): x is string => !!x));
    if (folderId) sources.add(folderId);
    for (const s of sources) if (s !== scopeRef.current && pages[s]) void loadPage(s, kind);
  };

  const bulkRemove = async (files: KbFile[]) => {
    // REMOVE NEVER TOUCHES A MEETING NOTE — it lives with its meeting and leaves from there.
    const targets = files.filter((f) => f.deletable);
    const skipped = files.length - targets.length;
    if (!targets.length || bulkBusy) return;
    setConfirmBulkDel(false);
    setBulkBusy('remove');
    const ids = new Set(targets.map((f) => f.id));
    setPages((prev) => pagesAfterDelete(prev, ids));
    setSearch((s) => s ? { ...s, files: s.files.filter((x) => !ids.has(x.id)) } : s);
    const { ok, failed } = await runPool(targets, async (f) => {
      try { return (await fetch(`/api/drive/uploads/${f.id}`, { method: 'DELETE' })).ok; } catch { return false; }
    });
    const line = `Removed ${ok}${skipped ? ` · ${skipped} meeting note${skipped === 1 ? '' : 's'} skipped — they live with their meetings` : ''}`;
    if (failed) toast.error(`${line} · ${failed} failed`); else toast.success(line);
    clearSelection();
    setBulkBusy(null);
    void refresh(kind);
    void loadPage(scopeRef.current, kind);
  };

  // ── THE INTERNAL DRAG — the gesture, over the same doors ─────────────────────────────────────
  /** A DRAG CARRIES THE SELECTION — but only when it starts ON it. Dragging an unselected row is a
   *  statement about that row alone, and joining it to the selection behind the user's back would
   *  make a five-file move out of a one-file gesture. */
  const onRowDragStart = (e: React.DragEvent, f: KbFile) => {
    const carry = selected.has(f.id) && selectedFiles.length ? selectedFiles : [f];
    dragFilesRef.current = carry;
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(carry.map((x) => x.id)));
    e.dataTransfer.effectAllowed = 'move';
    if (carry.length > 1) {
      // A multi-drag says how many — the browser's default ghost is one row, which is a lie about
      // what is about to move. Detached the same tick so it never paints on the page itself.
      const ghost = document.createElement('div');
      ghost.textContent = `${carry.length} files`;
      ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;padding:6px 10px;border-radius:8px;background:#4f46e5;color:#fff;font:500 12px system-ui,sans-serif;';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.remove(), 0);
    }
  };

  const onRowDragEnd = () => { dragFilesRef.current = []; setDragFolder(null); };

  /** A rail row accepts ONLY the internal type — an OS file drop on the same row keeps going to the
   *  window handler that has always owned it. */
  const railDragOver = (e: React.DragEvent, key: string) => {
    if (!isInternalDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragFolder !== key) setDragFolder(key);
  };

  /** Leaving for a CHILD of the same row is not leaving the row — the counter idiom the window
   *  handler solves with depth, solved here by asking where the cursor actually went. */
  const railDragLeave = (e: React.DragEvent, key: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragFolder((d) => d === key ? null : d);
  };

  const railDrop = (e: React.DragEvent, folderId: string | null, folderName: string) => {
    if (!isInternalDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragFolder(null);
    const ids = new Set((() => {
      try { return JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[]; } catch { return []; }
    })());
    const carried = dragFilesRef.current.filter((f) => ids.has(f.id));
    const files = carried.length ? carried : paintedRef.current.filter((f) => ids.has(f.id));
    dragFilesRef.current = [];
    if (!files.length) return;
    // Dropping files already in that folder is a no-op the surgery absorbs; don't spend a request.
    if (files.every((f) => (f.folderId ?? null) === folderId)) { clearSelection(); return; }
    if (files.length === 1) { void move(files[0], folderId, folderName); clearSelection(); return; }
    void bulkMove(files, folderId, folderName); // clears the selection itself
  };

  /** THE LOCK IS A DOOR. A meeting note cannot be removed here — correct, and useless as an answer
   *  unless the row also says where it CAN be handled. `/meetings/<transcriptId>` is THE ONE note
   *  address (it takes `calendarEventId ?? id`, and its ad-hoc branch has always resolved transcript
   *  ids). No meetingId (a warm cache written before this field, or a row the server could not
   *  decorate) falls back to exactly the lock it always rendered — a missing address never becomes a
   *  dead link. `stopPropagation` because the row's plain click is the viewer, and this is not it. */
  const meetingLink = (f: KbFile, small = false) => {
    const title = 'Your meeting — its note and deletion live in Meetings';
    if (!f.meetingId) {
      return <LockClosedIcon className={`flex-shrink-0 ${small ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-neutral-300`} title={title} />;
    }
    return (
      <Link href={`/meetings/${f.meetingId}`} draggable={false} title={title}
        onClick={(e) => { e.stopPropagation(); setPendingOpen(false); setConfirmPendingAll(false); }}
        className={`flex-shrink-0 inline-flex items-center gap-1 whitespace-nowrap text-neutral-300 hover:text-indigo-600 transition-colors ${small ? 'text-[11px] pr-0.5' : 'text-[11.5px]'}`}>
        <LockClosedIcon className={small ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        In Meetings<span aria-hidden>→</span>
      </Link>
    );
  };

  const fileRow = (f: KbFile, showFolder = false, list: KbFile[] = []) => {
    const meta = KIND_META[f.kind];
    const rows = list.length ? list : [f];
    const checked = selected.has(f.id);
    return (
      <div key={f.id} draggable
        onDragStart={(e) => onRowDragStart(e, f)} onDragEnd={onRowDragEnd}
        // FINDER'S GRAMMAR: a MODIFIED click is a selection gesture and never navigates. Plain click
        // still previews — the row's first meaning is unchanged.
        onClick={(e) => {
          if (e.shiftKey) { toggleSelect(rows, f, true); return; }
          if (e.metaKey || e.ctrlKey) { toggleSelect(rows, f, false); return; }
          openPreview(rows, f);
        }}
        // select-none is permanent on rows — a shift-click range would otherwise drag a blue smear
        // of half-selected filenames behind it, and nothing here is text anyone copies.
        className={`group flex cursor-pointer select-none items-center gap-3 px-4 py-2.5 transition-colors ${checked ? 'bg-indigo-50/50' : 'hover:bg-neutral-50'}`}>
        {/* THE ROW'S OWN CHECKBOX — invisible until you reach for it, and visible on every row the
            moment a selection exists (a half-shown selection is a half-understood one). */}
        <button draggable={false} onClick={(e) => { e.stopPropagation(); toggleSelect(rows, f, e.shiftKey); }}
          title={checked ? 'Deselect — shift-click to select a range' : 'Select — shift-click to select a range'}
          className={`flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center transition-all ${checked
            ? 'border-indigo-600 bg-indigo-600 text-white opacity-100'
            : `border-neutral-300 bg-white text-transparent hover:border-indigo-400 ${selected.size ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}`}>
          <CheckIcon className="w-2.5 h-2.5" strokeWidth={3} />
        </button>
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
        <MoveControl file={f} folders={folders} onMove={move} onCreateFolder={createFolder}
          onOpenChange={(open) => setRowPopovers((n) => Math.max(0, n + (open ? 1 : -1)))} />
        {f.deletable ? (
          confirmDel === f.id ? (
            <span draggable={false} className="flex-shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => void del(f)} className="rounded-md bg-red-50 px-2 py-1 text-[11.5px] font-medium text-red-600 hover:bg-red-100 transition-colors">Remove</button>
              <button onClick={() => setConfirmDel(null)} className="text-[11.5px] text-neutral-400 hover:text-neutral-600">Keep</button>
            </span>
          ) : (
            <button draggable={false} onClick={(e) => { e.stopPropagation(); setConfirmDel(f.id); }} title="Remove from the knowledge base"
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-red-500 transition-all">
              <XMarkIcon className="w-4 h-4" />
            </button>
          )
        ) : (
          // EXCEPTIONS ON THE ROW: a meeting note lives with its meeting and leaves the KB from
          // there — the row SAYS so with a lock. An invisible spacer explained nothing… and neither
          // did a blind lock: "manage it there" named no door. THE LOCK IS A DOOR — it says
          // Meetings and it goes to the meeting. It is ALWAYS visible, word and all, unlike the
          // hover-revealed row controls beside it: those are deeds you reach for on a row you have
          // already found, this is the row's only exit and a hidden exit is the bug being fixed.
          // "Your meeting" is the truth, not a guess: a transcript indexes only into its own
          // owner's library, so a KB meeting row is never someone else's shared note.
          meetingLink(f)
        )}
      </div>
    );
  };

  // ── THE RAIL ─────────────────────────────────────────────────────────────────────────────────
  // Rows wear the platform's sidebar idiom (components/settings/settings-left-panel.tsx): indigo-50
  // on the selected scope, muted otherwise. Nothing else lives here — see THE TWO-PANE LIBRARY.
  const railRow = (active: boolean) =>
    `w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-left transition-colors ${
      active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900'
    }`;

  return (
    <div className={`h-full min-h-0 flex ${dragging ? 'outline-dashed outline-2 outline-offset-[-8px] outline-indigo-300 rounded-2xl' : ''}`}>
      {/* ONE input, every door — the door that opens it parks its destination first. */}
      <input ref={fileRef} type="file" multiple className="hidden" accept={ACCEPT}
        onChange={(e) => { const dest = pendingDest.current; pendingDest.current = null; void upload(e.target.files, dest); }} />

      {/* ── LEFT RAIL: the scopes, and nothing that acts on them ───────────────────────────── */}
      <div className="w-[230px] flex-shrink-0 flex flex-col border-r border-neutral-100 overflow-y-auto">
        <div className="flex-shrink-0 px-4 pt-4 pb-3">
          <h2 className="text-[15px] font-semibold text-neutral-900 tracking-tight">Documents</h2>
          <p className="mt-0.5 text-[11.5px] text-neutral-400"
            title="Everything the brain can read — indexed, searchable, and yours to remove. Group files into a folder and a task can read the whole folder as its source of truth.">
            Everything the brain can read.
          </p>
        </div>

        <nav className="flex-1 px-2 pb-3 space-y-0.5">
          {/* THE ALL-FILES ROW IS THE UNFILE DOOR — dropping here means "out of every folder". It
              carries NO data-drop-folder: an OS file dropped on it still means what it always did
              (land in the scope on screen), because that machinery reads the attribute, not this. */}
          <button onClick={() => pickScope(ALL)}
            onDragOver={(e) => railDragOver(e, ALL)}
            onDragLeave={(e) => railDragLeave(e, ALL)}
            onDrop={(e) => railDrop(e, null, '')}
            className={`${railRow(scope === ALL)} ${dragFolder === ALL ? 'ring-2 ring-indigo-300 bg-indigo-50/60' : ''}`}
            title="Drop files here to take them out of their folders">
            <DocumentTextIcon className={`w-4 h-4 flex-shrink-0 ${scope === ALL ? 'text-indigo-500' : 'text-neutral-400'}`} />
            <span className="min-w-0 flex-1 truncate">All files</span>
            {typeof c?.total === 'number' && <span className="flex-shrink-0 text-[11px] text-neutral-400">{c.total}</span>}
          </button>

          <p className="px-3 pt-4 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-300">Folders</p>

          {folders.map((f) => {
            const active = scope === f.id;
            return (
              <button key={f.id} data-drop-folder={f.id} onClick={() => pickScope(f.id)}
                onDragOver={(e) => railDragOver(e, f.id)}
                onDragLeave={(e) => railDragLeave(e, f.id)}
                onDrop={(e) => railDrop(e, f.id, f.name)}
                className={`${railRow(active)} ${dragFolder === f.id ? 'ring-2 ring-indigo-300 bg-indigo-50/60' : ''}`}
                title={f.workflows && f.workflows.count > 0 ? `${f.name} — feeds ${f.workflows.count} workflow${f.workflows.count === 1 ? '' : 's'}` : f.name}>
                <FolderIcon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-indigo-500' : 'text-neutral-400'}`} />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="flex-shrink-0 text-[11px] text-neutral-400">{f.count}</span>
              </button>
            );
          })}
          {folders.length === 0 && !loading && (
            <p className="px-3 py-1.5 text-[12px] text-neutral-300">No folders yet.</p>
          )}

          {creating ? (
            <div className="px-3 pt-1">
              <input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { void createFolder(newFolder).then((id) => { setCreating(false); setNewFolder(''); if (id) pickScope(id); }); }
                  if (e.key === 'Escape') { setCreating(false); setNewFolder(''); }
                }}
                onBlur={() => { setCreating(false); setNewFolder(''); }}
                placeholder="Folder name…"
                className="w-full rounded-lg border border-indigo-200 px-2 py-1.5 text-[12.5px] text-neutral-800 outline-none focus:border-indigo-400" />
            </div>
          ) : (
            <button onClick={() => { setCreating(true); setNewFolder(''); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-left text-neutral-400 hover:bg-neutral-50 hover:text-indigo-600 transition-colors">
              <PlusIcon className="w-4 h-4 flex-shrink-0" />New folder
            </button>
          )}
        </nav>
      </div>

      {/* ── RIGHT PANE: the selected scope, its deeds, and its list ────────────────────────── */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col relative">
       <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl px-6 py-6">
          {/* THE HEADER NAMES WHAT IT ACTS ON — a folder's rename / delete / upload live where the
              folder is named, never in the rail (which stays a map, not a workbench). */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                {renaming && scopeFolder && renaming.id === scopeFolder.id ? (
                  <input autoFocus value={renaming.name}
                    onChange={(e) => setRenaming({ id: scopeFolder.id, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') void renameFolder(scopeFolder.id, renaming.name); if (e.key === 'Escape') setRenaming(null); }}
                    onBlur={() => void renameFolder(scopeFolder.id, renaming.name)}
                    className="min-w-0 rounded-lg border border-indigo-200 px-2 py-1 text-[20px] font-semibold text-neutral-900 outline-none focus:border-indigo-400" />
                ) : (
                  <h1 className="min-w-0 truncate text-[20px] font-semibold text-neutral-900 tracking-tight">{scopeTitle}</h1>
                )}
                <span className="flex-shrink-0 text-[13px] text-neutral-400">{scopeCount}</span>
                {scopeFolder && renaming?.id !== scopeFolder.id && (
                  <span className="flex-shrink-0 flex items-center gap-1.5">
                    {!scopeFolder.isSystem && (
                      <button onClick={() => setRenaming({ id: scopeFolder.id, name: scopeFolder.name })}
                        title="Rename — workflow steps pointing at this folder follow the rename"
                        className="text-neutral-300 hover:text-neutral-600 transition-colors"><PencilIcon className="w-4 h-4" /></button>
                    )}
                    {/* DELETE IS OFFERED ONLY ON AN EMPTY FOLDER — no cascade question to answer. */}
                    {!scopeFolder.isSystem && scopeFolder.count === 0 && (confirmFolderDel === scopeFolder.id ? (
                      <span className="flex items-center gap-1.5">
                        <button onClick={() => void deleteFolder(scopeFolder.id)} className="rounded-md bg-red-50 px-2 py-0.5 text-[11.5px] font-medium text-red-600 hover:bg-red-100">Delete</button>
                        <button onClick={() => setConfirmFolderDel(null)} className="text-[11.5px] text-neutral-400 hover:text-neutral-600">Keep</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmFolderDel(scopeFolder.id)} title="Delete this empty folder"
                        className="text-neutral-300 hover:text-red-500 transition-colors"><TrashIcon className="w-4 h-4" /></button>
                    ))}
                  </span>
                )}
              </div>
              {/* THE CONSEQUENCE IS LEGIBLE BEFORE THE DEED — the read-side twin of the rename heal.
                  Absent bindings render nothing; a folder nothing depends on says nothing. */}
              {scopeFolder?.workflows && scopeFolder.workflows.count > 0 && (
                <p className="mt-1 text-[12px] text-neutral-400"
                  title={scopeFolder.workflows.names.join(' · ') + (scopeFolder.workflows.names.length < scopeFolder.workflows.count ? ' …' : '')}>
                  Feeds {scopeFolder.workflows.count} workflow{scopeFolder.workflows.count === 1 ? '' : 's'}
                </p>
              )}
            </div>

            {/* AN UPLOAD LANDS WHERE YOU AIM IT — the default aim is the scope on screen, so the
                button names a destination only when the caret overrode it. */}
            <span className={`flex-shrink-0 inline-flex items-stretch overflow-hidden rounded-lg bg-indigo-600 text-white ${uploading ? 'opacity-50' : ''}`}>
              <button onClick={() => pickFilesInto(uploadDest)} disabled={uploading}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium hover:bg-indigo-700 transition-colors">
                <ArrowUpTrayIcon className="w-4 h-4" />{uploading ? 'Uploading…' : 'Upload'}
              </button>
              <button ref={uploadAnchor} onClick={() => setUploadPick((v) => !v)} disabled={uploading}
                title={overrideName
                  ? `New uploads will be filed in "${overrideName}" — click to change`
                  : scopeFolder ? `New uploads land in "${scopeFolder.name}" — click to send them elsewhere`
                  : 'New uploads stay unfiled — click to choose a folder'}
                className={`inline-flex items-center gap-1 border-l border-indigo-500 py-2 text-[12.5px] font-medium hover:bg-indigo-700 transition-colors ${overrideName ? 'max-w-[190px] px-2.5' : 'px-2'}`}>
                {overrideName && <span className="truncate">to {overrideName}</span>}
                <ChevronDownIcon className="w-3 h-3 flex-shrink-0 opacity-70" />
              </button>
            </span>
          </div>
          <AnchoredPopover anchorRef={uploadAnchor} open={uploadPick} onClose={() => setUploadPick(false)} align="right" width={240}>
            <FolderPickerPanel
              folders={folders} clearLabel="No folder"
              onClear={() => { setUploadOverride(null); setUploadPick(false); }}
              onSelect={(f) => { setUploadOverride(f.id); setUploadPick(false); }}
              onCreate={async (n) => { const id = await createFolder(n); if (id) setUploadOverride(id); setUploadPick(false); }}
            />
          </AnchoredPopover>

          <div className="mt-4 flex items-center gap-2">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or content…"
                className="w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-3 py-2.5 text-[13.5px] text-neutral-800 placeholder:text-neutral-400 outline-none focus:border-indigo-300" />
            </div>
            <button ref={filterAnchor} onClick={() => setFilterOpen((v) => !v)}
              title="Filter by where a file came from"
              className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors ${kind === 'all'
                ? 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>
              <FunnelIcon className="w-4 h-4" />{kind === 'all' ? 'Filter' : kindWord}
            </button>
          </div>
          <AnchoredPopover anchorRef={filterAnchor} open={filterOpen} onClose={() => setFilterOpen(false)} align="right" width={200}>
            <div className="rounded-xl border border-neutral-200 bg-white shadow-lg p-1">
              {KIND_FILTERS.map((f) => (
                <button key={f.key} onClick={() => { pickKind(f.key); setFilterOpen(false); }}
                  className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors ${kind === f.key
                    ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-neutral-700 hover:bg-neutral-50'}`}>
                  <span className="min-w-0 flex-1 truncate">{f.label}</span>
                  {typeof f.n === 'number' && <span className="flex-shrink-0 text-[11px] text-neutral-300">{f.n}</span>}
                </button>
              ))}
            </div>
          </AnchoredPopover>

          {/* TELEMETRY SPEAKS ONLY WHEN SOMETHING MOVES — a permanent "N indexed" line reported a
              steady state nobody asked about; this renders only while files are actually in flight.
              …and it OPENS. "9 processing" answered nothing the owner asked of it ("whats processing?
              cant see or tell"): the rows carry the names and the dates, so a file that has been
              processing since August reads as stuck instead of hiding inside a busy-looking number.
              A FILTER IS NEVER HIDDEN STATE — while one is on, it wears a chip that dismisses it. */}
          {((c && c.pending > 0) || kind !== 'all') && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {c && c.pending > 0 && (
                <button ref={pendingAnchor}
                  onClick={() => { const next = !pendingOpen; setPendingOpen(next); if (next) void loadPending(); }}
                  title="See which files are still processing"
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11.5px] font-medium text-amber-700 hover:bg-amber-100 transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />{c.pending} processing
                  <ChevronDownIcon className="w-3 h-3 opacity-60" />
                </button>
              )}
              {kind !== 'all' && (
                <button onClick={() => pickKind('all')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11.5px] font-medium text-indigo-700 hover:bg-indigo-100 transition-colors">
                  {kindWord} only<XMarkIcon className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          <AnchoredPopover anchorRef={pendingAnchor} open={pendingOpen}
            onClose={() => { setPendingOpen(false); setConfirmPendingAll(false); }} align="left" width={320}>
            <div className="rounded-xl border border-neutral-200 bg-white shadow-lg p-1">
              {pendingList.loading && <p className="px-2 py-2 text-[12px] text-neutral-400">Loading…</p>}
              {pendingList.failed && <p className="px-2 py-2 text-[12px] text-neutral-400">Couldn&apos;t load these right now.</p>}
              {!pendingList.loading && !pendingList.failed && pendingList.files.length === 0 && (
                <p className="px-2 py-2 text-[12px] text-neutral-400">Nothing is processing any more.</p>
              )}
              <div className="max-h-64 overflow-y-auto">
                {pendingList.files.map((f) => (
                  <div key={f.id} className="group flex items-center gap-1 rounded-lg pr-1 hover:bg-neutral-50 transition-colors">
                    <button onClick={() => { setPendingOpen(false); setConfirmPendingAll(false); openPreview(pendingList.files, f); }}
                      className="min-w-0 flex-1 px-2 py-1.5 text-left">
                      <span className="block truncate text-[12.5px] text-neutral-800">{f.filename}</span>
                      <span className="block text-[11px] text-neutral-400">
                        {KIND_META[f.kind].word}{f.indexedAt ? ` · ${fmtDate(f.indexedAt)}` : ''}
                      </span>
                    </button>
                    {/* THE ROW'S EXITS. RETRY FIRST, AND ON EVERY ROW — it is the only exit a locked
                        meeting note has, and the honest first answer for any stuck row: try again
                        before you throw it away. */}
                    <button onClick={(e) => { e.stopPropagation(); void retryPending(f); }}
                      disabled={retrying.has(f.id) || pendingBusy}
                      title={retrying.has(f.id) ? 'Indexing…' : 'Try indexing this file again'}
                      className="flex-shrink-0 text-neutral-300 hover:text-indigo-600 transition-colors disabled:hover:text-neutral-300 disabled:opacity-60">
                      <ArrowPathIcon className={`w-3.5 h-3.5 ${retrying.has(f.id) ? 'animate-spin text-indigo-500' : ''}`} />
                    </button>
                    {/* …then the delete door the list uses, reached from here so a stuck row can be
                        cleared where it is named. A meeting note keeps its lock. */}
                    {f.deletable ? (
                      <button onClick={(e) => { e.stopPropagation(); void removePending(f); }} disabled={pendingBusy || retrying.has(f.id)}
                        title="Remove — this file will never finish indexing"
                        className="flex-shrink-0 text-neutral-300 hover:text-red-500 transition-colors disabled:opacity-40">
                        <XMarkIcon className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      // The confusing spot: a lock in a list about exits, offering none. Same door,
                      // always visible — from here it is the row's only way out besides Retry.
                      meetingLink(f, true)
                    )}
                  </div>
                ))}
              </div>
              {/* CLEARING THE LITTER IS ONE MOTION — behind the page's two-step red idiom, because
                  it is the same irreversible deed forty times over. */}
              {(pendingDeletable > 0 || pendingLocked > 0) && (
                <div className="mt-1 border-t border-neutral-100 pt-1">
                  {pendingDeletable > 0 && (confirmPendingAll ? (
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      <button onClick={() => void removeAllPending()} disabled={pendingBusy || retrying.size > 0}
                        className="rounded-md bg-red-50 px-2 py-1 text-[11.5px] font-medium text-red-600 hover:bg-red-100 transition-colors disabled:opacity-40">
                        Remove {pendingDeletable}?
                      </button>
                      <button onClick={() => setConfirmPendingAll(false)} className="text-[11.5px] text-neutral-400 hover:text-neutral-600">Keep</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmPendingAll(true)} disabled={pendingBusy || retrying.size > 0}
                      className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-neutral-500 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40">
                      {pendingBusy ? 'Removing…' : `Remove all ${pendingDeletable}`}
                    </button>
                  ))}
                  {/* THE DIFFERENCE, SPOKEN — the same words the skip toast uses, so the two
                      surfaces agree about what stayed behind and why. */}
                  {pendingLocked > 0 && (
                    <p className="px-2 pb-1 pt-0.5 text-[11px] text-neutral-400">
                      {pendingLocked === 1
                        ? '1 meeting note stays with its meeting'
                        : `${pendingLocked} meeting notes stay with their meetings`}
                    </p>
                  )}
                </div>
              )}
            </div>
          </AnchoredPopover>

          {/* SEARCH IS FLAT AND GLOBAL — a result set is not a filing view, and it is not scoped to
              the folder you happen to be standing in. A folder scope says so out loud, so nobody
              reads a cross-folder hit as a file that is filed here. */}
          {search ? (
            <>
              {scopeFolder && (
                <p className="mt-4 mb-1.5 text-[11.5px] text-neutral-400">Results across all documents</p>
              )}
              <div className={`${scopeFolder ? '' : 'mt-4'} rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100`}>
                {search.loading && search.files.length === 0 && <p className="p-6 text-[13px] text-neutral-400">Searching…</p>}
                {!search.loading && search.files.length === 0 && <p className="p-6 text-[13px] text-neutral-400">Nothing matches that.</p>}
                {search.files.map((f) => fileRow(f, true, search.files))}
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
              {!page ? (
                busyScope === scope || loading ? (
                  <div className="p-4 space-y-2" aria-hidden>
                    <div className="h-10 rounded-lg bg-neutral-100 animate-pulse" />
                    <div className="h-10 rounded-lg bg-neutral-100 animate-pulse" />
                    <div className="h-10 rounded-lg bg-neutral-100 animate-pulse" />
                  </div>
                ) : <p className="px-4 py-3 text-[12px] text-neutral-400" />
              ) : page.count === 0 ? (
                <p className="p-6 text-[13px] text-neutral-400">
                  {scopeFolder
                    ? 'Nothing filed here yet — upload into it, or move a file in.'
                    : 'Nothing here yet — attach a file in any conversation, or upload one above.'}
                </p>
              ) : (
                <>
                  {/* IN ALL FILES A ROW SAYS WHERE IT LIVES; inside a folder that word would be the
                      folder's own name on every line. */}
                  {page.files.map((f) => fileRow(f, scope === ALL, page.files))}
                  {page.hasMore && (
                    <button onClick={() => void loadPage(scope, kind, page.files.length)} disabled={busyScope === scope}
                      className="w-full px-4 py-2.5 text-left text-[12px] font-medium text-indigo-600 hover:bg-indigo-50/60 transition-colors disabled:opacity-50">
                      {busyScope === scope ? 'Loading…' : `Show all ${page.count}`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* The footnote keeps only the fact no row can carry — the other two are on the rows now
              (the lock) and on the affordances (delete appears only on an empty folder). */}
          <p className="mt-4 text-[12px] text-neutral-300">Removing a file deletes its indexed content.</p>
          {selected.size > 0 && <div className="h-14" aria-hidden />}
        </div>
       </div>

        {/* THE SELECTION BAR — it exists only while a selection does, it names what it will act on,
            and it never speaks a number it will not honour: Remove counts the DELETABLE rows. */}
        {selected.size > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-6">
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-lg">
              <span className="text-[12.5px] font-medium text-neutral-700">
                {bulkBusy === 'move' ? 'Moving…' : bulkBusy === 'remove' ? 'Removing…' : `${selected.size} selected`}
              </span>
              <span className="w-px h-4 bg-neutral-200" />
              <button ref={bulkAnchor} disabled={!!bulkBusy} onClick={() => setBulkPick((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-medium text-neutral-700 hover:bg-neutral-50 transition-colors disabled:opacity-40">
                Move to<ChevronDownIcon className="w-3 h-3 opacity-60" />
              </button>
              {deletableCount > 0 && (confirmBulkDel ? (
                <span className="flex items-center gap-1.5">
                  <button onClick={() => void bulkRemove(selectedFiles)} disabled={!!bulkBusy}
                    className="rounded-md bg-red-50 px-2 py-1 text-[11.5px] font-medium text-red-600 hover:bg-red-100 transition-colors disabled:opacity-40">
                    Remove {deletableCount}?
                  </button>
                  <button onClick={() => setConfirmBulkDel(false)} className="text-[11.5px] text-neutral-400 hover:text-neutral-600">Keep</button>
                </span>
              ) : (
                <button onClick={() => setConfirmBulkDel(true)} disabled={!!bulkBusy}
                  title={deletableCount < selected.size ? 'Meeting notes live with their meetings and are left alone' : 'Remove these from the knowledge base'}
                  className="rounded-lg px-2 py-1 text-[12.5px] font-medium text-neutral-700 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40">
                  Remove {deletableCount}
                </button>
              ))}
              <button onClick={clearSelection} disabled={!!bulkBusy}
                className="text-[12px] text-neutral-400 hover:text-neutral-600 transition-colors disabled:opacity-40">Clear</button>
            </div>
          </div>
        )}
        <AnchoredPopover anchorRef={bulkAnchor} open={bulkPick} onClose={() => setBulkPick(false)} align="left" width={240}>
          <FolderPickerPanel
            folders={folders} clearLabel="No folder"
            onClear={() => void bulkMove(selectedFiles, null, '')}
            onSelect={(f) => void bulkMove(selectedFiles, f.id, f.name)}
            onCreate={async (n) => {
              const id = await createFolder(n);
              setBulkPick(false);
              if (id) void bulkMove(selectedFiles, id, n);
            }}
          />
        </AnchoredPopover>
      </div>

      {/* A ROW HAS A DESTINATION — and it is THE ONE VIEWER, never a second file modal. */}
      {preview && (
        <AttachmentLightbox
          files={preview.files.map((f): LightboxFile => ({
            name: f.filename, size: f.sizeBytes, ref: { kind: 'kb', id: f.id },
            note: metaLine(f, true),
          }))}
          index={preview.index}
          onIndex={(i) => setPreview((p) => p ? { ...p, index: i } : p)}
          onClose={() => setPreview(null)}
        />
      )}
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
function MoveControl({ file, folders, onMove, onCreateFolder, onOpenChange }: {
  file: KbFile;
  folders: KbFolder[];
  onMove: (f: KbFile, folderId: string | null, folderName: string) => void | Promise<void>;
  onCreateFolder: (name: string) => Promise<string | null>;
  /** Reported up so the page's own Escape handler yields to this popover's. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const openChangeRef = useRef(onOpenChange);
  openChangeRef.current = onOpenChange;
  useEffect(() => {
    if (!open) return;
    openChangeRef.current?.(true);
    return () => openChangeRef.current?.(false);
  }, [open]);
  return (
    <span ref={ref} draggable={false} className="relative inline-flex flex-shrink-0" onClick={(e) => e.stopPropagation()}>
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
