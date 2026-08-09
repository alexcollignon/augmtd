// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMPUTED-PRODUCE STAGE (Arc 1 stage 3 — docs/one-surface-plan.md: produce COMPUTES before
// it writes). When a judged `produce` item has real data files staged (the deliverable resolution's
// kb-backed haves), the numbers are computed in the sandbox FIRST — a model-written script over the
// actual files — and the results ride the delegation envelope as COMPUTED FACTS. The coworker then
// WRITES FROM verified numbers instead of asserting them, and the evaluator's arithmetic floor
// confirms the same numbers downstream (belt and braces, both code).
//
// HONESTY LAWS:
//   • The codegen may DECLINE ("skip") — not every produce is data-work; a memo needs no sandbox.
//   • ONE capped repair attempt on a failed script (the evaluator-optimizer pattern), then null.
//   • null NEVER blocks the lane — delegation proceeds exactly as before, just without computed
//     facts (the stage is an enhancement; its absence is the pre-Arc-1 status quo).
//   • The facts block DECLARES its provenance so the drafter treats the numbers as exact.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

/** Which staged files are sandbox-computable: kb-backed raw bytes in a data format. */
export const COMPUTABLE_EXT = /\.(xlsx|xls|csv|tsv|pdf|docx|txt|json)$/i;

