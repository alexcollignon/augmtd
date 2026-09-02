// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE AHK EDITORIAL FIXTURE (permanent — gate #1 of docs/ahk-briefing-v2-plan.md).
//
// The client's KW33 line-by-line review became an editorial law (W1: the observer voice in the
// selection + synthesis prompts; W2: the delivery gate became a real `verify` step with the eight
// rules; W3: the €500k tender floor in config). A law is only alive while a gate enforces it —
// this is that gate. It runs the PATCHED German Executive Briefing in TEST MODE on the owner
// account and asserts the feedback classes on the produced briefing.
//
//   D1  the verify step produced a GateVerdict (the 0-verdicts-on-18-runs baseline is the regression)
//   D2  no em dashes in the briefing's prose (the header/section lines carry one by spec)
//   D3  the restructured sections + the two Quellenverzeichnis group headers are present
//   D4  the germanism lexicon is absent (Hochtech-class)
//   D5  every tender row is ≥ €500.000 or says "Wert nicht veröffentlicht"
//   D6  a "Hinweis zur Quellenlage" count equals the Amtliche group's entry count
//   D7  tender rows carry a Link cell — PENDING while the pt-tenders Link/Sektor rendering is
//       unmerged (auto-detected from the tool step's own output)
//   J1  zero advisory sentences (no sentence tells the reader what their company should do)
//   J2  every "Einordnung:" is supportable from facts stated in the text
//   J3  no absolute market/actor characterizations beyond the stated facts
//   J4  no third-country macro item without a direct Portugal decision link
//
// AHK_FIXTURE_TARGET=mercado runs the PT sibling ("AHK Mercado Alemão", the same editorial law
// adapted: the briefing reports Germany/EU for a Portuguese audience, so the third-country test
// means outside Germany, the EU and Portugal). Its gates are the P-prefixed mirrors:
//
//   P-D1  the verify step produced a GateVerdict (and P-D1b: never blocked)
//   P-D2  no travessões (em dashes) in the prose outside the header
//   P-D3  the PT section headers survive, incl. "Fontes"
//   P-D3b the source ledger carries "Fontes oficiais e primárias" + an imprensa group
//   P-D4  no numeric source-count claim anywhere (the count is never asserted, R7)
//   P-D5  every listed concurso carries a URL and the framing count equals the listed count
//   P-J1..P-J4  the judged mirrors, PT definitions
//
// The default (env unset) is the German briefing and its behavior is unchanged.
//
// ⚠️ WHY A CLONE: the delivery block in run-workflow.ts is NOT guarded by `isTest` — a test run of
// an email-home workflow really sends the email. The fixture therefore clones the patched steps
// onto a throwaway row with a message/silent home (the smoke-guardrails G5 idiom), runs THAT, and
// deletes it in finally. The live row is only ever READ.
//
// Accounts are resolved, never named: AHK_BRIEFING_WORKFLOW_ID, or AHK_OWNER_USER_PREFIX
// (default 08fe4449) + the workflow name.
//
// Run: npx tsx --env-file=.env.local scripts/smoke-ahk-editorial.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '../lib/ai/factory';
import type { StepOutput, GateVerdict, WorkflowStep } from '../lib/workflows/types';

type Target = 'de' | 'mercado';
const TARGET: Target = process.env.AHK_FIXTURE_TARGET === 'mercado' ? 'mercado' : 'de';
const IS_PT = TARGET === 'mercado';

const WORKFLOW_NAME = IS_PT ? 'AHK Mercado Alemão' : 'AHK Executive Briefing';
const OUTPUT_LANGUAGE = IS_PT ? 'pt' : 'de';
const GERMANISMS = ['Hochtech', 'Höchtech', 'Hochtechnologie-Startup', 'Datenzentrum'];

