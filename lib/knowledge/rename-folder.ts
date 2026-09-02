// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RENAME HEAL — a folder rename FOLLOWS ITS POINTERS.
//
// A knowledge folder is bound BY NAME, not by id: `read_kb_folder` takes `config.folder`,
// `match_to_profiles` takes `config.profiles_folder`, and the profile manifest is KEYED by the
// folder name (item_plans.entity_id). So a bare rename of the `drive_folders` row silently
// unhooks every workflow step aiming at it and orphans its manifest — the caveat the folders
// surface shipped with as a tooltip warning. This module makes the rename whole instead: the
// pointers move with the name, and the panel can state it as a fact.
//
// ── ORDER OF OPERATIONS (and why) ───────────────────────────────────────────────────────────────
// There is no transaction across these tables, so the order is chosen to make every reachable
// failure leave the OLD name fully intact:
//   1. VALIDATE  — the folder exists, is not a system folder, and no other folder already wears
//                  the new name (the same 409 rule creation enforces: one name, one folder).
//   2. POINTERS  — workflow steps, then the manifest. Every write is RECORDED as an undo.
//   3. THE ROW   — the folder's own name goes LAST, and only if every pointer landed.
// If a pointer write fails we roll back the ones that succeeded and refuse; if the final row
// rename fails we roll the pointers back too. The half-state this exists to prevent — steps
// naming a folder that no longer exists — is therefore unreachable through this door. A rollback
// that itself fails is REPORTED, never swallowed: a lie about a half-move is worse than the move.
//
// Matching is exact on the trimmed, case-folded name — deliberately NOT the fuzzy token ladder
// `read_kb_folder` resolves with at run time. A heal may only re-point what unambiguously names
// THIS folder; guessing at a near-spelling would silently re-aim a step at a folder the user never
// meant (the ladder's own law: guess within one folder's spellings, never BETWEEN folders).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { PROFILE_MANIFEST_KIND } from '@/lib/matching/manifest';

/** The two config keys that bind a step to a folder by name. Adding a folder-taking tool means
 *  adding its key HERE — the one table the heal walks. */
export const FOLDER_CONFIG_KEYS: Record<string, string> = {
  read_kb_folder: 'folder',
  match_to_profiles: 'profiles_folder',
};

export type RenameResult = {
  ok: true;
  folder: { id: string; name: string; parent_id: string | null; is_system: boolean; system_key: string | null; created_at: string };
  repointedSteps: number;
  repointedWorkflows: number;
  manifestMoved: boolean;
};
export type RenameRefusal = { ok: false; status: number; error: string };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type Step = { type?: string; tool?: string; config?: Record<string, unknown> };

/** Re-point one workflow's steps. Returns the rewritten steps and how many changed. */
export function repointSteps(steps: unknown, oldName: string, newName: string): { steps: Step[]; changed: number } {
  const arr = Array.isArray(steps) ? (steps as Step[]) : [];
  let changed = 0;
  const out = arr.map((s) => {
    const key = s?.tool ? FOLDER_CONFIG_KEYS[s.tool] : undefined;
    if (!key) return s;
    const cur = s.config?.[key];
    if (typeof cur !== 'string' || !same(cur, oldName)) return s;
    changed++;
    return { ...s, config: { ...(s.config ?? {}), [key]: newName } };
  });
  return { steps: out, changed };
}

