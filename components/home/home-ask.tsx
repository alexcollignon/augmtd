'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ASK ZONE — the entry to the brain, at the bottom of the Home below the cards. The reasoned brief
// is its opening context (turn-0); a grounded conversation grows in place below it; a composer with
// state-derived suggested prompts anchors the bottom. Answers are grounded in the ONE registry and cite
// the items they used (chips → the deep-dive). No persona name — the system's own voice (the AUGMTD orb).
// Phase 1: single in-session thread ("New" clears it); History / multi-thread + inline actions come next.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { BriefingBlock, type Briefing, type BriefingRef } from '@/components/briefing/briefing-view';

type Ref = { id: string; kind: string; label: string; href: string | null };
type Turn = { role: 'user' | 'assistant'; text: string; refs?: Ref[] };

// Split answer text on [E#]/[C#]/[R#] tags → inline chips that open the referenced item.
function Answer({ text, refs, onOpen }: { text: string; refs: Ref[]; onOpen: (r: Ref) => void }) {
  const byTag = new Map<string, Ref>(); // tags aren't returned per-position; map label order is enough — resolve by index tag
  // The model emits [E1]/[C2]/[R3]; refs are the resolved items in use-order. Build a tag→ref best-effort.
  const parts: React.ReactNode[] = [];
  const re = /\[([ECRF]\d+)\]/g;
  let last = 0, m: RegExpExecArray | null, k = 0, refIdx = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`t${k++}`}>{text.slice(last, m.index)}</span>);
    const r = refs[refIdx] ?? null; refIdx++;
    if (r) parts.push(<button key={`r${k++}`} onClick={() => onOpen(r)} className="inline font-medium text-indigo-700 hover:underline decoration-indigo-300 underline-offset-2">{r.label}</button>);
    last = m.index + m[0].length;
    void byTag;
  }
  if (last < text.length) parts.push(<span key={`t${k++}`}>{text.slice(last)}</span>);
  return <p className="text-[14px] text-neutral-700 leading-[1.7]">{parts}</p>;
}

export default function HomeAsk({ briefing, clearedIds, onBriefNavigate, suggestions }: {
  briefing: Briefing | null; clearedIds: Set<string>; onBriefNavigate: (r: BriefingRef) => void; suggestions: string[];
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns.length, busy]);

  const openRef = (r: Ref | BriefingRef) => { if ('href' in r && r.href) router.push(r.href); };

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput('');
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((prev) => [...prev, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const res = await fetch('/api/home/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history }) });
      const d = await res.json();
      setTurns((prev) => [...prev, { role: 'assistant', text: d.answer || "I couldn't answer that just now.", refs: d.refs ?? [] }]);
    } catch {
      setTurns((prev) => [...prev, { role: 'assistant', text: "Something went wrong reaching your brain — try again." }]);
    } finally { setBusy(false); }
  };

  const hasThread = turns.length > 0;
  // GRANOLA-STYLE PROGRESSIVE REVEAL: at rest = pills + input only; HOVER slides in a 2-line brief
  // preview; FOCUS (or a live thread) opens the full brief + conversation. One smooth max-height motion.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const expanded = focused || hasThread;
  return (
    // Fills the remaining height so the composer can OWN the bottom. No label, no card chrome — the brief
    // reads as the opening message and the whole thing is one continuous surface, full width like the cards.
    <section className="flex flex-col flex-1 min-h-0 w-full" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* The brief — the opening message of the conversation (flat: no "Read the brief", minimal prose).
          A quiet "New" affordance appears at the top-right once a thread is going. */}
      {(briefing || hasThread) && (
        <div
          className="relative overflow-hidden transition-all duration-300 ease-out"
          style={{ maxHeight: expanded ? 1400 : hovered ? 68 : 0, opacity: expanded || hovered ? 1 : 0 }}
        >
          {hasThread && (
            <button onClick={() => setTurns([])} className="absolute -top-1 right-0 inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-400 hover:text-neutral-700 transition-colors">
              <ArrowPathIcon className="w-3.5 h-3.5" /> New
            </button>
          )}
          {briefing && <BriefingBlock briefing={briefing} clearedIds={clearedIds} onNavigate={onBriefNavigate} flat />}
          {/* Preview fade — the 2-line hover state dissolves at its edge; gone once fully open. */}
          {!expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-[#fbfbfd] to-transparent" />}
        </div>
      )}

      {/* The conversation — grows in place (one surface). User = subtle right pill; answer = plain text. */}
      {hasThread && (
        <div className="space-y-4 mt-5">
          {turns.map((t, i) => (
            t.role === 'user' ? (
              <div key={i} className="flex justify-end"><span className="rounded-2xl rounded-br-sm bg-neutral-100 px-3.5 py-2 text-[13.5px] text-neutral-800 max-w-[80%]">{t.text}</span></div>
            ) : (
              <div key={i} className="pr-2"><Answer text={t.text} refs={t.refs ?? []} onOpen={openRef} /></div>
            )
          ))}
          {busy && <div className="flex items-center gap-1.5 text-[13px] text-neutral-400"><span className="w-1.5 h-1.5 rounded-full bg-indigo-300 animate-pulse" />Thinking…</div>}
          <div ref={endRef} />
        </div>
      )}

      {/* Composer — anchored to the BOTTOM and STICKY. mt-auto eats the slack on a short page so it sits at
          the viewport floor; sticky bottom-0 keeps it pinned while a long conversation scrolls under it. A
          page-colored top fade blends the content dissolving beneath it. Chips only when the thread is
          empty (never a blank box). */}
      <div className="mt-auto sticky bottom-0 z-20 pt-8 pb-5 bg-gradient-to-t from-[#fbfbfd] via-[#fbfbfd] to-transparent">
        {!hasThread && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {suggestions.map((s) => (
              <button key={s} onClick={() => ask(s)} disabled={busy} className="rounded-full border border-neutral-200 bg-white/80 px-3 py-1.5 text-[12px] text-neutral-600 hover:border-indigo-300 hover:text-indigo-700 hover:bg-white transition-all duration-150">{s}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-3.5 py-2.5 shadow-[0_4px_28px_-12px_rgba(23,23,23,0.22)] focus-within:border-indigo-300 focus-within:shadow-[0_4px_32px_-10px_rgba(79,70,229,0.28)] transition-all duration-200">
          <input
            value={input} onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
            placeholder="Ask anything about your work…"
            className="flex-1 bg-transparent text-[14px] text-neutral-800 placeholder:text-neutral-400 outline-none py-1"
          />
          <button onClick={() => ask(input)} disabled={!input.trim() || busy} className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 disabled:hover:bg-indigo-600 text-white transition-colors">
            <ArrowUpIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
