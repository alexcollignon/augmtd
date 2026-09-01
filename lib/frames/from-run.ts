// ════════════════════════════════════════════════════════════════════════════════════════════════
// NEW FRAME FROM AN OUTPUT — the deep-dive's one production door for frames (frames plan law 1).
//
// A delivered run already holds the material; this turns THAT material into a frame through THE ONE
// PRODUCTION DOOR (`materializeDocument`, forceType 'frame'). It mirrors the run loop's own document
// branch exactly — same door, same storage upload with `cacheControl: '0'` (the CDN lesson), same
// artifact row shape, same landing in the run's OWN thread. Nothing here re-implements production.
//
// THE FRAMES THIS DOOR MAKES ARE BOUND (law 4): they are run-born, so they carry
// `binding {workflowId, refresh:'on_run'}` — the same stamp the run loop writes, which is what lets
// a shared link resolve forward to the newest generation of the series instead of freezing.
// LIMITATION, deliberate and shared with the run loop: `workflowId` alone identifies the series.
//
// NO SILENT DOCX: if the frame lane declines (the layout model could not produce a valid,
// no-egress frame), this door REFUSES with `declined` and writes nothing. A .docx wearing the word
// "frame" would be the lie law 1 forbids — the caller says so plainly instead.
//
// ONE INDISTINGUISHABLE REFUSAL: an unknown workflow, a foreign workflow, a run that belongs to a
// different workflow, a foreign run and a run with nothing to lay out all resolve to `not_found`.
// A refusal that says WHICH of those it was is an existence oracle.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FrameDeclineReason, FrameDiagnostics } from '@/lib/frames/generate-frame';

export type FrameFromRunResult =
  | { ok: true; artifactId: string }
  /** Unknown / foreign / unusable — one shape for all of them. */
  | { ok: false; reason: 'not_found' }
  /** The frame lane declined. The caller says so; it never ships another kind in a frame's name.
   *  `cause` is the OBSERVED reason (FrameDeclineReason), never a guess about the material —
   *  the door's copy is chosen from it. Absent when the lane failed without naming itself. */
  | { ok: false; reason: 'declined'; cause?: FrameDeclineReason };

const NOT_FOUND = { ok: false, reason: 'not_found' } as const;

/** The run's deliverable text — the LAST step's output, exactly as the run loop reads it. */
function finalTextOf(stepOutputs: unknown): string {
  const outs = Array.isArray(stepOutputs) ? (stepOutputs as Array<{ output?: unknown }>) : [];
  const last = outs[outs.length - 1];
  if (!last) return '';
  return typeof last.output === 'string' ? last.output : JSON.stringify(last.output ?? '', null, 2);
}

/**
 * @param client the CALLER'S OWN session (RLS) — ownership is proved here, before any admin use.
 * @param admin  the service-role client — storage + the thread write, after the proof.
 */
export async function createFrameFromRun(
  client: SupabaseClient,
  admin: SupabaseClient,
  userId: string,
  args: { workflowId: string; runId: string },
): Promise<FrameFromRunResult> {
  const { workflowId, runId } = args;
  if (!workflowId || !runId) return NOT_FOUND;

  // ── THE PROOF, on the caller's own session. The workflow must be theirs… ──
  const { data: wfRow } = await client
    .from('workflows')
    .select('id, name')
    .eq('id', workflowId)
    .eq('user_id', userId)
    .maybeSingle();
  const workflow = wfRow as { id: string; name: string | null } | null;
  if (!workflow) return NOT_FOUND;

  // ── …and the run must be theirs AND belong to THIS workflow. ──
  const { data: runRow } = await client
    .from('workflow_runs')
    .select('id, status, thread_id, step_outputs, created_at, completed_at')
    .eq('id', runId)
    .eq('workflow_id', workflowId)
    .eq('user_id', userId)
    .maybeSingle();
  const run = runRow as {
    id: string; status: string; thread_id: string | null; step_outputs: unknown;
  } | null;
  if (!run || run.status !== 'succeeded') return NOT_FOUND;
  // The frame has to LIVE somewhere: the run's own thread is its home (that is also the surface
  // the deep-dive reads back). No thread, nothing to append to — the same one refusal.
  if (!run.thread_id) return NOT_FOUND;

  const content = finalTextOf(run.step_outputs);
  if (!content.trim()) return NOT_FOUND;

  const title = (workflow.name || 'Frame').slice(0, 120);

  // ── THE ONE PRODUCTION DOOR, forced onto the frame lane. ──
  // THE HONEST CAUSE rides out with the refusal: this door ASKED for a frame, so when the lane
  // declines the user is owed the observed reason (too large / rejected / transient), not a
  // sentence about the run's shape that nothing measured.
  const frameDiagnostics: FrameDiagnostics = {};
  const { materializeDocument } = await import('@/lib/documents/materialize');
  const m = await materializeDocument(admin, userId, {
    title,
    content,
    request: title,
    forceType: 'frame',
    frameDiagnostics,
  });
  if (m.type !== 'frame') {
    console.warn(
      `[frames/from-run] declined for run ${runId}: ${frameDiagnostics.reason ?? 'unknown'} — ${frameDiagnostics.detail ?? 'no detail recorded'}`,
    );
    return { ok: false, reason: 'declined', cause: frameDiagnostics.reason };
  }

  const outTitle = (typeof m.content === 'object' && m.content && 'title' in m.content && m.content.title)
    ? String(m.content.title)
    : title;

  // ── THE SERIES, NOT A SIBLING (frames plan, THE FRAME SERIES): a workflow that already has a
  // head gains a VERSION on that same identity; no head → this founds one. Same door, same
  // upload rules (cacheControl '0'), same thread — but never a stray twin whose share link
  // freezes while the real series moves on. `upsertFrameSeries` does the thread write itself,
  // because a head updates IN PLACE. ──
  const { upsertFrameSeries } = await import('@/lib/frames/series');
  const res = await upsertFrameSeries(admin, {
    userId,
    threadId: run.thread_id,
    workflowId,
    runId,
    title: outTitle,
    bytes: m.bytes,
    mime: m.mime,
    content: m.content,
    provenance: m.provenance ?? null,
  });

  // The HEAD's id — the identity, which is what every surface should address.
  return { ok: true, artifactId: res.artifactId };
}
