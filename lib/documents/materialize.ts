// ─── THE ONE PRODUCTION DOOR (plan AF, Aug 12) ──────────────────────────────────────────────
// Every document any actor ships — the chief's delegations, coworker DMs, workflow runs —
// materializes through THIS module. Actors differ (how work is asked for and narrated);
// the organs are shared: the deliverable tiers, the deterministic floors, the brand theme.
// THE INVARIANT: adding a document capability = one edit HERE, every surface upgrades at once
// (the tool-gating map's property, applied to production).
//
// The tiers, best first, each falling soft to the next:
//   1. THE COMPILER (DH6/DH7) — generated Python in the locked room, for what templates can't
//      express: charts, in-place revision, template-following. Render-verified, code-validated.
//   2. TYPED DELIVERABLES (DH3) — a ```spreadsheet/```slides fence from the author becomes a
//      real xlsx/pptx through the code-validating parser.
//   3. THE TEMPLATE RENDERERS (the floor) — docx/pptx/xlsx built from structured content.
//      The user ALWAYS gets a document, sometimes a plainer one.
//
// The deterministic floors that ride the door (never the caller's discretion):
//   • THE CONTENT FLOOR — the author's written deliverable IS the document's text; codegen
//     formats, never authors (found live: perfect structure, zero real facts).
//   • THE FACTS FLOOR — tabular material with no precomputed facts gets computeDataFacts here,
//     so the compiler's numbers are code-computed even when the caller forgot the pre-pass.
//   • THE THEME — resolved through the one getDocTheme hierarchy unless explicitly overridden.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocTheme } from '@/lib/documents/theme';
import type { DeliverableType, ArtifactContent } from '@/lib/types/inbox';

export type MaterializeArgs = {
  /** Display title (artifact card / filename). */
  title: string;
  /** THE CONTENT FLOOR: the author's written deliverable (a coworker's output, a workflow
   *  step's text). May carry a typed ```spreadsheet/```slides fence — the door parses it. */
  content: string;
  /** The user's own words for the work — drives the compile trigger (chart/graph words) and
   *  the ext hints (deck words → pptx). */
  request?: string | null;
  /** Tabular material the work is over (chat attachment, workflow step data). */
  csvText?: string | null;
  /** Pre-computed sandbox facts (the delegation pre-pass). Absent + csvText present → the
   *  door computes them itself (THE FACTS FLOOR). */
  computedFacts?: string | null;
  /** REVISION-IN-PLACE: the current file — mounted at /job/inputs/current.<ext>. */
  revise?: { bytes: Buffer; ext: 'docx' | 'pptx' | 'xlsx'; title?: string } | null;
  /** TEMPLATE-BY-EXAMPLE: the design example — mounted at /job/inputs/template.<ext>. */
  templateFile?: { bytes: Buffer; ext: 'docx' | 'pptx' | 'xlsx' } | null;
  /** Theme override (THE MOMENT THEME). undefined → resolve via getDocTheme; null → house look. */
  theme?: DocTheme | null;
  /** Force the deliverable kind (the DM's generate_document knows word/excel/pptx). */
  forceType?: DeliverableType | null;
};

export type Materialized = {
  bytes: Buffer;
  ext: string;
  mime: string;
  type: DeliverableType;
  /** The structured content behind the template tier (the viewer's render; compiled files keep
   *  the text version here so the in-app viewer still shows something readable). */
  content: ArtifactContent;
  /** Which tier produced the file — observability, never behavior. */
  tier: 'compiler' | 'typed' | 'template';
};

const EXT_BY_TYPE: Record<string, 'docx' | 'pptx' | 'xlsx'> = {
  presentation: 'pptx', spreadsheet: 'xlsx', document: 'docx', report: 'docx', analysis: 'docx',
};

