// ─── THE TEXT-HYGIENE GATE (W38 — a delivered office file carries words, not syntax) ──────────
// Server-only use (jszip), pure logic. Found by the W38 file verifier on the compiler tier: a
// compiled .docx shipped "**East** achieved…" with the markdown asterisks as literal text, an
// ASCII-art bar chart ("East : ######## (4,305)") beside the real embedded chart, and every
// heading as a bold paragraph with no heading style (no navigation pane, no outline, no TOC).
// The render gate only proved the file RENDERS; this gate proves what it renders is clean.
// compileDocument runs it on the produced bytes — a failure feeds its one reasoned repair.
import JSZip from 'jszip';

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Visible text of an OOXML file (docx body / every slide / shared strings), paragraphs on lines. */
export async function officeText(bytes: Buffer, ext: 'docx' | 'pptx' | 'xlsx'): Promise<{ text: string; headingStyles: number }> {
  const zip = await JSZip.loadAsync(bytes);
  const parts = Object.keys(zip.files).filter((n) => ext === 'docx' ? n === 'word/document.xml'
    : ext === 'pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(n) : n === 'xl/sharedStrings.xml');
  const run = ext === 'docx' ? 'w:t' : ext === 'pptx' ? 'a:t' : 't';
  const para = ext === 'docx' ? '</w:p>' : ext === 'pptx' ? '</a:p>' : '</si>';
  let text = ''; let headingStyles = 0;
  for (const p of parts) {
    const xml = await zip.file(p)!.async('string');
    if (ext === 'docx') headingStyles += (xml.match(/<w:pStyle w:val="(?:Heading|heading|Title)[^"]*"/g) ?? []).length + (xml.match(/<w:outlineLvl /g) ?? []).length;
    text += xml.split(para).map((x) => [...x.matchAll(new RegExp(`<${run}(?:\\s[^>]*)?>([^<]*)</${run}>`, 'g'))].map((m) => decode(m[1])).join('')).filter((l) => l.trim()).join('\n') + '\n';
  }
  return { text, headingStyles };
}

/** Problems in a delivered file's visible text. Pure. */
export function textHygieneProblems(text: string): string[] {
  const t = String(text ?? '');
  const out: string[] = [];
  if (/\*\*[^*\n]{1,80}\*\*/.test(t)) out.push('literal markdown bold markers (**text**) are in the document text — render them as bold runs');
  if (/^\s{0,3}#{1,6}\s+\S/m.test(t)) out.push('literal markdown heading markers (## …) are in the document text — use real heading styles');
  if (/^\s*\|.*\|\s*$/m.test(t) && /^\s*\|?\s*:?-{3,}/m.test(t)) out.push('a literal markdown table (| … |) is in the document text — build a real table');
  if (/[#█■=*]{8,}/.test(t)) out.push('an ASCII-art bar/rule is in the document text — charts are images or native charts, never characters');
  if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(t)) out.push('placeholder garbage ("undefined" / "NaN" / "[object Object]") is in the document text');
  return out;
}

/** The gate: the produced file's text problems (empty = clean). Fail-open on an unreadable zip
 *  (the structural gate owns "does it open"). */
export async function officeHygieneProblems(bytes: Buffer, ext: 'docx' | 'pptx' | 'xlsx' | 'pdf', opts: { expectHeadings?: boolean } = {}): Promise<string[]> {
  if (ext === 'pdf') return [];
  try {
    const { text, headingStyles } = await officeText(bytes, ext);
    const p = textHygieneProblems(text);
    if (ext === 'docx' && opts.expectHeadings && headingStyles === 0) p.push('no paragraph uses a heading style — headings must be real headings (doc.add_heading / style "Heading 1"/"Heading 2"), not bold paragraphs');
    return p;
  } catch { return []; }
}
