'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE VERSION PICKER — the frame-series surface half (frames plan, THE FRAME SERIES, Aug 20).
//
// ONE IDENTITY PER SERIES: the head is always the present, and every earlier generation stays
// addressable behind it (the Claude code-artifact idiom). This picker is the ONE way both surfaces
// — the full-screen address and the gallery's side panel — walk that history, so the two can never
// disagree about what "Current" means or how a version is named.
//
// WHAT IT CLAIMS, EXACTLY:
//  · "Current" is the head, always live. Every other row is a dated record.
//  · A version row is labeled with its DAY AND TIME — two runs on one day must be tellable apart
//    (the lesson already learned on the from-run picker).
//  · Selecting a version is a READ. Nothing here writes, re-runs, restores or promotes: history is
//    a record, and turning a record back into the present would be a deed.
//
// It renders NOTHING when there is no history — an empty picker on a one-shot frame would suggest
// versions exist. Chat-born frames are honest one-shots and stay picker-less by construction.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The version meta the authed door serves alongside the head (engine contract). */
export type FrameVersionMeta = { v: number; generatedAt?: string | null };

/** The picker's clock — day AND time, so two same-day generations are distinguishable. */
export function fmtVersionMoment(iso?: string | null): string {
  if (!iso) return 'an earlier run';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'an earlier run';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The standing line that rides above an old version. One sentence, both surfaces. */
export function versionBanner(sel: FrameVersionMeta | null): string | undefined {
  if (!sel) return undefined;
  return `Version from ${fmtVersionMoment(sel.generatedAt)} — the current one is live.`;
}

/** Newest first; "Current" is not in the list — it is the null value. */
export function sortVersions(versions: FrameVersionMeta[]): FrameVersionMeta[] {
  return [...versions].sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
}

/**
 * THE ROWS THAT CAN ACTUALLY BE SERVED — no lying doors. A stored generation is addressable only
 * while its bytes exist (the series caps at 20 and removes the overflow), and the serving door
 * refuses a version without a `storagePath` with the same 404 an unknown id gets. So a row without
 * one is never offered. Reads the raw stored array — the HEAD is not in it (it IS "Current").
 */
export function usableVersions(raw: unknown): FrameVersionMeta[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: FrameVersionMeta[] = [];
  for (const e of list as Array<{ v?: unknown; storagePath?: unknown; generatedAt?: unknown }>) {
    if (typeof e?.v !== 'number' || typeof e?.storagePath !== 'string' || !e.storagePath) continue;
    out.push({ v: e.v, generatedAt: typeof e.generatedAt === 'string' ? e.generatedAt : null });
  }
  return sortVersions(out);
}

export function FrameVersionPicker({
  versions, value, onChange, compact = false,
}: {
  versions: FrameVersionMeta[];
  /** null = Current (the head). A number = that stored version. */
  value: number | null;
  onChange: (v: number | null) => void;
  /** The side panel's tighter type scale; the full-screen bar uses the default. */
  compact?: boolean;
}) {
  const rows = sortVersions(versions);
  if (rows.length === 0) return null;

  return (
    <select
      value={value === null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      aria-label="Version"
      title="Version history"
      className={
        compact
          ? 'max-w-[220px] rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11.5px] text-neutral-600 focus:border-indigo-300 focus:outline-none'
          : 'max-w-[260px] rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[12.5px] text-neutral-600 focus:border-indigo-300 focus:outline-none'
      }
    >
      <option value="">Current</option>
      {rows.map((r) => (
        <option key={r.v} value={r.v}>{fmtVersionMoment(r.generatedAt)}</option>
      ))}
    </select>
  );
}

export default FrameVersionPicker;
