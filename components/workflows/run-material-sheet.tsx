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
// FILES, TOO (owner request, Oct 2 — v1 was "pasted text only", pointing a file elsewhere). The thing
// a person most often has is a file on their desk, so the sheet takes it HERE: each attached file
// uploads through POST /api/workflows/<id>/material-upload, which extracts and indexes it into the
// person's own Knowledge through THE ONE run-time ingest (lib/workflows/material-ingest.ts — the
// input station's attach rides the same function) and answers with the characters it read. The run
// door then reads each file's text from that row and carries it exactly like an arriving file's
// (`[WHAT IT CARRIED …]`). THREE HONESTIES: a file that could not be read says so ON ITS OWN ROW, in
// the server's own sentence, and blocks the run until it is removed (never a silent empty run); the
// Knowledge consequence is said BEFORE the pick; and a file attached then removed (or the sheet
// cancelled) is taken back — only what this door made, only while no run has used it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { Fragment, useEffect, useRef, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { DocumentTextIcon, ExclamationTriangleIcon, PaperClipIcon } from '@heroicons/react/24/outline';
// ONE CAP, ONE HOME: the ceiling the run door itself enforces (lib/workflows/inputs.ts) is the
// number this box counts against — a surface that invents its own limit lies about the other.
import { MATERIAL_MAX_CHARS } from '@/lib/workflows/inputs';
import {
  MATERIAL_ACCEPT, MATERIAL_FILES_MAX, MATERIAL_FILE_MAX_BYTES, MATERIAL_KINDS_SENTENCE,
  humanSize, materialMimeFor,
} from '@/lib/workflows/material-files';

/** What the run route accepts: `{ material: { text, name?, files? } }`. */
export type RunMaterial = { text: string; name?: string; files?: Array<{ kbFileId: string; name: string }> };

/** THE ONE BODY both mounts post to the run door — the `material` field exists only when the person
 *  gave something (text or at least one attached file). */
export function runRequestBody(material?: RunMaterial): string {
  return material && (material.text || material.files?.length) ? JSON.stringify({ material }) : '{}';
}

/** One attached file as the sheet holds it. `reading` = uploading + extracting; `failed` carries the
 *  server's own sentence. */
