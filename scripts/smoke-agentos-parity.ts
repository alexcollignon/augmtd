/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — AGENTOS PARITY (stabilization W4.2)
 *
 * The standing gate for the third conversational door. ZERO AI, zero network, zero DB.
 *
 *   npx tsx scripts/smoke-agentos-parity.ts
 *
 *   AP1 — THE LIVE CONTRACT: every check of scripts/agentos-contract.ts on the real tree
 *         (the SAME parser + checks — imported, never re-implemented). KNOWN gaps print, never fail.
 *   AP2 — THE PARSER READS WHAT IT CLAIMS: the AST-lite on fixtures (multi-line signatures,
 *         Optional/defaults, docstrings, module lists, the payload envelope, route cases).
 *   AP3 — THE DECOYS: a copy of the real tree with ONE planted drift each, and the contract must
 *         FAIL on exactly that drift — a renamed Python arg, a class-A docstring promising an
 *         immediate run, a dropped envelope field, a route case with no Python tool, a prompt that
 *         drifted from the seed, a legacy role served as an agent, a marker producer with no tool,
 *         a stale NATIVE_ONLY entry (simulated by a Python tool appearing for it).
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runContract, parsePyModule, parsePyParams, parseRouteCases, parseWorkerDefs, pyType,
} from './agentos-contract';

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); } else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const ROOT = path.resolve(__dirname, '..');

// ── AP1 ──
console.log('\nAP1 — THE LIVE CONTRACT');
const live = runContract(ROOT);
for (const c of live.checks) {
  if (c.status === 'KNOWN') { console.log(`KNOWN [${c.section}] ${c.detail}`); continue; }
  ok(`AP1.${c.section} ${c.id}`, c.status === 'PASS', c.detail);
}
ok('AP1 the vocabulary is non-trivial (≥30 box tools)', live.table.filter((r) => !r.route.includes('native')).length >= 30);

// ── AP2 ──
console.log('\nAP2 — THE PARSER');
ok('AP2.1 Optional[str] → string', pyType('Optional[str]') === 'string');
ok('AP2.2 int → number, list → array, dict → object, bool → boolean',
  pyType('int') === 'number' && pyType('list') === 'array' && pyType('dict') === 'object' && pyType('bool') === 'boolean');
const params = parsePyParams('run_context: RunContext, a: str, b: Optional[list] = None, c: dict = {"x": 1, "y": 2}, d = "q"');
ok('AP2.3 params: run_context dropped, required/defaults/nested-comma defaults read',
  params.map((p) => `${p.name}:${p.type}:${p.required}`).join(',') === 'a:string:true,b:array:false,c:object:false,d:null:false',
  JSON.stringify(params));
const fx = parsePyModule('tools_data', [
  'payload = {',
  '    "action": action,',
  '    "user_id": user_id,',
  '}',
  'x = "/api/internal/agentos/tools"',
  '@tool',
  'def alpha(',
  '    run_context: RunContext,',
  '    q: str,',
  '    n: Optional[int] = None,',
  ') -> str:',
  '    """First line.',
  '',
  '    Args:',
  '        q: query.',
  '    """',
  '    return _call("alpha", run_context, {"q": q, "n": n})',
  '',
  '',
  '@tool',
  'def beta(run_context: RunContext) -> str:',
  '    """Beta."""',
  '    return _call("beta", run_context, {})',
  '',
  'DATA_TOOLS = [alpha, beta]',
].join('\n'));
ok('AP2.4 module: two tools, multi-line + single-line signatures',
  fx.tools.map((t) => `${t.name}(${t.params.map((p) => p.name).join(',')})`).join(' ') === 'alpha(q,n) beta()', JSON.stringify(fx.tools.map((t) => t.name)));
ok('AP2.5 docstring first line + module list + route + envelope',
  fx.tools[0].docFirstLine === 'First line.' && fx.list.join(',') === 'alpha,beta' && fx.route === 'tools'
  && fx.envelope.join(',') === 'action,user_id');
const cases = parseRouteCases("switch (a) {\n  case 'one':\n    x(args.k);\n    break;\n  case 'two': {\n    y();\n  }\n  default:\n    z();\n}");
ok('AP2.6 route cases split at labels and default', [...cases.keys()].join(',') === 'one,two'
  && cases.get('one')!.includes('args.k') && !cases.get('two')!.includes('z()'));
