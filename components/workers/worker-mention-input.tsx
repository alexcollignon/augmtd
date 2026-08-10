'use client';

// Coworker-chat composer with @-mention (Coworkers / Tasks / Documents). Ported from
// the /work ChatInputBar mention machinery, re-contextualized. Streaming stays in the
// parent — this just emits onSubmit(text, mentions).

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  PaperAirplaneIcon, AtSymbolIcon, PaperClipIcon, ChevronRightIcon, ChevronLeftIcon,
  UserCircleIcon, BoltIcon, DocumentTextIcon,
} from '@heroicons/react/24/outline';
import type { AttachmentChip } from '@/components/work/chat-input-bar';

export interface WorkerMention { id: string; type: 'coworker' | 'task' | 'document'; label: string; subtitle?: string }

function formatBytes(b: number): string {
  return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

const ICONS: Record<WorkerMention['type'], React.ElementType> = { coworker: UserCircleIcon, task: BoltIcon, document: DocumentTextIcon };
const CHIP: Record<WorkerMention['type'], string> = {
  coworker: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  task: 'bg-amber-50 text-amber-700 border-amber-200',
  document: 'bg-violet-50 text-violet-700 border-violet-200',
};
const ICON_BG: Record<WorkerMention['type'], string> = {
  coworker: 'bg-indigo-50 text-indigo-500', task: 'bg-amber-50 text-amber-500', document: 'bg-violet-50 text-violet-500',
};
const CATEGORIES: { type: WorkerMention['type']; label: string }[] = [
  { type: 'coworker', label: 'Coworkers' },
  { type: 'task', label: 'Tasks' },
  { type: 'document', label: 'Documents' },
];

function mentionQueryAt(value: string, cursor: number): string | null {
  const m = value.slice(0, cursor).match(/@(\w*)$/);
  return m ? m[1] : null;
}

interface Props {
  onSubmit: (text: string, mentions: WorkerMention[]) => void;
  disabled?: boolean;
  placeholder?: string;
  prefill?: string | null;
  onPrefillConsumed?: () => void;
  onAttach?: (files: File[]) => void;
  attachments?: AttachmentChip[];
  onRemoveAttachment?: (id: string) => void;
  /** The HOST owns the frame (border/bg/focus ring) — the component renders only its innards.
      One frame, never a pill inside a pill (the Home floor wraps this in its own chrome). */
  frameless?: boolean;
  /** Host-supplied control rendered in the action row after Attach (e.g. the Home's scope
      chip) — context controls live WITH the composer, not above the conversation. */
  accessory?: React.ReactNode;
}

export function WorkerMentionInput({ onSubmit, disabled, placeholder, prefill, onPrefillConsumed, onAttach, attachments = [], onRemoveAttachment, frameless, accessory }: Props) {
  const [value, setValue] = useState('');
  const [mentions, setMentions] = useState<WorkerMention[]>([]);
  const [mq, setMq] = useState<string | null>(null);
  const [mode, setMode] = useState<'categories' | 'items'>('categories');
  const [cat, setCat] = useState<WorkerMention['type'] | null>(null);
  const [results, setResults] = useState<WorkerMention[]>([]);
  const [idx, setIdx] = useState(0);
  const [loadingItems, setLoadingItems] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rect, setRect] = useState<{ left: number; right: number; bottom: number } | null>(null);

  useEffect(() => {
    if (prefill) { setValue(prefill); onPrefillConsumed?.(); taRef.current?.focus(); }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // auto-resize
    const el = taRef.current; if (!el) return;
    el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => { // close on outside click — strip the dangling @ since nothing was chosen
    if (mq === null) return;
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setValue(v => v.replace(/@[^@\s]*$/, ''));
        setMq(null); setMode('categories'); setCat(null);
      }
    };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [mq]);

  const cacheRef = useRef<Record<string, WorkerMention[]>>({});
  const prefetchedRef = useRef(false);

  const fetchItems = useCallback(async (q: string, type?: WorkerMention['type'], silent = false) => {
    if (!silent) setLoadingItems(true);
    try {
      const p = new URLSearchParams({ q }); if (type) p.set('types', type);
      const res = await fetch(`/api/workers/mentions?${p}`);
      if (res.ok) {
        const items: WorkerMention[] = (await res.json()).results || [];
        setResults(items); setIdx(0);
        if (type && q === '') cacheRef.current[type] = items; // cache each category's default list
      }
    } catch { /* ignore */ } finally { if (!silent) setLoadingItems(false); }
  }, []);

  // Warm the cache the moment the menu opens (one request, split by type) so drilling is instant.
  useEffect(() => {
    if (mq === null || prefetchedRef.current) return;
    prefetchedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/workers/mentions?q=`);
        if (!res.ok) return;
        const all: WorkerMention[] = (await res.json()).results || [];
        cacheRef.current.coworker = all.filter(r => r.type === 'coworker');
        cacheRef.current.task = all.filter(r => r.type === 'task');
        cacheRef.current.document = all.filter(r => r.type === 'document');
      } catch { /* ignore */ }
    })();
  }, [mq]);

  useEffect(() => {
    if (mq === null) { setResults([]); setMode('categories'); setCat(null); return; }
    if (mq === '' && cat === null) { setMode('categories'); setResults([]); return; }
    setMode('items');
    // Cache hit for a category's default list → render instantly, refresh silently.
    const cached = cat && mq === '' ? cacheRef.current[cat] : undefined;
    if (cached) { setResults(cached); setIdx(0); }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => fetchItems(mq, cat ?? undefined, !!cached), cat ? 0 : 180);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [mq, cat, fetchItems]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value; setValue(v);
    const q = mentionQueryAt(v, e.target.selectionStart ?? v.length);
    if (q !== mq) setCat(null);
    setMq(q);
  }

  function pick(m: WorkerMention) {
    const cursor = taRef.current?.selectionStart ?? value.length;
    setValue(value.slice(0, cursor).replace(/@\w*$/, '') + value.slice(cursor));
    setMq(null); setResults([]); setCat(null); setMode('categories');
    setMentions(prev => prev.find(x => x.id === m.id && x.type === m.type) ? prev : [...prev, m]);
    taRef.current?.focus();
  }
  const removeMention = (id: string, type: string) => setMentions(prev => prev.filter(m => !(m.id === id && m.type === type)));

  function submit() {
    const t = value.trim();
    if (!t || disabled) return;
    onSubmit(t, mentions);
    setValue(''); setMentions([]); setMq(null); setCat(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mq !== null) {
      const list = mode === 'categories' ? CATEGORIES : results;
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, list.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Escape') { e.preventDefault(); if (cat) { setCat(null); setMode('categories'); } else setMq(null); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (mode === 'categories') { setCat(CATEGORIES[idx].type); setMode('items'); }
        else if (results.length) pick(results[idx]);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  useEffect(() => {
    if (mq === null || !wrapRef.current) { setRect(null); return; }
    const r = wrapRef.current.getBoundingClientRect();
    setRect({ left: r.left, right: r.right, bottom: r.top });
  }, [mq, value]);

  const dropdown = mq !== null && rect && typeof document !== 'undefined' ? createPortal(
    <div
      style={{ position: 'fixed', left: rect.left, width: rect.right - rect.left, bottom: window.innerHeight - rect.bottom + 8, maxHeight: rect.bottom - 16, zIndex: 9999 }}
      onMouseDown={e => e.stopPropagation()}
      className="bg-white rounded-xl shadow-lg border border-neutral-200 overflow-y-auto"
    >
      {mode === 'categories' ? (
        <div>
          <div className="px-3 py-2 border-b border-neutral-100"><p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Mention</p></div>
          {CATEGORIES.map((c, i) => {
            const Icon = ICONS[c.type];
            return (
              <button key={c.type} onMouseDown={e => { e.preventDefault(); setCat(c.type); setMode('items'); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left ${i === idx ? 'bg-neutral-50' : 'hover:bg-neutral-50'}`}>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${ICON_BG[c.type]}`}><Icon className="w-3.5 h-3.5" /></div>
                <span className="flex-1 text-[13px] font-medium text-neutral-700">{c.label}</span>
                <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-300" />
              </button>
            );
          })}
        </div>
      ) : (
        <div>
          {cat && (
            <button onMouseDown={e => { e.preventDefault(); setCat(null); setMode('categories'); setResults([]); setIdx(0); }}
              className="w-full flex items-center gap-2 px-3 py-2 border-b border-neutral-100 hover:bg-neutral-50 text-left">
              <ChevronLeftIcon className="w-3.5 h-3.5 text-neutral-400" />
              <span className="text-[12px] font-medium text-neutral-500">{CATEGORIES.find(c => c.type === cat)?.label}</span>
            </button>
          )}
          <div className="max-h-[240px] overflow-y-auto">
            {loadingItems && results.length === 0 && <div className="px-3 py-3 text-[12px] text-neutral-400">Searching…</div>}
            {!loadingItems && results.length === 0 && <div className="px-3 py-3 text-[12px] text-neutral-400">No results</div>}
            {results.map((r, i) => {
              const Icon = ICONS[r.type];
              return (
                <button key={`${r.type}:${r.id}`} onMouseDown={e => { e.preventDefault(); pick(r); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left ${i === idx ? 'bg-indigo-50' : 'hover:bg-neutral-50'}`}>
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center ${ICON_BG[r.type]}`}><Icon className="w-3.5 h-3.5" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium text-neutral-800 truncate">{r.label}</p>
                    {r.subtitle && <p className="text-[11px] text-neutral-400 truncate">{r.subtitle}</p>}
                  </div>
                  {!cat && <span className="text-[10.5px] text-neutral-300 capitalize">{r.type}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>, document.body) : null;

  function toggleMention() {
    // Clicking Mention again (dropdown open) closes it and strips the dangling @.
    if (mq !== null) {
      setValue(v => v.replace(/@[^@\s]*$/, ''));
      setMq(null); setCat(null); setMode('categories');
      return;
    }
    const el = taRef.current; if (!el) return;
    const pos = el.selectionStart ?? value.length;
    setValue(value.slice(0, pos) + '@' + value.slice(pos));
    setMq(''); setCat(null); setMode('categories'); setIdx(0);
    setTimeout(() => { el.focus(); el.setSelectionRange(pos + 1, pos + 1); }, 0);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) onAttach?.(files);
  }

  // DRAG-AND-DROP ATTACH (Aug 10): dropping files anywhere on the composer attaches them through
  // the SAME onAttach door the paperclip uses — one composer, so every chat box (Home chat, room
  // rail, coworker DM) gets it at once. A depth counter survives child enter/leave churn.
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const onDragEnter = (e: React.DragEvent) => {
    if (!onAttach || !hasFiles(e)) return;
    e.preventDefault(); dragDepth.current += 1; setDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => { if (onAttach && hasFiles(e)) e.preventDefault(); };
  const onDragLeave = () => {
    if (!onAttach) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!onAttach) return;
    e.preventDefault(); dragDepth.current = 0; setDragOver(false);
    // Same types the paperclip picker allows — the two attach doors behave identically.
    const ok = /\.(pdf|docx|txt|jpe?g|png|webp|zip)$/i;
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => ok.test(f.name));
    if (files.length) onAttach(files);
  };

  const hasChips = mentions.length > 0 || attachments.length > 0;

  return (
    <div className="relative" ref={wrapRef}
      onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dropdown}
      {dragOver && onAttach && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/90 pointer-events-none">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-indigo-600">
            <PaperClipIcon className="w-4 h-4" /> Drop files to attach
          </span>
        </div>
      )}
      <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,.zip" className="hidden" onChange={handleFileChange} />
      <div className={frameless ? '' : 'rounded-2xl bg-neutral-50 border border-neutral-200 overflow-hidden focus-within:border-neutral-300 focus-within:bg-white focus-within:shadow-sm transition-all duration-150'}>
        {hasChips && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {mentions.map(m => {
              const Icon = ICONS[m.type];
              return (
                <div key={`${m.type}:${m.id}`} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[12px] ${CHIP[m.type]}`}>
                  <Icon className="w-3 h-3" />
                  <span className="max-w-[120px] truncate">{m.label}</span>
                  <button onClick={() => removeMention(m.id, m.type)} className="opacity-60 hover:opacity-100 ml-0.5">×</button>
                </div>
              );
            })}
            {attachments.map(att => (
              <div key={att.id} className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-100 rounded-lg text-[12px] text-neutral-700">
                {att.isUploading ? (
                  <svg className="w-3 h-3 text-neutral-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : <PaperClipIcon className="w-3 h-3 text-neutral-400" />}
                <span className="max-w-[120px] truncate">{att.name}</span>
                {!att.isUploading && <span className="text-neutral-400">{formatBytes(att.size)}</span>}
                {onRemoveAttachment && <button onClick={() => onRemoveAttachment(att.id)} className="text-neutral-400 hover:text-neutral-600 ml-0.5">×</button>}
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={taRef} value={value} onChange={onChange} onKeyDown={onKeyDown}
          placeholder={placeholder} rows={1} disabled={disabled}
          className="w-full resize-none px-4 pt-3 pb-2 text-[13.5px] text-neutral-800 placeholder:text-neutral-400 bg-transparent outline-none leading-relaxed disabled:opacity-50"
          style={{ minHeight: '44px', maxHeight: '180px' }}
        />
        <div className="flex items-center px-3 pb-2.5">
          <button onClick={toggleMention} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors">
            <AtSymbolIcon className="w-3.5 h-3.5" /> Mention
          </button>
          {onAttach && (
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors">
              <PaperClipIcon className="w-3.5 h-3.5" /> Attach
            </button>
          )}
          {accessory}
          <button onClick={submit} disabled={disabled || !value.trim()}
            className="ml-auto flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-700 transition-colors">
            <PaperAirplaneIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
