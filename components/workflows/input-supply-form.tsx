'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SUPPLY FORM (relay canvas, THE WAVE — owner walk, Aug 25: "why are we sending him to another
// screen").
//
// A parked run asking for something only this person has. THE GATE CARRIES ITS DEED: wherever the
// ask is SHOWN, the answering must be possible — the process drawer's station card used to show
// the ask and then hand out a link to a different screen, which is the disconnected-door class.
// So the deed itself is ONE component, mounted at BOTH doors:
//   • the process drawer's input station (components/workflows/process-drawer.tsx)
//   • the commitment deep-dive's InputStationCard (components/home/item-detail.tsx)
// A second paste box anywhere is a fork of this law — the gate suite greps for exactly that.
//
// ONE DEED, ONE DOOR: "Send it" posts `{ input: { text?, kbFileId?, pin? } }` to
// /api/workflows/runs/<runId>/resume — the same route every other gate answers through; the server
// appends what was sent as the station's own step output and continues the run from there.
// "Hold it back" posts the plain `{ approve: false }` reject shape. A park nobody can answer must
// not be a dead end, so it stays available and quiet.
//
// THE PIN CLAIMS ONLY WHAT PINNING DOES: a pinned document becomes standing reference the workflow
// reads every run. It does NOT stop this station from asking again — the station exists precisely
// because some runs need a fresh answer — so the sentence says "you won't have to go find it
// again", never "won't ask".
//
// THE OVERLAY LAW: the document picker is painted INSIDE this card's own flow (a panel the
// consumer already owns), never an anchored popover escaping into a clipping ancestor.
//
// THE THIRD DOOR — ATTACH (THE WAVE, Aug 25). The thing the run is missing is often on the person's
// machine and nowhere else yet, so "pin a document" alone sends them off to upload it somewhere
// first — the disconnected-door class again, one layer in. So: a file from disk uploads through
// /api/workflows/runs/<runId>/supply-upload (multipart, field `file` — the house name every other
// attach door uses), which indexes it into Knowledge and returns { kbFileId, name }. From that
// moment it IS a document: the form holds it in exactly the same `doc` slot a pinned one lands in,
// and Send posts the SAME `{ input: { kbFileId, pin } }` through the SAME resume door. There is no
// second send path, and there is exactly ONE file input in this form.
//
// THE PIN DEFAULT DIFFERS BY SOURCE, THE DEED DOES NOT (owner call): a document the person went and
// FOUND in Knowledge is already part of their standing material, so pinning it is checked. A file
// they just pulled off their machine was chosen to answer THIS ask, so pinning it to every future
// run is a commitment they did not make — unchecked, with the same checkbox and the same sentence
// right there if they want it. Same claim, same write; only the presumption changes.
//
// THE INDEXING IS DISCLOSED BEFORE THE PICK, not after: uploading a file puts it in Knowledge where
// teammates can find it, which is a consequence the person must read BEFORE they choose the file —
// so the sentence sits under the attach affordance in its idle state, and stays under the file once
// it has landed.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useRef, useEffect, useState } from 'react';
import { CheckIcon, DocumentTextIcon, PaperClipIcon } from '@heroicons/react/24/outline';

/** Everything lib/attachments/text-extractor.ts can actually read (the allowlist-drift lesson). */
const ATTACH_ACCEPT = '.pdf,.doc,.docx,.xlsx,.pptx,.csv,.txt';

/** What the person may hand over — the station's own `accepts`, default 'both'. */
export type SupplyAccepts = 'text' | 'doc' | 'both';
/** How the ask ended: the run took the supply, or the person stopped the run here. */
export type SupplyOutcome = 'supplied' | 'held';

