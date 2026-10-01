// ════════════════════════════════════════════════════════════════════════════════════════════════
// W38 — EVERY GENERATED FILE IS REAL (live suite; NOT in the zero-AI board).
//
// Runs each file producer through its REAL path — real model calls on a probe host, the real compute
// sandbox, the real storage bucket — with generic fake inputs, downloads the STORED file, and judges it
// IN CODE (scripts/lib/file-check.ts — zero judge): it opens, its bytes match its extension and MIME,
// its sections/sheets/columns/slides are there, formulas are formulas and evaluate to the source's
// figures, every figure it states traces to the source data, no placeholder garbage, the language is
// the request's, no non-test address leaks, the size is sane, the title is not a mid-word clip.
//
// Producers (format × path):
//   door-template-docx   materializeDocument template tier            → .docx (zero AI)
//   door-typed-xlsx      materializeDocument typed ```spreadsheet      → .xlsx (zero AI)
//   door-typed-pptx      materializeDocument typed ```slides + chart   → .pptx (zero AI)
//   dm-word-fr           generateThreadDocument word (French ask)       → stored .docx
//   dm-excel             generateThreadDocument excel                   → stored .xlsx
//   dm-pptx              generateThreadDocument pptx                    → stored .pptx
//   dm-word-chart        generateThreadDocument word + CSV + "chart"    → compiler tier (sandbox) .docx
//   dm-excel-chart       generateThreadDocument excel + CSV + "chart"   → compiler tier (sandbox) .xlsx
//   compute-outputs      executeRunCompute (run_compute) → work-artifacts .csv + .xlsx (sandbox, zero AI)
//   frame-html           materializeDocument forceType frame            → .html
//   email-attachment     the workflow e-mail attachment for a stored artifact (lib/artifacts/attachment)
//
// PROBE HOSTS: pool account #3 of each tier (smoke-probe-pool-3@ / smoke-probe-eu-3@) — accounts #1/#2
// belong to other suites. Every row/file a case writes is torn down after it (threads + messages +
// stored artifacts, the KB rows the indexer adds, compute output folders).
//
//   npx tsx scripts/verify-generated-files.ts                     # DRY: the plan + estimate, spends nothing
//   npx tsx scripts/verify-generated-files.ts --yes               # both tiers (EU sequential), every case
//   flags: --tier standard|eu|both · --cases a,b · --max-eur n (hard stop, default 8) · --dump <dir> (keep the files)
// Cost: ≈ €0.6–1.2 per tier (the compiler's codegen dominates). Stops on the first Bedrock daily cap.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never);
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  readFileView, garbageHits, unsourcedFigures, missingFigures, derivableFigures, evaluateSheetFormulas,
  guessLanguage, nonTestAddresses, withReferenceGaps, isMidWordClip, formatConsistency, sizeProblem, MIME_BY_EXT, type FileView,
} from './lib/file-check';
import { installMeter, metered, meterAdapterClient, setCallGate } from './lib/eval/meter';
import { priceCalls } from './lib/eval/engine/pricing';
import { installProbeWriteFence, probeHostOf } from './lib/eval/engine/world';
import { isDailyQuota } from './lib/eval-surfaces/failures';
import { deleteThreads } from './lib/eval-surfaces/team';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string): string | null => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const tierArg = opt('tier') ?? 'both';
const TIERS = (tierArg === 'both' ? ['standard', 'eu'] : [tierArg]) as Array<'standard' | 'eu'>;
const ONLY = opt('cases')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const MAX_EUR = Number(opt('max-eur') ?? '8');
const LIVE = flag('yes');
const DUMP = opt('dump'); // write every produced file here (inspection)

