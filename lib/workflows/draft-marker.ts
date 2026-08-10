// ─── The workflow-draft marker (coherence slice #2) ───────────────────────────
// A drafting tool (coworker create_task) embeds its draft as a marker in the TOOL RESULT; both
// chat runtimes parse it runtime-side into a card event — never dependent on the model echoing
// base64. Isomorphic: server encodes, client decodes.

import type { WorkflowDraft } from '@/components/workflows/workflow-draft-card';
export type { WorkflowDraft };

export function encodeWorkflowDraftMarker(draft: WorkflowDraft): string {
  return `[[workflow_draft:${Buffer.from(JSON.stringify(draft), 'utf8').toString('base64')}]]`;
}

export function parseWorkflowDraftMarker(text: string): { draft: WorkflowDraft | null; cleaned: string } {
  const m = text.match(/\[\[workflow_draft:([A-Za-z0-9+/=]+)\]\]/);
  if (!m) return { draft: null, cleaned: text };
  let draft: WorkflowDraft | null = null;
  try {
    const json = typeof window === 'undefined'
      ? Buffer.from(m[1], 'base64').toString('utf8')
      : new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
    draft = JSON.parse(json) as WorkflowDraft;
  } catch { /* a malformed marker renders as nothing, never crashes the chat */ }
  return { draft, cleaned: text.replace(m[0], '').trim() };
}
