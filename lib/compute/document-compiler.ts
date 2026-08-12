// ─── THE DOCUMENT COMPILER (DH6, Aug 11 — code-per-document, in the locked room) ─────────────
// The ceiling tier above the template renderers: when a deliverable needs what templates can't
// express — charts inside a document, cover pages, template-following decks, in-place fill —
// the coworker's job becomes GENERATED PYTHON run in the sandbox (python-docx · python-pptx ·
// openpyxl · matplotlib · LibreOffice · our augmtd_docs helpers), behind:
//   • THE RENDER-VERIFICATION GATE — the script must render_verify() its own output (LibreOffice
//     → PDF page count) and print "RENDERED PAGES: n"; unrendered documents never ship.
//   • TS-SIDE STRUCTURAL VALIDATION — the returned file must parse (docx/pptx/xlsx are zips,
//     PDF magic checked) — a corrupt file never ships even if the script lied.
//   • ONE REASONED REPAIR carrying the actual stderr; then an honest null — the caller falls
//     back to the template tier, so the user always gets a document, sometimes a plainer one.
// Sovereign by construction: no third-party document APIs; nothing leaves the room.

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import type { DocTheme } from '@/lib/documents/theme';

export type CompiledDocument = { name: string; bytes: Buffer; mime: string; stdout: string };

