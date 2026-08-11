// ─── THE TYPED DELIVERABLE PROTOCOL (document hands slice 3, Aug 11) ─────────────────────────
// A coworker whose work is genuinely a SPREADSHEET or a SLIDE DECK says so structurally: one
// fenced block (```spreadsheet / ```slides) carrying JSON that matches XlsxContent/PptxContent.
// This module is the ONE parser both production engines use (delegations + workflow runs) —
// CODE-VALIDATED (bad shape → null → the docx fallback; a malformed block never breaks the
// deliverable, it just stays a document). Prose around the block survives as the report text.

import type { PptxContent, XlsxContent } from '@/lib/types/inbox';

export type TypedDeliverable =
  | { type: 'spreadsheet'; content: XlsxContent; remainder: string }
  | { type: 'presentation'; content: PptxContent; remainder: string };

const FENCE_RE = /```(spreadsheet|slides)\s*\n([\s\S]*?)```/;

export function parseTypedDeliverable(output: string): TypedDeliverable | null {
  try {
    const m = FENCE_RE.exec(output);
    if (!m) return null;
    const remainder = (output.slice(0, m.index) + output.slice(m.index + m[0].length)).trim();
    const raw = JSON.parse(m[2]);
    if (m[1] === 'spreadsheet') {
      const sheets = Array.isArray(raw?.sheets) ? raw.sheets : [];
      const valid = sheets.length > 0 && sheets.every((s: unknown) => {
        const sh = s as { name?: unknown; headers?: unknown; rows?: unknown };
        return typeof sh.name === 'string' && Array.isArray(sh.headers) && sh.headers.length > 0
          && Array.isArray(sh.rows) && (sh.rows as unknown[]).every((r) => Array.isArray(r));
      });
      if (!valid) return null;
      const content: XlsxContent = {
        title: String(raw.title ?? 'Spreadsheet').slice(0, 120),
        sheets: sheets.map((s: { name: string; headers: unknown[]; rows: unknown[][]; summary?: unknown }) => ({
          name: String(s.name).slice(0, 31), // Excel's sheet-name limit
          headers: s.headers.map(String),
          rows: s.rows.map((r) => r.map((c) => (typeof c === 'number' ? c : c == null ? null : String(c)))),
          ...(typeof s.summary === 'string' ? { summary: s.summary } : {}),
        })),
      };
      return { type: 'spreadsheet', content, remainder };
    }
    // slides
    const slides = Array.isArray(raw?.slides) ? raw.slides : [];
    const valid = slides.length > 0 && slides.every((s: unknown) => typeof (s as { title?: unknown }).title === 'string');
    if (!valid) return null;
    const content: PptxContent = {
      title: String(raw.title ?? 'Presentation').slice(0, 120),
      ...(typeof raw.subtitle === 'string' ? { subtitle: raw.subtitle } : {}),
      slides: slides.map((s: { title: string; layout?: unknown; bullets?: unknown; notes?: unknown }) => ({
        title: String(s.title).slice(0, 160),
        layout: s.layout === 'title' ? 'title' as const : 'content' as const,
        ...(Array.isArray(s.bullets) ? { bullets: (s.bullets as unknown[]).map(String).slice(0, 12) } : {}),
        ...(typeof s.notes === 'string' ? { notes: s.notes } : {}),
      })),
    };
    return { type: 'presentation', content, remainder };
  } catch { return null; }
}

/** The prompt block both engines append — conservative: typed output only when the work IS
 *  tabular data or a deck; everything else stays markdown → a formatted document. */
export const TYPED_OUTPUT_RULE =
  `TYPED DELIVERABLES: if (and ONLY if) the requested work is genuinely a SPREADSHEET (tabular ` +
  `data, lists with columns, budgets, trackers) or a SLIDE DECK, emit it as ONE fenced block — ` +
  `\`\`\`spreadsheet\n{"title":"…","sheets":[{"name":"…","headers":["…"],"rows":[["…"]]}]}\n\`\`\` or ` +
  `\`\`\`slides\n{"title":"…","slides":[{"title":"…","layout":"content","bullets":["…"]}]}\n\`\`\` — ` +
  `with your short hand-back note as plain text around it. Reports, briefs, forms, and prose ` +
  `stay MARKDOWN (they become formatted documents). Never force tabular shape onto prose.`;