type Row = { id: string; user_id: string; name: string; steps: WorkflowStep[] };

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const t0 = Date.now();

  const results: Array<[string, 'PASS' | 'FAIL' | 'PENDING', string]> = [];
  const ok = (name: string, cond: boolean, detail = '') =>
    results.push([name, cond ? 'PASS' : 'FAIL', cond ? '' : detail]);
  const pending = (name: string, why: string) => results.push([name, 'PENDING', why]);

  // ── Resolve the live row (read-only) ──────────────────────────────────────────────────────
  let live: Row | null = null;
  const explicitId = IS_PT ? process.env.AHK_MERCADO_WORKFLOW_ID : process.env.AHK_BRIEFING_WORKFLOW_ID;
  if (explicitId) {
    const { data } = await admin.from('workflows').select('id,user_id,name,steps')
      .eq('id', explicitId).maybeSingle();
    live = data as Row | null;
  } else {
    const prefix = process.env.AHK_OWNER_USER_PREFIX ?? '08fe4449';
    const { data } = await admin.from('workflows').select('id,user_id,name,steps').eq('name', WORKFLOW_NAME);
    live = ((data ?? []) as Row[]).find(w => String(w.user_id).startsWith(prefix)) ?? null;
  }
  if (!live) {
    console.log(`✗ the patched "${WORKFLOW_NAME}" row was not found (set ${IS_PT ? 'AHK_MERCADO_WORKFLOW_ID' : 'AHK_BRIEFING_WORKFLOW_ID'})`);
    process.exit(1);
  }
  console.log(`fixture target: ${TARGET} · wf ${live.id} · user ${String(live.user_id).slice(0, 8)}… · ${live.steps.length} steps`);

  let cloneId: string | null = null;
  try {
    const { data: clone, error } = await admin.from('workflows').insert({
      user_id: live.user_id, name: `${WORKFLOW_NAME} — editorial fixture`,
      description: 'smoke-ahk-editorial fixture (deleted on exit)',
      icon: 'shield', color: 'indigo', status: 'active',
      trigger: { type: 'manual' }, steps: live.steps,
      // NEVER the live email home — a test run would really send it.
      output_config: { destination: 'message', report_mode: 'silent', output_language: OUTPUT_LANGUAGE },
    }).select('id').single();
    if (error || !clone) throw new Error(`clone failed: ${error?.message}`);
    cloneId = clone.id as string;

    const { runWorkflow } = await import('../lib/workflows/run-workflow');
    console.log('running the briefing in test mode (real AI, several minutes)…');
    const run = await runWorkflow({ workflowId: cloneId, triggerSource: 'manual', isTest: true });
    const { data: runRow } = await admin.from('workflow_runs')
      .select('status, step_outputs, error').eq('id', run.runId).maybeSingle();
    const outs = ((runRow?.step_outputs ?? []) as StepOutput[]);
    ok('the run succeeded', run.status === 'succeeded', `${run.status} ${run.error ?? ''}`);

    const gateOut = [...outs].reverse().find(o => o.step_type === 'verify');
    const verdict = gateOut?.verdict as GateVerdict | undefined;
    const text = typeof gateOut?.output === 'string'
      ? gateOut.output
      : String(outs[outs.length - 1]?.output ?? '');

    // The produced briefing is the evidence for every assert below; AHK_FIXTURE_DUMP=<path>
    // keeps it for inspection (a failing editorial gate is read, not guessed at).
    if (process.env.AHK_FIXTURE_DUMP) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(process.env.AHK_FIXTURE_DUMP, text, 'utf8');
      console.log(`  briefing written to ${process.env.AHK_FIXTURE_DUMP}`);
    }

    // ── D1 — the verdict lands (the one gate both targets share) ──────────────────────────
    const P = IS_PT ? 'P-' : '';
    ok(`${P}D1 the verify step produced a GateVerdict`, !!verdict && typeof verdict.status === 'string',
      JSON.stringify(gateOut?.verdict ?? null).slice(0, 160));
    if (verdict) {
      console.log(`  gate verdict: ${verdict.status} · ${verdict.findings?.length ?? 0} finding(s) · reported=${verdict.reported}`);
      for (const f of verdict.findings ?? []) console.log(`    · [${f.source}/${f.action}] ${String(f.note ?? '').slice(0, 120)}`);
    }
    ok(`${P}D1b delivery stayed automatic (the verdict is never blocked)`, verdict?.status !== 'blocked', String(verdict?.status));

    if (IS_PT) mercadoDeterministic(text, ok, pending);
    else {

    // ── D2 — no em dashes in prose (headings carry one by the prompt's own format spec) ────
    const proseLines = text.split('\n').filter(l => !/^\s*#/.test(l) && !/^AHK PORTUGAL EXECUTIVE BRIEFING/i.test(l.trim()));
    const emLines = proseLines.filter(l => l.includes('—'));
    ok('D2 no em dashes in the briefing prose', emLines.length === 0, emLines.slice(0, 3).map(l => l.trim().slice(0, 90)).join(' | '));

    // ── D3 — the restructured sections + the source groups ────────────────────────────────
    const needSections = ['Investitionsradar', 'Corporate & Investment Activity', 'Deal Flow', 'Quellenverzeichnis'];
    const missingSections = needSections.filter(s => !text.includes(s));
    ok('D3 the section headers survive the restructure', missingSections.length === 0, `missing: ${missingSections.join(', ')}`);
    const needGroups = ['Amtliche und Primärquellen', 'Medienquellen'];
    const missingGroups = needGroups.filter(g => !text.includes(g));
    ok('D3b the Quellenverzeichnis carries both group headers', missingGroups.length === 0, `missing: ${missingGroups.join(', ')}`);

    // ── D4 — the germanism lexicon ────────────────────────────────────────────────────────
    const hits = GERMANISMS.filter(w => new RegExp(w, 'i').test(text));
    ok('D4 no germanized anglicisms (Hochtech-class)', hits.length === 0, hits.join(', '));

    // ── D5 — the tender floor, parsed off the table ────────────────────────────────────────
    const rows = tenderRows(text);
    const offenders: string[] = [];
    for (const r of rows) {
      const cell = r.wert;
      if (/Wert nicht veröffentlicht/i.test(cell)) continue;
      const v = parseEuro(cell);
      if (v === null) offenders.push(`unparseable value "${cell}"`);
      else if (v < 500000) offenders.push(`${cell} (${v})`);
    }
    ok(`D5 every tender row ≥ €500.000 or "Wert nicht veröffentlicht" (${rows.length} row(s))`,
      offenders.length === 0, offenders.slice(0, 4).join(' | '));

    // ── D6 — the source-count note ────────────────────────────────────────────────────────
    const noteM = text.match(/Hinweis zur Quellenlage[^\n]*?(\d+)/i);
    if (!noteM) pending('D6 the Quellenlage count matches the amtliche group', 'no "Hinweis zur Quellenlage" in this edition');
    else {
      const amtliche = countGroupEntries(text, 'Amtliche und Primärquellen');
      ok('D6 the Quellenlage count equals the amtliche group size',
        Number(noteM[1]) === amtliche, `stated ${noteM[1]}, amtliche entries ${amtliche}`);
    }

    // ── D7 — the Link cell (PENDING until pt-tenders renders links) ────────────────────────
    const tenderTool = outs.find(o => o.step_type === 'tool' && /tender/i.test(String(o.label ?? '')));
    const toolText = typeof tenderTool?.output === 'string' ? tenderTool.output : JSON.stringify(tenderTool?.output ?? '');
    const toolRendersLinks = /(^|\n)\s*Link\s*:/i.test(toolText) || /https?:\/\/\S*(dre\.pt|diariodarepublica)/i.test(toolText);
    if (!toolRendersLinks) {
      pending('D7 tender rows carry a Link cell', 'the tender tool output carries no Link lines yet (pt-tenders link rendering unmerged)');
    } else {
      const linkless = rows.filter(r => !/https?:\/\//.test(r.link));
      ok('D7 every tender row carries a Link', rows.length === 0 || linkless.length === 0,
        `${linkless.length} row(s) without a link`);
    }

    }

    // ── The judged pass — one cheap classification-tier call, strict JSON ──────────────────
    const judged = await judge(admin, live.user_id, text);
    const jgate = (key: keyof typeof judged.flags, name: string) => {
      const flagged = judged.flags[key] ?? [];
      ok(name, flagged.length === 0, flagged.slice(0, 3).map(s => `"${s}"`).join(' | '));
      if (flagged.length) { console.log(`  flagged for ${name}:`); for (const s of flagged) console.log(`    · ${s}`); }
    };
    if (!judged.parsed) ok('the judged pass returned JSON', false, judged.raw.slice(0, 200));
    else {
      // J1 is TWO-KEY (the gate-v5 idiom: a verdict fires only when judge AND code agree):
      // the judge proposes advisory sentences, but only a flag carrying a prescriptive marker
      // fails the gate — five fixture rounds proved every model tier flags borderline
      // observation sentences ("verschiebt sich die Risikolandschaft") no matter how sharp the
      // definition; markerless flags print as non-failing editorial notes so they stay visible.
      const PRESCRIPTIVE = IS_PT
        ? /\b(devem|deveriam|têm de|tem de|recomenda-se|é aconselhável|convém)\b/i
        : /\b(sollten?|müssen|empfiehlt|empfohlen|ratsam)\b/i;
      const advisoryAll = judged.flags.advisory ?? [];
      const advisoryHard = advisoryAll.filter(s => PRESCRIPTIVE.test(s));
      const advisoryNotes = advisoryAll.filter(s => !PRESCRIPTIVE.test(s));
      ok(`${P}J1 zero advisory sentences (judge + prescriptive marker)`, advisoryHard.length === 0,
        advisoryHard.slice(0, 3).map(s => `"${s}"`).join(' | '));
      if (advisoryNotes.length) {
        console.log('  editorial notes (judge-flagged, no prescriptive marker — non-failing):');
        for (const s of advisoryNotes) console.log(`    · ${s}`);
      }
      jgate('unsupported_einordnung', IS_PT
        ? 'P-J2 every Enquadramento is supportable from stated facts'
        : 'J2 every Einordnung is supportable from stated facts');
      jgate('absolutes', `${P}J3 no absolute characterizations beyond stated facts`);
      jgate('third_country', IS_PT
        ? 'P-J4 no third-country macro item without a Portuguese-company consequence'
        : 'J4 no third-country macro item without a Portugal decision link');
    }

    console.log(`\nbriefing length: ${text.length} chars · run ${Math.round((Date.now() - t0) / 1000)}s`);
  } finally {
    if (cloneId) {
      const { data: threads } = await admin.from('work_threads').select('id').eq('workflow_id', cloneId);
      if (threads?.length) {
        const ids = threads.map(t => t.id);
        await admin.from('work_messages').delete().in('thread_id', ids);
        await admin.from('workflow_runs').update({ thread_id: null }).in('thread_id', ids);
        await admin.from('work_threads').delete().in('id', ids);
      }
      await admin.from('workflow_runs').delete().eq('workflow_id', cloneId);
      await admin.from('workflows').delete().eq('id', cloneId);
    }
  }

  console.log('\n════ AHK EDITORIAL GATES ════');
  let pass = 0, fail = 0, pend = 0;
  for (const [name, state, detail] of results) {
    if (state === 'PASS') { pass++; console.log(`  ✓ ${name}`); }
    else if (state === 'PENDING') { pend++; console.log(`  ⏸ ${name} — PENDING: ${detail}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
  }
  const total = pass + fail;
  console.log(`\n${pass}/${total} pass${pend ? ` · ${pend} pending` : ''} · ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(fail === 0 ? 0 : 1);
}

// ── The Mercado (PT) deterministic gates ─────────────────────────────────────────────────────
type Ok = (name: string, cond: boolean, detail?: string) => void;
type Pending = (name: string, why: string) => void;

/** The Portuguese numerals a framing sentence may spell out instead of writing a digit. */
const PT_NUMERALS: Record<string, number> = {
  zero: 0, nenhum: 0, nenhuma: 0, um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3,
  quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

function mercadoDeterministic(text: string, ok: Ok, pending: Pending) {
  // ── P-D2 — no travessões in prose. The header line ("AHK PORTUGAL — MERCADO ALEMÃO — …")
  // carries them by the prompt's own format spec, as do markdown section headers.
  const proseLines = text.split('\n').filter(l =>
    !/^\s*#/.test(l) && !/^\**\s*AHK PORTUGAL\b/i.test(l.trim()));
  const emLines = proseLines.filter(l => l.includes('—'));
  ok('P-D2 no travessões in the briefing prose', emLines.length === 0,
    emLines.slice(0, 3).map(l => l.trim().slice(0, 90)).join(' | '));

  // ── P-D3 — the PT section skeleton survives the verification pass ──────────────────────────
  const needSections = ['Em Resumo', 'Sinais Executivos', 'Radar de Investimento',
    'Oportunidades Comerciais', 'Próxima Semana', 'Fontes'];
  const missingSections = needSections.filter(s => !text.includes(s));
  ok('P-D3 the PT section headers survive (incl. Fontes)', missingSections.length === 0,
    `missing: ${missingSections.join(', ')}`);

  const hasOfficial = text.includes('Fontes oficiais e primárias');
  const hasImprensa = /Fontes de imprensa/i.test(text);
  ok('P-D3b the source ledger carries the official group and an imprensa group',
    hasOfficial && hasImprensa,
    `oficiais=${hasOfficial} imprensa=${hasImprensa}`);

  // ── P-D4 — the source count is never asserted (R7: "remove any numeric source-count note") ─
  // Judged-quality lexical defects (the "alta-tecnologia" class) are deliberately NOT asserted
  // here: a forced translation is a usage judgment, not a string match. It rides the judge.
  const countClaims = text.split('\n')
    .filter(l => !/^\s*#/.test(l))
    .filter(l => /\b\d+\s+fontes\b/i.test(l) || /fontes\s+(?:oficiais\s+e\s+)?prim[áa]rias?\D{0,20}\d/i.test(l));
  ok('P-D4 no numeric source-count claim', countClaims.length === 0,
    countClaims.slice(0, 3).map(l => l.trim().slice(0, 90)).join(' | '));

  // ── P-D5 — the concursos list: a link per entry, and an honest count ───────────────────────
  const block = sectionBlock(text, /Oportunidades Comerciais|Concursos/i);
  if (block === null) {
    ok('P-D5 the concursos section is parseable', false, 'section 6 not found in the briefing');
    return;
  }
  // Fairs and events share the section by spec; only the concursos list is under the count rule.
  const cut = block.split('\n').findIndex(l => /^\s*(?:[#*_-]{0,3}\s*)?(?:\*\*)?\s*Feiras/i.test(l));
  const concursos = cut >= 0 ? block.split('\n').slice(0, cut).join('\n') : block;
  let entries = listEntries(concursos);
  const linkless = entries.filter(e => !/https?:\/\//.test(e));
  ok(`P-D5 every listed concurso carries a URL (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})`,
    linkless.length === 0, linkless.slice(0, 3).map(e => e.trim().slice(0, 90)).join(' | '));

  // THE HONEST-NONE PATTERN (found in fixture r3, a CORRECT briefing failing the parser): the
  // framing may say "N identificados … nenhum qualifica" and list only a pointer to the portal
  // itself. A stated count of SCANNED tenders beside an explicit none-qualifies negation is not a
  // count claim about the list, and a bare portal pointer is not a concurso entry.
  const noneQualify = /\bnenhum\b/i.test(concursos);
  if (noneQualify) entries = entries.filter(e => !/service\.bund\.de|\bportal\b/i.test(e));
  const stated = noneQualify ? null : statedCount(concursos);
  if (entries.length === 0) {
    ok('P-D5b the framing count matches the list (nothing listed, honest line)',
      stated === null || stated === 0, `the framing sentence still claims ${stated}`);
  } else if (stated === null) {
    pending('P-D5b the framing count matches the list',
      `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} listed, no count sentence parsed`);
  } else {
    ok('P-D5b the framing count equals the listed count', stated === entries.length,
      `framing says ${stated}, ${entries.length} listed`);
  }
}

/** The body of the markdown section whose header line matches, up to the next header. Falls back
 *  to a plain text search when the briefing renders headers in bold rather than with hashes. */
function sectionBlock(text: string, headerRe: RegExp): string | null {
  const lines = text.split('\n');
  const isHeader = (l: string) => /^#{1,4}\s/.test(l) || /^\*\*\s*\d+\.\s.*\*\*\s*$/.test(l.trim());
  let start = lines.findIndex(l => isHeader(l) && headerRe.test(l));
  if (start < 0) start = lines.findIndex(l => headerRe.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (isHeader(lines[i])) { end = i; break; }
  return lines.slice(start + 1, end).join('\n');
}

/** One entry per item of the list, whichever shape the briefing chose: table rows, bold or
 *  sub-heading titles, or bullets. ONE marker class per block, by precedence — a bold-titled entry
 *  whose body is bulleted must count once, not once per bullet. Continuation lines (the fields and
 *  the link under a title) fold into the entry they belong to, so a link on its own line counts. */
function listEntries(block: string): string[] {
  const lines = block.split('\n');
  const isTableRow = (l: string) => /^\s*\|/.test(l);
  const isTitle = (l: string) => /^#{3,5}\s+\S/.test(l) || /^\*\*[^*].*\*\*[:：]?\s*$/.test(l.trim());
  const isBullet = (l: string) => /^(?:[-*+]|\d+[.)])\s+\S/.test(l);
  const marker = lines.some(isTableRow) ? isTableRow : lines.some(isTitle) ? isTitle : isBullet;

  const out: string[] = [];
  let headerSeen = false;
  for (const line of lines) {
    if (marker === isTableRow && isTableRow(line)) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (!cells.length || cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
      if (!headerSeen) { headerSeen = true; continue; }                     // the table's head row
      out.push(line.trim());
      continue;
    }
    if (marker !== isTableRow && marker(line)) { out.push(line.trim()); continue; }
    if (out.length && line.trim()) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

/** The count the framing sentence claims ("três concursos", "5 concursos abertos"), or null. */
function statedCount(block: string): number | null {
  const m = block.match(/\b([\wáâãéêíóôõúç]+)\s+(?:concursos?|procedimentos?|an[úu]ncios?)\b/i);
  if (!m) return null;
  const w = m[1].toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  return w in PT_NUMERALS ? PT_NUMERALS[w] : null;
}

// ── Table parsing ────────────────────────────────────────────────────────────────────────────
/** The Deal Flow table's rows: | Auftraggeber | Gegenstand | Sektor | Wert | Frist | Verfahren | Link | */
function tenderRows(text: string): Array<{ wert: string; link: string; raw: string }> {
  const out: Array<{ wert: string; link: string; raw: string }> = [];
  const lines = text.split('\n');
  let headerCols: string[] | null = null;
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) { headerCols = null; continue; }
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (!cells.length) continue;
    if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;            // separator row
    if (!headerCols) { headerCols = cells.map(c => c.toLowerCase()); continue; }
    const iWert = headerCols.findIndex(c => /wert/.test(c));
    if (iWert < 0) continue;                                           // not the tender table
    const iLink = headerCols.findIndex(c => /link|quelle/.test(c));
    out.push({ wert: cells[iWert] ?? '', link: iLink >= 0 ? (cells[iLink] ?? '') : '', raw: line.trim() });
  }
  return out;
}

/** European money rendering → a number. "EUR 1.250.000" · "1,2 Mio." · "980.000 EUR". */
function parseEuro(cell: string): number | null {
  const s = cell.replace(/\s+/g, ' ').trim();
  const mio = /mio|millionen|mrd|milliarden/i.test(s);
  const m = s.match(/\d[\d.,]*/);
  if (!m) return null;
  let n = m[0];
  if (mio) n = n.replace(/\./g, '').replace(',', '.');
  else n = n.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (/mrd|milliarden/i.test(s)) return v * 1_000_000_000;
  if (/mio|millionen/i.test(s)) return v * 1_000_000;
  return v;
}

/** Numbered entries under one Quellenverzeichnis group header, up to the next group/section. */
function countGroupEntries(text: string, group: string): number {
  const i = text.indexOf(group);
  if (i < 0) return 0;
  const rest = text.slice(i + group.length);
  const end = rest.search(/\n\s*(?:\*\*)?(?:Medienquellen|Deutsche Quellen|Internationale Quellen)|\n#{1,3}\s/);
  const block = end >= 0 ? rest.slice(0, end) : rest;
  return (block.match(/^\s*(?:\[\d+\]|\d+[.)])\s+\S/gm) ?? []).length;
}

// ── The judged pass ──────────────────────────────────────────────────────────────────────────
type Flags = { advisory: string[]; unsupported_einordnung: string[]; absolutes: string[]; third_country: string[] };

async function judge(admin: SupabaseClient, userId: string, text: string):
  Promise<{ parsed: boolean; flags: Flags; raw: string }> {
  const empty: Flags = { advisory: [], unsupported_einordnung: [], absolutes: [], third_country: [] };
  try {
    // The judged gates run on the conversation tier deliberately: three fixture rounds proved
    // the cheap tier mis-fires on the observation-vs-advisory and protagonist-nationality
    // distinctions no matter how explicit the definitions get. A permanent QA gate earns the
    // stronger judge (~+€0.05/run).
    const { client, model } = await getAIClient(userId, 'conversation', admin as never);
    const prompt = IS_PT ? mercadoJudgePrompt(text) : germanJudgePrompt(text);
    const res = await aiCreate(client, {
      model, max_tokens: 1200, temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = res.choices?.[0]?.message?.content ?? '';
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const p = JSON.parse(json) as Partial<Flags>;
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
    return { parsed: true, raw, flags: {
      advisory: arr(p.advisory), unsupported_einordnung: arr(p.unsupported_einordnung),
      absolutes: arr(p.absolutes), third_country: arr(p.third_country),
    } };
  } catch (e) {
    return { parsed: false, flags: empty, raw: String(e) };
  }
}

function germanJudgePrompt(text: string): string {
  return (
        `You are auditing a German-language business briefing published by a bilateral chamber of commerce. ` +
        `The chamber is an OBSERVER and FACILITATOR, never an adviser. Quote offending sentences VERBATIM from the text; ` +
        `quote nothing you cannot find in it. Be strict but literal: only flag what the text actually says.\n\n` +
        `Return ONLY this JSON:\n` +
        `{"advisory":["<sentences ADDRESSED TO THE READER that tell them or their company what to DO — prescriptions ('sollten ... kalkulieren') and homework constructions ('müssen ... neu bewerten/einkalkulieren/sich einstellen') directed at reader companies. NOT advisory — never flag these: the publication's approved monitoring register ('Für Marktteilnehmer sind ... die zentralen Beobachtungspunkte', '... ist/sind zu erwarten'), observation verbs describing a situation ('sehen steigende Kosten', 'stehen vor', 'für X steigen die Kosten'), and factual REPORTING that some actor in the story (a regulator, a ministry) advised or warned someone — reported advice is a fact about the story, not advice to the reader. Also NOT advisory: statements of LEGAL obligation or factual necessity arising from a reported event ('müssen die neuen Vorgaben in ihre Compliance-Prozesse integrieren' when a law mandates it; 'benötigen alternative Bezugsquellen' when a supply was suspended) — flag only business-judgment prescriptions, where the publication recommends a discretionary action>"],` +
        `"unsupported_einordnung":["<sentences after an 'Einordnung:' label that are NOT supportable from facts stated elsewhere in the text, or that contradict or overstate a figure the text itself states>"],` +
        `"absolutes":["<absolute characterizations of a market or actor that exceed the sourced facts, e.g. claiming an actor 'takes back control' or a business 'no longer works'>"],` +
        `"third_country":["<items whose SUBJECT is a third country's own economy or policy (not Portugal, Germany, or an EU act) with no concrete stated consequence for companies in Portugal. Ask first: WHO is the item's protagonist? If the protagonist is a Portuguese or German company — even one winning contracts in Chile or expanding to Brazil ('Das portugiesische Unternehmen X hat einen Vertrag in Chile gewonnen') — it is a Portugal story: NEVER flag it. Flag only items whose protagonist is the third country itself (its GDP, its rates, its policy) with no stated Portugal consequence; an EU-level act only counts if the item states no Portugal effect at all>"]}\n` +
        `Empty arrays when there is nothing to flag.\n\nTHE BRIEFING:\n${text.slice(0, 45000)}`
  );
}

/** The PT mirror. Same law, inverted geography: this briefing reports GERMANY and the EU for a
 *  PORTUGUESE audience, so the third-country test means outside Germany, the EU and Portugal. */
function mercadoJudgePrompt(text: string): string {
  return (
    `You are auditing a Portuguese-language business briefing about Germany and the EU, published by a ` +
    `bilateral chamber of commerce for Portuguese executives. The chamber is an OBSERVER and FACILITATOR, ` +
    `never an adviser. Quote offending sentences VERBATIM from the text; quote nothing you cannot find in it. ` +
    `Be strict but literal: only flag what the text actually says.\n\n` +
    `Return ONLY this JSON:\n` +
    `{"advisory":["<sentences ADDRESSED TO THE READER that tell them or their company what to DO — prescriptions ('devem recalcular as margens', 'deveriam iniciar conversações') and homework constructions ('têm de reavaliar / incorporar / preparar-se para') directed at reader companies. NOT advisory — never flag these: the publication's approved monitoring register ('Para os participantes no mercado, os pontos de observação centrais são ...', 'é de esperar que ...'), observation verbs describing a situation ('enfrentam custos mais altos', 'para os exportadores, os custos sobem'), and factual REPORTING that some actor in the story (a regulator, a ministry, a company) advised or warned someone — reported advice is a fact about the story, not advice to the reader. Also NOT advisory: statements of LEGAL obligation or factual necessity arising from a reported event ('as novas regras aplicam-se a partir de 01.01.2027 também a empresas portuguesas'; 'necessitam de fontes de abastecimento alternativas' when a supply was suspended) — flag only business-judgment prescriptions, where the publication recommends a discretionary action>"],` +
    `"unsupported_einordnung":["<sentences after an 'Enquadramento:' label that are NOT supportable from facts stated elsewhere in the text, or that contradict or overstate a figure the text itself states>"],` +
    `"absolutes":["<absolute characterizations of a market or actor that exceed the sourced facts, e.g. claiming an actor 'perde o controlo', 'torna-se um apêndice', or that a business 'deixou de ser viável'>"],` +
    `"third_country":["<items whose SUBJECT is a third country's own economy or policy — a country outside Germany, the EU and Portugal (its GDP, its interest rates, its domestic policy, its energy milestones). The client's standard is UNCONDITIONAL for such items: flagged regardless of any relevance paragraph they carry, however well-written. But the test is about the item's SUBJECT, never its causes or comparisons: an item whose subject is Germany, the EU, or a global market effect hitting them stays even when a third country is the CAUSE ('conflito EUA-Irão eleva o preço do petróleo' — an energy-cost story for German industry) or a COMPARISON ('rendimentos alemães ... com movimento semelhante no Japão' — a German-yields story). Ask first: WHO is the item's protagonist? If the protagonist is a Portuguese or German company or institution — even one winning contracts in Chile or expanding to Brazil ('A empresa portuguesa X ganhou um contrato no Chile', 'A alemã Y abre fábrica no México') — it is a Portugal-Germany story: NEVER flag it. A German or EU-level development is never a third-country item. Flag every item whose protagonist is the third country itself>"]}\n` +
    `Empty arrays when there is nothing to flag.\n\nTHE BRIEFING:\n${text.slice(0, 45000)}`
  );
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
