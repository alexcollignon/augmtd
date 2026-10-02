'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE VIEWER (law `one-component-one-behaviour` — lib/present/behaviour.ts ONE_VIEWER).
//
// Every ARTIFACT — a produced document, a frame, a spreadsheet or deck, a pool deliverable, a
// meeting's notes, a full email thread — is a compact card in the conversation, and that card's
// Open raises THIS component. It is the same viewer on every surface (the Home chat, a coworker DM,
// an item room, a project room, the workflow pages): beside the conversation on desktop (the page
// makes room — the layout reads `--viewer-w`), a full-screen sheet on a phone. It never opens on its
// own (an arrival is a card, never a pane), and it never navigates: the room stays where it is.
//
// It replaces four lookalikes: the Home's docked artifact pane (`lg:mr-[608px]`, auto-opened on
// arrival), the workflow deliverable door's fixed panel, the project room's 52% split aside with a
// focused deliverable / item in it, and the item room's summoned stage. A deed NEVER mounts here —
// a deed is its inline card in the conversation (the gate holds both halves).
//
// ONE AT A TIME: opening a viewer closes whichever other one was open (the store below), so two
// hosts can never stack two panes. Escape closes. The overlay law: portalled to <body>, fixed.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { ThreadArtifactsPanel } from '@/components/work/chat-artifact-panel';
import type { DocumentArtifact } from '@/lib/types/inbox';
import { ThreadCardView } from '@/components/thread';
import { docCardTypeOf } from '@/lib/documents/doc-card';
import { ThreadMessages, type ThreadMessage } from '@/components/inbox/thread-messages';
import { loadThreadRaw } from '@/lib/inbox/thread-door';

/** The desktop width the viewer takes beside the page (the layout pads by the same variable). */
export const VIEWER_W = 'min(680px, 46vw)';
const VIEWER_VAR = '--viewer-w';

