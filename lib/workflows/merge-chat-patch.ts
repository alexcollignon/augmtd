// The Studio chat's patch, merged over the workflow it was written against (app/api/workflows/[id]/chat).
import type { Workflow } from '@/lib/workflows/types';

/**
 * THE PATCH KEEPS WHAT IT DIDN'T TOUCH (W37, found by the build.workflow-chat eval: the model saw a
 * 200-character `prompt_preview` of each ai step and returned it AS the step — the Studio, which replaces
 * `steps` wholesale, would have cut every ai prompt to its preview and stamped summary-only fields on
 * every step). Code merges each returned step over the ORIGINAL step with the same id: summary-only keys
 * are dropped, an ai prompt the model did not rewrite is kept, and a tool step's config is merged
 * key-by-key. New steps (unknown ids) pass through. Pure.
 */
export function mergePatchSteps(workflow: Partial<Workflow>, patch: Partial<Workflow>): Partial<Workflow> {
  // The prompt asks for only the CHANGED keys of trigger / output_config, and the Studio replaces each
  // top-level key wholesale — so a schedule change ({cron, label}) dropped the trigger's type and zone
  // (W37 confirm run). Object-valued keys are merged over the workflow's own.
  const objKeys = ['trigger', 'output_config'] as const;
  const merged0: Record<string, unknown> = { ...patch };
  for (const k of objKeys) {
    const o = (workflow as Record<string, unknown>)[k], p = (patch as Record<string, unknown>)[k];
    if (o && typeof o === 'object' && !Array.isArray(o) && p && typeof p === 'object' && !Array.isArray(p)) merged0[k] = { ...(o as object), ...(p as object) };
  }
  patch = merged0 as Partial<Workflow>;
  if (!Array.isArray(patch.steps)) return patch;
  const original = new Map(((workflow.steps ?? []) as unknown as Array<Record<string, unknown>>).map((s) => [String(s.id), s]));
  const steps = (patch.steps as unknown as Array<Record<string, unknown>>).map((raw) => {
    const { index: _i, prompt_preview: preview, ...p } = raw ?? {};
    void _i;
    const orig = original.get(String(p.id));
    if (!orig) return p;
    const merged: Record<string, unknown> = { ...orig, ...p };
    if (orig.config && typeof orig.config === 'object' && p.config && typeof p.config === 'object') {
      merged.config = { ...(orig.config as Record<string, unknown>), ...(p.config as Record<string, unknown>) };
    }
    // A prompt equal to (or missing beside) the summary preview is the preview, not an edit.
    const origPrompt = typeof orig.prompt === 'string' ? orig.prompt : null;
    if (origPrompt != null) {
      const sent = typeof p.prompt === 'string' ? p.prompt : null;
      const previewOf = origPrompt.slice(0, 200);
      if (sent == null || sent === previewOf || (typeof preview === 'string' && sent === preview)) merged.prompt = origPrompt;
    }
    return merged;
  });
  return { ...patch, steps: steps as unknown as Workflow['steps'] };
}
