'use client';

import { useEffect, useRef, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PEOPLE TYPEAHEAD (Aug 4) — every people field suggests KNOWN contacts as you type, grounded
// in the user's own correspondence (relationship graph + real mail), never invented. ONE input;
// the invite's attendees and the forward's recipients both mount it.
//
// Lifted out of item-detail.tsx when the invite card moved to the thread kit (Sep 8): two hosts
// needed the same editor, and a second copy is how two "identical" people fields start behaving
// differently. The behavior is byte-for-byte the donor's.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export function PeopleSuggestInput({ placeholder, onPick }: { placeholder: string; onPick: (email: string) => void }) {
  const [input, setInput] = useState('');
  const [sugs, setSugs] = useState<Array<{ email: string; name: string | null }>>([]);
  const [hi, setHi] = useState(0); // highlighted row
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = input.trim();
    if (q.length < 2 || q.includes('@') && q.split('@')[1]?.includes('.')) { setSugs([]); return; }
    debounceRef.current = setTimeout(() => {
      fetch(`/api/people/suggest?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (Array.isArray(d?.people)) { setSugs(d.people); setHi(0); } })
        .catch(() => {});
    }, 220);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [input]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setSugs([]); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  // AN EDITOR NEVER SWALLOWS WHAT WAS TYPED (owner, Sep 9 — the card-editor wave's consistency
  // rule): closing the editor unmounts this input, and an unmount fires no blur, so a finished
  // address the user had not pressed Enter on used to vanish. It commits on the way out instead.
  const liveRef = useRef({ input, onPick });
  liveRef.current = { input, onPick };
  useEffect(() => () => {
    const v = liveRef.current.input.trim();
    if (v.includes('@')) liveRef.current.onPick(v);
  }, []);

  const pick = (email: string) => { onPick(email); setInput(''); setSugs([]); };
  const commitFree = () => {
    const v = input.trim();
    if (v && v.includes('@')) { onPick(v); setInput(''); setSugs([]); }
    else if (!v) setSugs([]);
  };
  return (
    <div ref={boxRef} className="relative min-w-[140px] flex-1">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && sugs.length) { e.preventDefault(); setHi((h) => Math.min(h + 1, sugs.length - 1)); }
          else if (e.key === 'ArrowUp' && sugs.length) { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if ((e.key === 'Enter' || e.key === ',')) {
            e.preventDefault();
            if (sugs.length) pick(sugs[hi]?.email ?? sugs[0].email); else commitFree();
          } else if (e.key === 'Escape') setSugs([]);
        }}
        onBlur={() => setTimeout(commitFree, 150)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[12.5px] text-neutral-800 placeholder:text-neutral-300 focus:outline-none py-0.5"
      />
      {sugs.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-30 w-72 max-w-[80vw] rounded-lg border border-neutral-200 bg-white shadow-lg py-1">
          {sugs.map((s, i) => (
            <button
              key={s.email}
              onMouseDown={(e) => { e.preventDefault(); pick(s.email); }}
              onMouseEnter={() => setHi(i)}
              className={`w-full text-left px-3 py-1.5 ${i === hi ? 'bg-indigo-50' : ''}`}
            >
              <span className="block text-[12.5px] text-neutral-800 truncate">{s.name || s.email}</span>
              {s.name && <span className="block text-[11.5px] text-neutral-400 truncate">{s.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The editable invite chips (attendees) — typeahead over known people, remove via ✕. Never invents. */
export function AttendeeChips({ attendees, onChange }: { attendees: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attendees.map((a) => (
        <span key={a} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 pl-2.5 pr-1.5 py-0.5 text-[11.5px] text-neutral-700">
          {a}
          <button onClick={() => onChange(attendees.filter((x) => x !== a))} className="hover:text-rose-500 transition-colors" aria-label={`Remove ${a}`}>
            <XMarkIcon className="w-3 h-3" />
          </button>
        </span>
      ))}
      <PeopleSuggestInput
        placeholder={attendees.length ? 'Add another…' : 'attendee@email.com'}
        onPick={(email) => { if (!attendees.includes(email)) onChange([...attendees, email]); }}
      />
    </div>
  );
}
