// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE INPUTS TRAY (THE RELAY CANVAS W2 — docs/relay-canvas-plan.md, law 7: INPUTS ARE VISIBLE).
//
// A workflow's reference material — the policy, the template, the rubric — used to be a buried
// skill or a step's kb_file_ids nobody could see from the rail. It is now FIRST-CLASS CONFIG: a
// pinned tray on the WHEN endpoint, authored through the workflow PATCH, served on the workflow
// GET, and carried INTO the run as a `[WORKFLOW INPUTS]` block every ai step reads.
//
// STORE (build decision, Aug 22 — NO migration; the `workflow_owner` / `workflow_scope` /
// `frame_share` precedent): `item_plans` kind='workflow_inputs', entity_id=<workflowId>,
// user_id=<the workflow's owner-of-record, i.e. the caller who authored it>, tasks =
// { docs: [{kbFileId, name}], acceptMaterial }. ABSENT ROW = never configured (served as `null`,
// which is NOT the same as "configured with nothing").
//
// LAWS HELD HERE:
//   • A PINNED DOC IS THE CALLER'S OWN. Validation reads knowledge_files under the caller's id; a
//     kbFileId that is not theirs is DROPPED, never stored — a workflow can't be made to read a
//     stranger's document by hand-crafting a PATCH body.
//   • EMPTY IS DELETED. No docs and no material flag = the row is removed, so `null` keeps meaning
//     "never configured" and a stale empty row never masquerades as configuration.
//   • THE EXCERPT-HONESTY LAW (lib/utils/clip-for-prompt): every doc head is cut at a whitespace
//     boundary and DECLARES the cut with EXCERPT_MARK; the block carries EXCERPT_RULE so a reader
//     can never mistake OUR clipping for the document being truncated.
//   • A DOC WITH NOTHING IN HAND SAYS SO. A pinned file that has not finished indexing is named in
//     the block with an honest line — never silently absent (an absent doc reads as "no such rule
//     exists", which is exactly the lie the tray exists to prevent).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

export const INPUTS_KIND = 'workflow_inputs';

/** Per-doc and whole-block ceilings. The per-doc share shrinks with the number of docs so EVERY
 *  pinned doc is represented — a tray that silently drops its tail is the absent-doc lie again. */
export const INPUT_DOC_MAX_CHARS = 8_000;
export const INPUTS_BLOCK_MAX_CHARS = 24_000;

/** The run-time material door's ceiling (POST /api/workflows/[id]/run). */
export const MATERIAL_MAX_CHARS = 20_000;

export interface WorkflowInputDoc {
  kbFileId: string;
  name: string;
}

export interface WorkflowInputs {
  docs: WorkflowInputDoc[];
  /** Whether the Run-now door offers a material box. Config, not a run-time fact. */
  acceptMaterial: boolean;
}

function asDocs(raw: unknown): WorkflowInputDoc[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkflowInputDoc[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const rec = (r && typeof r === 'object') ? (r as Record<string, unknown>) : {};
    const kbFileId = String(rec.kbFileId ?? '').trim();
    if (!kbFileId || seen.has(kbFileId)) continue;
    seen.add(kbFileId);
    out.push({ kbFileId, name: String(rec.name ?? '').trim().slice(0, 200) || 'Document' });
    if (out.length >= 20) break;
  }
  return out;
}

/** THE READ. `null` = never configured (the absence IS the answer). Never throws: a store read
 *  that fails degrades to "no tray", never breaks a run or a page. */
export async function readWorkflowInputs(
  admin: SupabaseClient, userId: string, workflowId: string,
): Promise<WorkflowInputs | null> {
  try {
    const { data, error } = await admin.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', INPUTS_KIND).eq('entity_id', workflowId)
      .maybeSingle();
    if (error || !data) return null;
    const t = (data.tasks ?? null) as { docs?: unknown; acceptMaterial?: unknown } | null;
    if (!t) return null;
    return { docs: asDocs(t.docs), acceptMaterial: t.acceptMaterial === true };
  } catch {
    return null;
  }
}

/** THE WRITE. Docs are validated against the CALLER'S OWN knowledge_files (a foreign id is
 *  dropped, never stored); names are re-derived from the file row so a hand-written label can't
 *  misname a real document. Empty docs + acceptMaterial:false deletes the row. */