// ── THE FIXTURE (generic; no real names, no real data) ──────────────────────────────────────────
const CSV = 'region,q1,q2,q3\nNorth,1180,1240,1310\nSouth,960,1015,990\nEast,1420,1380,1505\nWest,805,870,925';
const ROWS: Array<[string, number[]]> = CSV.split('\n').slice(1).map((l) => { const [r, ...v] = l.split(','); return [r, v.map(Number)]; });
const NUMS = ROWS.map(([, v]) => v);
const REGION_TOTALS = NUMS.map((v) => v.reduce((a, b) => a + b, 0));               // 3730 2965 4305 2600
const QUARTER_TOTALS = [0, 1, 2].map((c) => NUMS.reduce((a, r) => a + r[c], 0));    // 4365 4505 4730
const GRAND = REGION_TOTALS.reduce((a, b) => a + b, 0);                              // 13600
const ALLOWED = derivableFigures(NUMS);
const MATERIAL = `Quarterly sales by region (units), from the sales tracker:\n${CSV}\n\nNote: the target is 1,400 units per region per quarter.`;
// The target and what derives from it: per-cell gaps, per-region (×3) / per-quarter (×4) / overall (×12)
// targets, and each total's gap to its target.
const TARGETS = [1400, 1400 * 3, 1400 * 4, 1400 * 12];
const ALLOWED_WITH_TARGET = withReferenceGaps(ALLOWED, TARGETS);

type Produced = { bytes: Buffer; ext: string; mime: string | null; title?: string; request?: string; note?: string };
type Expect = {
  format: 'docx' | 'xlsx' | 'pptx' | 'csv' | 'html';
  lang?: string;
  figures?: number[];            // must appear
  allowed?: number[];            // every figure ≥100 must be derivable from these
  headings?: number;             // docx: at least n headings
  images?: number;               // docx/pptx: at least n embedded images (charts as pictures)
  slides?: [number, number];     // pptx: slide count range
  chartValues?: number[];        // pptx/xlsx native chart carries these
  sheet?: { headers: RegExp[]; rowsFrom: 'source'; totalCol?: boolean; formulas?: boolean; chart?: boolean };
};
type Case = { id: string; ai: boolean; compute: boolean; estEur: number; run: (c: Ctx) => Promise<Produced>; expect: Expect };
type Ctx = { admin: SupabaseClient; userId: string; tier: 'standard' | 'eu'; threads: string[]; artifactIds: string[]; computePrefixes: string[]; since: string };

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
async function newThread(c: Ctx, withCsv: boolean): Promise<string> {
  const row: Record<string, unknown> = { user_id: c.userId, title: 'W38 file verify', status: 'active' };
  if (withCsv) row.user_attachments = [{ chatAttachId: 'w38', filename: 'regional-sales.csv', mimeType: 'text/csv', size: CSV.length, extractedText: CSV }];
  const { data, error } = await c.admin.from('work_threads').insert(row).select('id').single();
  if (error || !data) throw new Error(`work_threads insert: ${error?.message ?? 'no row'}`);
  c.threads.push((data as { id: string }).id);
  return (data as { id: string }).id;
}

async function storedArtifact(c: Ctx, threadId: string, artifactId: string): Promise<Produced & { type: string }> {
  const { data, error } = await c.admin.from('work_threads').select('artifacts').eq('id', threadId).single();
  if (error) throw new Error(`work_threads read: ${error.message}`);
  const a = ((data as { artifacts?: Array<{ id: string; storage_path?: string; type: string; title: string }> }).artifacts ?? []).find((x) => x.id === artifactId);
  if (!a?.storage_path) throw new Error('the artifact row carries no storage_path');
  const dl = await c.admin.storage.from('work-artifacts').download(a.storage_path);
  if (dl.error || !dl.data) throw new Error(`storage download: ${dl.error?.message ?? 'no data'}`);
  // What the user's download serves: the route's own header builder (ext + MIME + filename).
  const { downloadHeaders } = await import('../lib/artifacts/download-name');
  const h = downloadHeaders(a.title, a.type as never, a.storage_path);
  return { bytes: Buffer.from(await dl.data.arrayBuffer()), ext: h.ext, mime: h.mime, title: a.title, type: a.type, note: `stored ${a.storage_path.split('.').pop()} · served as ${h.filename}` };
}