export async function computeForProduce(
  admin: SupabaseClient, userId: string,
  args: {
    title: string;                                     // the task in the item's own words
    judgeReason?: string | null;                       // the verdict's why (grounds the script's aim)
    requires?: string[];                               // the judged deliverable inventory labels
    files: Array<{ id: string; filename: string }>;    // kb-backed staged inputs (caller pre-filters)
    entityId?: string | null;                          // the deal — outputs stamp into its world
  },
): Promise<{ facts: string; stamp: string } | null> {
  try {
    if (!args.files.length) return null;
    const { aiCall } = await import('@/lib/ai/call');
    const fileList = args.files.map((f) => f.filename).join(', ');

    // THE DATA PREVIEW (found live: codegen guessed a column name — "invoice_amount" — it had
    // never seen and the script KeyError'd). The KB's extracted_text is the ground truth for
    // column/sheet names; codegen reads the actual head of each input before writing a line.
    const { data: previews } = await admin.from('knowledge_files')
      .select('id, extracted_text').in('id', args.files.map((f) => f.id)).eq('user_id', userId);
    const textOf = new Map((previews ?? []).map((p) => [String(p.id), (p.extracted_text as string | null) ?? null]));
    const previewBlock = args.files.map((f) => {
      const head = textOf.get(f.id)?.trim().slice(0, 700);
      return `--- ${f.filename} (actual head) ---\n${head || '(no preview available — the script must print the columns/structure it finds and use them defensively, never guessed names)'}`;
    }).join('\n');

    const codegen = async (repair?: string) => {
      const day = new Date().toISOString().slice(0, 10);
      const res = await aiCall<{ skip?: string; script?: string }>({
        userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 1600,
        source: 'task_preparation',
        prompt:
          // THE CLOCK (the dated-source law applied to codegen — found live: a script filtered
          // "July" of the model's assumed year against 2026 data and printed a confident 0).
          `Today is ${day}.\n\n` +
          `A colleague must produce: "${args.title.slice(0, 200)}"` +
          (args.judgeReason ? ` (context: ${args.judgeReason.slice(0, 160)})` : '') +
          (args.requires?.length ? `\nThe deliverable must include: ${args.requires.slice(0, 5).join('; ')}` : '') +
          `\n\nInput files available READ-ONLY at /job/inputs/: ${fileList}\n` +
          `THE DATA PREVIEWS (ground truth for column/sheet/field names — use EXACTLY these, never guess):\n${previewBlock}\n\n` +
          `If computing over these files would materially ground the deliverable (totals, reconciliations, ` +
          `breakdowns, extracted tables/figures), write ONE Python script that:\n` +
          `- reads ONLY /job/inputs/<filename> (pandas, openpyxl, pypdf, python-docx, csv, json available; NO network),\n` +
          `- FIRST prints a DATA line: rows read and the actual date range PRESENT IN THE DATA,\n` +
          `- NEVER assumes a year or period — derive periods from the data itself (and today's date above),\n` +
          `- computes what the deliverable needs and prints every computed result on its own line ` +
          `starting EXACTLY with "FINDINGS: " (e.g. 'FINDINGS: July total = 6150') — these lines are ` +
          `the ground truth a colleague will write from; output without FINDINGS lines is rejected,\n` +
          `- if any filter matches 0 rows, prints "WARNING: filter matched 0 rows" AND the unfiltered ` +
          `equivalents — a silent 0 from an empty filter is the worst possible output,\n` +
          `- writes any produced data file (a sheet, a cleaned CSV) to /job/out/.\n` +
          `If this task is NOT data-computation (a memo, a narrative, judgment work), decline.\n` +
          (repair ? `\nYOUR PREVIOUS SCRIPT FAILED — fix exactly this and return the corrected script:\n${repair.slice(0, 1200)}\n` : '') +
          `\nJSON only: {"script":"<python source>"} OR {"skip":"<one line: why no computation applies>"}`,
      });
      return { skip: res.json?.skip ? String(res.json.skip) : null, script: (res.json?.script ?? '').trim() || null };
    };

    const first = await codegen();
    if (!first.script) return null; // declined or failed — the lane proceeds unaided, honestly

    const { executeRunCompute } = await import('@/lib/tools/compute');
    const run = (script: string) => executeRunCompute(
      { description: args.title.slice(0, 120), script, file_ids: args.files.map((f) => f.id), timeout_s: 90, entityId: args.entityId ?? null },
      userId, admin,
    );
    let result = await run(first.script);
    // The failure floors, each with ITS reason (the repair must know WHY it was rejected — found
    // live: a numerically-correct run was rejected for a missing label and the blind repair
    // reproduced it): a crashed/refused run · an empty-filter zero (the year-transposition
    // class) · output without FINDINGS lines (warnings are not facts).
    const failWhy = (r: string): string | null =>
      /FAILED|nothing was run|unreachable|not configured|unreadable/i.test(r.slice(0, 250)) ? 'the script crashed or the run was refused — see the error above' :
      /WARNING: filter matched 0 rows|rows read: 0\b/i.test(r) ? 'a filter matched 0 rows — derive the period from the data and today\'s date, never an assumed year' :
      !/FINDINGS/i.test(r) ? 'the output has no "FINDINGS: " lines — print every computed result on a line starting exactly with "FINDINGS: "' :
      null;
    const why1 = failWhy(result);
    if (why1) {
      // ONE repair attempt with the failure AND its reason in view — then honest null (never a
      // fabricated fact). Logged both times: a silent skip reads as "no data work applied" when
      // the truth is "the script broke" — ops needs to see the difference.
      console.warn('[compute-produce] script failed, repairing:', why1, '·', result.slice(0, 400).replace(/\n/g, ' | '));
      const second = await codegen(`${result.slice(0, 1100)}\n\nWHY IT WAS REJECTED: ${why1}`);
      if (!second.script) return null;
      result = await run(second.script);
      const why2 = failWhy(result);
      if (why2) {
        console.warn('[compute-produce] repair also failed, falling through:', why2, '·', result.slice(0, 400).replace(/\n/g, ' | '));
        return null;
      }
    }

    return {
      facts:
        `COMPUTED FACTS — these numbers were computed BY CODE in the sandbox over the staged files ` +
        `(${fileList}). Use them EXACTLY as printed; never recompute them by hand or state different ones:\n` +
        result.slice(0, 3000),
      // The provenance-chip stamp (structural, as-of): what ran, over what, when.
      stamp: `computed in code from ${fileList} · ${new Date().toISOString().slice(0, 10)}`,
    };
  } catch { return null; } // the stage is an enhancement — failure returns the lane to the status quo
}