export async function writeWorkflowInputs(
  admin: SupabaseClient, userId: string, workflowId: string, raw: unknown,
): Promise<{ ok: true; inputs: WorkflowInputs | null; dropped: number } | { ok: false; error: string }> {
  const rec = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const wanted = asDocs(rec.docs);
  const acceptMaterial = rec.acceptMaterial === true;

  let docs: WorkflowInputDoc[] = [];
  if (wanted.length) {
    const { data, error } = await admin.from('knowledge_files')
      .select('id, filename')
      .eq('user_id', userId)
      .in('id', wanted.map(d => d.kbFileId));
    if (error) return { ok: false, error: 'the pinned documents could not be verified' };
    const mine = new Map<string, string>();
    for (const r of (data ?? []) as Array<{ id: string; filename: string | null }>) {
      mine.set(String(r.id), String(r.filename ?? '').trim());
    }
    // Authoring order is preserved; a foreign / deleted id simply is not in the map.
    docs = wanted
      .filter(d => mine.has(d.kbFileId))
      .map(d => ({ kbFileId: d.kbFileId, name: mine.get(d.kbFileId) || d.name }));
  }
  const dropped = wanted.length - docs.length;

  const nowIso = new Date().toISOString();
  if (!docs.length && !acceptMaterial) {
    const { error } = await admin.from('item_plans').delete()
      .eq('user_id', userId).eq('kind', INPUTS_KIND).eq('entity_id', workflowId);
    if (error) return { ok: false, error: 'the inputs could not be cleared' };
    return { ok: true, inputs: null, dropped };
  }

  const inputs: WorkflowInputs = { docs, acceptMaterial };
  const { error } = await admin.from('item_plans').upsert({
    user_id: userId, kind: INPUTS_KIND, entity_id: workflowId,
    tasks: inputs, updated_at: nowIso,
  }, { onConflict: 'user_id,kind,entity_id' });
  if (error) return { ok: false, error: 'the inputs could not be saved' };
  return { ok: true, inputs, dropped };
}

/** The cheap, real read of a document's text: `knowledge_files.extracted_text` is written by the
 *  indexer in the same upsert that creates the row, so it is ONE query for the whole tray. Chunks
 *  are the fallback for the rare row whose text landed only as chunks (legacy / re-chunked rows) —
 *  a second query, and only for the files that need it. */
async function textsFor(
  admin: SupabaseClient, userId: string, ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const { data } = await admin.from('knowledge_files')
      .select('id, extracted_text').eq('user_id', userId).in('id', ids);
    for (const r of (data ?? []) as Array<{ id: string; extracted_text: string | null }>) {
      const t = String(r.extracted_text ?? '').trim();
      if (t) out.set(String(r.id), t);
    }
  } catch { /* the honest not-in-hand line is the degradation */ }

  const missing = ids.filter(id => !out.has(id));
  if (!missing.length) return out;
  try {
    const { data } = await admin.from('knowledge_chunks')
      .select('file_id, chunk_index, content')
      .eq('user_id', userId).in('file_id', missing)
      .order('chunk_index', { ascending: true })
      .limit(missing.length * 12);
    const byFile = new Map<string, string[]>();
    for (const c of (data ?? []) as Array<{ file_id: string; content: string | null }>) {
      const arr = byFile.get(String(c.file_id)) ?? [];
      arr.push(String(c.content ?? ''));
      byFile.set(String(c.file_id), arr);
    }
    for (const [fid, parts] of byFile) {
      const joined = parts.join('\n\n').trim();
      if (joined) out.set(fid, joined);
    }
  } catch { /* same degradation */ }
  return out;
}

/** THE BLOCK THE RUN CARRIES. One `[WORKFLOW INPUTS …]` section, one entry per pinned doc, every
 *  cut whitespace-bounded and declared. Returns null when there is nothing to say. */
export async function buildInputsBlock(
  admin: SupabaseClient, userId: string, docs: WorkflowInputDoc[], budget?: number,
): Promise<string | null> {
  if (!docs?.length) return null;
  const total = Math.max(1_000, budget ?? INPUTS_BLOCK_MAX_CHARS);
  // EVERY doc gets a share — the tail is never dropped for the head's benefit.
  const perDoc = Math.max(400, Math.min(INPUT_DOC_MAX_CHARS, Math.floor(total / docs.length)));

  const texts = await textsFor(admin, userId, docs.map(d => d.kbFileId));

  const entries = docs.map((d) => {
    const name = d.name || 'Document';
    const text = (texts.get(d.kbFileId) ?? '').replace(/\r\n/g, '\n').trim();
    if (!text) {
      // NEVER SILENTLY ABSENT — a pinned doc with nothing in hand says so in its own words.
      return `— ${name} — not yet indexed; its content is not in hand.`;
    }
    return `— ${name}:\n${clipForPrompt(text, perDoc)}`;
  });

  return (
    `[WORKFLOW INPUTS — reference material pinned to this workflow]\n` +
    `These documents are the standing reference for this work (policies, templates, rubrics). ` +
    `Follow them; they are not the run's new material.\n${EXCERPT_RULE}\n\n` +
    entries.join('\n\n')
  );
}

/** THE MATERIAL DOOR's block (POST /api/workflows/[id]/run `{ material }`). Whitespace-honest cut,
 *  declared like every other prompt-bound clip. Returns null for nothing worth carrying. */
export function materialBlock(material: { text?: unknown; name?: unknown } | null | undefined): string | null {
  const text = String(material?.text ?? '').trim();
  if (!text) return null;
  const name = String(material?.name ?? '').trim().slice(0, 120);
  return (
    `[MANUAL MATERIAL — provided at run time${name ? `: ${name}` : ''}]\n` +
    `${EXCERPT_RULE}\n\n${clipForPrompt(text, MATERIAL_MAX_CHARS)}`
  );
}
