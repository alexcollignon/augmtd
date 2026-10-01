// ════════════════════════════════════════════════════════════════════════════════════════════════
// FILE-READING QUALITY (labelled, zero-judge) — every format the KB accepts goes through the REAL
// extraction door every ingestion path shares (`extractTextFromFile` in lib/knowledge/indexer.ts:
// indexUploadedFile · ingestFile · indexSource · the retry door), and the text is scored against the
// content the fixture was GENERATED from (scripts/lib/eval/fixture-files.ts — nothing hand-labelled).
//
// Metrics per file (scripts/lib/eval/quality-metrics.ts): word recall (order-free) · char accuracy
// (order-sensitive, 1−CER) · numbers/codes exact · table rows kept on one line in order · the
// END-OF-DOCUMENT marker present (no truncation) · order checks (slide/page order).
//
// OCR cases (PNG, scanned PDFs) call the probe account's `ocr` slot through lib/ai/factory — the tier's
// own perimeter (EU probe → Bedrock EU). Everything else is zero-AI.
//
//   npx tsx scripts/eval-ingestion.ts                  # zero-AI formats only (no account needed)
//   npx tsx scripts/eval-ingestion.ts --ocr --tier std # + OCR cases on std probe #2 (≈ €0.02)
//   npx tsx scripts/eval-ingestion.ts --ocr --tier eu  # + OCR cases on EU probe #2 (Bedrock EU)
//   flags: --only id,id · --show (print each extracted text) · --probe k (pool account #k, default 2)
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never);
import { extractTextFromFile, chunkText, CHUNK_SIZE, CHUNK_OVERLAP } from '@/lib/knowledge/indexer';
import { makeTextPdf, layoutTextPdf, makeImagePdf, renderScan, makeDocx, makePptx, makeXlsx } from './lib/eval/fixture-files';
import { wordRecall, charAccuracy, tokensKept, tableRowsKept, foldText, pct } from './lib/eval/quality-metrics';
import { adminClient } from './lib/eval/engine/live';
import { resolveProbePool } from './lib/eval/engine/probes';

const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] ?? null : null; };
const withOcr = argv.includes('--ocr');
const show = argv.includes('--show');
const only = opt('only')?.split(',') ?? null;

type Case = {
  id: string; filename: string; mime: string; ocr?: boolean;
  build: () => Promise<Buffer>;
  /** The full known text (what a perfect reader returns). */
  truth: string;
  numbers?: string[];
  table?: string[][];
  /** Phrases that must appear in this order (pages / slides). */
  order?: string[];
  /** The last sentence of the document — present = no truncation. */
  endMarker: string;
};

// ── the labelled content ─────────────────────────────────────────────────────────────────────────
const INV_TABLE = [
  ['Item', 'Qty', 'Unit price', 'Amount'],
  ['Advisory retainer March', '1', '2,400.00', '2,400.00'],
  ['Workshop facilitation', '3', '450.00', '1,350.00'],
  ['Travel expenses Lisbon', '1', '318.75', '318.75'],
  ['Report translation DE-EN', '2', '125.00', '250.00'],
];
const INV_HEAD = ['INVOICE INV-2026-0417', 'Acme Advisory Ltd, 12 Harbour Street, Porto', 'Billed to: Northwind Logistics GmbH', 'Invoice date: 14 March 2026 · Due date: 13 April 2026'];
const INV_TOTALS = ['Subtotal EUR 4,318.75', 'VAT 23% EUR 993.31', 'Total due EUR 5,312.06', 'IBAN PT50 0002 0123 1234 5678 9015 4'];
const TERMS = Array.from({ length: 70 }, (_, i) => `Clause ${i + 1}. The supplier shall deliver item ${i + 1} within ${10 + (i % 20)} business days and report progress to Sam in writing.`);
const END_PDF = 'End of document: Acme reference AX-993 closes this invoice.';

const SCAN_PAGES = [
  ['NOTICE OF RENEWAL', 'Contract number CN-48213', 'Dear Sam,', 'Your service agreement with Acme Facilities renews', 'on 1 July 2026 for a further 24 months.', 'The new monthly fee is EUR 1,180.00.'],
  ['PAGE TWO', 'Schedule of sites', 'Site A Porto warehouse 3,200 m2', 'Site B Braga office 410 m2', 'Site C Faro depot 1,075 m2'],
  ['PAGE THREE', 'Service levels', 'Response within 4 hours for priority one', 'Response within 2 days for priority three', 'Penalty 5% of the monthly fee per breach'],
  ['PAGE FOUR', 'Signatures', 'Signed for Acme Facilities by the director', 'Reference SCN-7781 ends this notice.'],
];
const FLATE_LINES = ['MEMO FROM THE OFFICE MANAGER', 'Kitchen renovation starts 9 February 2026.', 'Budget approved: EUR 12,600.', 'Contractor: Globex Interiors, quote Q-5521.', 'Questions go to Sam before 30 January.'];
const RECEIPT = ['ACME CAFE PORTO', 'Receipt 000731  2026-05-18 12:42', '2 x Espresso        3.20', '1 x Toast mista      4.50', '1 x Agua 50cl        1.30', 'TOTAL EUR            9.00', 'NIF 501234567'];

