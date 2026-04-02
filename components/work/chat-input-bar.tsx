'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  PaperAirplaneIcon,
  PaperClipIcon,
  AtSymbolIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  EnvelopeIcon,
  CalendarIcon,
  DocumentTextIcon,
  Cog6ToothIcon,
  UserIcon,
} from '@heroicons/react/24/outline';

export const CHAT_SOURCES = [
  { id: 'kb', label: 'Knowledge base' },
  { id: 'inbox', label: 'Inbox & emails' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'processes', label: 'Active processes' },
] as const;

export type SourceId = (typeof CHAT_SOURCES)[number]['id'];

export interface AttachmentChip {
  id: string;
  name: string;
  size: number;
}

export interface MentionChip {
  id: string;
  type: 'email' | 'meeting' | 'kb' | 'process' | 'contact';
  label: string;
  subtitle?: string;
}

// ── Mention helpers ────────────────────────────────────────────────────────────

const MENTION_ICONS: Record<MentionChip['type'], React.ElementType> = {
  email: EnvelopeIcon,
  meeting: CalendarIcon,
  kb: DocumentTextIcon,
  process: Cog6ToothIcon,
  contact: UserIcon,
};

const MENTION_COLORS: Record<MentionChip['type'], string> = {
  email: 'bg-blue-50 text-blue-700 border-blue-200',
  meeting: 'bg-violet-50 text-violet-700 border-violet-200',
  kb: 'bg-amber-50 text-amber-700 border-amber-200',
  process: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  contact: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const MENTION_ICON_BG: Record<MentionChip['type'], string> = {
  email: 'bg-blue-50 text-blue-500',
  meeting: 'bg-violet-50 text-violet-500',
  kb: 'bg-amber-50 text-amber-500',
  process: 'bg-emerald-50 text-emerald-500',
  contact: 'bg-indigo-50 text-indigo-500',
};

const CATEGORIES: { type: MentionChip['type']; label: string }[] = [
  { type: 'email',   label: 'Emails' },
  { type: 'meeting', label: 'Meetings' },
  { type: 'kb',      label: 'Drive & Knowledge base' },
  { type: 'process', label: 'Processes' },
  { type: 'contact', label: 'Contacts' },
];

function getMentionQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/@(\w*)$/);
  return match ? match[1] : null;
}