const defs = parseWorkerDefs('WORKER_DEFS = [\n    {"id": "a_b", "name": "Ann",\n     "description": "Does x.",\n     "instructions": A_PROMPT + GRAMMAR},\n]');
ok('AP2.7 worker defs', defs.length === 1 && defs[0].id === 'a_b' && defs[0].instructions.join('+') === 'A_PROMPT+GRAMMAR', JSON.stringify(defs));

// ── AP3 ──
console.log('\nAP3 — THE DECOYS (one planted drift each; the contract must catch it)');
const FILES = [
  'infra/agentos/tools_tasks.py', 'infra/agentos/tools_data.py', 'infra/agentos/tools_integrations.py',
  'infra/agentos/workers.py', 'app/api/internal/agentos/tasks/route.ts', 'app/api/internal/agentos/tools/route.ts',
  'lib/work/agentos-bridge.ts', 'lib/tools/worker-tasks.ts',
];
function decoy(label: string, file: string, from: string | RegExp, to: string, expect: RegExp) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-contract-'));
  try {
    for (const f of FILES) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
    }
    const p = path.join(tmp, file);
    const src = fs.readFileSync(p, 'utf8');
    const planted = src.replace(from, to);
    if (planted === src) { ok(`AP3 ${label}`, false, 'the decoy did not apply — fixture out of date'); return; }
    fs.writeFileSync(p, planted);
    const res = runContract(tmp);
    const hit = res.checks.filter((c) => c.status === 'FAIL' && expect.test(c.detail));
    ok(`AP3 ${label}`, hit.length > 0, `failures: ${res.checks.filter((c) => c.status === 'FAIL').map((c) => c.detail).join(' || ') || '(none)'}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
decoy('a renamed Python arg (slack channel → chan)', 'infra/agentos/tools_integrations.py',
  'def slack_list_members(run_context: RunContext, channel: str)', 'def slack_list_members(run_context: RunContext, chan: str)',
  /slack_list_members: .*param chan/);
decoy('a class-A docstring promising an immediate run', 'infra/agentos/tools_tasks.py',
  'Prepare an immediate manual run of an existing task.', 'Trigger an immediate manual run of an existing task.',
  /run_task: docstring instructs acting without the card/);
decoy('a dropped envelope field (user_text)', 'infra/agentos/tools_integrations.py',
  '"user_text": deps.get("user_text") or "",\n', '',
  /tools_integrations\._call payload is missing user_text/);
decoy('a route case no Python tool reaches', 'app/api/internal/agentos/tools/route.ts',
  "      case 'web_search':", "      case 'orphan_action':\n        result = '';\n        break;\n\n      case 'web_search':",
  /tools route case orphan_action is reachable from no Python tool/);
decoy('a role prompt drifted from the seed', 'infra/agentos/workers.py',
  'You find things and make sense of them.', 'You find things.',
  /research_analyst: prompt RESEARCH_PROMPT differs from seed/);
decoy('a legacy role served as an agent', 'infra/agentos/workers.py',
  '{"id": "branding_expert", "name": "Luca",', '{"id": "linkedin_drafter", "name": "Luca",',
  /linkedin_drafter → branding_expert: SERVED/);
decoy('a marker producer with no Python tool', 'lib/work/agentos-bridge.ts',
  "card: ['present_linkedin_post'],", "card: ['present_linkedin_post', 'present_ghost_card'],",
  /card ← present_ghost_card: NO Python tool/);
decoy('a Python tool appears for a NATIVE_ONLY entry (stale declaration + unknown tool)', 'infra/agentos/tools_data.py',
  '@tool\ndef read_team_work(', '@tool\ndef get_email_body(run_context: RunContext, email_id: str) -> str:\n    """Read one email."""\n    return _call("get_email_body", run_context, {"email_id": email_id})\n\n\n@tool\ndef read_team_work(',
  /NATIVE_ONLY get_email_body is stale|Python @tool get_email_body .* has no vocabulary row|missing from DATA_TOOLS/);
decoy('a wire arg the Python body never sends', 'infra/agentos/tools_data.py',
  '"include_upcoming": include_upcoming', '"upcoming": include_upcoming',
  /get_meeting_context: wire arg "include_upcoming" is never sent/);
decoy('the tasks route loses prepare() on a class-A case', 'app/api/internal/agentos/tasks/route.ts',
  "result = await prepare('delete_task',", "result = await executeDelete('delete_task',",
  /delete_task: class-A but the \/tasks case never calls prepare/);

console.log(`\n${pass} pass · ${fail} fail — ${fail ? 'AGENTOS PARITY BROKEN' : 'AGENTOS PARITY HOLDS'}`);
process.exit(fail ? 1 : 0);