const POLICY = {
  title: 'Remote Work Policy',
  intro: 'This policy applies to every employee of Acme Consulting from 1 January 2026.',
  numbered: ['Employees may work remotely up to 3 days per week.', 'Core hours are 10:00 to 16:00 Lisbon time.', 'Equipment allowance is EUR 450 per year.'],
  table: [['Role', 'Remote days', 'Allowance'], ['Consultant', '3', 'EUR 450'], ['Manager', '2', 'EUR 600'], ['Intern', '1', 'EUR 150']],
  end: 'Policy owner: People team, review date 31 December 2026.',
};

const XLSX_ROWS: Array<Array<string | number>> = [
  ['Category', 'Q1', 'Q2', 'Q3', 'Q4'],
  ['Salaries', 182500, 184250.5, 186000, 190125.75],
  ['Rent', 24000, 24000, 24600, 24600],
  ['Software', 8125.4, 7980, 9210.15, 9875],
  ['Travel', 3150, 4275.25, 2980, 5120.6],
];
const XLSX_TABLE = [['Category', 'Q1', 'Q2', 'Q3', 'Q4'], ['Salaries', '182500', '184250.5', '186000', '190125.75'], ['Rent', '24000', '24000', '24600', '24600'], ['Software', '8125.4', '7980', '9210.15', '9875'], ['Travel', '3150', '4275.25', '2980', '5120.6']];

const CSV_ROWS = [['name', 'company', 'city', 'phone'], ['Sam Example', 'Acme Lda', 'São João da Madeira', '+351 912 345 678'], ['Lee Sample', 'Globex GmbH', 'Köln', '+49 221 555 0199'], ['Ana Placeholder', 'Initech SARL', 'Besançon', '+33 3 81 55 01 02']];

const SLIDES = Array.from({ length: 12 }, (_, i) => ({
  title: `Slide ${i + 1}: ${['Context', 'Market', 'R&D roadmap', 'Pricing', 'Team', 'Pipeline', 'Risks', 'Budget', 'Timeline', 'KPIs', 'Ask', 'Close'][i]}`,
  bullets: [`Point ${i + 1}a for Acme <pilot> account`, `Metric ${i + 1}: ${(i + 1) * 125} units at ${(i + 1) * 3}% growth`],
}));

const MD = `# Onboarding checklist\n\n- Create the Acme workspace account\n- Invite Sam by 5 March 2026\n- Upload the 3 pilot documents\n\n| Step | Owner | Days |\n|---|---|---|\n| Setup | Sam | 2 |\n| Review | Lee | 5 |\n\nChecklist version 1.4 ends here.`;
const TXT = `Meeting notes — Acme pilot kickoff\nDate: 2026-04-07\nAttendees: Sam, Lee, Ana\nDecisions: budget EUR 7,500 approved; go-live 15 May 2026.\nAção: rever o contrato até sexta-feira.\nEnd of notes.`;

