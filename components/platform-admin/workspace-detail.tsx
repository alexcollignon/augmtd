'use client';

// THE WORKSPACE DETAIL (platform-admin redesign, Aug 10) — one workspace, whole truth, current
// product language. Sections: identity · access & entry (the sovereign door) · branding ·
// features · members · danger. Every mutation reuses the SAME platform-admin API routes the
// list page calls — one behavior, two views.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon, ClipboardDocumentIcon, CheckIcon, ArrowPathIcon, ShieldCheckIcon,
  ExclamationTriangleIcon, TrashIcon, ChevronRightIcon,
} from '@heroicons/react/24/outline';
import type { WorkspaceFeatures, WorkspaceType, FeatureKey } from '@/lib/workspace/types';
import type { TierType } from '@/lib/ai/types';

type Company = {
  id: string; name: string; slug: string; plan: string; type: WorkspaceType; status: string;
  features: WorkspaceFeatures; join_code: string; ai_tier: TierType | null; created_at: string;
  member_count: number;
  settings?: { branding?: { logo_url?: string; tagline?: string; accent_color?: string; footer_line?: string } } | null;
};
type Member = { id: string; user_id: string; email: string; full_name: string | null; role: string };
// THE COMPANY SEED KIT — folders of documents every member's knowledge base arrives with.
type SeedKitFile = { name: string; path: string; mime: string; size: number };
type SeedKit = { folders: Array<{ name: string; files: SeedKitFile[] }>; updated_at: string };

const TYPE_OPTIONS = ['company', 'pilot', 'beta', 'internal', 'personal'];
const PLAN_OPTIONS = ['starter', 'pro', 'enterprise'];
const AI_TIER_OPTIONS: { value: TierType | null; label: string }[] = [
  { value: null, label: 'Standard (default)' },
  { value: 'standard', label: 'Standard' },
  { value: 'bedrock_private', label: 'Bedrock Private' },
  { value: 'bedrock_optimised', label: 'Bedrock Optimised' },
];

// Current-product feature language — what each switch actually turns on for the members.
const FEATURES: Array<{ key: FeatureKey; label: string; detail: string }> = [
  { key: 'email', label: 'Email', detail: 'Mailbox connections, inbox triage, reply drafting. OFF = the sovereign mode (no mailbox auth anywhere).' },
  { key: 'meetings', label: 'Meetings', detail: 'In-person recording, transcripts, calendar view.' },
  { key: 'drive', label: 'Knowledge', detail: 'The knowledge base: uploads, indexing, semantic search.' },
  { key: 'agents', label: 'Coworkers', detail: 'The agent team — chat, delegation, DMs, skills.' },
  { key: 'studio', label: 'Workflows', detail: 'Standing workflows, the ledger, the Studio builder.' },
];

const card = 'rounded-2xl bg-white border border-neutral-200 p-5';
const label = 'text-[11px] font-semibold uppercase tracking-wide text-neutral-400';
const input = 'rounded-md border border-neutral-200 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-indigo-300';

