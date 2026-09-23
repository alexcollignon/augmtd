/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE AGENTOS CONTRACT (stabilization W4.2 — AGENTOS PARITY)
 *
 * The AgentOS box is a third conversational door, and until now nothing compared it to the other
 * two. This script reads the Python source of the box (infra/agentos/tools_*.py + workers.py) with
 * a small AST-lite parser and diffs it against the ONE TS vocabulary (lib/work/tool-vocabulary.ts)
 * and the internal routes' dispatch switches. ZERO AI, zero network, zero DB.
 *
 *   npx tsx scripts/agentos-contract.ts          # prints the table + every check, exit 1 on mismatch
 *   npx tsx scripts/agentos-contract.ts --quiet  # checks only
 *
 * Checks:
 *   A  every Python @tool is a vocabulary row, sits in its declared module + module list, POSTs its
 *      own action to its declared route, and its params match the wire args (names via the declared
 *      aliases, types, required-ness); every wire arg is actually sent; every row has a Python tool.
 *   B  every internal-route case is reachable from a Python tool (or declared ROUTE_NATIVE_ONLY);
 *      every row has a case that reads each of its wire args; every coworker-door tool is on the box
 *      or declared NATIVE_ONLY (a stale declaration fails); every Python _call carries the full
 *      envelope (user_text / thread_id / turn_id); feature-gated rows sit behind the TOOL_FEATURE
 *      gate (or a declared KNOWN gap).
 *   C  every class-A (confirm) tool: the route PREPARES it, and its Python docstring never tells the
 *      model to act without the card — it names the card.
 *   D  workers.py personas == lib/workers/seed.ts rows (ids, names, descriptions, prompts verbatim +
 *      the deliverable grammar), ROLE_LABELS agree (Luca = LinkedIn Expert under `branding_expert`,
 *      `linkedin_drafter` an alias label only, never a served agent), every worker holds every list.
 *   E  every MARKER_PRODUCERS tool in lib/work/agentos-bridge.ts exists as a Python tool and its
 *      dispatch actually emits that marker.
 *
 * Shared with scripts/smoke-agentos-parity.ts via `runContract()` — one parser, one set of checks.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  agentosVocabulary, nativeWorkerDoorTools, NATIVE_ONLY, AGENTOS_ONLY, ROUTE_NATIVE_ONLY, KNOWN_GAPS,
  AGENTOS_WORKER_ROLES, LEGACY_ROLE_ALIASES, ROLE_PERSONA, PLACED_TOOLS,
  type ArgType, type VocabRow, type PyModule,
} from '../lib/work/tool-vocabulary';
import { ROLE_LABELS } from '../lib/workers/roles';
import { buildWorkers } from '../lib/workers/seed';

const ROOT = path.resolve(__dirname, '..');
const AGENTOS_DIR = path.join(ROOT, 'infra/agentos');
const MODULES: readonly PyModule[] = ['tools_tasks', 'tools_data', 'tools_integrations'];
const MODULE_LIST: Readonly<Record<PyModule, string>> = {
  tools_tasks: 'TASK_TOOLS', tools_data: 'DATA_TOOLS', tools_integrations: 'INTEGRATION_TOOLS',
};
const ROUTE_FILE: Readonly<Record<'tasks' | 'tools', string>> = {
  tasks: 'app/api/internal/agentos/tasks/route.ts',
  tools: 'app/api/internal/agentos/tools/route.ts',
};

// ─── The Python AST-lite ─────────────────────────────────────────────────────────────────────────

export interface PyParam { name: string; type: ArgType | null; rawType: string; required: boolean; defaultValue: string | null }
export interface PyTool {
  name: string; module: PyModule; params: PyParam[]; docstring: string; docFirstLine: string; body: string;
}
export interface PyModuleInfo {
  module: PyModule; tools: PyTool[]; list: string[]; route: 'tasks' | 'tools' | null; envelope: string[];
}

