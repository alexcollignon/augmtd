'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONVERSATIONAL RAIL (just-works P1.5b) — the deep-dive's right column talks like a colleague,
// not a data card. The opening narration is the entity's OWN judged state (zero AI at render — the
// brain already authored it); every mention is a live CHIP (✉ thread, meeting, file, coworker avatar
// with one-tap hand-off). One composer at the bottom is the whole channel: a correction reworks the
// draft + writes entity memory, a question gets a grounded answer, and "have <coworker> do X" routes
// a real delegation — all via /api/items/steer.
//
// VISUAL LANGUAGE: mirrors the app's ONE chat-panel idiom (components/shared/chat-sidebar.tsx — the
// meetings/drive assistant): h-10 icon header, neutral-100 user bubbles (rounded-br-sm), small round
// assistant avatar + plain text, bouncing-dots typing indicator, rounded-2xl composer with the round
// indigo send button. Same visual = same meaning across screens.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EnvelopeIcon, CalendarDaysIcon, DocumentIcon, PaperAirplaneIcon, PaperClipIcon, ChatBubbleLeftRightIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { ROLE_AVATARS } from '@/lib/workers/roles';
import { fmtMonthDay } from '@/lib/utils/format-date';

// 'entity' = the PROJECT DOOR (P7c-c2): the same rail inside the project room — id is the entity
// id, steer/ingest run in entity scope, the Overview chip hides (you're already there).
type RailKind = 'email' | 'followup' | 'commitment' | 'meeting' | 'awareness' | 'entity';

export type RailView = {
  // The open item — what the rail's opening message narrates FIRST (P5b: item-anchored, never generic).
  anchor?: { who: string | null; ask: string | null; prepared: string | null } | null;
  gap: string | null;
  entity: {
    id: string; name: string;
    summary: string | null; momentum: string | null; nextMove: string | null;
    whoOwesYou: string[]; whoOwesThem: string[];
  } | null;
  siblings: {
    threads: Array<{ id: string; subject: string; who: string | null; at: string | null; current: boolean }>;
    meetings: Array<{ id: string; title: string; at: string | null }>;
    commitments: Array<{ id: string; description: string; who: string | null }>;
    files: Array<{ id: string; filename: string }>;
  };
};

type Turn =
  | { role: 'user'; text: string }
  | { role: 'system'; text: string; refs?: Array<{ label: string; href: string | null }>; files?: Array<{ id: string; filename: string; source: string }> };

type Coworker = { id: string; name: string; worker_role: string | null };

// THE ROOM (P7c-c1): the conversation is PER-DEAL, not per-item — navigating between a deal's
// artifacts keeps the chat (module-level store, keyed by entity id; a reload releases it). A loose
// item (no deal) keys by its own id.
const _dealTurns = new Map<string, Turn[]>();

// One roster fetch per page session (the rail only needs names/roles for the hand-off chip).
let _coworkers: Promise<Coworker[]> | null = null;
function fetchCoworkers(): Promise<Coworker[]> {
  _coworkers ??= fetch('/api/workers')
    .then((r) => (r.ok ? r.json() : { workers: [] }))
    .then((d) => (Array.isArray(d.workers) ? d.workers : Array.isArray(d) ? d : []))
    .catch(() => []);
  return _coworkers;
}

// The coworker whose craft matches the deal's next move — conservative: no clear match → no chip.
function coworkerForMove(move: string, workers: Coworker[]): Coworker | null {
  const m = move.toLowerCase();
  const role = /\bresearch|analy|compare|investigat|assess\b/.test(m) ? 'research_analyst'
    : /\bwrite|draft|post|article|content|deck|present|summar\b/.test(m) ? 'content_manager'
    : null;
  return role ? (workers.find((w) => w.worker_role === role) ?? null) : null;
}



