'use client';

// Coworker-chat composer with @-mention (Coworkers / Tasks / Documents). Ported from
// the /work ChatInputBar mention machinery, re-contextualized. Streaming stays in the
// parent — this just emits onSubmit(text, mentions).

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  PaperAirplaneIcon, AtSymbolIcon, ChevronRightIcon, ChevronLeftIcon,
  UserCircleIcon, BoltIcon, DocumentTextIcon,
} from '@heroicons/react/24/outline';

export interface WorkerMention { id: string; type: 'coworker' | 'task' | 'document'; label: string; subtitle?: string }

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
}

export function WorkerMentionInput({ onSubmit, disabled, placeholder, prefill, onPrefillConsumed }: Props) {
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
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rect, setRect] = useState<{ left: number; right: number; bottom: number } | null>(null);

  useEffect(() => {
    if (prefill) { setValue(prefill); onPrefillConsumed?.(); taRef.current?.focus(); }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // auto-resize
    const el = taRef.current; if (!el) return;
    el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => { // close on outside click
    if (mq === null) return;
    const h = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setMq(null); setMode('categories'); } };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [mq]);

  const fetchItems = useCallback(async (q: string, type?: WorkerMention['type']) => {
    setLoadingItems(true);
    try {
      const p = new URLSearchParams({ q }); if (type) p.set('types', type);
      const res = await fetch(`/api/workers/mentions?${p}`);
      if (res.ok) { const d = await res.json(); setResults(d.results || []); setIdx(0); }
    } catch { /* ignore */ } finally { setLoadingItems(false); }
  }, []);

  useEffect(() => {
    if (mq === null) { setResults([]); setMode('categories'); setCat(null); return; }
    if (mq === '' && cat === null) { setMode('categories'); setResults([]); return; }
    setMode('items');
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => fetchItems(mq, cat ?? undefined), cat ? 0 : 180);
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

  function openMention() {
    const el = taRef.current; if (!el) return;
    const pos = el.selectionStart ?? value.length;
    setValue(value.slice(0, pos) + '@' + value.slice(pos));
    setMq(''); setCat(null); setMode('categories'); setIdx(0);
    setTimeout(() => { el.focus(); el.setSelectionRange(pos + 1, pos + 1); }, 0);
  }

  return (
    <div className="relative" ref={wrapRef}>
      {dropdown}
      <div className="rounded-2xl bg-neutral-50 border border-neutral-200 overflow-hidden focus-within:border-neutral-300 focus-within:bg-white focus-within:shadow-sm transition-all duration-150">
        {mentions.length > 0 && (
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
          </div>
        )}
        <textarea
          ref={taRef} value={value} onChange={onChange} onKeyDown={onKeyDown}
          placeholder={placeholder} rows={1} disabled={disabled}
          className="w-full resize-none px-4 pt-3 pb-2 text-[13.5px] text-neutral-800 placeholder:text-neutral-400 bg-transparent outline-none leading-relaxed disabled:opacity-50"
          style={{ minHeight: '44px', maxHeight: '180px' }}
        />
        <div className="flex items-center px-3 pb-2.5">
          <button onClick={openMention} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors">
            <AtSymbolIcon className="w-3.5 h-3.5" /> Mention
          </button>
          <button onClick={submit} disabled={disabled || !value.trim()}
            className="ml-auto flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-700 transition-colors">
            <PaperAirplaneIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
