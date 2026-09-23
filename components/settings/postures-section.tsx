'use client';

// THE POSTURES SURFACE (docs/attention-plan.md · A8) — the PRIMARY face of the triage rules.
// One plain sentence per posture, never a condition builder: the sentence · on/off · edit in place
// (re-saying re-parses, with the understood-as show-back) · delete · its receipts. A posture
// without visible effect is a mystery toggle, so every row carries its receipts line.
// The old field-by-field rule editor is not deleted — it is demoted behind "Advanced" by the
// parent section, for the tail of cases a sentence can't reach.

import { useEffect, useState } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

export type Posture = {
  id: string;
  sentence: string;
  verbatim: boolean;
  builtin: boolean;
  enabled: boolean;
  priority: number;
  connection_id: string | null;
};
type Receipt = { ruleId: string; form: string; count: number; sharedWith: number; scanned: number; line: string };

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={on ? 'Turn off' : 'Turn on'}
      className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors ${on ? 'bg-indigo-600' : 'bg-neutral-200'}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

// The one authoring control — a text field and a confirm. Parse first, show back what was
// understood, and only then write: the user never confirms a sentence whose meaning they can't see.
function SentenceComposer({
  initial, connectionId, postureId, onDone, onCancel,
}: {
  initial: string; connectionId: string | null; postureId?: string;
  onDone: (p: Posture) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [understood, setUnderstood] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [primitives, setPrimitives] = useState<any>(null);
  const [reason, setReason] = useState<string | null>(null);

  const parse = async () => {
    if (!text.trim()) return;
    setBusy(true); setReason(null); setUnderstood(null);
    try {
      const res = await fetch('/api/postures/parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: text.trim() }),
      });
      const d = await res.json();
      if (d.ok) { setUnderstood(d.understood); setPrimitives(d.primitives); }
      else setReason(d.reason || "I couldn't turn that into something I can act on.");
    } catch { setReason("I couldn't read that just now — try again."); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    setBusy(true); setReason(null);
    try {
      const res = await fetch(postureId ? `/api/postures/${postureId}` : '/api/postures', {
        method: postureId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: text.trim(), connection_id: connectionId, primitives }),
      });
      const d = await res.json();
      if (d.ok && d.posture) onDone(d.posture);
      else setReason(d.reason || 'Could not save that.');
    } catch { setReason('Could not save that.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 px-3.5 py-3">
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setUnderstood(null); setPrimitives(null); setReason(null); }}
        rows={2}
        autoFocus
        placeholder="Say it plainly — e.g. “Label anything from our accountant as To do and file it under Finance/Accounts.”"
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] focus:border-indigo-300 focus:outline-none resize-none"
      />
      {understood && (
        <p className="mt-2 text-[12px] text-neutral-600">
          <span className="text-neutral-400">Understood as:</span> {understood}
        </p>
      )}
      {reason && <p className="mt-2 text-[12px] text-amber-700">{reason}</p>}
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-2.5 py-1.5 text-[12.5px] text-neutral-500 hover:text-neutral-800">Cancel</button>
        {understood ? (
          <button onClick={commit} disabled={busy}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? 'Saving…' : postureId ? 'Save this' : 'Add it'}
          </button>
        ) : (
          <button onClick={parse} disabled={busy || !text.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? 'Reading…' : 'Check it'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function PosturesSection({ connectionId }: { connectionId: string | null }) {
  const [postures, setPostures] = useState<Posture[]>([]);
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const url = connectionId ? `/api/postures?connection_id=${connectionId}` : '/api/postures';
    fetch(url).then(r => r.json())
      .then(d => { setPostures(d.postures ?? []); setReceipts(d.receipts ?? {}); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, [connectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (p: Posture) => {
    setPostures(ps => ps.map(x => x.id === p.id ? { ...x, enabled: !x.enabled } : x));
    await fetch(`/api/postures/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !p.enabled }),
    }).catch(() => {});
  };

  const remove = async (p: Posture) => {
    if (!confirm(`Remove this posture?\n\n${p.sentence}`)) return;
    setPostures(ps => ps.filter(x => x.id !== p.id));
    await fetch(`/api/postures/${p.id}`, { method: 'DELETE' }).catch(() => {});
  };

  const upsert = (p: Posture) => {
    setPostures(ps => ps.some(x => x.id === p.id) ? ps.map(x => x.id === p.id ? p : x) : [p, ...ps]);
    setAdding(false); setEditingId(null);
    // Receipts are a server computation over real mail — refetch so the new row isn't left blank.
    load();
  };

  return (
    <div className="space-y-2">
      {adding ? (
        <SentenceComposer initial="" connectionId={connectionId} onDone={upsert} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-neutral-200 px-3.5 py-3 text-[13px] text-neutral-500 hover:border-indigo-300 hover:text-indigo-700 transition-colors">
          <PlusIcon className="w-4 h-4" /> Tell me how you want mail handled
        </button>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-neutral-100 animate-pulse" />)}</div>
      ) : postures.length === 0 ? (
        <p className="px-1 py-6 text-[12.5px] text-neutral-400">No postures yet — say one above and I&apos;ll hold to it.</p>
      ) : postures.map(p => (
        editingId === p.id ? (
          <SentenceComposer key={p.id} initial={p.sentence} connectionId={p.connection_id} postureId={p.id}
            onDone={upsert} onCancel={() => setEditingId(null)} />
        ) : (
          <div key={p.id}
            className={`flex items-start gap-3 rounded-xl border border-neutral-200 bg-white px-3.5 py-3 ${p.enabled ? '' : 'opacity-50'}`}>
            <div className="min-w-0 flex-1">
              <button onClick={() => setEditingId(p.id)}
                className="block w-full text-left text-[13px] leading-relaxed text-neutral-800 hover:text-indigo-700 transition-colors">
                {p.sentence}
              </button>
              <p className="mt-1 text-[11.5px] text-neutral-400">
                {p.builtin && <span className="mr-1.5 text-neutral-300">Built-in ·</span>}
                {receipts[p.id]?.line ?? 'No receipts yet.'}
              </p>
            </div>
            <button onClick={() => remove(p)} title="Remove" className="mt-0.5 text-neutral-300 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
            <div className="mt-0.5"><Toggle on={p.enabled} onClick={() => toggle(p)} /></div>
          </div>
        )
      ))}
    </div>
  );
}