async function dm(c: Ctx, type: 'word' | 'excel' | 'pptx', instructions: string, withCsv: boolean): Promise<Produced> {
  const threadId = await newThread(c, withCsv);
  const { generateThreadDocument } = await import('../lib/work/generate-thread-document');
  const r = await generateThreadDocument({ userId: c.userId, threadId, type, instructions, adminClient: c.admin, groundingContext: withCsv ? undefined : MATERIAL });
  if (!r.artifact) throw new Error(`no artifact — ${r.summary}`);
  c.artifactIds.push(r.artifact.id);
  return { ...(await storedArtifact(c, threadId, r.artifact.id)), request: instructions };
}

async function door(c: Ctx, args: Record<string, unknown>): Promise<Produced & { tier: string }> {
  const { materializeDocument } = await import('../lib/documents/materialize');
  const m = await materializeDocument(c.admin, c.userId, { theme: null, ...args } as never);
  return { bytes: m.bytes, ext: m.ext, mime: m.mime, title: String(args.title), tier: m.tier, note: `tier ${m.tier}` };
}

const TEMPLATE_MD = `## Summary\nRegional sales reached ${GRAND.toLocaleString('en-US')} units over three quarters. East led with ${REGION_TOTALS[2].toLocaleString('en-US')} units.\n\n` +
  `## Figures\n| Region | Q1 | Q2 | Q3 | Total |\n|---|---|---|---|---|\n${ROWS.map(([r, v], i) => `| ${r} | ${v.join(' | ')} | ${REGION_TOTALS[i]} |`).join('\n')}\n\n` +
  `## Next steps\n- Review the South pipeline before ${'the next review'}\n- Share the tracker with the regional leads`;

