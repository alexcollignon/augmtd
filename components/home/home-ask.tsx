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
// (BriefingBlock removed from the chat — Phase 3 F2: the prose brief duplicated the deck; the
// composeBriefing machinery survives as the deck's ordering anchor + the daily report.)

type Ref = { id: string; kind: string; label: string; href: string | null };
type Turn = { role: 'user' | 'assistant'; text: string; refs?: Ref[] };

// TYPEWRITER — the same streaming feel as the coworker chats. The answer arrives whole (JSON + refs need
// the full text), so we REVEAL it progressively: ~3 chars/frame, a partial trailing [ref tag is trimmed
// so raw tags never flash mid-reveal. Only the newest assistant turn animates; history renders static.
function useTypewriter(full: string, active: boolean): string {
  const [len, setLen] = useState(active ? 0 : full.length);
  useEffect(() => {
    if (!active) { setLen(full.length); return; }
    setLen(0);
    const iv = window.setInterval(() => {
      setLen((l) => { const n = Math.min(full.length, l + 3); if (n >= full.length) window.clearInterval(iv); return n; });
    }, 16);
    return () => window.clearInterval(iv);
  }, [full, active]);
  return full.slice(0, len).replace(/\[[ECRF]?\d*(?:\s*,\s*[ECRF]?\d*)*$/, '');
}

// Split answer text on [E#]/[C#]/[R#] tags → inline chips that open the referenced item.
function AnimatedAnswer({ text, refs, onOpen, animate }: { text: string; refs: Ref[]; onOpen: (r: Ref) => void; animate: boolean }) {
  const shown = useTypewriter(text, animate);
  return <Answer text={shown} refs={refs} onOpen={onOpen} />;
}

function Answer({ text, refs, onOpen }: { text: string; refs: Ref[]; onOpen: (r: Ref) => void }) {
  // FORMATTING GUARDS: the renderer is plain-prose — strip any markdown the model leaks, and
  // SEPARATE adjacent refs with " · ". Refs resolve by emit order ACROSS paragraphs. Structure:
  // blank lines split the answer into real spaced paragraphs (never one massive block).
  const clean = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1').replace(/^#+\s*/gm, '');
  // Grouped tags ("[E34, E35, E36]") are tolerated — one chip per id, refs consumed in order.
  const re = /\[([ECRF]\d+(?:\s*,\s*[ECRF]\d+)*)\]/g;
  let k = 0, refIdx = 0;
  const renderPara = (para: string) => {
    const parts: React.ReactNode[] = [];
    let last = 0, m: RegExpExecArray | null, prevWasRef = false;
    re.lastIndex = 0;
    while ((m = re.exec(para)) !== null) {
      if (m.index > last) { parts.push(<span key={`t${k++}`}>{para.slice(last, m.index)}</span>); prevWasRef = false; }
      const ids = m[1].split(/\s*,\s*/);
      for (const _id of ids) {
        if (prevWasRef) parts.push(<span key={`s${k++}`} className="text-neutral-300"> · </span>);
        const r = refs[refIdx] ?? null; refIdx++;
        if (r) { parts.push(<button key={`r${k++}`} onClick={() => onOpen(r)} className="inline font-medium text-indigo-700 hover:underline decoration-indigo-300 underline-offset-2">{r.label}</button>); prevWasRef = true; }
      }
      last = m.index + m[0].length;
    }
    if (last < para.length) parts.push(<span key={`t${k++}`}>{para.slice(last)}</span>);
    return parts;
  };
  const paras = clean.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return (
    <div className="space-y-2.5">
      {paras.map((para, i) => (
        <p key={i} className="text-[13.5px] text-neutral-700 leading-[1.7] whitespace-pre-line">{renderPara(para)}</p>
      ))}
    </div>
  );
}

export default function HomeAsk({ suggestions }: { suggestions: string[] }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Which assistant turn TYPES in live (only the newest — history never re-animates). Staged via a
  // ref from the setTurns updater (no setState-in-updater), committed by the effect below.
  const [animateIdx, setAnimateIdx] = useState<number | null>(null);
  const pendingAnimate = useRef<number | null>(null);
  useEffect(() => {
    if (pendingAnimate.current !== null) { setAnimateIdx(pendingAnimate.current); pendingAnimate.current = null; }
  }, [turns.length]);
  // Pin to the latest turn — CONTAINER-scoped (never scrolls the page), on new turns AND on open
  // (the grid transition needs a beat before the height is real).
  const pinToEnd = () => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => { pinToEnd(); const tm = window.setTimeout(pinToEnd, 320); return () => window.clearTimeout(tm); }, [turns.length, busy]);
  // While the newest answer TYPES, keep the container pinned to the growing text.
  useEffect(() => {
    if (animateIdx === null) return;
    let raf = 0; const start = performance.now();
    const tick = (now: number) => { pinToEnd(); if (now - start < 6000) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animateIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRef = (r: Ref) => { if ('href' in r && r.href) router.push(r.href); };

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
      setTurns((prev) => { pendingAnimate.current = prev.length; return [...prev, { role: 'assistant', text: d.answer || "I couldn't answer that just now.", refs: d.refs ?? [] }]; });
    } catch {
      setTurns((prev) => [...prev, { role: 'assistant', text: "Something went wrong reaching your brain — try again." }]);
    } finally { setBusy(false); }
  };

  const hasThread = turns.length > 0;
  // GRANOLA PANEL (v2): at rest = pills + input only. HOVER (the chat block ONLY — not the page) slides a
  // 2-line brief preview in TIGHT above the composer. FOCUS or a live thread morphs the block into an
  // ELEVATED CARD (border + surface + shadow) holding brief → conversation → composer. One smooth motion.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // The panel's OPEN state is explicit: focusing the input opens it; clicking OUTSIDE closes it smoothly.
  // The conversation STATE persists (component state) — reopening restores it; a reload or "New" clears.
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (shellRef.current && !shellRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  const expanded = focused || open;
  const showThread = hasThread && (expanded || hovered);
  // Re-pin to the latest turn when the thread reveals (the grid transition needs a beat).
  useEffect(() => { const tm = window.setTimeout(pinToEnd, 320); return () => window.clearTimeout(tm); }, [showThread]); // eslint-disable-line react-hooks/exhaustive-deps
  // THE CHAT CARD (final): standard chat anatomy — the CONVERSATION ABOVE, the INPUT AT THE BOTTOM
  // of the card. At rest the card is just the input (top of the page); when a conversation starts,
  // the thread SMOOTHLY expands above it (grid-rows transition — the same Collapse idiom), the
  // input stays put as the card's floor, and the scroll container pins to the latest turn.
  return (
    <section className="w-full">
      <div ref={shellRef} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        className={`transition-all duration-300 ease-out ${showThread ? 'rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_40px_-18px_rgba(23,23,23,0.16)] p-4' : ''}`}>
        {/* The thread — above the input, smooth open/close (grid-rows), bounded + self-scrolling. */}
        <div className={`grid transition-all duration-300 ease-out ${showThread ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden min-h-0">
            <div className="flex items-center justify-end mb-1">
              <button onClick={() => setTurns([])} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-neutral-400 hover:text-neutral-700 transition-colors">
                <ArrowPathIcon className="w-3.5 h-3.5" /> New
              </button>
            </div>
            <div ref={scrollRef} className="space-y-4 max-h-[38vh] overflow-y-auto [scrollbar-width:thin] pr-1 pb-3">
              {turns.map((t, i) => (
                t.role === 'user' ? (
                  <div key={i} className="flex justify-end"><span className="rounded-2xl rounded-br-sm bg-neutral-100 px-3.5 py-2 text-[13.5px] text-neutral-800 max-w-[80%]">{t.text}</span></div>
                ) : (
                  <div key={i} className="pr-2"><AnimatedAnswer text={t.text} refs={t.refs ?? []} onOpen={openRef} animate={i === animateIdx} /></div>
                )
              ))}
              {busy && <div className="flex items-center gap-1.5 text-[13px] text-neutral-400"><span className="w-1.5 h-1.5 rounded-full bg-indigo-300 animate-pulse" />Thinking…</div>}
              <div ref={endRef} />
            </div>
          </div>
        </div>
        {/* The input — the card's FLOOR, never moves once a conversation is live. */}
        <div className={`flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 transition-all duration-300 ${showThread
          ? 'border-neutral-200 bg-neutral-50/70 focus-within:border-indigo-300'
          : 'border-neutral-200 bg-white shadow-[0_4px_28px_-12px_rgba(23,23,23,0.22)] focus-within:border-indigo-300 focus-within:shadow-[0_4px_32px_-10px_rgba(79,70,229,0.28)]'}`}>
          <input
            value={input} onChange={(e) => setInput(e.target.value)}
            onFocus={() => { setFocused(true); setOpen(true); }} onBlur={() => setFocused(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
            placeholder="Ask anything about your work…"
            className="flex-1 bg-transparent text-[14px] text-neutral-800 placeholder:text-neutral-400 outline-none py-1"
          />
          <button onClick={() => ask(input)} disabled={!input.trim() || busy} className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 disabled:hover:bg-indigo-600 text-white transition-colors">
            <ArrowUpIcon className="w-4 h-4" />
          </button>
        </div>
        {!hasThread && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {suggestions.map((s) => (
              // A trailing "…" chip PREFILLS the composer (a fill-in verb like "Add a task…");
              // everything else asks immediately.
              <button key={s} onClick={() => (s.endsWith('…') ? setInput(s.slice(0, -1) + ' ') : ask(s))} disabled={busy} className="rounded-full border border-neutral-200 bg-white/80 px-3 py-1.5 text-[12px] text-neutral-600 hover:border-indigo-300 hover:text-indigo-700 hover:bg-white transition-all duration-150">{s}</button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
