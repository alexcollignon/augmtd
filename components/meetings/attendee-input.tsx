'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

export interface AttendeeChip {
  email: string;
  name?: string;
}

interface Suggestion {
  email: string;
  name?: string;
}

interface AttendeeInputProps {
  value: AttendeeChip[];
  onChange: (attendees: AttendeeChip[]) => void;
  compact?: boolean;
  placeholder?: string;
  noBorder?: boolean;
}

function avatarLetter(chip: AttendeeChip) {
  return (chip.name || chip.email)[0].toUpperCase();
}

function avatarColor(email: string) {
  const colors = [
    'bg-indigo-100 text-indigo-700',
    'bg-violet-100 text-violet-700',
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
  ];
  let hash = 0;
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function AttendeeInput({ value, onChange, compact = false, placeholder = 'Add attendees…', noBorder = false }: AttendeeInputProps) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback((q: string) => {
    if (q.length < 2) { setSuggestions([]); setShowDropdown(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts/suggest?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const filtered = (data.contacts ?? []).filter(
          (s: Suggestion) => !value.some(v => v.email.toLowerCase() === s.email.toLowerCase())
        );
        setSuggestions(filtered);
        setShowDropdown(filtered.length > 0);
        setActiveIdx(-1);
      } catch { /* ignore */ }
    }, 200);
  }, [value]);

  useEffect(() => {
    fetchSuggestions(input);
  }, [input, fetchSuggestions]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addAttendee = (chip: AttendeeChip) => {
    const email = chip.email.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (value.some(v => v.email.toLowerCase() === email)) {
      setInput(''); setSuggestions([]); setShowDropdown(false); return;
    }
    onChange([...value, { email, name: chip.name }]);
    setInput(''); setSuggestions([]); setShowDropdown(false);
  };

  const removeAttendee = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showDropdown && suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); return; }
      if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); addAttendee(suggestions[activeIdx]); return; }
      if (e.key === 'Escape') { setShowDropdown(false); return; }
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (input.trim()) { e.preventDefault(); addAttendee({ email: input.trim() }); }
    }
    if (e.key === 'Backspace' && input === '' && value.length > 0) {
      removeAttendee(value.length - 1);
    }
  };

  const chipSize = compact ? 'text-[10px] h-5 px-1.5 gap-1' : 'text-[11px] h-6 px-2 gap-1.5';
  const avatarSize = compact ? 'w-3.5 h-3.5 text-[8px]' : 'w-4 h-4 text-[9px]';
  const inputSize = compact ? 'text-[12px]' : 'text-[13px]';

  return (
    <div ref={containerRef} className="relative">
      <div
        className={noBorder
          ? `flex flex-wrap items-center gap-1 cursor-text min-h-[28px] flex-1`
          : `flex flex-wrap gap-1 ${compact ? 'p-1.5' : 'p-2'} border border-neutral-200 rounded-md cursor-text focus-within:border-indigo-400 transition-colors bg-white min-h-[36px]`}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((chip, idx) => (
          <span
            key={idx}
            className={`inline-flex items-center ${chipSize} rounded-full bg-neutral-100 text-neutral-700 font-medium max-w-[180px]`}
          >
            <span className={`inline-flex items-center justify-center rounded-full font-semibold flex-shrink-0 ${avatarSize} ${avatarColor(chip.email)}`}>
              {avatarLetter(chip)}
            </span>
            <span className="truncate">{chip.name || chip.email}</span>
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); removeAttendee(idx); }}
              className="flex-shrink-0 text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              <XMarkIcon className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => input.length >= 2 && suggestions.length > 0 && setShowDropdown(true)}
          placeholder={value.length === 0 ? placeholder : ''}
          className={`flex-1 min-w-[120px] outline-none bg-transparent ${inputSize} placeholder:text-neutral-400`}
        />
      </div>

      {/* Suggestions dropdown */}
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-neutral-200 rounded-md shadow-lg overflow-hidden">
          {suggestions.map((s, idx) => (
            <button
              key={s.email}
              type="button"
              onMouseDown={e => { e.preventDefault(); addAttendee(s); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                idx === activeIdx ? 'bg-indigo-50' : 'hover:bg-neutral-50'
              }`}
            >
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold flex-shrink-0 ${avatarColor(s.email)}`}>
                {(s.name || s.email)[0].toUpperCase()}
              </span>
              <div className="min-w-0">
                {s.name && <div className="text-[12px] font-medium text-neutral-800 truncate">{s.name}</div>}
                <div className={`truncate ${s.name ? 'text-[11px] text-neutral-500' : 'text-[12px] text-neutral-800'}`}>{s.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