const CASES: Case[] = [
  {
    id: 'pdf.text.invoice', filename: 'INV-2026-0417.pdf', mime: 'application/pdf',
    build: async () => makeTextPdf(layoutTextPdf([
      { lines: INV_HEAD }, { table: { cols: [56, 300, 360, 460], rows: INV_TABLE } }, { lines: INV_TOTALS },
      { heading: 'Terms and conditions', lines: TERMS }, { lines: [END_PDF] },
    ])),
    truth: [...INV_HEAD, ...INV_TABLE.map((r) => r.join(' ')), ...INV_TOTALS, 'Terms and conditions', ...TERMS, END_PDF].join('\n'),
    numbers: ['INV-2026-0417', '4,318.75', '993.31', '5,312.06', '2,400.00', '318.75', 'AX-993', '14 March 2026'],
    table: INV_TABLE, order: ['INVOICE INV-2026-0417', 'Clause 1.', 'Clause 70.', 'End of document'], endMarker: END_PDF,
  },
  {
    id: 'pdf.scan.jpeg4', filename: 'renewal-notice-scan.pdf', mime: 'application/pdf', ocr: true,
    build: async () => {
      const imgs = [];
      for (const p of SCAN_PAGES) { const s = await renderScan(p); imgs.push({ kind: 'jpeg' as const, data: s.jpeg, w: s.w, h: s.h }); }
      return makeImagePdf(imgs);
    },
    truth: SCAN_PAGES.flat().join('\n'),
    numbers: ['CN-48213', '1,180.00', '3,200', '1,075', '24', 'SCN-7781'],
    order: ['NOTICE OF RENEWAL', 'PAGE TWO', 'PAGE THREE', 'PAGE FOUR'], endMarker: 'Reference SCN-7781 ends this notice.',
  },
  {
    id: 'pdf.scan.flate', filename: 'office-memo-scan.pdf', mime: 'application/pdf', ocr: true,
    build: async () => { const s = await renderScan(FLATE_LINES, { w: 1000, h: 1414, font: 28 }); return makeImagePdf([{ kind: 'rgb', data: s.rgb, w: s.w, h: s.h }]); },
    truth: FLATE_LINES.join('\n'), numbers: ['12,600', 'Q-5521', '9 February 2026'], endMarker: 'Questions go to Sam before 30 January.',
  },
  {
    id: 'img.png.receipt', filename: 'receipt-0731.png', mime: 'image/png', ocr: true,
    build: async () => (await renderScan(RECEIPT, { w: 900, h: 700, font: 30, rotateDeg: 1.2 })).png,
    truth: RECEIPT.join('\n'), numbers: ['000731', '3.20', '4.50', '1.30', '9.00', '501234567'], endMarker: 'NIF 501234567',
  },
  {
    id: 'docx.policy', filename: 'Remote Work Policy.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    build: () => makeDocx([{ heading: POLICY.title, paras: [POLICY.intro], numbered: POLICY.numbered, table: POLICY.table }, { paras: [POLICY.end] }]),
    truth: [POLICY.title, POLICY.intro, ...POLICY.numbered, ...POLICY.table.map((r) => r.join(' ')), POLICY.end].join('\n'),
    numbers: ['10:00', '16:00', 'EUR 450', 'EUR 600', '31 December 2026'], table: POLICY.table, endMarker: POLICY.end,
  },
  {
    id: 'xlsx.budget', filename: 'budget-2026.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    build: () => makeXlsx([
      { name: 'Opex', rows: [...XLSX_ROWS, ['Total', 0, 0, 0, 0]], formulas: [{ cell: 'B6', f: 'SUM(B2:B5)', v: 217775.4 }] },
      { name: 'Notes', rows: [['Owner', 'Sam'], ['Approved', '2026-02-11'], ['Sheet ends with code', 'BGT-2026-Z']] },
    ]),
    truth: [...XLSX_TABLE.map((r) => r.join(' ')), 'Total 217775.4', 'Owner Sam', 'Approved 2026-02-11', 'Sheet ends with code BGT-2026-Z'].join('\n'),
    numbers: ['184250.5', '9210.15', '5120.6', '217775.4', 'BGT-2026-Z'], table: XLSX_TABLE, order: ['Opex', 'Notes'], endMarker: 'Sheet ends with code BGT-2026-Z',
  },
  {
    id: 'csv.contacts', filename: 'contacts.csv', mime: 'text/csv',
    build: async () => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(CSV_ROWS.map((r) => r.join(',')).join('\r\n'), 'utf8')]),
    truth: CSV_ROWS.map((r) => r.join(' ')).join('\n'), numbers: ['+351 912 345 678', '+49 221 555 0199'], table: CSV_ROWS, endMarker: 'Besançon',
  },
  {
    id: 'pptx.deck12', filename: 'Acme pilot deck.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    build: () => makePptx(SLIDES),
    truth: SLIDES.map((s) => [s.title, ...s.bullets].join('\n')).join('\n'),
    numbers: ['1500', '36%', '625', 'R&D roadmap'], order: SLIDES.map((s) => s.title), endMarker: 'Metric 12: 1500 units at 36% growth',
  },
  {
    id: 'md.checklist', filename: 'onboarding.md', mime: 'text/markdown',
    build: async () => Buffer.from(MD, 'utf8'), truth: MD, numbers: ['5 March 2026', '1.4'], endMarker: 'Checklist version 1.4 ends here.',
  },
  {
    id: 'txt.notes', filename: 'kickoff-notes.txt', mime: 'text/plain',
    build: async () => Buffer.from(TXT, 'utf8'), truth: TXT, numbers: ['2026-04-07', '7,500', '15 May 2026'], endMarker: 'End of notes.',
  },
];

