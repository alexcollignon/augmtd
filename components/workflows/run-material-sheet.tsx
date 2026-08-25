'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MATERIAL DOOR (THE RELAY CANVAS, W2 — docs/relay-canvas-plan.md, law 7)
//
// A workflow that normally starts from something that ARRIVES (a reaction door) had no honest way
// to be run by hand: Run-now fired it with nothing to work on, so the refusal sentence had to
// carry the apology. This sheet is the door — one modal, mounted by BOTH run affordances (the
// deep-dive header and the ledger row's play button), so "run it with this" is the same act
// wherever it is asked for.
//
// THREE ORDERING RULES, deliberate:
//   1. READINESS SPEAKS FIRST. An unready workflow toasts its served reason and never sheets —
//      the sheet is a door onto a run that CAN happen, never a detour around a refusal.
//   2. NO NEW FRICTION ON PLAIN WORKFLOWS. The sheet opens only when the workflow has reaction
//      doors or accepts material; everything else keeps its one-click Run exactly as it was.
//   3. "Run without material" is always present — opening the door never traps the plain run.
//   4. THE STATIONS ASK BY NAME (owner walk, Aug 25). A workflow carrying an ⌨ INPUT STATION never
//      sees this sheet at all — `asksForMaterial` returns false for it at BOTH mounts, so the run
//      starts and the station asks, by name, in the panel. That also settles the footer line
//      below ("for a file, upload it to Knowledge…"): a station's card has a real pin-a-document
//      door, so the sentence pointing elsewhere is structurally unreachable where it would lie.
//
// v1 IS HONEST ABOUT ITSELF: pasted text only. A file would have to be extracted somewhere, and
// the place that already extracts, indexes and remembers files is Knowledge — so the sheet says
// so plainly rather than growing a second, weaker extraction path.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { Fragment, useEffect, useRef, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { PaperClipIcon } from '@heroicons/react/24/outline';
// ONE CAP, ONE HOME: the ceiling the run door itself enforces (lib/workflows/inputs.ts) is the
// number this box counts against — a surface that invents its own limit lies about the other.
import { MATERIAL_MAX_CHARS } from '@/lib/workflows/inputs';

/** What the run route accepts: `{ material: { text, name? } }`. */
export type RunMaterial = { text: string; name?: string };

/**
 * THE ONE PREDICATE both mounts read — a workflow "asks" for material when it has an event door
 * (running it by hand is otherwise a hollow test) or when its inputs tray says it accepts some.
 * Absent config answers false: a surface that was served nothing claims nothing.
 *
 * THE STATIONS ASK BY NAME (owner walk, Aug 25). A workflow carrying ≥1 ⌨ INPUT STATION already
 * has a door for "what should this run work on" — and a far better one: the station names what it
 * wants, at the moment the run needs it, in the panel. This generic sheet knows NONE of that; it
 * asks "what is this?" about a run whose own steps are about to ask precisely. So a station-bearing
 * workflow SKIPS the sheet entirely and runs — the wave does the asking. One rule, one place: both
 * Run-now mounts read this predicate, so neither can drift from the other.
 */
export function asksForMaterial(o: {
  acceptsMaterial?: boolean | null;
  hasReactionDoors?: boolean | null;
  /** ≥1 `input` step in the workflow's steps. Unserved (undefined) keeps today's behaviour. */
  hasInputStations?: boolean | null;
}): boolean {
  if (o.hasInputStations === true) return false;
  return o.acceptsMaterial === true || o.hasReactionDoors === true;
}

export default function RunMaterialSheet({
  open, workflowName, acceptsMaterial, hasReactionDoors, busy, onRun, onClose,
}: {
  open: boolean;
  workflowName: string;
  acceptsMaterial?: boolean | null;
  hasReactionDoors?: boolean | null;
  busy?: boolean;
  /** Called with the material, or with nothing for the plain run. Closing is the caller's job. */
  onRun: (material?: RunMaterial) => void | Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setText('');
    setName('');
    const t = setTimeout(() => areaRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open]);

  const trimmed = text.trim();
  const near = text.length > MATERIAL_MAX_CHARS * 0.9;

  // The lead says which of the two reasons put this door here — the user should never have to
  // guess why they are being asked.
  const lead = hasReactionDoors
    ? `"${workflowName}" normally starts from something that arrives. Paste what it should work on and this run behaves like the real one.`
    : acceptsMaterial
      ? `"${workflowName}" accepts material at run time. Paste what this run should work on.`
      : `Give this run something to work on, or start it plain.`;

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => { if (!busy) onClose(); }}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-150" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-150" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-100" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-neutral-200 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <PaperClipIcon className="w-4 h-4 text-neutral-500" />
                  <Dialog.Title className="text-[14px] font-semibold text-neutral-900">Run with material</Dialog.Title>
                </div>

                <p className="text-[12px] text-neutral-500 leading-snug">{lead}</p>

                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                    What is this?
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, 120))}
                    onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
                    placeholder="e.g. the message it should work from"
                    className="w-full text-[13px] rounded-lg border border-neutral-300 focus:border-indigo-400 focus:outline-none px-3 py-2 bg-white"
                  />
                </div>

                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <label className="block text-[11px] font-medium text-neutral-500 uppercase tracking-wide">
                      The material
                    </label>
                    <span className={`text-[10.5px] tabular-nums ${near ? 'text-amber-600' : 'text-neutral-400'}`}>
                      {text.length.toLocaleString()} / {MATERIAL_MAX_CHARS.toLocaleString()}
                    </span>
                  </div>
                  <textarea
                    ref={areaRef}
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, MATERIAL_MAX_CHARS))}
                    onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
                    rows={7}
                    placeholder="Paste the text this run should work on…"
                    className="w-full text-[13px] rounded-lg border border-neutral-300 focus:border-indigo-400 focus:outline-none px-3 py-2 bg-white resize-y leading-relaxed"
                  />
                  <p className="mt-1.5 text-[10.5px] text-neutral-400 leading-snug">
                    Text only for now — for a file, upload it to Knowledge and pin it to this workflow in Studio.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-0.5">
                  <button
                    type="button" onClick={onClose} disabled={busy}
                    className="text-[13px] text-neutral-500 hover:text-neutral-700 px-3 py-1.5 disabled:opacity-40 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button" disabled={busy}
                    onClick={() => void onRun()}
                    className="text-[13px] font-medium text-neutral-700 bg-white border border-neutral-300 hover:bg-neutral-50 rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors"
                  >
                    Run without material
                  </button>
                  <button
                    type="button" disabled={busy || trimmed.length === 0}
                    onClick={() => void onRun({ text: trimmed, ...(name.trim() ? { name: name.trim() } : {}) })}
                    className="text-[13px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-1.5 disabled:opacity-40 transition-colors"
                  >
                    {busy ? '…' : 'Run with this'}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
