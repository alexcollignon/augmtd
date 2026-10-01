// ─── THE TABLE IN THE MATERIAL (W38 — pure, client-safe) ──────────────────────────────────────
// Finds the tabular block inside free source material (a pasted CSV, a markdown table) so the
// facts floor can compute its aggregates IN CODE before an author writes — found by the W38 file
// verifier: a DM deck over a 4×3 sales table stated every quarter total +5,000 and a year total of
// 29,600 (true: 13,600) because the author summed by hand; the source was passed as grounding text,
// so no facts pass ever saw a table. Returns CSV text (header + rows) or null.

const DELIMS = [',', ';', '\t'] as const;

function csvRun(lines: string[]): string | null {
  let best: string[] = [];
  for (const d of DELIMS) {
    let run: string[] = [];
    let width = -1;
    const close = () => { if (run.length > best.length) best = run; run = []; width = -1; };
    for (const raw of lines) {
      const l = raw.trim();
      const n = l ? l.split(d).length - 1 : 0;
      if (n >= 1 && (width === -1 || n === width) && l.length <= 2000) { run.push(d === ',' ? l : l.split(d).map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')); width = n; }
      else { close(); if (n >= 1) { run.push(d === ',' ? l : l.split(d).join(',')); width = n; } }
    }
    close();
  }
  // A table: a header and at least two rows, with at least one numeric cell in the body.
  if (best.length < 3 || !best.slice(1).some((r) => /(^|,)\s*-?\d[\d.,\s]*\s*(,|$)/.test(r))) return null;
  return best.join('\n');
}

function markdownRun(lines: string[]): string | null {
  let best: string[] = []; let run: string[] = [];
  const isRow = (l: string) => { const t = l.trim(); return t.startsWith('|') && t.endsWith('|') && t.length > 2; };
  const isSep = (l: string) => /^\|?[\s:|-]+\|?$/.test(l.trim()) && l.includes('-');
  for (const l of [...lines, '']) {
    if (isRow(l)) { if (!isSep(l)) run.push(l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => { const v = c.trim(); return /[",]/.test(v) && !/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v.replace(/^(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/, (m) => m.replace(/,/g, '')); }).join(',')); }
    else { if (run.length > best.length) best = run; run = []; }
  }
  if (best.length < 3) return null;
  return best.join('\n');
}

/** The largest tabular block in `text` as CSV, or null. Pure. */
export function tabularBlock(text: string | null | undefined): string | null {
  const lines = String(text ?? '').split(/\r?\n/);
  const md = markdownRun(lines);
  const csv = csvRun(lines.filter((l) => !l.trim().startsWith('|')));
  if (md && csv) return md.split('\n').length >= csv.split('\n').length ? md : csv;
  return md ?? csv;
}