// ── ONE AT A TIME — the active viewer's id, shared by every host ─────────────────────────────────
let activeId: string | null = null;
const listeners = new Set<() => void>();
const setActive = (id: string | null) => {
  activeId = id;
  try { document.documentElement.style.setProperty(VIEWER_VAR, id ? VIEWER_W : '0px'); } catch { /* SSR */ }
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const useActive = () => useSyncExternalStore(subscribe, () => activeId, () => null);

export function ArtifactViewer({ open, onClose, title, meta, bare = false, children }: {
  open: boolean;
  onClose: () => void;
  /** The viewer's own header (absent when `bare`: the body brings its own chrome). */
  title?: React.ReactNode;
  meta?: React.ReactNode;
  /** The body owns its header + close (the thread artifacts panel). */
  bare?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  const active = useActive();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Claim the one seat on open; release it on close/unmount (only if still ours).
  useEffect(() => {
    if (!open) return;
    setActive(id);
    return () => { if (activeId === id) setActive(null); };
  }, [open, id]);
  // Another host opened its viewer → this one closes (one pane, never two).
  useEffect(() => {
    if (open && active && active !== id) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  // Escape closes — the one overlay idiom.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted || typeof document === 'undefined') return null;
  return createPortal(
    <aside
      data-artifact-viewer
      role="dialog" aria-label={typeof title === 'string' ? title : 'Viewer'}
      // PHONE: a full-screen sheet. DESKTOP (lg): a panel BESIDE the page, which pads itself by the
      // same width (app/(main)/layout.tsx reads --viewer-w), so the conversation stays readable.
      className="aug-viewer fixed inset-0 z-[60] flex flex-col bg-neutral-50 lg:left-auto lg:border-l lg:border-neutral-200 lg:shadow-[-12px_0_32px_rgba(0,0,0,0.07)]"
    >
      {/* The drawer's own motion (components/room/filed-drawer.tsx aug-drawer-in), the same curve and
          the same reduced-motion floor — one feel for every side surface. */}
      <style href="aug-viewer" precedence="default">{`
@keyframes aug-viewer-in { from { transform: translateX(18px); opacity: 0.5; } to { transform: none; opacity: 1; } }
.aug-viewer { animation: aug-viewer-in 0.18s ease-out; }
@media (min-width: 1024px) { .aug-viewer { width: ${VIEWER_W}; } }
@media (prefers-reduced-motion: reduce) { .aug-viewer { animation: none; } }
`}</style>
      {bare ? children : (
        <div className="flex h-full min-h-0 flex-col p-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-neutral-100 px-5 py-3">
              <div className="min-w-0 flex-1">
                {title && <h2 className="truncate text-[14px] font-semibold text-neutral-900">{title}</h2>}
                {meta && <p className="mt-0.5 truncate text-[11.5px] text-neutral-400">{meta}</p>}
              </div>
              <button onClick={onClose} title="Close" aria-label="Close"
                className="flex-shrink-0 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700">
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
          </div>
        </div>
      )}
    </aside>,
    document.body,
  );
}

// ── THE BODIES — what an artifact reads as inside the one viewer ─────────────────────────────────

/** A pool deliverable (item_deliverables) read through the one preview door. */
export function DeliverableBody({ id, by, at }: { id: string; by?: string | null; at?: string | null }) {
  const [state, setState] = useState<{ text?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    fetch('/api/files/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: { kind: 'deliverable', id } }) })
      .then((r) => r.json()).then((dd) => { if (alive) setState({ text: dd.text, loading: false }); })
      .catch(() => { if (alive) setState({ loading: false }); });
    return () => { alive = false; };
  }, [id]);
  return <TextBody text={state.text ?? null} loading={state.loading} by={by} at={at} />;
}

/** Words the host already holds (a prepared deliverable served on the item view). */
export function TextBody({ text, loading = false, by, at, note }: { text: string | null; loading?: boolean; by?: string | null; at?: string | null; note?: string | null }) {
  return (
    <div className="px-6 pb-8 pt-5">
      {(by || at || note) && (
        <p className="mb-3 text-[12px] text-neutral-400">
          {by ? `Prepared by ${by.split(' ')[0]}` : 'Prepared'}{at ? ` · ${at}` : ''}{note ? ` · ${note}` : ''}
        </p>
      )}
      {loading ? <p className="text-[13px] text-neutral-400">Loading…</p>
        : text ? <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-neutral-800">{text}</p>
          : <p className="text-[13px] text-neutral-400">Couldn&apos;t load this one.</p>}
    </div>
  );
}

/** A FULL EMAIL THREAD (the `email_thread` artifact) — the reply card's "Open thread" door reads here,
 *  through the ONE thread door (lib/inbox/thread-door — joins any flight already in the air). */
export function EmailThreadBody({ itemId }: { itemId: string }) {
  const [state, setState] = useState<{ messages: ThreadMessage[] | null; attachments?: unknown; err?: boolean }>({ messages: null });
  useEffect(() => {
    let alive = true;
    loadThreadRaw(itemId).then((raw) => {
      if (!alive) return;
      if (!raw || raw.error) { setState({ messages: [], err: true }); return; }
      const msgs = (Array.isArray(raw.messages) ? raw.messages : []) as Array<Record<string, unknown>>;
      setState({
        messages: msgs.map((m) => ({
          id: String(m.id ?? ''), from_name: (m.fromName as string) ?? null, from_address: (m.from as string) ?? null,
          received_at: (m.receivedAt as string) ?? null, body: (m.body as string) ?? null, html_body: (m.html_body as string) ?? null,
          is_from_user: !!m.isFromUser, to_addresses: (m.to_addresses as ThreadMessage['to_addresses']) ?? null,
          cc_addresses: (m.cc_addresses as ThreadMessage['cc_addresses']) ?? null,
        }) as ThreadMessage),
        attachments: raw.attachments,
      });
    }).catch(() => { if (alive) setState({ messages: [], err: true }); });
    return () => { alive = false; };
  }, [itemId]);
  return (
    <div className="px-6 pb-8 pt-5">
      {state.err ? <p className="text-[13px] text-neutral-400">Could not load the conversation.</p>
        : <ThreadMessages messages={state.messages} attachments={(state.attachments ?? null) as never} />}
    </div>
  );
}

// ── THE HOOK — what a host holds: what is open, the opener, and the node to render ───────────────

export type ViewerSubject =
  | { kind: 'thread'; threadId: string; artifactId: string | null }
  | { kind: 'deliverable'; id: string; title: string; by?: string | null; at?: string | null }
  | { kind: 'text'; title: string; text: string; by?: string | null; note?: string | null }
  | { kind: 'email_thread'; itemId: string; title: string };

/**
 * One viewer per host, one open at a time across hosts. `open(subject)` raises it ONLY on the
 * reader's click (hosts never call it on arrival). `onThreadArtifacts` hands a thread's artifact list
 * back to the host the moment the viewer has read it (Home folds its doc cards on the same flight).
 */
export function useArtifactViewer(opts?: { onThreadArtifacts?: (threadId: string, arts: DocumentArtifact[]) => void; onError?: () => void }) {
  const [subject, setSubject] = useState<ViewerSubject | null>(null);
  const [thread, setThread] = useState<{ id: string; title: string; artifacts?: DocumentArtifact[] } | null>(null);
  const onThreadArtifacts = opts?.onThreadArtifacts;
  const onError = opts?.onError;
  const close = useCallback(() => { setSubject(null); setThread(null); }, []);
  const open = useCallback(async (s: ViewerSubject) => {
    if (s.kind !== 'thread') { setThread(null); setSubject(s); return; }
    try {
      const d = await fetch(`/api/work/threads/${s.threadId}/messages`).then((r) => (r.ok ? r.json() : null));
      const th = d?.thread as { id: string; title?: string; artifacts?: DocumentArtifact[] } | null;
      if (!th) throw new Error('thread');
      setThread({ id: th.id, title: th.title ?? 'Work', artifacts: th.artifacts ?? [] });
      setSubject(s);
      onThreadArtifacts?.(th.id, th.artifacts ?? []);
    } catch { onError?.(); }
  }, [onThreadArtifacts, onError]);

  const node = !subject ? null
    : subject.kind === 'thread' ? (thread ? (
      <ArtifactViewer open onClose={close} bare>
        <ThreadArtifactsPanel
          thread={thread}
          onClose={close}
          initialDetailId={subject.artifactId}
          onArtifactsUpdate={(arts) => {
            setThread((p) => (p ? { ...p, artifacts: arts } : p));
            onThreadArtifacts?.(thread.id, arts);
          }}
        />
      </ArtifactViewer>
    ) : null)
    : subject.kind === 'email_thread' ? (
      <ArtifactViewer open onClose={close} title={subject.title}>
        <EmailThreadBody itemId={subject.itemId} />
      </ArtifactViewer>
    )
    : subject.kind === 'deliverable' ? (
      <ArtifactViewer open onClose={close} title={subject.title}>
        <DeliverableBody id={subject.id} by={subject.by} at={subject.at} />
      </ArtifactViewer>
    ) : (
      <ArtifactViewer open onClose={close} title={subject.title}>
        <TextBody text={subject.text} by={subject.by} note={subject.note} />
      </ArtifactViewer>
    );

  return { open, close, isOpen: !!subject, subject, node };
}

// ── THE COMPACT CARD — an artifact in the conversation: the kit's doc handle, one door (Open) ────

/** A prepared/produced artifact as it sits in a conversation (the kit's `doc` card): glyph · title ·
 *  who made it · ONE door, which raises the one viewer. Never the document inlined. */
export function ArtifactCard({ title, type, owner, onOpen, openLabel = 'Open →' }: {
  title: string; type?: string | null; owner?: string | null; onOpen: () => void; openLabel?: string;
}) {
  const dk = docCardTypeOf(type ?? null, null);
  return (
    <ThreadCardView card={{
      kind: 'doc', id: `artifact-${title}`, title, docType: dk.type, typeLabel: dk.label,
      ...(owner ? { owner: owner.split(' ')[0] } : {}), reviewLabel: openLabel, onReview: onOpen,
    }} />
  );
}