const CASES: Case[] = [
  { id: 'door-template-docx', ai: false, compute: false, estEur: 0,
    run: (c) => door(c, { title: 'Regional sales summary', content: TEMPLATE_MD, request: 'a short memo' }),
    expect: { format: 'docx', figures: [...NUMS.flat(), ...REGION_TOTALS, GRAND], allowed: ALLOWED, headings: 3 } },
  { id: 'door-typed-xlsx', ai: false, compute: false, estEur: 0,
    run: (c) => door(c, { title: 'Regional tracker', request: 'a tracker', content: `Here is the tracker.\n\`\`\`spreadsheet\n${JSON.stringify({ title: 'Regional tracker', sheets: [{ name: 'Sales', headers: ['Region', 'Q1', 'Q2', 'Q3', 'Total'], rows: ROWS.map(([r, v], i) => [r, ...v, REGION_TOTALS[i]]) }] })}\n\`\`\`` }),
    expect: { format: 'xlsx', allowed: ALLOWED, sheet: { headers: [/region/i, /q1/i, /q2/i, /q3/i, /total/i], rowsFrom: 'source', totalCol: true } } },
  { id: 'door-typed-pptx', ai: false, compute: false, estEur: 0,
    run: (c) => door(c, { title: 'Regional review', request: 'a deck', content: `\`\`\`slides\n${JSON.stringify({ title: 'Regional review', subtitle: 'Q1–Q3', slides: [
      { title: 'Regional review', layout: 'title' },
      { title: 'East leads on volume', layout: 'content', bullets: [`East: ${REGION_TOTALS[2]} units`, `North: ${REGION_TOTALS[0]} units`, `Total: ${GRAND} units`] },
      { title: 'Totals by region', layout: 'content', chart: { type: 'bar', labels: ROWS.map(([r]) => r), values: REGION_TOTALS, title: 'Units by region' } },
    ] })}\n\`\`\`` }),
    expect: { format: 'pptx', slides: [3, 3], chartValues: REGION_TOTALS, allowed: ALLOWED } },
  { id: 'dm-word-fr', ai: true, compute: false, estEur: 0.08,
    run: (c) => dm(c, 'word', 'Rédige une note de synthèse d\'une page pour la direction sur les ventes régionales du trimestre, avec le total par région et la tendance trimestre par trimestre.', false),
    expect: { format: 'docx', lang: 'fr', figures: REGION_TOTALS, allowed: ALLOWED_WITH_TARGET, headings: 1 } },
  { id: 'dm-excel', ai: true, compute: false, estEur: 0.05,
    run: (c) => dm(c, 'excel', 'Build a spreadsheet tracker of the regional sales: one row per region with columns Region, Q1, Q2, Q3 and a Total column.', false),
    expect: { format: 'xlsx', allowed: ALLOWED_WITH_TARGET, sheet: { headers: [/region/i, /q1/i, /q2/i, /q3/i, /total/i], rowsFrom: 'source', totalCol: true } } },
  { id: 'dm-pptx', ai: true, compute: false, estEur: 0.06,
    run: (c) => dm(c, 'pptx', 'Prepare a 4-slide deck for the regional sales review: overview, region by region, quarter trend, next steps.', false),
    expect: { format: 'pptx', slides: [3, 8], allowed: ALLOWED_WITH_TARGET } },
  { id: 'dm-word-chart', ai: true, compute: true, estEur: 0.35,
    run: (c) => dm(c, 'word', 'Write a short report on the attached regional sales with a bar chart of the total per region.', true),
    expect: { format: 'docx', images: 1, figures: REGION_TOTALS, allowed: ALLOWED, headings: 1 } },
  { id: 'dm-excel-chart', ai: true, compute: true, estEur: 0.35,
    run: (c) => dm(c, 'excel', 'Build a spreadsheet of the attached regional sales with a Total column per region and a chart of the totals.', true),
    expect: { format: 'xlsx', allowed: ALLOWED, sheet: { headers: [/region/i, /q1/i, /q2/i, /q3/i, /total/i], rowsFrom: 'source', totalCol: true, formulas: true, chart: true } } },
  { id: 'compute-outputs', ai: false, compute: true, estEur: 0,
    run: async (c) => computeOutputs(c, 'xlsx'),
    expect: { format: 'xlsx', allowed: ALLOWED, sheet: { headers: [/region/i, /q1/i, /q2/i, /q3/i, /total/i], rowsFrom: 'source', totalCol: true, formulas: true } } },
  { id: 'compute-outputs-csv', ai: false, compute: true, estEur: 0,
    run: async (c) => computeOutputs(c, 'csv'),
    expect: { format: 'csv', figures: [...REGION_TOTALS], allowed: ALLOWED } },
  { id: 'frame-html', ai: true, compute: true, estEur: 0.3,
    run: (c) => door(c, { title: 'Regional sales view', forceType: 'frame', csvText: CSV, request: 'Make a one-screen dashboard of the quarterly regional sales: totals per region and the quarter trend.',
      content: `## Regional sales\nTotals per region over Q1–Q3: ${ROWS.map(([r], i) => `${r} ${REGION_TOTALS[i]}`).join(', ')}. Quarter totals: ${QUARTER_TOTALS.join(', ')}. Overall ${GRAND}.` }),
    expect: { format: 'html', figures: REGION_TOTALS, allowed: ALLOWED } },
  { id: 'email-attachment', ai: false, compute: false, estEur: 0,
    run: async (c) => emailAttachment(c),
    expect: { format: 'xlsx', allowed: ALLOWED, sheet: { headers: [/region/i, /q1/i, /q2/i, /q3/i, /total/i], rowsFrom: 'source', totalCol: true } } },
];