const EXT_MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export async function compileDocument(
  client: SupabaseClient, userId: string,
  args: {
    task: string;
    ext: 'docx' | 'pptx' | 'xlsx' | 'pdf';
    csvText?: string | null;
    /** Extra input files mounted at /job/inputs/<name> (e.g. a template docx, a logo). */
    extraFiles?: Array<{ name: string; bytes: Buffer }>;
    theme?: DocTheme | null;
    computedFacts?: string | null;
    /** THE CONTENT FLOOR: the coworker's actual written deliverable — the document's text comes
     *  from HERE (found live: a template-following compile invented its own content; structure
     *  was perfect, every real fact was missing). */
    contentText?: string | null;
  },
): Promise<CompiledDocument | null> {
  try {
    if (!process.env.COMPUTE_SERVICE_URL || !process.env.COMPUTE_SECRET) return null;
    const inputNames = [
      ...(args.csvText ? ['data.txt (the CSV data)'] : []),
      ...(args.extraFiles ?? []).map((f) => f.name),
      ...(args.theme?.logo ? ['logo.png (the brand logo image)'] : []),
    ];
    const themeBlock = args.theme
      ? `BRAND THEME (apply it): accent color #${args.theme.accent}; ` +
        `${args.theme.logo ? 'logo at /job/inputs/logo.png (place it on the cover/header); ' : ''}` +
        `${args.theme.footer ? `footer line "${args.theme.footer}"; ` : ''}` +
        `charts use the accent color.`
      : 'No brand theme — clean neutral design, dark text, one restrained accent.';

    const gen = async (repairNote?: string, deep = true): Promise<string | null> => {
      const res = await aiCall<{ script?: string }>({
        userId, supabase: client, shape: deep ? { output: 'json', reasoning: 'deep' } : { output: 'json' }, temperature: 0, maxTokens: 6000, source: 'brain_synthesis',
        prompt:
          `Write a Python script that BUILDS a polished .${args.ext} document in a sandbox.\n\n` +
          `THE TASK: ${args.task.slice(0, 800)}\n\n` +
          `${themeBlock}\n` +
          (args.computedFacts ? `\nCOMPUTED FACTS (authoritative numbers — use them verbatim):\n${args.computedFacts.slice(0, 2000)}\n` : '') +
          (args.contentText ? `\nTHE CONTENT (authoritative — the document's text comes from THIS, formatted for the ` +
            `document; NEVER invent facts, names, numbers, or sections of your own):\n${args.contentText.slice(0, 6000)}\n` : '') +
          (inputNames.length ? `\nINPUT FILES at /job/inputs/: ${inputNames.join(', ')}\n` : '') +
          (repairNote ? `\nYOUR PREVIOUS SCRIPT FAILED — fix the cause:\n${repairNote.slice(0, 800)}\n` : '') +
          `\nAVAILABLE: python-docx, python-pptx, openpyxl, matplotlib (Agg backend; save charts as PNG ` +
          `and embed them), pandas, pypdf, and \`from augmtd_docs import clone_slide, render_verify\`.\n` +
          ((args.extraFiles ?? []).some((f) => f.name.startsWith('current.'))
            ? `A file at /job/inputs/current.* is the document's CURRENT version: OPEN it and modify — never rebuild from scratch.\n` : '') +
          ((args.extraFiles ?? []).some((f) => f.name.startsWith('template.'))
            ? `A file at /job/inputs/template.* is a DESIGN EXAMPLE: mirror its structure/layout/design; for pptx use clone_slide(pres, slide) to duplicate slides preserving their design, then edit the clone's text.\n` : '') +
          `CONTRACT (all mandatory):\n` +
          `1. Write EXACTLY ONE output file: /job/out/deliverable.${args.ext}\n` +
          `2. Charts: matplotlib.use("Agg"); style them with the accent color; readable labels; save to ` +
          `/tmp and embed into the document (never leave a chart as a loose file).\n` +
          `3. Real document design: a title/cover block, clear headings, consistent fonts — not a text dump.\n` +
          (args.ext === 'xlsx'
            ? `4. Spreadsheets: real header styling and LIVE FORMULAS (=SUM/=AVERAGE) for derived cells — never hardcode a derivable number.\n`
            : `4. After writing the file: pages = render_verify("/job/out/deliverable.${args.ext}"); print(f"RENDERED PAGES: {pages}") — this is the shipping gate.\n`) +
          `5. NUMBERS: when a COMPUTED FACTS block is given, every statistic in the document comes from it ` +
          `verbatim. A number NOT in the facts is computed from the raw input rows — never derived from ` +
          `other aggregates (an unweighted mean of group means is WRONG when groups differ in size).\n` +
          `6. Print "DONE: deliverable.${args.ext}" as the last line.\n` +
          `Return ONLY JSON: {"script": "<python>"}`,
      });
      return res.json?.script?.trim() || null;
    };

    const { runComputeForOutputs } = await import('@/lib/tools/compute');
    const extraFiles = [
      ...(args.extraFiles ?? []).map((f) => ({ name: f.name, content_b64: f.bytes.toString('base64') })),
      ...(args.theme?.logo ? [{ name: 'logo.png', content_b64: args.theme.logo.dataB64 }] : []),
    ];

    const validate = (r: Awaited<ReturnType<typeof runComputeForOutputs>>): string | null => {
      if (!r) return 'The compute service was unreachable.';
      if (!r.ok) return `The script failed:\n${r.stderr.slice(0, 600) || r.stdout.slice(-400)}`;
      const out = r.outputs.find((o) => o.name === `deliverable.${args.ext}`);
      if (!out) return `No /job/out/deliverable.${args.ext} was produced (outputs: ${r.outputs.map((o) => o.name).join(', ') || 'none'}).`;
      // Structural validity: OOXML files are zips; PDF has its magic. A corrupt file never ships.
      if (args.ext === 'pdf') {
        if (!out.bytes.subarray(0, 5).toString().startsWith('%PDF')) return 'The produced PDF is not a valid PDF.';
      } else if (out.bytes.readUInt16BE(0) !== 0x504b) {
        return `The produced .${args.ext} is not a valid OOXML file (bad zip signature).`;
      }
      if (args.ext !== 'xlsx' && !/RENDERED PAGES:\s*[1-9]/.test(r.stdout)) {
        return 'The render-verification gate did not pass (no "RENDERED PAGES: n>=1" printed) — the document may not render.';
      }
      return null;
    };

    let script = await gen();
    if (!script) script = await gen(undefined, false); // reasoning-tier empty return → the plain JSON tier
    if (!script) { console.error('[compiler] codegen returned no script'); return null; }
    let run = await runComputeForOutputs({ script, data: args.csvText ?? undefined, extraFiles, timeout_s: 110 });
    let problem = validate(run);
    if (problem) {
      console.error('[compiler] attempt 1 failed:', problem.slice(0, 300));
      script = await gen(problem) ?? await gen(problem, false);
      if (!script) { console.error('[compiler] repair codegen returned no script'); return null; }
      run = await runComputeForOutputs({ script, data: args.csvText ?? undefined, extraFiles, timeout_s: 110 });
      problem = validate(run);
      if (problem) { console.error('[compiler] attempt 2 failed:', problem.slice(0, 300)); return null; }
    }
    const out = run!.outputs.find((o) => o.name === `deliverable.${args.ext}`)!;
    return { name: out.name, bytes: out.bytes, mime: EXT_MIME[args.ext], stdout: run!.stdout.slice(0, 2000) };
  } catch { return null; }
}
