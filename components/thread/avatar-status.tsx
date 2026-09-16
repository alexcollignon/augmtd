'use client';

import React from 'react';
import { WorkerFace } from '@/components/work/worker-face';
import { cn } from '@/lib/cn';
import type { AvatarStatus } from './types';

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE AVATAR IS THE STATUS SYSTEM (docs/threads-plan.md · docs/design/threads/AvatarStates.dc.html)
 *
 * One universal signal replaces spinners, "preparing…" chips and tool-call narration:
 *   still        — nothing running, nothing owed
 *   working      — an orbiting arc while their run / delegation / sandbox job is live
 *   needs you    — a badge: an approval, an input, a decision waiting in the thread
 *   blocked      — dimmed + a red mark; the THREAD says why, spoken (the mark never explains)
 *
 * THE MOTION BUDGET is spent here and on card arrival, nowhere else — and every animation is
 * switched OFF under `prefers-reduced-motion: reduce`. The ring and the badge are exported as
 * composable pieces because the sidebar wears the same grammar (same visual, same meaning).
 *
 * THE ONE FACE: this WRAPS `components/work/worker-face.tsx` — it never forks the headshot.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The status stylesheet, hoisted + deduped by React 19 via `href`, so N avatars ship ONE copy. */
function AvatarMotionStyles() {
  return (
    <style href="aug-thread-avatar-motion" precedence="default">{`
@keyframes aug-ringspin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes aug-softpulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.12); opacity: 0.85; } }
.aug-workring { animation: aug-ringspin 2.4s linear infinite; }
.aug-needpulse { animation: aug-softpulse 2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .aug-workring, .aug-needpulse { animation: none; } }
`}</style>
  );
}

// A face's accent is DERIVED from its stable id — never assigned per person in code, so a custom
// or re-branded roster colours itself (the agnostic doctrine).
const ACCENTS = ['#6366f1', '#0d9488', '#d97706', '#7c3aed', '#0284c7', '#db2777'];

export function accentFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

/** The orbiting arc — a 20% arc of the circle, spinning once per 2.4s. */
export function WorkRing({ size, color }: { size: number; color: string }) {
  const pad = Math.max(2, Math.round(size * 0.14));
  const box = size + pad * 2;
  const r = box / 2 - pad / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="aug-workring pointer-events-none absolute"
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      style={{ top: -pad, left: -pad }}
      aria-hidden
    >
      <circle
        cx={box / 2} cy={box / 2} r={r} fill="none" stroke={color}
        strokeWidth={Math.max(1.4, size * 0.05 + 0.4)}
        strokeDasharray={`${c * 0.2} ${c * 0.8}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The needs-you badge — a count, indigo, softly pulsing. */
export function NeedsYouBadge({ size, count }: { size: number; count?: number }) {
  const d = Math.max(14, Math.round(size * 0.4));
  return (
    <span
      className="aug-needpulse absolute flex items-center justify-center rounded-full border-2 border-white bg-indigo-600 font-semibold text-white"
      style={{ top: -3, right: -3, minWidth: d, height: d, fontSize: Math.max(9, Math.round(d * 0.6)), padding: '0 4px' }}
    >
      {count && count > 0 ? count : ''}
    </span>
  );
}

/** The blocked mark — dimmed face + a red mark. The mark points; the thread speaks. */
function BlockedMark({ size }: { size: number }) {
  const d = Math.max(12, Math.round(size * 0.36));
  return (
    <span
      className="absolute flex items-center justify-center rounded-full border-2 border-white bg-red-500"
      style={{ bottom: -2, right: -2, width: d, height: d }}
      aria-hidden
    >
      <svg width={Math.round(d * 0.5)} height={Math.round(d * 0.5)} viewBox="0 0 16 16" fill="none">
        <path d="M8 4v5M8 11.5v.5" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export interface AvatarStatusProps {
  name: string;
  /** The stable identity the accent derives from; falls back to the name. */
  actorId?: string;
  size?: number;
  status?: AvatarStatus;
  /** Count on the needs-you badge. */
  count?: number;
  /** One line, present tense, no tool names — surfaced on hover. Reassurance, not supervision. */
  hint?: string;
  className?: string;
}

export function AvatarStatus({
  name, actorId, size = 28, status = 'idle', count, hint, className,
}: AvatarStatusProps) {
  const color = accentFor(actorId || name);
  const statusWord =
    status === 'working' ? `${name} is working` :
    status === 'needs_you' ? `${name} needs you` :
    status === 'blocked' ? `${name} is blocked` : name;
  return (
    <span
      className={cn('relative inline-flex flex-shrink-0', className)}
      style={{ width: size, height: size }}
      title={hint || statusWord}
      aria-label={hint ? `${statusWord} — ${hint}` : statusWord}
    >
      <AvatarMotionStyles />
      {status === 'working' && <WorkRing size={size} color={color} />}
      <span className={cn('inline-flex', status === 'blocked' && 'opacity-55')}>
        <WorkerFace name={name} size={size} />
      </span>
      {status === 'needs_you' && <NeedsYouBadge size={size} count={count} />}
      {status === 'blocked' && <BlockedMark size={size} />}
    </span>
  );
}

/**
 * The header's participant row — overlapping faces, newest state visible.
 *
 * A FACE MUST SAY WHO IT IS (owner walk, Sep 7: "what is that J and L next to Clara?"). Every face
 * already carries its own `title` (AvatarStatus). The PILE names everyone in one hover title, caps
 * at `max` with a quiet "+N" overflow, and — given `onClick` — becomes ONE door to where people and
 * inventory actually live (the drawer). No handler → it stays inert chrome, never a lying button.
 */
export function FacePile({
  faces, size = 26, max = 4, onClick, label,
}: {
  faces: { id: string; name: string; status?: AvatarStatus; count?: number }[];
  size?: number;
  max?: number;
  onClick?: () => void;
  label?: string;
}) {
  const shown = faces.slice(0, max);
  const rest = faces.length - shown.length;
  const names = faces.map((f) => f.name).join(', ');
  const title = label ? `${label} — ${names}` : names;
  const inner = (
    <>
      {shown.map((f, i) => (
        <span key={f.id} className="rounded-full border-2 border-white" style={{ marginLeft: i === 0 ? 0 : -8 }}>
          <AvatarStatus name={f.name} actorId={f.id} size={size} status={f.status} count={f.count} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full border-2 border-white bg-neutral-100 font-semibold text-neutral-500"
          style={{ marginLeft: -8, width: size, height: size, fontSize: Math.round(size * 0.4) }}
        >
          +{rest}
        </span>
      )}
    </>
  );
  if (!onClick) return <span className="flex items-center" title={title}>{inner}</span>;
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      className="aug-focus flex items-center rounded-full transition-opacity hover:opacity-80">
      {inner}
    </button>
  );
}