// The compute sandbox through run_compute's executor: a fixed script (the plumbing under test is the
// locked room → work-artifacts → KB index, not codegen) writing a CSV and an xlsx with live formulas.
const computeCache = new WeakMap<Ctx, Promise<{ csv: Produced; xlsx: Produced }>>();
function computeOutputs(c: Ctx, which: 'csv' | 'xlsx'): Promise<Produced> {
  if (!computeCache.has(c)) computeCache.set(c, (async () => {
    const script = [
      'import csv, openpyxl',
      'rows = list(csv.DictReader(open("/job/inputs/data.txt")))',
      'print("TOTAL ROWS:", len(rows))',
      'with open("/job/out/region-totals.csv", "w", newline="") as f:',
      '    w = csv.writer(f); w.writerow(["region", "total"])',
      '    for r in rows: w.writerow([r["region"], int(r["q1"]) + int(r["q2"]) + int(r["q3"])])',
      'wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Sales"',
      'ws.append(["Region", "Q1", "Q2", "Q3", "Total"])',
      'for i, r in enumerate(rows, start=2):',
      '    ws.append([r["region"], int(r["q1"]), int(r["q2"]), int(r["q3"]), f"=SUM(B{i}:D{i})"])',
      'wb.save("/job/out/region-sales.xlsx")',
      'print("DONE")',
    ].join('\n');
    const { executeRunCompute } = await import('../lib/tools/compute');
    const prefix = `compute/${c.userId}`;
    const before = new Set(((await c.admin.storage.from('work-artifacts').list(prefix, { limit: 1000 })).data ?? []).map((x) => x.name));
    const out = await executeRunCompute({ script, data: CSV, description: 'W38 verify: region totals' }, c.userId, c.admin);
    if (!/Files produced/.test(out) || /STORE FAILED|FAILED|unreachable|not configured/.test(out)) throw new Error(`run_compute: ${out.slice(0, 400)}`);
    const after = ((await c.admin.storage.from('work-artifacts').list(prefix, { limit: 1000 })).data ?? []).map((x) => x.name);
    const job = after.find((n) => !before.has(n));
    if (!job) throw new Error('run_compute reported files but no new job folder exists in work-artifacts');
    c.computePrefixes.push(`${prefix}/${job}`);
    const files = (await c.admin.storage.from('work-artifacts').list(`${prefix}/${job}`)).data ?? [];
    const get = async (name: string): Promise<Produced> => {
      const meta = files.find((f) => f.name === name);
      if (!meta) throw new Error(`${name} missing from the job folder (have: ${files.map((f) => f.name).join(', ')})`);
      const dl = await c.admin.storage.from('work-artifacts').download(`${prefix}/${job}/${name}`);
      if (dl.error || !dl.data) throw new Error(`download ${name}: ${dl.error?.message}`);
      return { bytes: Buffer.from(await dl.data.arrayBuffer()), ext: name.split('.').pop()!, mime: (meta.metadata as { mimetype?: string } | null)?.mimetype ?? null, title: name, note: 'run_compute → work-artifacts' };
    };
    return { csv: await get('region-totals.csv'), xlsx: await get('region-sales.xlsx') };
  })());
  return computeCache.get(c)!.then((r) => r[which]);
}

// The workflow e-mail attachment of a stored typed spreadsheet: the attachment must be THE delivered
// file (same bytes, its own ext), never a re-render through the wrong builder.
async function emailAttachment(c: Ctx): Promise<Produced> {
  const m = await door(c, { title: 'Regional tracker', request: 'a tracker', content: `\`\`\`spreadsheet\n${JSON.stringify({ title: 'Regional tracker', sheets: [{ name: 'Sales', headers: ['Region', 'Q1', 'Q2', 'Q3', 'Total'], rows: ROWS.map(([r, v], i) => [r, ...v, REGION_TOTALS[i]]) }] })}\n\`\`\`` });
  const threadId = await newThread(c, false);
  const id = crypto.randomUUID();
  const storagePath = `${c.userId}/${threadId}/${id}.${m.ext}`;
  const up = await c.admin.storage.from('work-artifacts').upload(storagePath, m.bytes, { contentType: m.mime ?? undefined, upsert: true });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const { textToDocContent } = await import('../lib/workflows/doc-content');
  const artifact = { id, title: 'Regional tracker', type: 'spreadsheet', storage_path: storagePath, content: textToDocContent('Regional tracker', 'x') };
  await c.admin.from('work_threads').update({ artifacts: [artifact], artifact }).eq('id', threadId);
  const { attachmentForArtifact } = await import('../lib/artifacts/attachment');
  // The workflow's configured output kind is 'document' (the common default) — the attachment must still be the sheet.
  const att = await attachmentForArtifact(c.admin, artifact as never, { subject: 'Regional tracker', configuredType: 'document' });
  return { bytes: att.content, ext: att.filename.split('.').pop()!, mime: MIME_BY_EXT[att.filename.split('.').pop()!] ?? null, title: att.filename, note: `attachment ${att.filename}` };
}