export default function InputSupplyForm({
  runId, accepts = 'both', onSettled,
}: {
  /** The parked run. `null` = the caller does not know it yet — nothing renders (never a dead form). */
  runId: string | null;
  accepts?: SupplyAccepts;
  /** Fired ONLY after the resume door accepted. The consumer owns what the surface then says. */
  onSettled: (outcome: SupplyOutcome) => void;
}) {
  const [text, setText] = useState('');
  const [doc, setDoc] = useState<{ id: string; name: string } | null>(null);
  /** Which door the held document came through — it changes the pin PRESUMPTION, never the deed. */
  const [docFrom, setDocFrom] = useState<'picked' | 'attached' | null>(null);
  const [pin, setPin] = useState(true);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ id: string; label: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // THE ATTACH DOOR. One hidden input, one file at a time — a station asks for a thing, not a pile.
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const canPaste = accepts !== 'doc';
  const canPin = accepts !== 'text';

  // THE ONE KNOWLEDGE DOOR — the same source the chat composer's @-mention and the Studio inputs
  // tray read (/api/workers/mentions?types=document → knowledge_files). No second KB endpoint.
  useEffect(() => {
    if (!picking) return;
    let dead = false;
    const t = setTimeout(() => {
      fetch(`/api/workers/mentions?types=document&q=${encodeURIComponent(q.trim())}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!dead) setResults(((j?.results ?? []) as Array<{ id: string; label: string }>)); })
        .catch(() => { if (!dead) setResults([]); });
    }, q ? 200 : 0);
    return () => { dead = true; clearTimeout(t); };
  }, [picking, q]);

  // THE UPLOAD IS NOT THE SEND. It only turns a file on disk into a document the run can read;
  // nothing reaches the run until "Send it" posts the one resume door. A refusal (too big · nothing
  // readable in it) speaks the SERVER'S OWN sentence inline, right where the person is looking —
  // never a toast that scrolls away from the thing it is about.
  const attach = async (f: File) => {
    if (!runId || busy || uploading) return;
    setUploading(f.name); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch(`/api/workflows/runs/${runId}/supply-upload`, { method: 'POST', body: fd });
      const j = (await r.json().catch(() => null)) as { kbFileId?: string; name?: string; error?: string } | null;
      if (!r.ok || !j?.kbFileId) {
        setError(j?.error || 'That file did not go through — try again.');
        return;
      }
      setDoc({ id: j.kbFileId, name: j.name || f.name });
      setDocFrom('attached');
      setPin(false); // a file from THIS person's machine answers THIS ask until they say otherwise
      setPicking(false);
    } catch { setError('That file did not go through — try again.'); } finally { setUploading(null); }
  };

  const send = async () => {
    if (!runId || busy || uploading) return;
    const said = text.trim();
    if (!said && !doc) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/workflows/runs/${runId}/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { ...(said ? { text: said } : {}), ...(doc ? { kbFileId: doc.id, pin } : {}) } }),
      });
      if (!r.ok) {
        // The server's sentence is the honest one (too long · not indexed yet · already moved on).
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error || 'That did not land — try again.');
        return;
      }
      onSettled('supplied');
    } catch { setError('That did not land — try again.'); } finally { setBusy(false); }
  };

  const holdBack = async () => {
    if (!runId || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/workflows/runs/${runId}/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve: false }),
      });
      if (!r.ok) { setError('That did not land — try again.'); return; }
      onSettled('held');
    } catch { setError('That did not land — try again.'); } finally { setBusy(false); }
  };

  // A caller that does not know its run yet says NOTHING rather than paint a form that can't post.
  if (!runId) return null;

  return (
    <>
      {canPaste && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          rows={5}
          placeholder="Paste it here…"
          className="mt-3 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12.5px] text-neutral-800 placeholder:text-neutral-400 focus:border-indigo-300 focus:outline-none disabled:opacity-60"
        />
      )}

      {canPin && (
        <div className="mt-2">
          {/* THE ONE FILE INPUT in this form — hidden, opened by the affordance below (house pattern). */}
          <input
            ref={fileRef}
            type="file"
            accept={ATTACH_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void attach(f);
            }}
          />
          {uploading ? (
            <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2">
              <PaperClipIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
              <span className="flex-1 truncate text-[12.5px] text-neutral-500" title={uploading}>{uploading}</span>
              <span className="text-[12px] text-neutral-400 animate-pulse motion-reduce:animate-none">Reading it…</span>
            </div>
          ) : doc ? (
            <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2">
              <DocumentTextIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
              <span className="flex-1 truncate text-[12.5px] text-neutral-700" title={doc.name}>{doc.name}</span>
              <button onClick={() => { setDoc(null); setDocFrom(null); }} disabled={busy} className="text-[12px] text-neutral-400 hover:text-neutral-700">Remove</button>
            </div>
          ) : picking ? (
            <div className="rounded-lg border border-neutral-200 bg-white">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search your documents…"
                className="w-full rounded-t-lg border-b border-neutral-100 px-3 py-2 text-[12.5px] text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
              />
              <div className="max-h-[180px] overflow-y-auto py-1">
                {results === null ? (
                  <p className="px-3 py-1.5 text-[12px] text-neutral-400">Looking…</p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-1.5 text-[12px] text-neutral-400">Nothing matching in your documents.</p>
                ) : results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => { setDoc({ id: r.id, name: r.label }); setDocFrom('picked'); setPin(true); setPicking(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-50"
                  >
                    <DocumentTextIcon className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
                    <span className="truncate text-[12.5px] text-neutral-700">{r.label}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setPicking(false)} className="w-full border-t border-neutral-100 px-3 py-1.5 text-left text-[12px] text-neutral-400 hover:text-neutral-600">Cancel</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <button
                onClick={() => setPicking(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors"
              >
                <DocumentTextIcon className="w-3.5 h-3.5" />
                {canPaste ? '…or pin a document' : 'Pin a document'}
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-500 hover:text-indigo-600 transition-colors"
              >
                <PaperClipIcon className="w-3.5 h-3.5" />
                …or attach a file
              </button>
            </div>
          )}
          {/* Said BEFORE the pick as well as after it — indexing is a consequence, not a footnote. */}
          {!picking && (!doc || docFrom === 'attached') && (
            <p className="mt-1.5 text-[12px] text-neutral-400">
              {docFrom === 'attached'
                ? 'It’s saved to your Knowledge too, so the team can find it later.'
                : 'An attached file is saved to your Knowledge too, so the team can find it later.'}
            </p>
          )}
          {doc && (
            <label className="mt-1.5 flex items-start gap-2 text-[12px] text-neutral-500">
              <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} disabled={busy} className="mt-[3px]" />
              <span>
                Keep it pinned to this workflow.{' '}
                <span className="text-neutral-400">Pinned documents are read on every run — you won&apos;t have to go find this one again.</span>
              </span>
            </label>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void send()}
          disabled={busy || !!uploading || (!text.trim() && !doc)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-4 py-2 text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          <CheckIcon className="w-4 h-4" />Send it
        </button>
        <button
          onClick={() => void holdBack()}
          disabled={busy}
          className="inline-flex items-center text-[13px] font-medium text-neutral-500 hover:text-neutral-700 disabled:opacity-60 transition-colors"
        >
          Hold it back
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-rose-600">{error}</p>}
    </>
  );
}
