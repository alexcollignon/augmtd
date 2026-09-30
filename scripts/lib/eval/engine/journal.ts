// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — THE RUN JOURNAL (append-safe resume). Every finished (surface, tier, case, repeat, column) run
// is appended as ONE JSON line to `<run>.jsonl` the moment it lands, so a stopped or crashed run never
// needs a full re-run: `--resume <run>.json` reads the journal (or, for a run that finished, the saved
// .json itself), skips every finished unit and continues ON THE SAME RUN CLOCK — for TRUTHS (relative
// dates resolve against it; mixing truth clocks inside one result would compare different days).
// W27.C — THE TWO CLOCKS: the run clock is `header.now`; everything that happens is stamped on the
// WALL clock — each record's `at`, and one `resume` line per resumed invocation (`at` + the run clock
// it continued) — and AUGMTD worlds are seeded on the wall clock too (runner.ts RunPlan.worldClock),
// because the product reads the real clock: a resume hours later used to age every fixture message by
// the gap (the W26 diagnosis: a run clock ~4h behind the clock the product prompts read).
// A torn last line (the process died mid-write) is ignored, never fatal.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import type { EngineResult } from './runner';
import type { ColumnId, ColumnRun, Tier } from './types';

export type JournalHeader = {
  type: 'header';
  version: 1;
  now: string;
  startedAt: string;
  repeat: number;
  columns: ColumnId[];
  tiers: Tier[];
  judgeModel: string | null;
  /** Anything that changes what a run measures (judge style, efforts): a resume must match it. */
  fingerprint: Record<string, unknown>;
};

export type RunRecord = { surface: string; tier: Tier; caseId: string; repeat: number; column: ColumnId; run: ColumnRun };
type RunLine = RunRecord & { type: 'run'; /** wall-clock stamp (W27.C) */ at?: string };
/** One per resumed invocation: when it resumed (wall clock) and the run clock it continued on. */
export type ResumeLine = { type: 'resume'; at: string; runClock: string; from: string };

export const unitKey = (r: { surface: string; tier: string; caseId: string; repeat: number; column: string }) =>
  `${r.surface}|${r.tier}|${r.caseId}|${r.repeat}|${r.column}`;

/** A record counts as FINISHED (skipped on resume) unless it was a budget skip, an error (retried —
 *  429 exhaustion and transient faults deserve another attempt) or a copy from another tier. */
export const isFinished = (run: ColumnRun) => !run.skipped && !run.out.error && !run.reusedFrom;

export const journalPathOf = (jsonPath: string) => jsonPath.replace(/\.json$/, '') + '.jsonl';

export class Journal {
  constructor(readonly path: string) {}
  /** Start a new journal (or keep appending to an existing one on resume). */
  open(header: JournalHeader, resume: boolean): void {
    if (resume && existsSync(this.path)) {
      // A process killed mid-write leaves a torn last line: close it, or the first new record would
      // be glued onto it and lost with it.
      const text = readFileSync(this.path, 'utf8');
      if (text.length && !text.endsWith('\n')) appendFileSync(this.path, '\n');
      return;
    }
    writeFileSync(this.path, JSON.stringify(header) + '\n');
  }
  append(r: RunRecord): void {
    // One write per line: appendFileSync with a single string is one write(2) for our line sizes,
    // and a torn tail is tolerated by the reader.
    appendFileSync(this.path, JSON.stringify({ type: 'run', ...r, at: new Date().toISOString() } satisfies RunLine, (_k, v) => (typeof v === 'function' ? undefined : v)) + '\n');
  }
  /** Stamp a resumed invocation (wall clock) — the reader ignores it; a human reads the timeline. */
  markResume(runClock: string, from: string): void {
    appendFileSync(this.path, JSON.stringify({ type: 'resume', at: new Date().toISOString(), runClock, from } satisfies ResumeLine) + '\n');
  }
}

/** Parse a journal: the header + the LAST record per unit (a re-run after an error supersedes it). */
export function parseJournal(text: string): { header: JournalHeader | null; records: RunRecord[]; torn: number } {
  let header: JournalHeader | null = null;
  const byKey = new Map<string, RunRecord>();
  let torn = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: { type?: string } & Record<string, unknown>;
    try { o = JSON.parse(line); } catch { torn++; continue; }
    if (o.type === 'header') header = o as unknown as JournalHeader;
    else if (o.type === 'run') {
      const line = o as unknown as RunLine;
      const rec: RunRecord = { surface: line.surface, tier: line.tier, caseId: line.caseId, repeat: line.repeat, column: line.column, run: line.run };
      byKey.set(unitKey(rec), rec);
    }
  }
  return { header, records: [...byKey.values()], torn };
}

/** Records from a saved result (a run that finished, or one written before journals existed). */
export function recordsFromResult(r: EngineResult): RunRecord[] {
  const out: RunRecord[] = [];
  for (const sr of r.surfaces) for (const cr of sr.cases) for (const [col, runs] of Object.entries(cr.runs)) {
    for (const run of runs ?? []) out.push({ surface: sr.surface, tier: sr.tier, caseId: cr.caseId, repeat: run.repeat, column: col as ColumnId, run });
  }
  return out;
}

/** What `--resume <path>` loads: the journal next to the .json when it exists, else the .json. */
export function loadResume(p: string): { header: JournalHeader | null; records: RunRecord[]; from: string; torn: number; saved: EngineResult | null } {
  const jsonl = p.endsWith('.jsonl') ? p : journalPathOf(p);
  const json = p.endsWith('.jsonl') ? p.replace(/\.jsonl$/, '.json') : p;
  const saved = existsSync(json) ? (JSON.parse(readFileSync(json, 'utf8')) as EngineResult) : null;
  if (existsSync(jsonl)) {
    const j = parseJournal(readFileSync(jsonl, 'utf8'));
    return { ...j, from: jsonl, saved };
  }
  if (!saved) throw new Error(`--resume: neither ${jsonl} nor ${json} exists`);
  return {
    header: { type: 'header', version: 1, now: saved.now, startedAt: saved.startedAt, repeat: saved.repeat, columns: [], tiers: [], judgeModel: saved.judgeModel, fingerprint: {} },
    records: recordsFromResult(saved), from: json, torn: 0, saved,
  };
}

/** The fingerprint fields that differ between a journal and this invocation (a resume refuses them). */
export function fingerprintMismatch(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => k in a && k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${JSON.stringify(a[k])} ≠ ${JSON.stringify(b[k])}`);
}

/** Atomic write (tmp + rename) — a reader never sees a half-written report. */
export function writeAtomic(p: string, content: string): void {
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, p);
}

/** W27.C — the zones in which a resume's WALL-clock day differs from the RUN clock's day. Relative-date
 *  truths resolve on the run clock while the product reads the wall clock, so on a different day a date
 *  truth ("due +2d") and the product's "today" disagree by a day: the CLI refuses such a resume unless
 *  --allow-day-drift. Pure. */
export function resumeDayDrift(runClock: Date, wallNow: Date, tzs: string[]): string[] {
  const day = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return [...new Set(tzs)].filter((tz) => day(runClock, tz) !== day(wallNow, tz)).map((tz) => `${tz}: run clock ${day(runClock, tz)} vs today ${day(wallNow, tz)}`);
}