export function WorkspaceDetail({ company: initial }: { company: Company }) {
  const router = useRouter();
  const [c, setC] = useState<Company>(initial);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [pending, setPending] = useState<Array<{ email: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [logo, setLogo] = useState(initial.settings?.branding?.logo_url ?? '');
  const [tagline, setTagline] = useState(initial.settings?.branding?.tagline ?? '');
  // THE DOCUMENT THEME (DH4): accent + footer feed every deliverable's letterhead.
  const [accent, setAccent] = useState(initial.settings?.branding?.accent_color ?? '');
  const [footerLine, setFooterLine] = useState(initial.settings?.branding?.footer_line ?? '');
  const [name, setName] = useState(initial.name);
  const [codeDraft, setCodeDraft] = useState(initial.join_code);
  const [codeErr, setCodeErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Seed kit — the manifest, the folder being added to, and the two-step confirms.
  const [kit, setKit] = useState<SeedKit | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [kitErr, setKitErr] = useState('');
  const [confirmKit, setConfirmKit] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [kitDragOver, setKitDragOver] = useState(false);
  // Folders rest COLLAPSED (a 33-file folder must not own the page) — expanded per click.
  const [openKitFolders, setOpenKitFolders] = useState<Set<string>>(new Set());
  const toggleKitFolder = (name: string) => setOpenKitFolders(prev => {
    const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n;
  });
  const kitFileRef = useRef<HTMLInputElement>(null);
  const kitDirRef = useRef<HTMLInputElement>(null);
  const kitTargetFolder = useRef<string>('');
  // ONE generic corporate door — the workspace code identifies the company (old /<slug> links redirect).
  const entryUrl = `${typeof window !== 'undefined' ? window.location.origin : 'https://app.augmtd.ai'}/enterprise`;
  const sovereign = c.features.email === false;

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/platform-admin/companies/${c.id}/members`);
        const d = await res.json();
        setMembers((d.members ?? []) as Member[]);
        setPending((d.pendingInvites ?? []) as Array<{ email: string }>);
      } catch { setMembers([]); }
    })();
  }, [c.id]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/platform-admin/companies/${c.id}/seed-kit`);
        const d = await res.json();
        setKit((d.seedKit ?? { folders: [], updated_at: '' }) as SeedKit);
      } catch { setKit({ folders: [], updated_at: '' }); }
    })();
  }, [c.id]);

  const copy = (what: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(what); setTimeout(() => setCopied(null), 1800);
  };

  const patch = async (updates: Record<string, unknown>, apply: (prev: Company) => Company) => {
    setBusy('patch');
    try {
      const res = await fetch(`/api/platform-admin/companies/${c.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates),
      });
      if (res.ok) setC(apply);
    } finally { setBusy(null); }
  };

  const toggleFeature = async (key: FeatureKey, next: boolean) => {
    setBusy(`feature:${key}`);
    setC(prev => ({ ...prev, features: { ...prev.features, [key]: next } }));
    try {
      const res = await fetch(`/api/platform-admin/companies/${c.id}/features`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) setC(prev => ({ ...prev, features: { ...prev.features, [key]: !next } }));
    } finally { setBusy(null); }
  };

  const regenCode = async () => {
    setBusy('code');
    try {
      const res = await fetch(`/api/platform-admin/companies/${c.id}/regenerate-join-code`, { method: 'POST' });
      const d = await res.json();
      if (res.ok && d.join_code) { setC(prev => ({ ...prev, join_code: d.join_code })); setCodeDraft(d.join_code); }
    } finally { setBusy(null); }
  };

  // Branded join codes: save the typed code; a rejection (format/clash) shows and reverts.
  const saveCode = async () => {
    const code = codeDraft.trim().toUpperCase();
    if (!code || code === c.join_code) { setCodeDraft(c.join_code); return; }
    setBusy('code');
    try {
      const res = await fetch(`/api/platform-admin/companies/${c.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ join_code: code }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) { setC(prev => ({ ...prev, join_code: code })); setCodeDraft(code); }
      else { setCodeErr(d?.error ?? 'Could not save code'); setCodeDraft(c.join_code); }
    } finally { setBusy(null); }
  };

  const uploadLogo = async (file: File) => {
    setBusy('logo');
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/platform-admin/companies/${c.id}/logo`, { method: 'POST', body: fd });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.url) setLogo(d.url);
    } finally { setBusy(null); }
  };

  const saveBranding = () => patch(
    { branding: { logo_url: logo.trim(), tagline: tagline.trim(), accent_color: accent.trim(), footer_line: footerLine.trim() } },
    prev => ({ ...prev, settings: { ...(prev.settings ?? {}), branding: {
      ...(logo.trim() ? { logo_url: logo.trim() } : {}), ...(tagline.trim() ? { tagline: tagline.trim() } : {}),
      ...(accent.trim() ? { accent_color: accent.trim().replace(/^#/, '').toUpperCase() } : {}),
      ...(footerLine.trim() ? { footer_line: footerLine.trim() } : {}),
    } } }),
  );

  // Seed kit — uploads go one file at a time (each POST returns the merged manifest, so the
  // last response is the truth); a rejected file shows its own reason and the rest continue.
  const uploadKitFiles = async (folder: string, files: File[]) => {
    setKitErr('');
    for (const f of files) {
      setBusy(`kit:${folder}`);
      try {
        const fd = new FormData();
        fd.append('folder', folder);
        fd.append('file', f);
        const res = await fetch(`/api/platform-admin/companies/${c.id}/seed-kit`, { method: 'POST', body: fd });
        const d = await res.json().catch(() => null);
        if (res.ok && d?.seedKit) setKit(d.seedKit as SeedKit);
        else setKitErr(d?.error ?? `Could not add ${f.name}`);
      } catch { setKitErr(`Could not add ${f.name}`); }
    }
    setBusy(null);
  };

  // WHOLE-FOLDER UPLOAD (owner, Aug 31): the superadmin picks a directory (or the whole pack)
  // and the folder names DERIVE from the files' own relative paths — each file's immediate
  // parent directory becomes its kit folder, so selecting the pack ROOT lands its subfolders as
  // separate kit folders in one gesture. Junk (dotfiles, empties) is skipped silently; every
  // file still goes through the same one-at-a-time POST (same validation, same honest errors).
  const uploadKitTree = async (files: File[]) => {
    const byFolder = new Map<string, File[]>();
    for (const f of files) {
      if (f.name.startsWith('.') || f.size === 0) continue;
      const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '').split('/').filter(Boolean);
      // [pack, folder, file] → folder; [folder, file] → folder; a bare file → 'Documents'.
      const folder = rel.length >= 2 ? rel[rel.length - 2] : 'Documents';
      const arr = byFolder.get(folder) ?? [];
      arr.push(f); byFolder.set(folder, arr);
    }
    for (const [folder, fs] of byFolder) await uploadKitFiles(folder, fs);
  };

  // MULTI-FOLDER DROP (owner, Aug 31 — "add multiple folders at once"): the native directory
  // picker is ONE directory per gesture by browser design, so multiple-at-once lives on
  // drag-and-drop — drop any mix of folders (and loose files) onto the card. Each dropped
  // DIRECTORY becomes a kit folder under its own name; its nested files are read recursively
  // (readEntries returns ≤100 per call — loop until drained); loose files land in 'Documents'.
  const readKitDrop = async (dt: DataTransfer): Promise<Map<string, File[]>> => {
    const byFolder = new Map<string, File[]>();
    const add = (folder: string, f: File) => {
      if (f.name.startsWith('.') || f.size === 0) return;
      const arr = byFolder.get(folder) ?? [];
      arr.push(f); byFolder.set(folder, arr);
    };
    const fileOf = (entry: FileSystemFileEntry) => new Promise<File | null>((res) => entry.file(res, () => res(null)));
    const drain = (dir: FileSystemDirectoryEntry) => {
      const reader = dir.createReader();
      return new Promise<FileSystemEntry[]>((res) => {
        const all: FileSystemEntry[] = [];
        const next = () => reader.readEntries((batch) => {
          if (!batch.length) return res(all);
          all.push(...batch); next();
        }, () => res(all));
        next();
      });
    };
    const walk = async (entry: FileSystemEntry, folder: string): Promise<void> => {
      if (entry.isFile) {
        const f = await fileOf(entry as FileSystemFileEntry);
        if (f) add(folder, f);
      } else if (entry.isDirectory) {
        // A nested directory keeps ITS name — same rule as the picker (immediate parent wins).
        const children = await drain(entry as FileSystemDirectoryEntry);
        for (const c of children) await walk(c, entry.name);
      }
    };
    const entries = Array.from(dt.items)
      .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
      .filter((e): e is FileSystemEntry => !!e);
    for (const e of entries) {
      if (e.isDirectory) await walk(e, e.name);
      else await walk(e, 'Documents');
    }
    return byFolder;
  };

  const onKitDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    setKitDragOver(false);
    if (busy !== null) return;
    try {
      const byFolder = await readKitDrop(ev.dataTransfer);
      for (const [folder, fs] of byFolder) await uploadKitFiles(folder, fs);
    } catch { setKitErr('Could not read the dropped folders — try the "Upload folders…" button.'); }
  };

  const removeKit = async (folder: string, file?: string) => {
    setConfirmKit(null);
    setBusy(`kit:${folder}`);
    try {
      const res = await fetch(`/api/platform-admin/companies/${c.id}/seed-kit`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder, file }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.seedKit) setKit(d.seedKit as SeedKit);
      else setKitErr(d?.error ?? 'Could not remove');
    } finally { setBusy(null); }
  };

  const addFolder = () => {
    const name = newFolder.trim();
    if (!name) return;
    if (!(kit?.folders ?? []).some(f => f.name.toLowerCase() === name.toLowerCase())) {
      // A folder exists in the manifest only once it holds a file — hold it locally until then.
      setKit(prev => ({ folders: [...(prev?.folders ?? []), { name, files: [] }], updated_at: prev?.updated_at ?? '' }));
    }
    setNewFolder('');
  };

  const applyKit = async () => {
    setConfirmKit(null);
    setBusy('kit:apply');
    setApplyResult(null);
    try {
      const res = await fetch(`/api/platform-admin/companies/${c.id}/seed-kit/apply`, { method: 'POST' });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setApplyResult(
          `Seeded ${d.seeded} · skipped ${d.skipped} · failed ${d.failed}` +
          (d.leftBehind?.length ? ` · ${d.leftBehind.length} left for a re-run` : '')
        );
      } else setApplyResult(d?.error ?? 'Seeding failed');
    } catch { setApplyResult('Seeding failed'); }
    finally { setBusy(null); }
  };

  // FULL USER DELETE (owner, Aug 10 — "keep user management as we had"): the SAME
  // platform-admin route the old list expansion used; two-step confirm, row removed on success.
  const [confirmingUser, setConfirmingUser] = useState<string | null>(null);
  const deleteUser = async (userId: string) => {
    setConfirmingUser(null);
    setBusy(`del:${userId}`);
    try {
      const res = await fetch(`/api/platform-admin/members/${userId}/delete`, { method: 'POST' });
      if (res.ok) {
        setMembers(prev => (prev ?? []).filter(m => m.user_id !== userId));
        setC(prev => ({ ...prev, member_count: Math.max(0, prev.member_count - 1) }));
      }
    } finally { setBusy(null); }
  };

  const changeRole = async (userId: string, role: string) => {
    setBusy(`role:${userId}`);
    try {
      const res = await fetch(`/api/platform-admin/companies/${c.id}/members/${userId}/role`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
      });
      if (res.ok) setMembers(prev => (prev ?? []).map(m => m.user_id === userId ? { ...m, role } : m));
    } finally { setBusy(null); }
  };

  const toggleSuspend = async () => {
    const endpoint = c.status === 'active' ? 'suspend' : 'unsuspend';
    setBusy('suspend');
    try {
      const res = await fetch(`/api/platform-admin/companies/${c.id}/${endpoint}`, { method: 'POST' });
      if (res.ok) setC(prev => ({ ...prev, status: prev.status === 'active' ? 'suspended' : 'active' }));
    } finally { setBusy(null); }
  };

  const cascadeDelete = async () => {
    setBusy('delete');
    try {
      const res = await fetch(`/api/platform-admin/companies/${c.id}/cascade-delete`, { method: 'POST' });
      if (res.ok) router.push('/platform-admin');
    } finally { setBusy(null); }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-neutral-50">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        {/* Header */}
        <div>
          <Link href="/platform-admin" className="inline-flex items-center gap-1.5 text-[12px] text-neutral-400 hover:text-neutral-700 transition-colors mb-3">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> All workspaces
          </Link>
          <div className="flex items-center gap-3">
            <input value={name} onChange={e => setName(e.target.value)}
              onBlur={() => { if (name.trim() && name !== c.name) void patch({ name: name.trim() }, prev => ({ ...prev, name: name.trim() })); }}
              className="text-[22px] font-semibold text-neutral-900 bg-transparent outline-none border-b border-transparent focus:border-indigo-300 min-w-0" />
            <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full capitalize ${c.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{c.status}</span>
            {sovereign && (
              <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                <ShieldCheckIcon className="w-3.5 h-3.5" /> Corporate
              </span>
            )}
          </div>
          <p className="text-[12px] text-neutral-400 mt-1">
            {c.slug} · {c.member_count} member{c.member_count === 1 ? '' : 's'} · created {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>

        {/* Identity */}
        <div className={card}>
          <p className={label}>Identity</p>
          <div className="flex items-center gap-4 mt-3">
            {([['Type', c.type, TYPE_OPTIONS, (v: string) => patch({ type: v }, p => ({ ...p, type: v as WorkspaceType }))],
               ['Plan', c.plan, PLAN_OPTIONS, (v: string) => patch({ plan: v }, p => ({ ...p, plan: v }))]] as const)
              .map(([lab, val, opts, on]) => (
              <label key={lab} className="flex flex-col gap-1">
                <span className="text-[11px] text-neutral-400">{lab}</span>
                <select value={val} onChange={e => void on(e.target.value)} className={`${input} capitalize`}>
                  {opts.map(o => <option key={o} value={o} className="capitalize">{o}</option>)}
                </select>
              </label>
            ))}
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-neutral-400">AI mode</span>
              <select value={c.ai_tier ?? ''} onChange={e => void patch({ ai_tier: e.target.value || null }, p => ({ ...p, ai_tier: (e.target.value || null) as TierType | null }))} className={input}>
                {AI_TIER_OPTIONS.map(o => <option key={o.value ?? 'null'} value={o.value ?? ''}>{o.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        {/* Access & entry — the sovereign door */}
        <div className={card}>
          <p className={label}>Access & entry</p>
          <div className="mt-3 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium text-neutral-800 flex items-center gap-1.5">
                  <ShieldCheckIcon className={`w-4 h-4 ${sovereign ? 'text-emerald-500' : 'text-neutral-300'}`} />
                  Corporate (sovereign) mode
                </p>
                <p className="text-[12px] text-neutral-400 mt-0.5 max-w-md">
                  No mailbox or calendar auth anywhere — members get the agent team, workflows, meetings recording,
                  and the knowledge base. Workflow email sending to stated addresses still works.
                </p>
              </div>
              <button onClick={() => void toggleFeature('email', !sovereign ? false : true)}
                disabled={busy === 'feature:email'}
                className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${sovereign ? 'bg-emerald-500' : 'bg-neutral-200'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${sovereign ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-neutral-500 w-20 flex-shrink-0">Entry link</span>
              <button onClick={() => copy('entry', entryUrl)} className="flex items-center gap-1.5 text-[12px] font-mono text-indigo-600 hover:text-indigo-800 truncate">
                {copied === 'entry' ? <CheckIcon className="w-3.5 h-3.5" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
                {entryUrl}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-neutral-500 w-20 flex-shrink-0">Join code</span>
              {/* EDITABLE (owner, Aug 10): type a branded code (ISCORE26-style) and save on
                  blur/Enter — uppercase alphanumeric, uniqueness enforced server-side. */}
              <input
                value={codeDraft}
                onChange={e => { setCodeDraft(e.target.value.toUpperCase()); setCodeErr(''); }}
                onBlur={() => void saveCode()}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                spellCheck={false}
                className="w-32 rounded-md border border-neutral-200 px-2 py-0.5 text-[12px] font-mono font-semibold uppercase tracking-wider text-neutral-700 outline-none focus:border-indigo-300"
              />
              <button onClick={() => copy('code', c.join_code)} title="Copy the current code"
                className="p-1 rounded text-neutral-400 hover:text-neutral-700">
                {copied === 'code' ? <CheckIcon className="w-3.5 h-3.5" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => void regenCode()} disabled={busy === 'code'} title="Regenerate a random code (invalidates the old one)"
                className="p-1 rounded text-neutral-400 hover:text-neutral-700 disabled:opacity-50">
                <ArrowPathIcon className={`w-3.5 h-3.5 ${busy === 'code' ? 'animate-spin' : ''}`} />
              </button>
              {codeErr && <span className="text-[11.5px] text-red-600">{codeErr}</span>}
            </div>
          </div>
        </div>

        {/* Branding */}
        <div className={card}>
          <p className={label}>Branding — the entry page & sidebar co-brand</p>
          <div className="flex items-center gap-2 mt-3">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="logo" className="h-7 max-w-[64px] object-contain rounded flex-shrink-0" />
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadLogo(f); }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy === 'logo'}
              className="text-[12px] font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 rounded-md px-2.5 py-1.5 transition-colors flex-shrink-0">
              {busy === 'logo' ? 'Uploading…' : 'Upload logo'}
            </button>
            <input value={logo} onChange={e => setLogo(e.target.value)} placeholder="…or paste a logo URL" className={`${input} flex-1`} />
            <input value={tagline} onChange={e => setTagline(e.target.value)} placeholder="Tagline (optional)" className={`${input} flex-1`} />
            <span className="flex items-center gap-1 flex-shrink-0">
              {accent && /^#?[0-9a-fA-F]{6}$/.test(accent) && (
                <span className="w-5 h-5 rounded border border-neutral-200 flex-shrink-0" style={{ backgroundColor: `#${accent.replace(/^#/, '')}` }} />
              )}
              <input value={accent} onChange={e => setAccent(e.target.value)} placeholder="Accent hex" maxLength={7}
                title="Document theme accent — titles and deck accents in every deliverable"
                className={`${input} w-24 font-mono`} />
            </span>
            <input value={footerLine} onChange={e => setFooterLine(e.target.value)} placeholder="Doc footer line (optional)"
              title='Runs along the bottom of every document, e.g. "Prepared by Acme Consulting"'
              className={`${input} flex-1`} />
            <button onClick={() => void saveBranding()} disabled={busy === 'patch'}
              className="text-[12px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-md px-3 py-1.5 transition-colors">
              Save
            </button>
          </div>
        </div>

        {/* Features */}
        <div className={card}>
          <p className={label}>Features</p>
          <div className="mt-3 space-y-3">
            {FEATURES.map(f => (
              <div key={f.key} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[13px] font-medium text-neutral-800">{f.label}</p>
                  <p className="text-[12px] text-neutral-400 mt-0.5 max-w-md">{f.detail}</p>
                </div>
                <button onClick={() => void toggleFeature(f.key, !c.features[f.key])}
                  disabled={busy === `feature:${f.key}`}
                  className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${c.features[f.key] ? 'bg-indigo-500' : 'bg-neutral-200'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${c.features[f.key] ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Seed kit — what every member's knowledge base arrives with. The card is a DROP ZONE:
            drop several folders at once (the picker is one-directory-per-gesture by browser design). */}
        <div className={`${card} ${kitDragOver ? 'ring-2 ring-indigo-300 bg-indigo-50/30' : ''} transition-all`}
          onDragOver={(e) => { e.preventDefault(); if (busy === null) setKitDragOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setKitDragOver(false); }}
          onDrop={(e) => void onKitDrop(e)}>
          <p className={label}>Seed kit — documents every member arrives with</p>
          <p className="text-[12px] text-neutral-400 mt-1 max-w-lg">
            Folders of documents planted in each member&apos;s own knowledge base, indexed and searchable.
            New members receive the kit automatically when they join. Drop folders anywhere on this card
            — several at once works — or use &ldquo;Upload folders…&rdquo;.
          </p>

          <input ref={kitFileRef} type="file" multiple className="hidden"
            accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.pptx"
            onChange={e => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void uploadKitFiles(kitTargetFolder.current, files);
            }} />
          {/* Directory picker — webkitdirectory is non-standard but universal; React's types
              don't know it, so it rides a spread. */}
          <input ref={kitDirRef} type="file" multiple className="hidden"
            {...({ webkitdirectory: '' } as Record<string, string>)}
            onChange={e => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void uploadKitTree(files);
            }} />

          <div className="mt-3 space-y-3">
            {kit === null ? (
              <p className="text-[12px] text-neutral-400">Loading…</p>
            ) : kit.folders.length === 0 ? (
              <p className="text-[12px] text-neutral-400">No kit yet — add a folder, then the documents that belong in it.</p>
            ) : kit.folders.map(f => {
              const open = openKitFolders.has(f.name);
              return (
              <div key={f.name} className="rounded-lg border border-neutral-200">
                {/* The folder ROW is the whole story at rest: name · count · actions. Click expands. */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => toggleKitFolder(f.name)}
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left group">
                    <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-400 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
                    <span className="text-[13px] font-medium text-neutral-800 truncate group-hover:text-indigo-700 transition-colors">{f.name}</span>
                    <span className="text-[11.5px] text-neutral-400 flex-shrink-0">{f.files.length} file{f.files.length === 1 ? '' : 's'}</span>
                  </button>
                  <button onClick={() => { kitTargetFolder.current = f.name; kitFileRef.current?.click(); }}
                    disabled={busy === `kit:${f.name}`}
                    className="text-[11.5px] font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50 flex-shrink-0">
                    {busy === `kit:${f.name}` ? 'Working…' : 'Add files'}
                  </button>
                  {confirmKit === `folder:${f.name}` ? (
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[11px] text-red-500 font-medium">Remove the whole folder?</span>
                      <button onClick={() => void removeKit(f.name)}
                        className="text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded px-2 py-0.5 transition-colors">Remove</button>
                      <button onClick={() => setConfirmKit(null)} className="text-[11px] text-neutral-400 hover:text-neutral-600">Cancel</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmKit(`folder:${f.name}`)} title="Remove this folder from the kit"
                      className="p-1 rounded text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0">
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {open && f.files.length > 0 && (
                  <div className="px-3 pb-2.5 pl-8 space-y-1 border-t border-neutral-100 pt-2">
                    {f.files.map(file => (
                      <div key={file.path} className="flex items-center gap-2 text-[12px]">
                        {/* Basename defensively — pre-fix manifests carried the dropped RELATIVE PATH as the name. */}
                        <span className="flex-1 text-neutral-600 truncate">{file.name.split('/').pop() ?? file.name}</span>
                        <span className="text-[11px] text-neutral-400 flex-shrink-0">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                        {confirmKit === `file:${f.name}/${file.name}` ? (
                          <span className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={() => void removeKit(f.name, file.name)}
                              className="text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded px-2 py-0.5 transition-colors">Remove</button>
                            <button onClick={() => setConfirmKit(null)} className="text-[11px] text-neutral-400 hover:text-neutral-600">Cancel</button>
                          </span>
                        ) : (
                          <button onClick={() => setConfirmKit(`file:${f.name}/${file.name}`)} title="Remove this document"
                            className="p-1 rounded text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0">
                            <TrashIcon className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );})}

            <div className="flex items-center gap-2">
              <input value={newFolder} onChange={e => setNewFolder(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addFolder(); }}
                placeholder="New folder (e.g. 01_HR_CV_Screening)" maxLength={60} className={`${input} flex-1`} />
              <button onClick={addFolder} disabled={!newFolder.trim()}
                className="text-[12px] font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-40 rounded-md px-2.5 py-1.5 transition-colors">
                Add folder
              </button>
              <button onClick={() => kitDirRef.current?.click()} disabled={busy !== null}
                title="Pick a folder (or the whole pack) — subfolders become kit folders, names derived from the paths"
                className="text-[12px] font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-40 rounded-md px-2.5 py-1.5 transition-colors whitespace-nowrap">
                Upload folders…
              </button>
            </div>

            {kitErr && <p className="text-[11.5px] text-red-600">{kitErr}</p>}

            <div className="flex items-center gap-3 pt-1">
              {confirmKit === 'apply' ? (
                <span className="flex items-center gap-2">
                  <span className="text-[12px] text-neutral-500">Plant the kit in every current member&apos;s knowledge base?</span>
                  <button onClick={() => void applyKit()} disabled={busy === 'kit:apply'}
                    className="text-[12px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-md px-3 py-1.5 transition-colors">Confirm</button>
                  <button onClick={() => setConfirmKit(null)} className="text-[12px] text-neutral-400 hover:text-neutral-600">Cancel</button>
                </span>
              ) : (
                <button onClick={() => setConfirmKit('apply')} disabled={busy === 'kit:apply' || !(kit?.folders ?? []).some(f => f.files.length)}
                  className="text-[12px] font-medium text-neutral-700 border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40 rounded-md px-3 py-1.5 transition-colors">
                  {busy === 'kit:apply' ? 'Seeding…' : 'Seed existing members'}
                </button>
              )}
              {applyResult && <span className="text-[12px] text-neutral-500">{applyResult}</span>}
            </div>
          </div>
        </div>

        {/* Members */}
        <div className={card}>
          <p className={label}>Members</p>
          <div className="mt-3 space-y-2">
            {members === null ? (
              <p className="text-[12px] text-neutral-400">Loading…</p>
            ) : members.length === 0 ? (
              <p className="text-[12px] text-neutral-400">No members yet — send the entry link and join code.</p>
            ) : members.map(m => (
              <div key={m.id} className="flex items-center gap-3 text-[12.5px]">
                <span className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-semibold text-indigo-700 flex-shrink-0">
                  {(m.full_name ?? m.email)[0]?.toUpperCase()}
                </span>
                <span className="flex-1 text-neutral-700 truncate">{m.full_name ? `${m.full_name} (${m.email})` : m.email}</span>
                <select value={m.role} onChange={e => void changeRole(m.user_id, e.target.value)} disabled={busy === `role:${m.user_id}`}
                  className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold capitalize border-0 bg-neutral-100 text-neutral-600 cursor-pointer focus:outline-none">
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </select>
                {confirmingUser === m.user_id ? (
                  <span className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[11px] text-red-500 font-medium">Delete user entirely?</span>
                    <button onClick={() => void deleteUser(m.user_id)} disabled={busy === `del:${m.user_id}`}
                      className="text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded px-2 py-0.5 transition-colors">
                      {busy === `del:${m.user_id}` ? '…' : 'Delete'}
                    </button>
                    <button onClick={() => setConfirmingUser(null)} className="text-[11px] text-neutral-400 hover:text-neutral-600">Cancel</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmingUser(m.user_id)} title="Delete this user completely (account and data)"
                    className="p-1 rounded text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0">
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            {pending.length > 0 && (
              <p className="text-[11.5px] text-neutral-400 pt-1">Pending invites: {pending.map(p => p.email).join(', ')}</p>
            )}
          </div>
        </div>

        {/* Danger */}
        <div className={`${card} border-red-100`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-400">Danger zone</p>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => void toggleSuspend()} disabled={busy === 'suspend'}
              className="text-[12px] font-medium text-amber-700 border border-amber-200 hover:bg-amber-50 disabled:opacity-50 rounded-md px-3 py-1.5 transition-colors">
              {c.status === 'active' ? 'Suspend workspace' : 'Unsuspend workspace'}
            </button>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)}
                className="text-[12px] font-medium text-red-600 border border-red-200 hover:bg-red-50 rounded-md px-3 py-1.5 transition-colors">
                Delete workspace…
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-[12px] text-red-600"><ExclamationTriangleIcon className="w-4 h-4" />Deletes the workspace and unlinks all members.</span>
                <button onClick={() => void cascadeDelete()} disabled={busy === 'delete'}
                  className="text-[12px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-md px-3 py-1.5 transition-colors">
                  {busy === 'delete' ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-[12px] text-neutral-400 hover:text-neutral-600">Cancel</button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