// ── THE JUDGE IN CODE ───────────────────────────────────────────────────────────────────────────
function judge(p: Produced, view: FileView, e: Expect): string[] {
  const f: string[] = [];
  if (view.format !== e.format) f.push(`format: expected ${e.format}, got ${view.format}`);
  f.push(...formatConsistency(view.format, p.ext, p.mime));
  const sz = sizeProblem(view.format, p.bytes.length); if (sz) f.push(`size: ${sz}`);
  const g = garbageHits(view.text, { syntax: view.format !== 'csv' && view.format !== 'html' }); if (g.length) f.push(`garbage: ${g.join(', ')}`);
  const addr = nonTestAddresses(view.text); if (addr.length) f.push(`non-test addresses: ${addr.join(', ')}`);
  if (p.title && p.request && isMidWordClip(p.title, p.request)) f.push(`title is a mid-word clip of the request: "${p.title}"`);
  if (e.lang) { const l = guessLanguage(view.text); if (l !== e.lang) f.push(`language: expected ${e.lang}, got ${l ?? 'undetermined'}`); }
  if (e.figures) { const miss = missingFigures(view.text, e.figures); if (miss.length) f.push(`figures absent: ${miss.join(', ')}`); }
  if (e.allowed) { const un = unsourcedFigures(view.text, e.allowed); if (un.length) f.push(`figures not derivable from the source: ${un.slice(0, 8).join(', ')}`); }
  if (e.headings != null && (view.docx?.headings.length ?? 0) < e.headings) f.push(`headings: ${view.docx?.headings.length ?? 0} < ${e.headings}`);
  if (e.images != null) {
    const n = view.docx?.images ?? view.pptx?.images ?? 0;
    if (n < e.images) f.push(`embedded charts/images: ${n} < ${e.images} (the compiler tier did not deliver — template fallback)`);
  }
  if (e.slides && view.pptx) {
    const n = view.pptx.slides.length;
    if (n < e.slides[0] || n > e.slides[1]) f.push(`slides: ${n} outside ${e.slides.join('–')}`);
    const untitled = view.pptx.slides.filter((s) => !s.title.trim()).length;
    if (untitled) f.push(`${untitled} slide(s) without a title`);
  }
  if (e.chartValues && view.pptx) {
    const miss = e.chartValues.filter((v) => !view.pptx!.chartValues.includes(v));
    if (!view.pptx.charts) f.push('no native chart in the deck'); else if (miss.length) f.push(`chart values absent: ${miss.join(', ')}`);
  }
  if (e.sheet && view.xlsx) {
    const s = e.sheet;
    // Find the sheet + header row carrying every expected header.
    let found: { sheet: (typeof view.xlsx.sheets)[number]; hr: number; cols: number[] } | null = null;
    for (const sh of view.xlsx.sheets) {
      for (let r = 0; r < Math.min(sh.rows.length, 8) && !found; r++) {
        const row = sh.rows[r].map((x) => String(x ?? ''));
        const cols = s.headers.map((re) => row.findIndex((h) => re.test(h)));
        if (cols.every((i) => i >= 0)) found = { sheet: sh, hr: r, cols };
      }
      if (found) break;
    }
    if (!found) f.push(`no sheet carries the headers ${s.headers.map((r) => r.source).join(', ')}`);
    else {
      const { sheet, hr, cols } = found;
      const evals = new Map(evaluateSheetFormulas(sheet).map((x) => [x.ref, x.value]));
      const XL = (r: number, c: number) => `${String.fromCharCode(65 + c)}${r + 1}`;
      const num = (r: number, c: number): number | null => {
        const ref = XL(r, c); const cell = sheet.cells[ref];
        if (cell?.f) return evals.get(ref) ?? (typeof cell.v === 'number' ? cell.v : null);
        const v = sheet.rows[r]?.[c];
        return typeof v === 'number' ? v : v != null && Number.isFinite(Number(v)) ? Number(v) : null;
      };
      for (let i = 0; i < ROWS.length; i++) {
        const [region, vals] = ROWS[i];
        const r = sheet.rows.findIndex((row, k) => k > hr && String(row[cols[0]] ?? '').trim().toLowerCase() === region.toLowerCase());
        if (r < 0) { f.push(`row "${region}" missing`); continue; }
        vals.forEach((v, j) => { const got = num(r, cols[j + 1]); if (got !== v) f.push(`${region} Q${j + 1}: ${got} ≠ source ${v}`); });
        if (s.totalCol) { const got = num(r, cols[4]); if (got == null || Math.abs(got - REGION_TOTALS[i]) > 0.01) f.push(`${region} total: ${got} ≠ ${REGION_TOTALS[i]}`); }
      }
      const fs = evaluateSheetFormulas(sheet);
      const wrong = fs.filter((x) => x.value != null && !ALLOWED.some((a) => Math.abs(a - x.value!) <= 0.51));
      if (wrong.length) f.push(`formulas evaluating to figures not derivable from the source: ${wrong.slice(0, 4).map((x) => `${x.ref} =${x.f} → ${x.value}`).join('; ')}`);
    }
    if (s.formulas && view.xlsx.formulas === 0) f.push('no live formulas (derived cells are hardcoded)');
    if (s.chart && view.xlsx.charts === 0) f.push('no chart in the workbook');
  }
  if (view.html) {
    if (view.html.remoteRefs.length) f.push(`remote resources: ${view.html.remoteRefs.slice(0, 3).join(', ')}`);
  }
  return f;
}