/** The chunker's size + its overlap tail + separators — no chunk may exceed it. */
const MAX_CHUNK_CHARS = CHUNK_SIZE + CHUNK_OVERLAP + 4;

function inOrder(text: string, phrases: string[]): boolean {
  const t = foldText(text);
  let at = 0;
  for (const p of phrases) { const i = t.indexOf(foldText(p), at); if (i < 0) return false; at = i + 1; }
  return true;
}

async function main() {
  const tier = (opt('tier') ?? 'std') === 'eu' ? 'eu' : 'standard';
  const k = Number(opt('probe') ?? '2');
  const admin = adminClient();
  let userId = '00000000-0000-0000-0000-000000000000';
  if (withOcr) {
    const pool = await resolveProbePool(admin, { spec: { [tier]: [k] }, create: false });
    if (!pool.accounts.length) throw new Error(`probe ${tier}#${k} missing: ${[...pool.problems, ...pool.missing].join('; ')}`);
    userId = pool.accounts[0].userId;
    console.log(`OCR on ${pool.accounts[0].label} (${pool.accounts[0].email})`);
  }
  const rows: string[] = [];
  let fails = 0;
  for (const c of CASES) {
    if (only && !only.includes(c.id)) continue;
    if (c.ocr && !withOcr) { rows.push(`| ${c.id} | (OCR — run with --ocr) | | | | | | | | | |`); continue; }
    const buf = await c.build();
    const t0 = Date.now();
    let text = '';
    try { text = (await extractTextFromFile(buf, c.mime, c.filename, userId, admin)) ?? ''; }
    catch (e) { text = ''; console.error(`  ${c.id} threw: ${(e as Error).message}`); }
    const ms = Date.now() - t0;
    if (show) console.log(`\n──── ${c.id} (${text.length} chars) ────\n${text}\n`);
    const wr = wordRecall(c.truth, text), ca = charAccuracy(c.truth, text);
    const nums = tokensKept(c.numbers ?? [], text);
    const tbl = c.table ? tableRowsKept(c.table, text) : null;
    const ord = c.order ? inOrder(text, c.order) : null;
    const end = foldText(text).includes(foldText(c.endMarker));
    // Undecoded markup entities (&amp; &lt; &#39; …) are a reading error, not text.
    const entities = (text.match(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi) ?? []).length;
    // Line structure: the extracted text keeps (at least half of) the document's lines — a reader that
    // flattens a document to one line loses rows, headings and every paragraph boundary.
    const lineCount = (x: string) => x.split('\n').filter((l) => l.trim()).length;
    const lineRatio = lineCount(text) / Math.max(1, lineCount(c.truth));
    // The chunk the index will embed: no chunk may exceed the chunker's size (+ overlap).
    const chunks = text ? chunkText(text, c.filename) : [];
    const maxChunk = Math.max(0, ...chunks.map((ch) => ch.content.length));
    const ok = wr >= 0.95 && nums.lost.length === 0 && (!tbl || tbl.kept === tbl.total) && ord !== false && end && entities === 0
      && lineRatio >= 0.5 && maxChunk <= MAX_CHUNK_CHARS;
    if (!ok) fails++;
    rows.push(`| ${c.id} | ${ok ? 'PASS' : 'FAIL'} | ${pct(wr)} | ${pct(ca)} | ${nums.kept.length}/${(c.numbers ?? []).length}${nums.lost.length ? ` lost: ${nums.lost.join(', ')}` : ''} | ${tbl ? `${tbl.kept}/${tbl.total}` : '—'} | ${ord === null ? '—' : ord ? 'yes' : 'NO'} | ${end ? 'yes' : 'NO'} | ${entities ? `${entities} raw` : '0'} | ${pct(Math.min(lineRatio, 9.99))} | ${chunks.length} / ${maxChunk} | ${ms}ms |`);
  }
  console.log('\n| case | verdict | word recall | char acc | numbers exact | table rows | order | end kept | entities | lines kept | chunks / max chars | time |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(r);
  console.log(`\n${fails ? `✗ ${fails} case(s) below the bar` : '✓ every case at the bar'} (bar: word recall ≥ 95%, every number exact, every table row on one line, order kept, end kept, no raw entities, ≥ 50% of lines kept, no chunk over ${MAX_CHUNK_CHARS} chars)`);
  process.exitCode = fails ? 1 : 0;
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