export async function renameKnowledgeFolder(
  sb: SupabaseClient, userId: string, folderId: string, rawName: string,
): Promise<RenameResult | RenameRefusal> {
  const newName = String(rawName ?? '').trim();
  if (!newName) return { ok: false, status: 400, error: 'name is required' };

  // ── 1. VALIDATE ────────────────────────────────────────────────────────────────────────────
  const { data: folder } = await sb.from('drive_folders')
    .select('id, name, is_system').eq('id', folderId).eq('user_id', userId).maybeSingle();
  if (!folder) return { ok: false, status: 404, error: 'Folder not found' };
  const f = folder as { id: string; name: string; is_system: boolean };
  if (f.is_system) return { ok: false, status: 409, error: 'This folder is managed by the system.' };

  const oldName = f.name;
  if (same(oldName, newName)) {
    // A no-op rename (or a pure case change) touches no pointer — they already resolve.
    const { data } = await sb.from('drive_folders')
      .update({ name: newName, updated_at: new Date().toISOString() })
      .eq('id', folderId).eq('user_id', userId)
      .select('id, name, parent_id, is_system, system_key, created_at').single();
    return { ok: true, folder: data as RenameResult['folder'], repointedSteps: 0, repointedWorkflows: 0, manifestMoved: false };
  }

  // ONE NAME, ONE FOLDER — the same rule creation enforces. Two folders sharing a name make every
  // by-name step ambiguous, which is exactly what this heal exists to prevent.
  const { data: clash } = await sb.from('drive_folders')
    .select('id').eq('user_id', userId).ilike('name', newName).neq('id', folderId).limit(1);
  if ((clash ?? []).length) {
    return { ok: false, status: 409, error: `You already have a folder called "${newName}".` };
  }

  // ── 2. POINTERS (recorded, so any failure can be undone) ───────────────────────────────────
  const undo: Array<() => Promise<{ error: { message: string } | null }>> = [];
  const fail = async (msg: string): Promise<RenameRefusal> => {
    const failures: string[] = [];
    for (const u of undo.reverse()) {
      try { const { error } = await u(); if (error) failures.push(error.message); }
      catch (e) { failures.push(String(e)); }
    }
    // The rollback's own outcome is part of the truth we return.
    return {
      ok: false, status: 500,
      error: failures.length
        ? `${msg} — and the rollback did not fully complete (${failures.join('; ')}). The folder is still "${oldName}".`
        : `${msg} — nothing was changed; the folder is still "${oldName}".`,
    };
  };

  let repointedSteps = 0, repointedWorkflows = 0;
  const { data: wfs, error: wfErr } = await sb.from('workflows')
    .select('id, steps').eq('user_id', userId);
  if (wfErr) return { ok: false, status: 500, error: `could not read workflows: ${wfErr.message}` };

  for (const w of (wfs ?? []) as Array<{ id: string; steps: unknown }>) {
    const { steps, changed } = repointSteps(w.steps, oldName, newName);
    if (!changed) continue;
    const before = w.steps;
    const { error } = await sb.from('workflows').update({ steps }).eq('id', w.id).eq('user_id', userId);
    if (error) return await fail(`could not re-point workflow steps: ${error.message}`);
    undo.push(async () => await sb.from('workflows').update({ steps: before }).eq('id', w.id).eq('user_id', userId));
    repointedSteps += changed;
    repointedWorkflows++;
  }

  // The manifest is keyed by folder name (item_plans.entity_id) AND names its folder inside its
  // own payload — both halves move, or the matcher refuses to read it as another collection's.
  let manifestMoved = false;
  const { data: man } = await sb.from('item_plans')
    .select('id, tasks').eq('user_id', userId).eq('kind', PROFILE_MANIFEST_KIND).eq('entity_id', oldName).maybeSingle();
  if (man) {
    const row = man as { id: string; tasks: Record<string, unknown> | null };
    const moved = { ...(row.tasks ?? {}), folder: newName };
    const write = async () => sb.from('item_plans')
      .update({ entity_id: newName, tasks: moved as never, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('user_id', userId);
    let { error } = await write();
    if (error && /duplicate key|23505/i.test(error.message)) {
      // A manifest already sitting at the new name is an ORPHAN — the duplicate-folder check above
      // proves no folder wears that name, so nothing can be reading it. Clear it and retry once.
      await sb.from('item_plans').delete()
        .eq('user_id', userId).eq('kind', PROFILE_MANIFEST_KIND).eq('entity_id', newName).neq('id', row.id);
      ({ error } = await write());
    }
    if (error) return await fail(`could not move the profile manifest: ${error.message}`);
    undo.push(async () => await sb.from('item_plans')
      .update({ entity_id: oldName, tasks: (row.tasks ?? {}) as never }).eq('id', row.id).eq('user_id', userId));
    manifestMoved = true;
  }

  // ── 3. THE FOLDER ROW, LAST ────────────────────────────────────────────────────────────────
  const { data: renamed, error: renameErr } = await sb.from('drive_folders')
    .update({ name: newName, updated_at: new Date().toISOString() })
    .eq('id', folderId).eq('user_id', userId)
    .select('id, name, parent_id, is_system, system_key, created_at').single();
  if (renameErr || !renamed) return await fail(`could not rename the folder: ${renameErr?.message ?? 'no row'}`);

  return {
    ok: true, folder: renamed as RenameResult['folder'],
    repointedSteps, repointedWorkflows, manifestMoved,
  };
}
