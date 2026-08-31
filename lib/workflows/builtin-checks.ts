// ─── THE BUILT-INS MAP (guardrails arc, docs/guardrails-plan.md) ──────────────
// The static, truthful record of the QA the ENGINE runs for each step type — surfaced as the
// Studio's edge chip + the gate panel's locked list. These are properties of the executors
// (hardcoded in lib/tools/* and execute-step.ts), so a static map is honest by construction.
// LAW: only claim a check the engine actually runs. A step type with nothing meaningful gets
// null — no chip. Pure data, no imports from app/.

import type { WorkflowStep, ToolStep } from './types';

export interface BuiltinChecks {
  title: string;     // "Built-in on this step"
  lines: string[];   // one plain sentence per check
}

// Per-tool checks — each line maps to real executor behavior (see lib/tools/*).
const TOOL_CHECKS: Record<string, string[]> = {
  rss_feed: [
    'Every item carries its publication date — stale items are dropped',
    'Only items newer than the last run are considered',
  ],
  fetch_url: [
    'The page’s publication date is detected and stamped',
    'Undated pages are flagged as undated — never assumed current',
  ],
  web_search: [
    'Results carry their published date when known',
    'Undated results are marked "do not assume current"',
  ],
  deep_research: [
    'Sources carry their published dates when known',
    'Undated sources are marked "do not assume current"',
  ],
  get_pt_tenders: [
    'The day window is enforced in code, not trusted to the API',
    'Signing and publication dates print with every tender',
  ],
  run_compute: [
    'Code runs in a locked sandbox with no network access',
    'Only the files you declared are readable inside it',
  ],
  get_emails: ['Reads only your own connected mailbox'],
  get_meeting_context: ['Reads only your own calendar and meetings'],
  read_kb_file: ['Reads only files in your own knowledge base'],
  read_kb_folder: [
    'Reads only folders in your own knowledge base',
    'Every file in the folder is read — nothing is dropped in silence',
  ],
  search_knowledge_base: ['Searches only your own knowledge base'],
  slack_read_channel: ['Reads only channels your coworker’s app was invited to'],
  slack_send: ['Channel posts carry an attribution label naming whose coworker posted'],
  forward_email: ['Recipients are never invented — only literal addresses you stated'],
  send_calendar_invite: ['Times are grounded in your own timezone and calendar'],
  find_team_work: ['Reads only your own coworkers’ outputs'],
  get_workflow_output: ['Reads only your own tasks’ outputs'],
};

/** The engine guarantees for one step, or null when nothing meaningful applies (no chip). */
export function builtinChecksFor(step: WorkflowStep): BuiltinChecks | null {
  if (step.type === 'tool') {
    const lines = TOOL_CHECKS[(step as ToolStep).tool];
    return lines ? { title: 'Built-in on this step', lines } : null;
  }
  if (step.type === 'ai') {
    // NOTE: the "its instruction is the brief" claim is POSITIONAL (only the step feeding the
    // gate gets its prompt enforced), so the UI appends it conditionally — never claimed here.
    return {
      title: 'Built-in on this step',
      lines: [
        'Today’s date is pinned — old material can’t be rewritten as current',
        'All previous steps ride along as source material, freshest kept whole',
      ],
    };
  }
  // verify/approval are gates (they ARE the check); agent steps make no per-step claim.
  return null;
}

/** The gate panel's locked "Always checked — built in" list (the verify gate's own floors). */
export const GATE_BUILTIN_LINES: string[] = [
  'Numbers are recomputed by code — sums, percentages, dates',
  'Every claim is checked against this run’s sources',
  'Citations must point at real source links',
  'Old material is never presented as current news',
  'The writing step’s own instruction is honored — language, structure, length',
];