function formatBytes(b: number): string {
  return b < 1024 * 1024
    ? `${Math.round(b / 1024)} KB`
    : `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  onSubmit?: (message: string, sources: SourceId[], mentions: MentionChip[]) => void;
  onAttach?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  attachments?: AttachmentChip[];
  mentions?: MentionChip[];
  onMentionRemove?: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
  autoFocus?: boolean;
  defaultValue?: string;
  placeholder?: string;
  threadId?: string;
}

export function ChatInputBar({
  onSubmit,
  onAttach,
  onRemoveAttachment,
  attachments = [],
  mentions = [],
  onMentionRemove,
  disabled,
  loading,
  autoFocus,
  defaultValue = '',
  placeholder = 'Ask anything...',
  threadId,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [activeSources, setActiveSources] = useState<Set<SourceId>>(
    new Set(['kb', 'inbox', 'calendar', 'processes'])
  );

  // Mention dropdown state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionMode, setMentionMode] = useState<'categories' | 'items'>('categories');
  const [selectedCategory, setSelectedCategory] = useState<MentionChip['type'] | null>(null);
  const [mentionResults, setMentionResults] = useState<MentionChip[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionLoading, setMentionLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dropdownRect, setDropdownRect] = useState<{ left: number; right: number; bottom: number } | null>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (defaultValue) {
      setValue(defaultValue);
      textareaRef.current?.focus();
    }
  }, [defaultValue]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [value]);

  // Close sources dropdown on outside click
  useEffect(() => {
    if (!sourcesOpen) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setSourcesOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sourcesOpen]);

  // Close mention dropdown on outside click (portal is outside wrapperRef)
  useEffect(() => {
    if (mentionQuery === null) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMentionQuery(null);
        setMentionMode('categories');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mentionQuery]);

  const fetchMentions = useCallback(async (q: string, type?: MentionChip['type']) => {
    setMentionLoading(true);
    try {
      const params = new URLSearchParams({ q });
      if (type) params.set('types', type);
      const res = await fetch(`/api/work/mentions?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setMentionResults(data.results || []);
      setMentionIndex(0);
    } catch {
      // ignore
    } finally {
      setMentionLoading(false);
    }
  }, []);

  // Drive mode: bare @ → categories; typed query → items; category selected → items scoped
  useEffect(() => {
    if (mentionQuery === null) {
      setMentionResults([]);
      setMentionMode('categories');
      setSelectedCategory(null);
      return;
    }

    if (mentionQuery === '' && selectedCategory === null) {
      // Bare @ with no query and no category selected → show category layer
      setMentionMode('categories');
      setMentionResults([]);
      return;
    }

    // Has query or has a selected category → items mode
    setMentionMode('items');
    if (mentionDebounce.current) clearTimeout(mentionDebounce.current);
    mentionDebounce.current = setTimeout(() => {
      fetchMentions(mentionQuery, selectedCategory ?? undefined);
    }, selectedCategory ? 0 : 180);

    return () => {
      if (mentionDebounce.current) clearTimeout(mentionDebounce.current);
    };
  }, [mentionQuery, selectedCategory, fetchMentions]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = e.target.value;
    setValue(newValue);
    const cursor = e.target.selectionStart ?? newValue.length;
    const q = getMentionQuery(newValue, cursor);
    if (q !== mentionQuery) {
      // Query changed — reset category drill-in
      setSelectedCategory(null);
    }
    setMentionQuery(q);
  }

  function drillIntoCategory(type: MentionChip['type']) {
    setSelectedCategory(type);
    setMentionMode('items');
  }

  function backToCategories() {
    setSelectedCategory(null);
    setMentionMode('categories');
    setMentionResults([]);
    setMentionIndex(0);
  }

  function selectMention(mention: MentionChip) {
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    const newBefore = before.replace(/@\w*$/, '');
    setValue(newBefore + after);
    setMentionQuery(null);
    setMentionResults([]);
    setSelectedCategory(null);
    setMentionMode('categories');
    if (!mentions.find(m => m.id === mention.id && m.type === mention.type)) {
      _addMention(mention);
    }
    textareaRef.current?.focus();
  }

  // Internal pending mentions (added via typeahead before submit)
  const [pendingMentions, setPendingMentions] = useState<MentionChip[]>([]);

  function _addMention(mention: MentionChip) {
    setPendingMentions(prev =>
      prev.find(m => m.id === mention.id && m.type === mention.type) ? prev : [...prev, mention]
    );
  }

  function removePendingMention(id: string, type: string) {
    setPendingMentions(prev => prev.filter(m => !(m.id === id && m.type === type)));
    onMentionRemove?.(`${type}:${id}`);
  }

  const allMentions = [
    ...mentions,
    ...pendingMentions.filter(p => !mentions.find(m => m.id === p.id && m.type === p.type)),
  ];

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null) {
      if (mentionMode === 'categories') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex(i => Math.min(i + 1, CATEGORIES.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex(i => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          drillIntoCategory(CATEGORIES[mentionIndex].type);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMentionQuery(null);
          return;
        }
      }

      if (mentionMode === 'items') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex(i => Math.min(i + 1, mentionResults.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex(i => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter' && mentionResults.length > 0) {
          e.preventDefault();
          selectMention(mentionResults[mentionIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          if (selectedCategory) {
            backToCategories();
          } else {
            setMentionQuery(null);
          }
          return;
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleSubmit() {
    const msg = value.trim();
    if (!msg || disabled || loading) return;
    setValue('');
    const submitMentions = allMentions;
    setPendingMentions([]);
    setMentionQuery(null);
    setSelectedCategory(null);
    onSubmit?.(msg, Array.from(activeSources), submitMentions);
  }

  function toggleSource(id: SourceId) {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) onAttach?.(files);
    e.target.value = '';
  }

  const sourceLabel =
    activeSources.size === CHAT_SOURCES.length
      ? 'All sources'
      : activeSources.size === 0
      ? 'No sources'
      : Array.from(activeSources)
          .map((id) => CHAT_SOURCES.find((s) => s.id === id)?.label.split(' ')[0])
          .join(' · ');

  const canSend = value.trim().length > 0 && !disabled && !loading;
  const hasChips = attachments.length > 0 || allMentions.length > 0;
  const showMentionDropdown = mentionQuery !== null;

  // Recalculate dropdown anchor whenever it becomes visible
  useEffect(() => {
    if (!showMentionDropdown || !wrapperRef.current) {
      setDropdownRect(null);
      return;
    }
    const r = wrapperRef.current.getBoundingClientRect();
    setDropdownRect({ left: r.left, right: r.right, bottom: r.top });
  }, [showMentionDropdown, value]);

  const mentionDropdown = showMentionDropdown && dropdownRect && typeof document !== 'undefined'
    ? createPortal(
        <div
          style={{
            position: 'fixed',
            left: dropdownRect.left,
            width: dropdownRect.right - dropdownRect.left,
            bottom: window.innerHeight - dropdownRect.bottom + 8,
            zIndex: 9999,
          }}
          className="bg-white rounded-xl shadow-lg border border-neutral-200 overflow-hidden"
        >

          {/* ── Category layer ── */}
          {mentionMode === 'categories' && (
            <div>
              <div className="px-3 py-2 border-b border-neutral-100">
                <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">Mention</p>
              </div>
              {CATEGORIES.map((cat, i) => {
                const Icon = MENTION_ICONS[cat.type];
                return (
                  <button
                    key={cat.type}
                    onMouseDown={(e) => { e.preventDefault(); drillIntoCategory(cat.type); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                      i === mentionIndex ? 'bg-neutral-50' : 'hover:bg-neutral-50'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${MENTION_ICON_BG[cat.type]}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="flex-1 text-[13px] font-medium text-neutral-700">{cat.label}</span>
                    <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Items layer ── */}
          {mentionMode === 'items' && (
            <div>
              {/* Header with back button when drilled into a category */}
              {selectedCategory && (
                <button
                  onMouseDown={(e) => { e.preventDefault(); backToCategories(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 border-b border-neutral-100 hover:bg-neutral-50 transition-colors text-left"
                >
                  <ChevronLeftIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
                  <span className="text-[12px] font-medium text-neutral-500">
                    {CATEGORIES.find(c => c.type === selectedCategory)?.label}
                  </span>
                </button>
              )}

              {/* Items list */}
              <div className="max-h-[240px] overflow-y-auto">
                {mentionLoading && mentionResults.length === 0 && (
                  <div className="px-3 py-3 text-[12px] text-neutral-400">Searching…</div>
                )}
                {!mentionLoading && mentionResults.length === 0 && (
                  <div className="px-3 py-3 text-[12px] text-neutral-400">No results</div>
                )}
                {mentionResults.map((result, i) => {
                  const Icon = MENTION_ICONS[result.type];
                  return (
                    <button
                      key={`${result.type}:${result.id}`}
                      onMouseDown={(e) => { e.preventDefault(); selectMention(result); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        i === mentionIndex ? 'bg-indigo-50' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${MENTION_ICON_BG[result.type]}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] font-medium text-neutral-800 truncate">{result.label}</p>
                        {result.subtitle && (
                          <p className="text-[11px] text-neutral-400 truncate">{result.subtitle}</p>
                        )}
                      </div>
                      {/* Show type badge only in cross-search (no selected category) */}
                      {!selectedCategory && (
                        <span className="text-[10.5px] text-neutral-300 capitalize flex-shrink-0">{result.type}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>,
        document.body
      )
    : null;

  return (
    <div className="relative" ref={wrapperRef}>
      {/* Mention dropdown — portal to escape overflow:hidden ancestors */}
      {mentionDropdown}

      {/* Sources dropdown */}
      {sourcesOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-52 bg-white rounded-xl shadow-lg border border-neutral-200 py-1.5 z-20">
          {CHAT_SOURCES.map((source) => (
            <button
              key={source.id}
              onClick={() => toggleSource(source.id)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-neutral-50 text-[13px] text-neutral-700 transition-colors"
            >
              <div
                className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                  activeSources.has(source.id)
                    ? 'bg-indigo-600 border-indigo-600'
                    : 'border-neutral-300'
                }`}
              >
                {activeSources.has(source.id) && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2,6 5,9 10,3" />
                  </svg>
                )}
              </div>
              {source.label}
            </button>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,.zip"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Input card */}
      <div className="rounded-2xl bg-white shadow-sm border border-neutral-200 overflow-hidden">
        {/* Chips row (attachments + mentions) */}
        {hasChips && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {/* Mention chips */}
            {allMentions.map((m) => {
              const Icon = MENTION_ICONS[m.type];
              return (
                <div
                  key={`${m.type}:${m.id}`}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[12px] ${MENTION_COLORS[m.type]}`}
                >
                  <Icon className="w-3 h-3 flex-shrink-0" />
                  <span className="max-w-[100px] truncate">{m.label}</span>
                  <button
                    onClick={() => removePendingMention(m.id, m.type)}
                    className="opacity-60 hover:opacity-100 ml-0.5"
                  >
                    ×
                  </button>
                </div>
              );
            })}

            {/* Attachment chips */}
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-100 rounded-lg text-[12px] text-neutral-700"
              >
                <PaperClipIcon className="w-3 h-3 text-neutral-400 flex-shrink-0" />
                <span className="max-w-[120px] truncate">{att.name}</span>
                <span className="text-neutral-400">{formatBytes(att.size)}</span>
                {onRemoveAttachment && (
                  <button
                    onClick={() => onRemoveAttachment(att.id)}
                    className="text-neutral-400 hover:text-neutral-600 ml-0.5"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Textarea */}
        <div className={`px-4 ${hasChips ? 'pt-2' : 'pt-3'} pb-1`}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || loading}
            rows={1}
            className="w-full resize-none bg-transparent text-[14px] text-neutral-800 placeholder:text-neutral-400 outline-none leading-relaxed disabled:opacity-50"
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-0.5 px-3 pb-3 pt-1">
          {/* Sources */}
          <button
            onClick={() => setSourcesOpen((v) => !v)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors ${
              sourcesOpen
                ? 'bg-neutral-100 text-neutral-700'
                : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
            }`}
          >
            <span>{sourceLabel}</span>
            <ChevronDownIcon className={`w-3 h-3 transition-transform ${sourcesOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Mention */}
          <button
            onClick={() => {
              const el = textareaRef.current;
              if (!el) return;
              const pos = el.selectionStart ?? value.length;
              const newVal = value.slice(0, pos) + '@' + value.slice(pos);
              setValue(newVal);
              setMentionQuery('');
              setSelectedCategory(null);
              setMentionMode('categories');
              setMentionIndex(0);
              setTimeout(() => {
                el.focus();
                el.setSelectionRange(pos + 1, pos + 1);
              }, 0);
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
          >
            <AtSymbolIcon className="w-3.5 h-3.5" />
            Mention
          </button>

          {/* Attach */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
          >
            <PaperClipIcon className="w-3.5 h-3.5" />
            Attach
          </button>

          {/* Send */}
          <div className="ml-auto">
            {loading ? (
              <div className="w-7 h-7 rounded-full bg-neutral-200 flex items-center justify-center">
                <span className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-pulse" />
              </div>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!canSend}
                className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
              >
                <PaperAirplaneIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