/** Split on commas at bracket depth 0. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0; let cur = ''; let quote: string | null = null;
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}

export function pyType(raw: string): ArgType | null {
  let t = raw.trim();
  const opt = t.match(/^Optional\[(.*)\]$/);
  if (opt) t = opt[1].trim();
  if (/^str$/.test(t)) return 'string';
  if (/^(int|float)$/.test(t)) return 'number';
  if (/^bool$/.test(t)) return 'boolean';
  if (/^(list|List(\[.*\])?)$/.test(t)) return 'array';
  if (/^(dict|Dict(\[.*\])?)$/.test(t)) return 'object';
  return null;
}

export function parsePyParams(sig: string): PyParam[] {
  const out: PyParam[] = [];
  for (const p of splitTop(sig)) {
    // [\s\S] instead of the `s` flag — the repo targets ES2017.
    const m = p.match(/^(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*([\s\S]+))?$/);
    if (!m) continue;
    const [, name, rawType = '', def] = m;
    if (name === 'run_context') continue;
    out.push({ name, rawType: rawType.trim(), type: pyType(rawType), required: def === undefined, defaultValue: def?.trim() ?? null } as PyParam);
  }
  return out;
}

/** Parse every `@tool`-decorated function of a Python module. */
export function parsePyModule(module: PyModule, src: string): PyModuleInfo {
  const lines = src.split('\n');
  const tools: PyTool[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '@tool') continue;
    const defLine = lines[i + 1] ?? '';
    const dm = defLine.match(/^def (\w+)\(/);
    if (!dm) continue;
    // Signature: from `def name(` to the first `) -> …:` (or the def line itself when single-line).
    let j = i + 1; let sig = defLine;
    while (!/\)\s*(->\s*[^:]+)?:\s*$/.test(lines[j]) && j < lines.length - 1) { j++; sig += '\n' + lines[j]; }
    const inner = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'));
    // Body: until the next non-empty column-0 line.
    let k = j + 1; const bodyLines: string[] = [];
    while (k < lines.length && (lines[k] === '' || /^\s/.test(lines[k]))) { bodyLines.push(lines[k]); k++; }
    const body = bodyLines.join('\n');
    const dmatch = body.match(/"""([\s\S]*?)"""/);
    const docstring = dmatch ? dmatch[1].trim() : '';
    tools.push({
      name: dm[1], module, params: parsePyParams(inner), docstring,
      docFirstLine: docstring.split('\n')[0]?.trim() ?? '', body,
    });
    i = k - 1;
  }
  const lm = src.match(new RegExp(`^${MODULE_LIST[module]}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'));
  const list = lm ? lm[1].split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
  const rm = src.match(/\/api\/internal\/agentos\/(tasks|tools)/);
  const pm = src.match(/payload\s*=\s*\{([\s\S]*?)\n\s*\}/);
  const envelope = pm ? [...pm[1].matchAll(/"(\w+)"\s*:/g)].map((m) => m[1]) : [];
  return { module, tools, list, route: (rm?.[1] as 'tasks' | 'tools') ?? null, envelope };
}

/** Python triple-quoted top-level string constants. */
export function parsePyStrings(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/^(\w+)\s*=\s*"""([\s\S]*?)"""/gm)) out[m[1]] = m[2];
  return out;
}

export interface PyWorkerDef { id: string; name: string; description: string; instructions: string[] }
export function parseWorkerDefs(src: string): PyWorkerDef[] {
  const block = src.match(/WORKER_DEFS\s*=\s*\[([\s\S]*?)\n\]/)?.[1] ?? '';
  const out: PyWorkerDef[] = [];
  for (const m of block.matchAll(/\{\s*"id":\s*"(\w+)",\s*"name":\s*"([^"]+)",\s*"description":\s*"([^"]*)",\s*"instructions":\s*([\w\s+]+?)\s*\}/g)) {
    out.push({ id: m[1], name: m[2], description: m[3], instructions: m[4].split('+').map((s) => s.trim()) });
  }
  return out;
}

// ─── The TS route AST-lite ───────────────────────────────────────────────────────────────────────

/** `case 'x':` → its body (until the next case label or `default:`). */
export function parseRouteCases(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^\s*case '(\w+)':/gm;
  const hits = [...src.matchAll(re)];
  const defIdx = src.search(/^\s*default:/m);
  hits.forEach((h, n) => {
    const start = (h.index ?? 0) + h[0].length;
    const next = hits[n + 1]?.index ?? (defIdx > start ? defIdx : src.length);
    out.set(h[1], src.slice(start, next));
  });
  return out;
}

const PASSTHROUGH = /\((config|args)\s*[,)]|\b(config|args) as (never|any)\b|prepare\('\w+',\s*args\)/;
function caseReads(body: string, key: string): boolean {
  if (PASSTHROUGH.test(body)) return true;
  return new RegExp(`\\.${key}\\b|\\[['"]${key}['"]\\]`).test(body);
}

// ─── The contract ────────────────────────────────────────────────────────────────────────────────

export type CheckStatus = 'PASS' | 'FAIL' | 'KNOWN';
export interface Check { section: 'A' | 'B' | 'C' | 'D' | 'E'; id: string; status: CheckStatus; detail: string }
export interface TableRow {
  name: string; route: string; module: string; py: string; wire: string; confirm: string; feature: string; status: CheckStatus;
}
export interface ContractResult { checks: Check[]; table: TableRow[]; failures: number; known: number }

/** Class-A docstring floors. */
const FORBIDDEN_DOC = [
  /act immediately/i,
  /without (asking|confirm)/i,
  /no need to (ask|confirm)/i,
  /\b(don'?t|do not|never) (ask|wait)( the user)? (for|to) (a |any |their )?confirm/i,
  /\b(runs?|starts?|deletes?|shares?) (it )?(right away|immediately|at once)\b/i,
  /\bTrigger an immediate\b/i,
];
const CARD_WORDS = /confirm card|PREPARED/;

/** Marker family → how the route (or executor) proves it emits it. */
const MARKER_EMITTER: Readonly<Record<string, { file: string; token: string }>> = {
  artifact: { file: ROUTE_FILE.tools, token: '[[artifact:' },
  email_draft: { file: ROUTE_FILE.tools, token: '[[email_draft:' },
  card: { file: ROUTE_FILE.tools, token: '[[card:' },
  workflow_draft: { file: 'lib/tools/worker-tasks.ts', token: 'encodeWorkflowDraftMarker' },
};

const ENVELOPE = ['action', 'user_id', 'agent_id', 'thread_id', 'user_text', 'turn_id'];

export function runContract(root: string = ROOT): ContractResult {
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
  const checks: Check[] = [];
  const add = (section: Check['section'], id: string, ok: boolean, detail: string, known = false) =>
    checks.push({ section, id, status: ok ? 'PASS' : known ? 'KNOWN' : 'FAIL', detail });

  const vocab = agentosVocabulary();
  const byName = new Map<string, VocabRow>(vocab.map((r) => [r.name, r]));
  const modules = MODULES.map((m) => parsePyModule(m, read(`infra/agentos/${m}.py`)));
  const pyTools = new Map<string, PyTool>();
  for (const mi of modules) for (const t of mi.tools) pyTools.set(t.name, t);
  const routeCases = {
    tasks: parseRouteCases(read(ROUTE_FILE.tasks)),
    tools: parseRouteCases(read(ROUTE_FILE.tools)),
  };
  const rowStatus = new Map<string, CheckStatus>();
  const mark = (name: string, s: CheckStatus) => {
    const prev = rowStatus.get(name);
    if (prev === 'FAIL' || (prev === 'KNOWN' && s === 'PASS')) return;
    rowStatus.set(name, s);
  };

  // ── A: Python tools ↔ vocabulary ──
  for (const mi of modules) {
    add('A', `${mi.module}:route`, mi.route !== null, `${mi.module}.py POSTs to /api/internal/agentos/${mi.route ?? '??'}`);
    const listed = new Set(mi.list);
    for (const t of mi.tools) {
      if (!listed.has(t.name)) add('A', `${t.name}:listed`, false, `@tool ${t.name} is defined in ${mi.module}.py but missing from ${MODULE_LIST[mi.module]} (dead tool)`);
    }
    for (const n of mi.list) {
      if (!mi.tools.some((t) => t.name === n)) add('A', `${n}:defined`, false, `${MODULE_LIST[mi.module]} lists ${n} but no @tool ${n} is defined in ${mi.module}.py`);
    }
  }
  for (const [name, t] of pyTools) {
    const row = byName.get(name);
    if (!row) { add('A', `${name}:vocab`, false, `Python @tool ${name} (${t.module}.py) has no vocabulary row — declare it in lib/work/tool-vocabulary.ts`); continue; }
    const mi = modules.find((m) => m.module === t.module)!;
    const errs: string[] = [];
    if (row.module !== t.module) errs.push(`lives in ${t.module}.py, vocabulary says ${row.module}.py`);
    if (mi.route !== row.route) errs.push(`module POSTs to /${mi.route}, vocabulary says /${row.route}`);
    if (!new RegExp(`_call\\(\\s*"${name}"`).test(t.body)) errs.push(`body does not _call("${name}", …)`);
    const wireOf = (p: string) => row.pyAliases[p] ?? p;
    const wire = new Map(row.args.map((a) => [a.wire, a]));
    for (const p of t.params) {
      const a = wire.get(wireOf(p.name));
      if (!a) { errs.push(`param ${p.name} → wire "${wireOf(p.name)}" is not a wire arg of ${name}`); continue; }
      const want = row.pyTypes[p.name] ?? a.type;
      if (p.type === null) errs.push(`param ${p.name}: unrecognised Python type "${p.rawType}"`);
      else if (p.type !== want) errs.push(`param ${p.name}: Python ${p.type}, wire ${want}`);
      if (p.required && !a.required) errs.push(`param ${p.name} is required in Python but optional on the wire`);
    }
    for (const a of row.args) {
      const pyName = Object.entries(row.pyAliases).find(([, w]) => w === a.wire)?.[0] ?? a.wire;
      const sent = new RegExp(`"${a.wire}"|\\b${a.wire}=`).test(t.body);
      if (!sent) errs.push(`wire arg "${a.wire}" is never sent by the Python body`);
      const p = t.params.find((x) => x.name === pyName);
      if (a.required && a.origin === 'native' && !p) errs.push(`native-required "${a.wire}" has no Python param`);
    }
    const ok = errs.length === 0;
    add('A', `${name}:signature`, ok, ok ? `${name}: ${t.params.length} params ↔ ${row.args.length} wire args` : `${name}: ${errs.join('; ')}`);
    mark(name, ok ? 'PASS' : 'FAIL');
  }
  for (const row of vocab) {
    if (!pyTools.has(row.name)) {
      add('A', `${row.name}:python`, false, `vocabulary row ${row.name} has no Python @tool in ${row.module}.py (box never offers it)`);
      mark(row.name, 'FAIL');
    }
  }

  // ── B: routes ↔ vocabulary; native door coverage; envelope; feature gate ──
  for (const route of ['tasks', 'tools'] as const) {
    for (const [action] of routeCases[route]) {
      const row = byName.get(action);
      const reachable = (row && row.route === route && pyTools.has(action)) || action in ROUTE_NATIVE_ONLY;
      add('B', `${route}:${action}:reachable`, Boolean(reachable),
        reachable ? `${route} route case ${action} reachable from a Python tool` : `${route} route case ${action} is reachable from no Python tool and is not declared ROUTE_NATIVE_ONLY`);
    }
  }
  for (const k of Object.keys(ROUTE_NATIVE_ONLY)) {
    const live = routeCases.tasks.has(k) || routeCases.tools.has(k);
    add('B', `route-native-only:${k}`, live && !pyTools.has(k), `ROUTE_NATIVE_ONLY ${k} must be a live case with no Python tool`);
  }
  for (const row of vocab) {
    const body = routeCases[row.route].get(row.action);
    if (!body) { add('B', `${row.name}:case`, false, `${row.name}: no case '${row.action}' in ${ROUTE_FILE[row.route]}`); mark(row.name, 'FAIL'); continue; }
    const unread = row.args.filter((a) => a.wire !== 'thread_id' && !caseReads(body, a.wire)).map((a) => a.wire);
    // run_task's thread_id is an AgentOS extra the route deliberately ignores (the run is prepared).
    add('B', `${row.name}:dispatch`, unread.length === 0,
      unread.length === 0 ? `${row.name}: /${row.route} case reads every wire arg` : `${row.name}: /${row.route} case never reads ${unread.join(', ')}`);
    if (unread.length) mark(row.name, 'FAIL');
  }
  const doorTools = nativeWorkerDoorTools();
  for (const id of doorTools) {
    const onBox = byName.has(id);
    const declared = id in NATIVE_ONLY;
    add('B', `door:${id}`, onBox || declared,
      onBox ? `coworker-door ${id} is on the box` : declared ? `coworker-door ${id} NATIVE-ONLY: ${NATIVE_ONLY[id]}` : `coworker-door ${id} is neither on the box nor declared NATIVE_ONLY (unplaced: ${!PLACED_TOOLS.includes(id)})`);
  }
  for (const [id, why] of Object.entries(NATIVE_ONLY)) {
    const stale = !doorTools.includes(id) || pyTools.has(id);
    add('B', `native-only:${id}`, !stale, stale ? `NATIVE_ONLY ${id} is stale (${pyTools.has(id) ? 'a Python tool now exists' : 'no longer a coworker-door tool'}) — remove it` : `declared: ${why}`);
  }
  for (const id of Object.keys(AGENTOS_ONLY)) {
    add('B', `agentos-only:${id}`, !doorTools.includes(id), `AGENTOS_ONLY ${id} must not be a native coworker-door tool`);
  }
  for (const mi of modules) {
    const payloadKey = mi.route === 'tasks' ? 'args' : 'config';
    const missing = [...ENVELOPE, payloadKey].filter((k) => !mi.envelope.includes(k));
    add('B', `${mi.module}:envelope`, missing.length === 0,
      missing.length === 0 ? `${mi.module}._call carries the full envelope` : `${mi.module}._call payload is missing ${missing.join(', ')} (the route's user-words floors fail closed, cards cannot anchor to the turn)`);
  }
  for (const route of ['tasks', 'tools'] as const) {
    const gated = vocab.filter((r) => r.route === route && r.feature !== null);
    if (!gated.length) continue;
    const hasGate = /TOOL_FEATURE\[action\]/.test(read(ROUTE_FILE[route]));
    const gapKey = `feature-gate:${route}`;
    const known = gapKey in KNOWN_GAPS;
    if (hasGate && known) add('B', gapKey, false, `KNOWN_GAPS["${gapKey}"] is stale — the /${route} route now gates by TOOL_FEATURE; remove the entry`);
    else add('B', gapKey, hasGate, hasGate
      ? `/${route} route gates ${gated.length} feature-mapped tools by TOOL_FEATURE`
      : known ? `KNOWN: ${KNOWN_GAPS[gapKey]} (tools: ${gated.map((r) => `${r.name}→${r.feature}`).join(', ')})`
        : `/${route} route has no TOOL_FEATURE gate for ${gated.map((r) => r.name).join(', ')}`, known);
    if (!hasGate) for (const r of gated) mark(r.name, known ? 'KNOWN' : 'FAIL');
  }

  // ── C: class-A tools ──
  for (const row of vocab.filter((r) => r.confirm === 'confirm')) {
    const body = routeCases[row.route].get(row.action) ?? '';
    const prepared = /\bprepare\(/.test(body);
    add('C', `${row.name}:route-prepares`, prepared, prepared ? `${row.name}: /${row.route} route PREPARES it (confirm card)` : `${row.name}: class-A but the /${row.route} case never calls prepare(`);
    const t = pyTools.get(row.name);
    if (!t) continue;
    const bad = FORBIDDEN_DOC.filter((re) => re.test(t.docstring)).map((re) => re.source);
    const names = CARD_WORDS.test(t.docstring);
    const ok = bad.length === 0 && names;
    add('C', `${row.name}:docstring`, ok, ok ? `${row.name}: docstring names the confirm card, no act-now instruction`
      : `${row.name}: docstring ${bad.length ? `instructs acting without the card (${bad.join(' | ')})` : ''}${bad.length && !names ? '; ' : ''}${names ? '' : 'never says the change is PREPARED as a confirm card'}`);
    if (!prepared || !ok) mark(row.name, 'FAIL');
  }

  // ── D: role prompts ↔ seed + labels ──
  const workersSrc = read('infra/agentos/workers.py');
  const pyStrings = parsePyStrings(workersSrc);
  const pyDefs = parseWorkerDefs(workersSrc);
  const seed = buildWorkers('contract');
  const seedByRole = new Map(seed.map((w) => [w.worker_role, w]));
  add('D', 'roles:set', pyDefs.map((d) => d.id).sort().join(',') === [...AGENTOS_WORKER_ROLES].sort().join(',')
    && seed.map((w) => w.worker_role).sort().join(',') === [...AGENTOS_WORKER_ROLES].sort().join(','),
  `workers.py serves [${pyDefs.map((d) => d.id).join(', ')}]; seed.ts seeds [${seed.map((w) => w.worker_role).join(', ')}]; vocabulary [${AGENTOS_WORKER_ROLES.join(', ')}]`);
  for (const d of pyDefs) {
    const s = seedByRole.get(d.id);
    const persona = ROLE_PERSONA[d.id as keyof typeof ROLE_PERSONA];
    const errs: string[] = [];
    if (!s) errs.push('no seed row');
    if (s && s.name !== d.name) errs.push(`name "${d.name}" vs seed "${s.name}"`);
    if (persona && persona.name !== d.name) errs.push(`name "${d.name}" vs vocabulary persona "${persona.name}"`);
    if (s && s.description !== d.description) errs.push('description differs from seed');
    const [promptConst, ...rest] = d.instructions;
    const prompt = pyStrings[promptConst];
    if (prompt === undefined) errs.push(`prompt constant ${promptConst} not found`);
    else if (s && prompt !== s.instructions) {
      const i = [...prompt].findIndex((c, n) => c !== s.instructions[n]);
      errs.push(`prompt ${promptConst} differs from seed at char ${i}: py «${prompt.slice(i, i + 40)}» vs seed «${s.instructions.slice(i, i + 40)}»`);
    }
    if (!rest.includes('DELIVERABLE_GRAMMAR')) errs.push('prompt lacks + DELIVERABLE_GRAMMAR');
    const label = ROLE_LABELS[d.id];
    if (!label) errs.push('no ROLE_LABELS entry');
    if (persona && prompt && !prompt.toLowerCase().includes(persona.labelPhrase.toLowerCase())) errs.push(`prompt never says "${persona.labelPhrase}" (label: ${label})`);
    add('D', `role:${d.id}`, errs.length === 0, errs.length ? `${d.id}: ${errs.join('; ')}` : `${d.id} = ${d.name} · ${label} · prompt verbatim with seed + deliverable grammar`);
  }
  for (const [legacy, target] of Object.entries(LEGACY_ROLE_ALIASES)) {
    const served = pyDefs.some((d) => d.id === legacy);
    const labelOk = target === null || ROLE_LABELS[legacy] === undefined || ROLE_LABELS[legacy] === ROLE_LABELS[target];
    add('D', `legacy:${legacy}`, !served && labelOk,
      `${legacy} → ${target ?? 'retired'}: ${served ? 'SERVED as an agent on the box (must not be)' : 'not served'}; label ${ROLE_LABELS[legacy] ?? '(none)'}${target ? ` vs ${ROLE_LABELS[target]}` : ''}`);
  }
  add('D', 'luca:linkedin-expert', ROLE_LABELS.branding_expert === 'LinkedIn Expert' && ROLE_LABELS.linkedin_drafter === 'LinkedIn Expert',
    `branding_expert label "${ROLE_LABELS.branding_expert}", linkedin_drafter alias label "${ROLE_LABELS.linkedin_drafter}"`);
  const toolsExpr = workersSrc.match(/tools=\[([^\]]*)\]/)?.[1] ?? '';
  const allLists = Object.values(MODULE_LIST).every((l) => toolsExpr.includes(`*${l}`));
  add('D', 'roles:tool-lists', allLists, `every worker holds [${toolsExpr.trim()}] — per-role tool sets are uniform (vocabulary roles = all)`);

  // ── E: marker producers ──
  const bridge = read('lib/work/agentos-bridge.ts');
  const mp = bridge.match(/MARKER_PRODUCERS[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const families = [...mp.matchAll(/(\w+):\s*\[([^\]]*)\]/g)].map((m) => ({ family: m[1], tools: [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]) }));
  add('E', 'markers:parsed', families.length > 0, `MARKER_PRODUCERS families: ${families.map((f) => `${f.family}←${f.tools.join('/')}`).join(', ') || '(none parsed)'}`);
  for (const f of families) {
    for (const tool of f.tools) {
      const onBox = pyTools.has(tool) && byName.has(tool);
      const em = MARKER_EMITTER[f.family];
      const emits = em ? read(em.file).includes(em.token) : false;
      add('E', `marker:${f.family}:${tool}`, onBox && emits,
        `${f.family} ← ${tool}: ${onBox ? 'Python tool present' : 'NO Python tool'}; ${em ? (emits ? `emitter ${em.token} in ${em.file}` : `emitter ${em.token} missing from ${em.file}`) : 'no emitter declared in the contract'}`);
      if (!(onBox && emits)) mark(tool, 'FAIL');
    }
  }

  const table: TableRow[] = vocab.map((r) => {
    const t = pyTools.get(r.name);
    return {
      name: r.name, route: `/${r.route}`, module: r.module.replace('tools_', ''),
      py: t ? String(t.params.length) : '—', wire: String(r.args.length),
      confirm: r.confirm === 'confirm' ? 'A·confirm' : r.confirm === 'apply' ? 'B·apply' : '—',
      feature: r.feature ?? '—', status: rowStatus.get(r.name) ?? 'PASS',
    };
  });
  for (const id of Object.keys(NATIVE_ONLY)) {
    table.push({ name: id, route: '(native only)', module: '—', py: '—', wire: '—', confirm: '—', feature: '—', status: 'KNOWN' });
  }
  return {
    checks, table,
    failures: checks.filter((c) => c.status === 'FAIL').length,
    known: checks.filter((c) => c.status === 'KNOWN').length,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────────────────────────

function pad(s: string, n: number) { return s.length >= n ? s : s + ' '.repeat(n - s.length); }

export function printTable(rows: TableRow[]) {
  const cols: Array<[keyof TableRow, string, number]> = [
    ['name', 'tool', 24], ['route', 'route', 15], ['module', 'module', 13], ['py', 'py', 4],
    ['wire', 'wire', 5], ['confirm', 'class', 10], ['feature', 'feature', 9], ['status', 'status', 6],
  ];
  console.log(cols.map(([, h, w]) => pad(h, w)).join(' '));
  console.log(cols.map(([, , w]) => '─'.repeat(w)).join(' '));
  for (const r of rows) console.log(cols.map(([k, , w]) => pad(String(r[k]), w)).join(' '));
}

if (process.argv[1] && /agentos-contract\.ts$/.test(process.argv[1])) {
  const quiet = process.argv.includes('--quiet');
  const res = runContract();
  if (!quiet) {
    console.log('\nTHE AGENTOS CONTRACT — the box vocabulary vs the TS registry\n');
    printTable(res.table);
    console.log('');
  }
  for (const c of res.checks) {
    if (quiet && c.status === 'PASS') continue;
    console.log(`${c.status === 'PASS' ? 'PASS ' : c.status === 'KNOWN' ? 'KNOWN' : 'FAIL '} [${c.section}] ${c.detail}`);
  }
  const pass = res.checks.length - res.failures - res.known;
  console.log(`\n${pass} pass · ${res.known} known gap(s) · ${res.failures} FAIL — ${res.failures ? 'CONTRACT BROKEN' : 'contract holds'}`);
  process.exit(res.failures ? 1 : 0);
}