function Initials({ name }: { name: string }) {
  const parts = name.replace(/<[^>]*>/g, '').trim().split(/\s+/);
  const ini = (parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
  return (
    <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-indigo-100 text-indigo-600 text-[9px] font-semibold flex-shrink-0">
      {ini.toUpperCase()}
    </span>
  );
}

function Chip({ icon, label, onClick }: { icon?: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600 transition-colors max-w-full ${onClick ? 'hover:border-indigo-200 hover:text-indigo-600 cursor-pointer' : 'cursor-default'}`}
    >
      {icon}<span className="truncate">{label}</span>
    </button>
  );
}

// An assistant message — PLAIN indented paragraphs (user call: the rail is a narrator, not a
// persona; no per-message avatar). The panel header keeps the shared chat-sidebar icon.
function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-[13px] text-neutral-800 leading-relaxed space-y-1.5">{children}</div>
  );
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 mt-1">
      <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="inline-block w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

export function ItemRail({ kind, id, view, onDraft }: {
  kind: RailKind; id: string; view: RailView; onDraft?: (draft: string) => void;
}) {
  const router = useRouter();
  const ent = view.entity;
  const sib = view.siblings;
  const inRoom = kind === 'entity';
  const roomKey = ent?.id ?? `item-${id}`;
  const [turns, setTurnsRaw] = useState<Turn[]>(() => _dealTurns.get(roomKey) ?? []);
  const setTurns = (updater: (prev: Turn[]) => Turn[]) => {
    setTurnsRaw((prev) => { const next = updater(prev); _dealTurns.set(roomKey, next); return next; });
  };
  // Same-deal navigation remounts the rail — restore the deal's conversation.
  useEffect(() => { setTurnsRaw(_dealTurns.get(roomKey) ?? []); }, [roomKey]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [workers, setWorkers] = useState<Coworker[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  // S1 (projecthood): founding a project FROM this item — chip → inline name input → create+attach.
  const [founding, setFounding] = useState(false);
  const [foundName, setFoundName] = useState('');

  useEffect(() => { fetchCoworkers().then(setWorkers); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [turns, busy]);

  const otherThreads = sib.threads.filter((t) => !t.current);
  const suggested = ent?.nextMove ? coworkerForMove(ent.nextMove, workers) : null;

  const send = async (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || busy) return;
    setText('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setTurns((prev) => [...prev, { role: 'user', text: t }]);
    setBusy(true);
    try {
      const res = await fetch('/api/items/steer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, text: t }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTurns((prev) => [...prev, { role: 'system', text: d.error || "I couldn't do that just now." }]);
      } else {
        // The ONE conversation core's uniform turn: `say` is the reply; refs/files are chips; a
        // reworked draft re-seeds the composer. (P6b — the rail owns zero logic.)
        if (d.draft && onDraft) onDraft(d.draft);
        setTurns((prev) => [...prev, {
          role: 'system',
          // Refs render as chips below — the raw [L4]/[F2] markers must never sit in the prose.
          text: String(d.say || d.answer || 'Done.').replace(/\s*\[[LF]?\d+(?:\s*,\s*[LF]?\d+)*\]/g, ''),
          refs: Array.isArray(d.refs) ? d.refs.map((r: { label?: string; href?: string | null }) => ({ label: String(r.label ?? ''), href: r.href ?? null })) : [],
          files: Array.isArray(d.files) ? d.files : undefined,
        }]);
      }
    } catch {
      setTurns((prev) => [...prev, { role: 'system', text: "I couldn't do that just now." }]);
    } finally { setBusy(false); }
  };

  // Found a project from this item (S1) — the SAME create+attach the chat's create_project runs.
  const linkKind = kind === 'commitment' || kind === 'followup' ? 'commitment' : kind === 'meeting' ? 'meeting' : 'inbox_item';
  const foundProject = async () => {
    const n = foundName.trim();
    if (!n || busy) return;
    setFounding(false); setFoundName(''); setBusy(true);
    try {
      const res = await fetch('/api/entities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.id) throw new Error();
      await fetch('/api/items/entity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: linkKind, id, entityId: d.id }) });
      setTurns((prev) => [...prev, { role: 'system', text: `Started ${n} — this is in it now. New mail about it will attach as it arrives.` }]);
    } catch {
      setTurns((prev) => [...prev, { role: 'system', text: "I couldn't create that project just now." }]);
    } finally { setBusy(false); }
  };

  // 📎 — the ingest funnel: the file lands in the per-item deliverable pool (ONE write, every reader
  // — steps, coworkers, find_file — sees it); the rail only narrates what happened.
  const attach = async (f: File) => {
    if (busy) return;
    setTurns((prev) => [...prev, { role: 'user', text: `Attached: ${f.name}` }]);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f); fd.append('kind', kind); fd.append('id', id);
      const res = await fetch('/api/items/ingest', { method: 'POST', body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setTurns((prev) => [...prev, { role: 'system', text: d.error || "I couldn't read that file." }]);
      else setTurns((prev) => [...prev, {
        role: 'system',
        text: d.satisfiedStep
          ? `Got it — that covers "${d.satisfiedStep}". It's folded into this work now.`
          : `Got it — I've folded ${d.filename} into this work. Anything running here can read it now.`,
      }]);
    } catch {
      setTurns((prev) => [...prev, { role: 'system', text: "I couldn't read that file." }]);
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden min-h-0">
      {/* Header — the shared chat-sidebar idiom: h-10, panel icon + title. */}
      <div className="h-10 flex items-center gap-2 px-3 border-b border-neutral-100 flex-shrink-0">
        <ChatBubbleLeftRightIcon className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />
        <span className="text-[12px] font-semibold text-neutral-700 truncate">{inRoom ? 'Chat' : ent ? ent.name : 'About this'}</span>
      </div>

      {/* Messages — narration first, then the conversation. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-4 min-h-0">
        {/* Opening — THIS item first (who · verb-first ask · what's already prepared), assembled
            deterministically from the anchor (grounded-or-absent per part); then the deal's judged
            state as ONE line. Who-owes folds to a single line, and disappears entirely when the
            next-move below already carries the actionable. */}
        {inRoom && turns.length === 0 && (
          <AssistantRow>
            <p className="text-[12.5px] text-neutral-500">This is the room for {ent?.name ?? 'this work'} — ask anything, correct me, or hand work off. I hold everything on it.</p>
          </AssistantRow>
        )}
        {!inRoom && <AssistantRow>
          {(() => {
            const a = view.anchor;
            const who = a?.who ? a.who.replace(/<[^>]*>/g, '').trim().split(/\s+/)[0] : null;
            const ask = a?.ask ? a.ask.charAt(0).toLowerCase() + a.ask.slice(1).replace(/\.+$/, '') : null;
            const prep = a?.prepared ? (a.prepared === 'draft' ? 'I drafted a reply below' : `${a.prepared.split(' ')[0]} drafted a reply below`) : null;
            if (who && ask) return <p>{who} is asking you to {ask}{prep ? ` — ${prep.charAt(0).toLowerCase() + prep.slice(1)}` : ''}.</p>;
            if (ask) return <p>This needs you to {ask}{prep ? ` — ${prep.charAt(0).toLowerCase() + prep.slice(1)}` : ''}.</p>;
            if (prep) return <p>{prep}.</p>;
            return null;
          })()}
          {ent?.summary
            ? <p className={view.anchor?.ask || view.anchor?.prepared ? 'text-[12px] text-neutral-500' : undefined}>{ent.summary}</p>
            : (!view.anchor?.ask && <p>This isn&apos;t tied to a bigger body of work yet — I&apos;ll keep it standalone.</p>)}
          {!ent && !inRoom && (
            founding ? (
              <input
                autoFocus value={foundName} onChange={(e) => setFoundName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') foundProject(); if (e.key === 'Escape') { setFounding(false); setFoundName(''); } }}
                onBlur={() => { if (foundName.trim()) foundProject(); else setFounding(false); }}
                placeholder="Project name…"
                className="w-full max-w-[240px] text-[12px] border-b border-indigo-300 outline-none bg-transparent py-0.5"
              />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <Chip label="Start a project from this" onClick={() => setFounding(true)} />
              </div>
            )
          )}
          {!ent?.nextMove && ent?.whoOwesThem[0] && <p className="text-[12px] text-neutral-500">They owe: {ent.whoOwesThem[0]}</p>}
          {!ent?.nextMove && ent?.whoOwesYou[0] && <p className="text-[12px] text-neutral-500">You owe: {ent.whoOwesYou[0]}</p>}
        </AssistantRow>}

        {/* THE ROOM INDEX (P7c-c1) — everything in this deal, grouped; clicking swaps the left
            artifact while the conversation persists (per-deal store above). Overview = the project
            door. */}
        {!inRoom && (otherThreads.length > 0 || sib.meetings.length > 0 || sib.commitments.length > 0 || sib.files.length > 0 || ent) && (
          <AssistantRow>
            <p className="text-[12px] text-neutral-500">{inRoom ? 'In here:' : 'In this project:'}</p>
            {ent && !inRoom && (
              <div className="flex flex-wrap gap-1.5">
                <Chip label="Open project overview" onClick={() => router.push(`/?view=projects&entity=${ent.id}`)} />
              </div>
            )}
            {otherThreads.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {otherThreads.slice(0, 3).map((t) => (
                  <Chip key={t.id} icon={<EnvelopeIcon className="w-3 h-3 flex-shrink-0" />}
                    label={`${t.who ? `${t.who.split(' ')[0]} · ` : ''}${t.subject}`}
                    onClick={() => router.push(`/item/${t.id}`)} />
                ))}
              </div>
            )}
            {(sib.meetings.length > 0 || sib.commitments.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {sib.meetings.slice(0, 2).map((m) => (
                  <Chip key={m.id} icon={<CalendarDaysIcon className="w-3 h-3 flex-shrink-0" />}
                    label={`${m.title}${m.at ? ` · ${fmtMonthDay(m.at)}` : ''}`}
                    onClick={() => router.push(`/item/${m.id}?kind=meeting`)} />
                ))}
                {sib.commitments.slice(0, 3).map((c) => (
                  <Chip key={c.id} icon={<CheckCircleIcon className="w-3 h-3 flex-shrink-0" />}
                    label={c.description}
                    onClick={() => router.push(`/item/${c.id}?kind=commitment`)} />
                ))}
              </div>
            )}
            {sib.files.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {sib.files.slice(0, 3).map((f) => (
                  <Chip key={f.id} icon={<DocumentIcon className="w-3 h-3 flex-shrink-0" />} label={f.filename} />
                ))}
              </div>
            )}
          </AssistantRow>
        )}

        {/* The gap — one plain ask, same channel (never a step list). */}
        {view.gap && (
          <AssistantRow>
            <p className="text-amber-800/90">{view.gap}</p>
          </AssistantRow>
        )}

        {/* The next move + a matching coworker as a PERSON (avatar + one-tap hand-off). */}
        {!inRoom && ent?.nextMove && (
          <AssistantRow>
            <p>Next: {ent.nextMove}</p>
            {suggested && (
              <button
                onClick={() => send(`Have ${suggested.name.split(' ')[0]} ${ent.nextMove}`)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50/50 pl-1 pr-2.5 py-0.5 text-[11.5px] font-medium text-indigo-700 hover:bg-indigo-50 transition-colors"
              >
                {suggested.worker_role && ROLE_AVATARS[suggested.worker_role] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ROLE_AVATARS[suggested.worker_role]} alt="" className="w-[18px] h-[18px] rounded-full" />
                ) : <Initials name={suggested.name} />}
                {suggested.name.split(' ')[0]} can take this →
              </button>
            )}
          </AssistantRow>
        )}

        {/* The conversation — user bubbles + assistant replies, the shared idiom. */}
        {turns.map((t, i) => t.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[80%] px-3 py-2 bg-neutral-100 rounded-2xl rounded-br-sm text-[13px] text-neutral-800 leading-relaxed">{t.text}</div>
          </div>
        ) : (
          <AssistantRow key={i}>
            <p className="whitespace-pre-wrap">{t.text}</p>
            {t.refs && t.refs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.refs.map((r, j) => (
                  <Chip key={j} label={r.label} onClick={r.href ? () => router.push(r.href!) : undefined} />
                ))}
              </div>
            )}
            {t.files && t.files.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.files.map((f, j) => (
                  <Chip key={j} icon={<DocumentIcon className="w-3 h-3 flex-shrink-0" />} label={f.filename} />
                ))}
              </div>
            )}
          </AssistantRow>
        ))}
        {busy && <AssistantRow><TypingDots /></AssistantRow>}
      </div>

      {/* Composer — the shared idiom: rounded-2xl box, auto-growing textarea, round send button. */}
      <div className="flex-shrink-0 px-3 pb-3 pt-2">
        <div className="flex items-end gap-2 rounded-2xl border border-neutral-200 bg-white shadow-sm px-3 py-2">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask, correct, or hand off…"
            rows={1}
            disabled={busy}
            className="flex-1 text-[12px] text-neutral-700 placeholder-neutral-400 bg-transparent outline-none min-w-0 disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
            style={{ maxHeight: '120px', overflowY: 'auto' }}
          />
          <input ref={fileRef} type="file" className="hidden"
            accept=".pdf,.docx,.txt,.csv,.xlsx,.pptx"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 transition-colors mb-px"
            title="Attach a file"
          >
            <PaperClipIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => send()}
            disabled={busy || !text.trim()}
            className="flex-shrink-0 w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center disabled:opacity-40 transition-opacity mb-px"
            title="Send"
          >
            <PaperAirplaneIcon className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
