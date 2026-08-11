// ─── THE DATA-FACTS PASS (the data-by-code lane, Aug 11 — the EG Bank benchmark) ─────────────
// "PRODUCE COMPUTES BEFORE IT WRITES", applied at the DELEGATION door: when chat-borne material
// is tabular, the statistics are computed IN THE SANDBOX before the coworker ever writes, and
// the computed facts ride the prompt as the authoritative numbers. Runtime-independent by
// design — the native agent step has no tool loop and AgentOS tool use is model-discretion;
// this lane is DETERMINISTIC (found live: a 150-row CSV produced a "send me the data" ask from
// a worker whose prompt CONTAINED the data, and a small CSV produced model-arithmetic numbers
// that merely looked computed). Carries the produce lane's lessons: THE DATA PREVIEW (real
// header + rows in the codegen prompt — no guessed columns), REASONED REPAIR (one retry
// carrying the actual error), and honest failure (null → the caller proceeds without facts,
// and the deliverable's numbers are then the model's own responsibility under the old rule).

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';

export async function computeDataFacts(
  client: SupabaseClient, userId: string,
  args: { request: string; csvText: string; filename?: string },
): Promise<string | null> {
  try {
    if (!process.env.COMPUTE_SERVICE_URL || !process.env.COMPUTE_SECRET) return null;
    const csv = args.csvText.trim();
    if (!csv || csv.length < 30) return null;
    const lines = csv.split('\n');
    const preview = lines.slice(0, 6).join('\n');

    const gen = async (repairNote?: string): Promise<string | null> => {
      const res = await aiCall<{ script?: string }>({
        userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 900, source: 'brain_synthesis',
        prompt:
          `Write a small Python script that computes what this request needs from a CSV file.\n\n` +
          `THE REQUEST: ${args.request.slice(0, 500)}\n\n` +
          `THE DATA PREVIEW (the file's REAL header and first rows — use ONLY these column names):\n${preview}\n` +
          `(${lines.length - 1} data rows total${args.filename ? ` · ${args.filename}` : ''})\n\n` +
          (repairNote ? `YOUR PREVIOUS SCRIPT FAILED — fix the cause:\n${repairNote.slice(0, 600)}\n\n` : '') +
          `CONTRACT: read the CSV from /job/inputs/data.txt with csv.DictReader; process EVERY data row — ` +
          `never deduplicate, never silently skip a row; the FIRST printed line must be exactly ` +
          `"TOTAL ROWS: <n>" (the number of data rows you processed). When the request PARTITIONS rows ` +
          `into categories (bands, buckets, groups): every row must land in EXACTLY ONE category — if the ` +
          `stated ranges leave gaps for the actual values (e.g. decimal scores between "0-39" and "40-59"), ` +
          `close the gaps with half-open ranges (0-39 means < 40) and print a line ` +
          `'Note: boundary rule — <the rule you applied>'; also print "CLASSIFIED: <n>" (must equal TOTAL ROWS). ` +
          `Then compute the aggregates: EVERY quantity the request explicitly names must be printed (counts ` +
          `asked → counts printed, means asked → means printed) — plus whatever else it implies; print each ` +
          `result as a clearly labeled line (e.g. "Operations mean: 49.6" / "Novice count: 55"). Standard ` +
          `library only. No file writes. Return ONLY JSON: {"script": "<python>"}`,
      });
      return res.json?.script?.trim() || null;
    };

    const { executeRunCompute } = await import('@/lib/tools/compute');
    // THE ROW-COUNT FLOOR (found live: a generated script silently lost 7 of 150 rows and every
    // band count came out wrong-but-plausible): the script must PROVE it read every data row —
    // "TOTAL ROWS: n" is verified CODE-SIDE against the file's own line count. A mismatch
    // repairs once with the exact discrepancy; still wrong → NO facts (null) — wrong facts are
    // worse than none, and the no-facts path marks derived stats unverified.
    const expectedRows = lines.length - 1;
    const failed = (s: string) => /Traceback|Error|failed|not configured|nothing was run/i.test(s) || !/\d/.test(s);
    const rowCountOf = (s: string): number | null => {
      const m = s.match(/TOTAL ROWS:\s*(\d+)/i);
      return m ? Number(m[1]) : null;
    };
    const verify = (s: string): string | null => {
      if (failed(s)) return `The run failed or produced no numbers:\n${s.slice(0, 400)}`;
      const n = rowCountOf(s);
      if (n === null) return 'Your output is missing the mandatory first line "TOTAL ROWS: <n>".';
      if (n !== expectedRows) return `Your script processed ${n} rows but the file has ${expectedRows} data rows — rows are being dropped or duplicated. Read every line with csv.DictReader; never deduplicate or silently skip.`;
      // THE PARTITION FLOOR: when the script classified rows, every row must have landed somewhere.
      const cm = s.match(/CLASSIFIED:\s*(\d+)/i);
      if (cm && Number(cm[1]) !== n) return `You classified ${cm[1]} of ${n} rows — ${n - Number(cm[1])} fell through the category boundaries. Close the gaps (half-open ranges) so every row lands in exactly one category, and state the boundary rule in a Note line.`;
      return null;
    };
    let script = await gen();
    if (!script) return null;
    let out = await executeRunCompute({ script, data: csv, description: 'data facts for a delegated deliverable' }, userId, client);
    let problem = verify(out);
    if (problem) {
      script = await gen(problem);
      if (!script) return null;
      out = await executeRunCompute({ script, data: csv, description: 'data facts (repaired)' }, userId, client);
      problem = verify(out);
      if (problem) return null;
    }
    return out.trim().slice(0, 4000);
  } catch { return null; }
}