export async function materializeDocument(
  client: SupabaseClient, userId: string, args: MaterializeArgs,
): Promise<Materialized> {
  const { textToDocContent } = await import('@/lib/workflows/doc-content');
  const { parseTypedDeliverable } = await import('@/lib/workflows/typed-output');
  const { buildArtifactFile, getFileExt, getMimeType } = await import('@/lib/artifacts/builders');

  const typed = parseTypedDeliverable(args.content);
  const title = (args.revise?.title || typed?.content.title || args.title).slice(0, 120) || 'Document';
  const request = args.request ?? '';

  // ── Resolve the deliverable kind + file ext (revision keeps its ext; template leads; then
  // the author's typed fence; then the user's own words; then the caller's forced kind). ──
  const wantsChart = !!args.csvText && /\b(chart|graph|plot|visuali[sz]|diagram)\w*/i.test(request);
  const compileExt: 'docx' | 'pptx' | 'xlsx' = args.revise?.ext
    ?? args.templateFile?.ext
    ?? (typed ? (typed.type === 'spreadsheet' ? 'xlsx' : 'pptx') : null)
    ?? (args.forceType ? EXT_BY_TYPE[args.forceType] ?? 'docx' : null)
    ?? (/\b(deck|slides?|presentation|pptx)\b/i.test(request) ? 'pptx' : 'docx');
  const type: DeliverableType = compileExt === 'pptx' ? 'presentation' : compileExt === 'xlsx' ? 'spreadsheet' : (args.forceType ?? 'document');
  const doc: ArtifactContent = typed ? typed.content : textToDocContent(title, args.content);

  // ── Theme: explicit override → the one hierarchy → house look. Fail-soft always. ──
  let theme: DocTheme | null = args.theme ?? null;
  if (args.theme === undefined) {
    try { theme = await (await import('@/lib/documents/theme')).getDocTheme(client, userId); } catch { theme = null; }
  }

  // ── TIER 1 — THE COMPILER: charts / revision / template-following, code in the locked room. ──
  if (wantsChart || args.revise || args.templateFile) {
    try {
      // THE FACTS FLOOR: tabular material without precomputed facts gets them HERE — the
      // compiler's numbers must be code-computed regardless of which caller forgot the pre-pass.
      let facts = args.computedFacts ?? null;
      if (!facts && args.csvText) {
        const { computeDataFacts } = await import('@/lib/compute/data-facts');
        facts = await computeDataFacts(client, userId, { request: request || title, csvText: args.csvText });
      }
      const extraFiles: Array<{ name: string; bytes: Buffer }> = [
        ...(args.revise ? [{ name: `current.${args.revise.ext}`, bytes: args.revise.bytes }] : []),
        ...(args.templateFile ? [{ name: `template.${args.templateFile.ext}`, bytes: args.templateFile.bytes }] : []),
      ];
      const directives = [
        args.revise ? `REVISE IN PLACE: the document's CURRENT version is at /job/inputs/current.${args.revise.ext} — ` +
          `open it (python-docx/python-pptx/openpyxl), apply ONLY the requested changes, preserve everything ` +
          `else exactly (existing sections, styles, images), and save the result as the deliverable.` : null,
        args.templateFile ? `FOLLOW THE TEMPLATE: an example file is at /job/inputs/template.${args.templateFile.ext} — ` +
          `mirror its structure, layout, and design exactly (for pptx, clone_slide duplicates a slide ` +
          `preserving its design byte-faithfully — clone then edit text), replacing the example's content ` +
          `with this task's content.` : null,
      ].filter(Boolean).join('\n');
      const { compileDocument } = await import('@/lib/compute/document-compiler');
      const compiled = await compileDocument(client, userId, {
        task: `${directives ? `${directives}\n` : ''}THE REQUEST: ${(request || title).slice(0, 800)}`,
        ext: compileExt, extraFiles: extraFiles.length ? extraFiles : undefined,
        csvText: args.csvText ?? null, theme, computedFacts: facts,
        contentText: args.content, // THE CONTENT FLOOR
      });
      if (compiled) {
        return { bytes: compiled.bytes, ext: compileExt, mime: compiled.mime, type, content: doc, tier: 'compiler' };
      }
    } catch { /* the tiers below are the floor */ }
  }

  // ── TIERS 2+3 — the typed builder / template renderers (one call: buildArtifactFile
  // dispatches on type; the theme rides both). ──
  const bytes = await buildArtifactFile(type, doc, { theme });
  return { bytes, ext: getFileExt(type), mime: getMimeType(type), type, content: doc, tier: typed ? 'typed' : 'template' };
}