// ── RUN ─────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  const cases = CASES.filter((c) => !ONLY || ONLY.includes(c.id));
  const est = cases.reduce((a, c) => a + c.estEur, 0) * TIERS.length;
  console.log(`W38 verify-generated-files — ${cases.length} cases × ${TIERS.join('+')} · estimate ≈ €${est.toFixed(2)} (cap €${MAX_EUR})`);
  if (!LIVE) { for (const c of cases) console.log(`  ${c.id}${c.ai ? ' [AI]' : ''}${c.compute ? ' [sandbox]' : ''}`); console.log('DRY RUN — add --yes to run.'); return; }
  if (est > MAX_EUR) { console.error('REFUSED: estimate over the cap'); process.exit(2); }
  if (!process.env.COMPUTE_SERVICE_URL || !process.env.COMPUTE_SECRET) console.warn('⚠ COMPUTE_SERVICE_URL/COMPUTE_SECRET unset — sandbox cases will fail (as they would in prod)');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const probeIds: string[] = [];
  let fenceHit = '';
  installProbeWriteFence(url, () => probeIds, (r) => { fenceHit = r; });
  installMeter();
  let euStop = '';
  setCallGate(async (model, fn) => {
    if (euStop) throw new Error(`EU QUOTA STOP (${euStop})`);
    try { return await fn(); } catch (e) { const m = String((e as Error)?.message ?? e); if (isDailyQuota(m)) euStop = m.slice(0, 160); throw e; }
  });
  // Product code swallows model errors into honest nulls — the daily cap is also caught from its logs.
  const origErr = console.error.bind(console);
  console.error = (...a: unknown[]) => { const s = a.map(String).join(' '); if (isDailyQuota(s)) euStop ||= s.slice(0, 160); origErr(...a); };

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { resolveProbePool } = await import('./lib/eval/engine/probes');
  const pool = await resolveProbePool(admin, { spec: Object.fromEntries(TIERS.map((t) => [t, [3]])), create: false });
  if (pool.problems.length || pool.missing.length) { console.error('probe pool:', [...pool.problems, ...pool.missing].join('; ')); process.exit(2); }

  const results: Array<{ tier: string; id: string; ok: boolean; failures: string[]; note: string; eur: number; ms: number }> = [];
  let spent = 0;
  for (const tier of TIERS) {
    const acct = pool.accounts.find((a) => a.tier === tier)!;
    const host = probeHostOf(acct.email);
    if (!host || host.tier !== tier || host.k !== 3) { console.error(`REFUSED: ${acct.email} is not probe #3 of ${tier}`); process.exit(2); }
    probeIds.push(acct.userId);
    const { getAIClient } = await import('../lib/ai/factory');
    for (const s of ['classification', 'conversation', 'generation', 'summarization', 'planning'] as const) meterAdapterClient((await getAIClient(acct.userId, s, admin)).client);
    console.log(`\n── ${tier} · ${acct.label} (${acct.userId.slice(0, 8)})`);
    for (const k of cases) {
      if (spent >= MAX_EUR) { results.push({ tier, id: k.id, ok: false, failures: ['UNRUN — budget cap reached'], note: '', eur: 0, ms: 0 }); continue; }
      if (euStop && k.ai) { results.push({ tier, id: k.id, ok: false, failures: [`UNRUN — Bedrock daily cap (${euStop})`], note: '', eur: 0, ms: 0 }); continue; }
      const ctx: Ctx = { admin, userId: acct.userId, tier, threads: [], artifactIds: [], computePrefixes: [], since: new Date().toISOString() };
      const t0 = Date.now();
      let failures: string[] = []; let note = ''; let eur = 0;
      try {
        const { result, bucket } = await metered(() => k.run(ctx));
        eur = priceCalls(bucket.calls).costEur; spent += eur;
        note = result.note ?? '';
        if (DUMP) { const fs = await import('fs'); fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(`${DUMP}/${tier}-${k.id}.${result.ext}`, result.bytes); }
        let view: FileView | null = null;
        try { view = await readFileView(result.bytes); } catch (e) { failures.push(`does not open: ${(e as Error).message}`); }
        if (view) failures = failures.concat(judge(result, view, k.expect));
      } catch (e) { failures.push(`producer threw: ${(e as Error).message.slice(0, 300)}`); }
      if (fenceHit) failures.push(`probe fence: ${fenceHit}`);
      // ── teardown (threads + stored artifacts + KB rows + compute folders) ──
      const td: string[] = [];
      try {
        await new Promise((r) => setTimeout(r, ctx.artifactIds.length || ctx.computePrefixes.length ? 4000 : 0)); // let the background indexer land first
        td.push(...await deleteThreads(admin, ctx.userId, ctx.threads));
        const pf = ctx.computePrefixes.flatMap(() => []) as string[];
        for (const p of ctx.computePrefixes) {
          const ls = (await admin.storage.from('work-artifacts').list(p)).data ?? [];
          if (ls.length) { const r = await admin.storage.from('work-artifacts').remove(ls.map((x) => `${p}/${x.name}`)); if (r.error) td.push(r.error.message); }
          pf.push(...ls.map((x) => `compute::${p.split('/').pop()}::${x.name}`));
        }
        const ids = [...ctx.artifactIds, ...pf];
        if (ids.length) {
          for (let i = 0; i < 12; i++) {
            const { data } = await admin.from('knowledge_files').select('id').eq('user_id', ctx.userId).in('provider_file_id', ids);
            const fids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
            if (fids.length) {
              const ch = await admin.from('knowledge_chunks').delete().eq('user_id', ctx.userId).in('file_id', fids); if (ch.error) td.push(ch.error.message);
              const kf = await admin.from('knowledge_files').delete().eq('user_id', ctx.userId).in('id', fids); if (kf.error) td.push(kf.error.message);
            }
            if (fids.length >= ids.length || i === 11) break;
            await new Promise((r) => setTimeout(r, 2500));
          }
        }
        // The 'AUGMTD Files' source the indexer provisioned during this case, when nothing else is in it.
        const { data: srcs } = await admin.from('knowledge_sources').select('id').eq('user_id', ctx.userId).eq('provider', 'augmtd').gte('created_at', ctx.since);
        for (const src of (srcs ?? []) as Array<{ id: string }>) {
          const { count } = await admin.from('knowledge_files').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('source_id', src.id);
          if (!count) { const d = await admin.from('knowledge_sources').delete().eq('user_id', ctx.userId).eq('id', src.id); if (d.error) td.push(`knowledge_sources: ${d.error.message}`); }
        }
      } catch (e) { td.push((e as Error).message.slice(0, 200)); }
      if (td.length) failures.push(`teardown: ${td.map((x) => x.slice(0, 200)).join('; ')}`);
      const ok = failures.length === 0;
      results.push({ tier, id: k.id, ok, failures, note, eur, ms: Date.now() - t0 });
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${k.id.padEnd(20)} ${note ? `(${note}) ` : ''}€${eur.toFixed(3)} ${Math.round((Date.now() - t0) / 1000)}s${ok ? '' : `\n        - ${failures.join('\n        - ')}`}`);
    }
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} files verified · spent ≈ €${spent.toFixed(2)}`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