type HeldFile = {
  key: string;
  name: string;
  size: number;
  status: 'reading' | 'ready' | 'failed';
  kbFileId?: string;
  chars?: number;
  error?: string;
};

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
  open, workflowId, workflowName, acceptsMaterial, hasReactionDoors, busy, onRun, onClose,
}: {
  open: boolean;
  /** The workflow the run belongs to — the file door is keyed on it. */
  workflowId: string;
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
  const [files, setFiles] = useState<HeldFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Uploads land after the sheet may have closed — the generation guards a stale result. */
  const genRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    genRef.current += 1;
    setText('');
    setName('');
    setFiles([]);
    const t = setTimeout(() => areaRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open]);

  const trimmed = text.trim();
  const near = text.length > MATERIAL_MAX_CHARS * 0.9;
  const ready = files.filter((f) => f.status === 'ready' && f.kbFileId);
  const reading = files.some((f) => f.status === 'reading');
  const failed = files.some((f) => f.status === 'failed');
  const canRunWith = (trimmed.length > 0 || ready.length > 0) && !reading && !failed;

  /** Take back an upload this sheet made and no run used (the server keeps anything else). */
  const takeBack = (kbFileId?: string) => {
    if (!kbFileId || !workflowId) return;
    void fetch(`/api/workflows/${workflowId}/material-upload?kbFileId=${encodeURIComponent(kbFileId)}`, { method: 'DELETE' })
      .catch(() => { /* best-effort: the file stays a Knowledge document */ });
  };

  const patch = (key: string, next: Partial<HeldFile>) =>
    setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, ...next } : f)));

  const uploadOne = async (key: string, f: File, gen: number) => {
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch(`/api/workflows/${workflowId}/material-upload`, { method: 'POST', body: fd });
      const j = (await r.json().catch(() => null)) as { kbFileId?: string; name?: string; chars?: number; error?: string } | null;
      if (gen !== genRef.current) { takeBack(j?.kbFileId); return; }
      if (!r.ok || !j?.kbFileId) {
        patch(key, { status: 'failed', error: j?.error || `${f.name} did not go through — remove it and try again.` });
        return;
      }
      patch(key, { status: 'ready', kbFileId: j.kbFileId, name: j.name || f.name, chars: j.chars });
    } catch {
      if (gen === genRef.current) patch(key, { status: 'failed', error: `${f.name} did not go through — remove it and try again.` });
    }
  };

  /** Attach from the picker or a drop. Refusals the browser can already see (too big · a kind the
   *  extractor can't read · over the count) speak on the file's own row without a round-trip; the
   *  rest upload one at a time (each extraction is real work). */
  const attach = async (list: FileList | File[]) => {
    if (busy || !workflowId) return;
    const gen = genRef.current;
    const room = MATERIAL_FILES_MAX - files.length;
    const incoming = Array.from(list);
    const held: Array<{ held: HeldFile; file: File | null }> = incoming.map((f, i) => {
      const key = `${Date.now()}-${i}-${f.name}`;
      const base = { key, name: f.name, size: f.size };
      if (i >= room) return { held: { ...base, status: 'failed', error: `One run takes up to ${MATERIAL_FILES_MAX} files — remove this one.` }, file: null };
      if (f.size > MATERIAL_FILE_MAX_BYTES) {
        return { held: { ...base, status: 'failed', error: `${f.name} is ${humanSize(f.size)} — this box takes up to ${humanSize(MATERIAL_FILE_MAX_BYTES)} a file.` }, file: null };
      }
      if (!materialMimeFor(f)) {
        return { held: { ...base, status: 'failed', error: `I can't read ${f.name}. Attach a ${MATERIAL_KINDS_SENTENCE} file — or paste it.` }, file: null };
      }
      return { held: { ...base, status: 'reading' }, file: f };
    });
    setFiles((prev) => [...prev, ...held.map((h) => h.held)]);
    for (const h of held) {
      if (!h.file) continue;
      if (gen !== genRef.current) return;
      await uploadOne(h.held.key, h.file, gen);
    }
  };

  const remove = (f: HeldFile) => {
    setFiles((prev) => prev.filter((x) => x.key !== f.key));
    if (f.status === 'ready') takeBack(f.kbFileId);
  };

  /** Every way out that is NOT a run takes back what was uploaded for it. */
  const dismiss = () => {
    if (busy) return;
    genRef.current += 1;
    for (const f of files) if (f.status === 'ready') takeBack(f.kbFileId);
    onClose();
  };

  const runWith = () => {
    if (!canRunWith) return;
    genRef.current += 1; // the files are the run's now — nothing below takes them back
    void onRun({
      text: trimmed,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(ready.length ? { files: ready.map((f) => ({ kbFileId: f.kbFileId!, name: f.name })) } : {}),
    });
  };

  /** The plain run carries nothing — anything uploaded for it goes back. */
  const runPlain = () => {
    genRef.current += 1;
    for (const f of files) if (f.status === 'ready') takeBack(f.kbFileId);
    void onRun();
  };

  // The lead says which of the two reasons put this door here — the user should never have to
  // guess why they are being asked.
  const lead = hasReactionDoors
    ? `"${workflowName}" normally starts from something that arrives. Paste or attach what it should work on and this run behaves like the real one.`
    : acceptsMaterial
      ? `"${workflowName}" accepts material at run time. Paste or attach what this run should work on.`
      : `Give this run something to work on, or start it plain.`;

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={dismiss}>
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
              <Dialog.Panel
                className={`w-full max-w-md bg-white rounded-2xl shadow-xl border p-5 space-y-4 transition-colors ${dragOver ? 'border-indigo-400' : 'border-neutral-200'}`}
                onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  if (!e.dataTransfer?.files?.length) return;
                  e.preventDefault(); setDragOver(false);
                  void attach(e.dataTransfer.files);
                }}
              >
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
                    onKeyDown={(e) => { if (e.key === 'Escape') dismiss(); }}
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
                    onKeyDown={(e) => { if (e.key === 'Escape') dismiss(); }}
                    rows={7}
                    placeholder="Paste the text this run should work on — or attach files below…"
                    className="w-full text-[13px] rounded-lg border border-neutral-300 focus:border-indigo-400 focus:outline-none px-3 py-2 bg-white resize-y leading-relaxed"
                  />
                </div>

                <div>
                  {/* THE ONE FILE INPUT in this sheet — hidden, opened by the affordance below (house pattern). */}
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept={MATERIAL_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const picked = e.target.files ? Array.from(e.target.files) : [];
                      e.target.value = '';
                      if (picked.length) void attach(picked);
                    }}
                  />
                  {files.length > 0 && (
                    <ul className="mb-2 space-y-1.5">
                      {files.map((f) => (
                        <li key={f.key} className={`rounded-lg border px-3 py-2 ${f.status === 'failed' ? 'border-red-200 bg-red-50/40' : 'border-neutral-200 bg-white'}`}>
                          <div className="flex items-center gap-2">
                            {f.status === 'failed'
                              ? <ExclamationTriangleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                              : <DocumentTextIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />}
                            <span className="flex-1 truncate text-[12.5px] text-neutral-700" title={f.name}>{f.name}</span>
                            {f.status === 'reading' ? (
                              <span className="text-[12px] text-neutral-400 animate-pulse motion-reduce:animate-none">Reading it…</span>
                            ) : (
                              <>
                                {f.status === 'ready' && typeof f.chars === 'number' && (
                                  <span className="text-[11px] text-neutral-400 tabular-nums">{f.chars.toLocaleString()} characters read</span>
                                )}
                                <button
                                  type="button" onClick={() => remove(f)} disabled={busy}
                                  className="text-[12px] text-neutral-400 hover:text-neutral-700 disabled:opacity-40"
                                >
                                  Remove
                                </button>
                              </>
                            )}
                          </div>
                          {f.status === 'failed' && f.error && (
                            <p className="mt-1 text-[11.5px] text-red-600 leading-snug">{f.error}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {files.length < MATERIAL_FILES_MAX && (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-500 hover:text-indigo-600 disabled:opacity-40 transition-colors"
                    >
                      <PaperClipIcon className="w-3.5 h-3.5" />
                      {files.length ? 'Attach another file' : 'Attach files'}
                    </button>
                  )}
                  {/* Said BEFORE the pick — indexing into Knowledge is a consequence, not a footnote. */}
                  <p className="mt-1.5 text-[10.5px] text-neutral-400 leading-snug">
                    {MATERIAL_KINDS_SENTENCE} files, up to {humanSize(MATERIAL_FILE_MAX_BYTES)} each and {MATERIAL_FILES_MAX} per run.
                    {' '}An attached file is saved to your Knowledge too, so the team can find it later.
                  </p>
                  {failed && (
                    <p className="mt-1 text-[11.5px] text-red-600 leading-snug">
                      Remove the file that couldn&rsquo;t be read to run with the rest.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-0.5">
                  <button
                    type="button" onClick={dismiss} disabled={busy}
                    className="text-[13px] text-neutral-500 hover:text-neutral-700 px-3 py-1.5 disabled:opacity-40 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button" disabled={busy || reading}
                    onClick={runPlain}
                    className="text-[13px] font-medium text-neutral-700 bg-white border border-neutral-300 hover:bg-neutral-50 rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors"
                  >
                    Run without material
                  </button>
                  <button
                    type="button" disabled={busy || !canRunWith}
                    onClick={runWith}
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
