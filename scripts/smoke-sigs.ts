// smoke-sigs.ts — W2.5 DEPENDENCY-KEYED CACHES gate (R4 · docs/stabilization-plan.md).
//
// ZERO AI, ZERO DB. The law: every AI cache key is `sigOf({version, deps})` or at least carries its
// prompt/law `*_VERSION`; the judge's sig carries the evidence set AND the entity's own sig; the one
// versions registry (lib/core/versions.ts) re-exports every `*_VERSION` in lib/.
//   S1 PURE      — sigOf is canonical (key order, Set order, array order, null/undefined/'' distinct).
//   S2 REGISTRY  — every `const X_VERSION =` in lib/ is re-exported from its home (allowlist w/ reason).
//   S3 WRITES    — every item_plans cache write (payload carries `sig`, or kind ∈ CACHE_KINDS) lives
//                  in a file that uses sigOf or references a *_VERSION (allowlist w/ reason).
//   S4 SIG HOMES — the non-item_plans AI caches reference their version in-file.
//   S5 THE JUDGE — sigOf-built, evidence + entity sig as deps, the commitment address resolved.
//   KNOWN DEBT   — out-of-fence caches still without a version: printed, never silently accepted.
//
// Run: npx tsx scripts/smoke-sigs.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { sigOf, canonicalSig, sigVersion } from '../lib/core/sig';

const ROOT = join(__dirname, '..');
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };

function walk(dir: string, files: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return files; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, files);
    else if (/\.(ts|tsx)$/.test(e)) files.push(p);
  }
  return files;
}
const rel = (f: string) => relative(ROOT, f);
const libFiles = walk(join(ROOT, 'lib'));
const allFiles = [...libFiles, ...walk(join(ROOT, 'app'))];

// ── S1 PURE ──────────────────────────────────────────────────────────────────────────────────────
{
  const a = sigOf({ version: 7, deps: { x: 1, y: 'b' } });
  const b = sigOf({ version: 7, deps: { y: 'b', x: 1 } });
  check('S1.1 dep key order never moves the sig', a === b, `${a} vs ${b}`);
  check('S1.2 a Set is order-independent', sigOf({ version: 1, deps: { s: new Set(['a', 'b']) } }) === sigOf({ version: 1, deps: { s: new Set(['b', 'a']) } }));
  check('S1.3 an array is a sequence (order matters)', sigOf({ version: 1, deps: { s: ['a', 'b'] } }) !== sigOf({ version: 1, deps: { s: ['b', 'a'] } }));
  check('S1.4 null / undefined / \'\' / false are distinct', new Set([null, undefined, '', false].map((v) => sigOf({ version: 1, deps: { v } }))).size === 4);
  check('S1.5 a version bump moves the sig, and the prefix names it', sigOf({ version: 1, deps: {} }) !== sigOf({ version: 2, deps: {} }) && sigVersion(sigOf({ version: 12, deps: {} })) === '12');
  check('S1.6 colon-free (embeddable in colon-delimited keys)', !sigOf({ version: 3, deps: { t: '2026-09-22T10:00:00Z' } }).includes(':'));
  check('S1.7 no concatenation collision ("ab"+"c" ≠ "a"+"bc")', canonicalSig({ p: 'ab', q: 'c' }) !== canonicalSig({ p: 'a', q: 'bc' }));
}

// ── S2 REGISTRY ──────────────────────────────────────────────────────────────────────────────────
const VERSION_ALLOW: Record<string, string> = {
  DB_VERSION: 'lib/recording/vault.ts — an IndexedDB schema version, not a cache key',
};
{
  const reg = src('lib/core/versions.ts');
  const missing: string[] = [];
  for (const f of libFiles) {
    if (rel(f) === 'lib/core/versions.ts') continue;
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/^\s*(export\s+)?const\s+([A-Z0-9_]*_VERSION)\s*(?::[^=]*)?=/gm)) {
      const name = m[2];
      if (VERSION_ALLOW[name]) continue;
      const home = rel(f).replace(/\.tsx?$/, '');
      const re = new RegExp(`export \\{ ${name} \\} from '@/${home.replace(/[/.]/g, (c) => `\\${c}`)}'`);
      if (!m[1] || !re.test(reg)) missing.push(`${name} (${rel(f)}${m[1] ? '' : ' — not exported'})`);
    }
  }
  check('S2 every *_VERSION in lib/ is exported from its home and re-exported by lib/core/versions.ts', missing.length === 0, missing.join(', '));
  const reexports = [...reg.matchAll(/export \{ ([A-Z0-9_]+) \} from '@\/([^']+)'/g)];
  const dangling = reexports.filter(([, n, p]) => !new RegExp(`export const ${n}\\b`).test(src(`${p}.ts`) || src(`${p}.tsx`))).map(([, n]) => n);
  check('S2b every registry line points at a real exported constant', reexports.length > 20 && dangling.length === 0, dangling.join(', '));
  check('S2c every registry line carries a one-line purpose', reexports.every((m) => /\/\*\*[^\n]+\*\/\n$/.test(reg.slice(0, m.index))));
}

// ── S3 WRITES ────────────────────────────────────────────────────────────────────────────────────
// Kinds that cache an AI (or law-derived) answer — a stale entry is a stale verdict.
const CACHE_KINDS = new Set([
  'judgment', 'room_brief', 'fulfillment', 'expiry', 'reply_directions', 'campaign_signature',
  'day_state', 'anticipation', 'outcome_facts', 'conversation_pair', 'judgment_nomination',
  'conversation_cascade', 'date_stated', 'timeline_cache', 'proof_of_life',
]);
// Write sites that may lack a version — each with its reason (debt is documented, never silent).
const WRITE_ALLOW: Record<string, string> = {
  'lib/utils/user-time.ts:date_stated': 'CODE-DISPOSED: the cached boolean is quoteProvesDate\'s verdict on a model-proposed span, keyed by iso + a text hash — follow-up: DATE_STATED_VERSION when the quote prompt next changes',
  'app/api/home/timeline/route.ts:timeline_cache': 'zero-AI server last-good (45s staleness) — freshness by TTL, no prompt to version',
};
{
  const offenders: string[] = [];
  let sites = 0;
  for (const f of allFiles) {
    const t = readFileSync(f, 'utf8');
    if (!t.includes('item_plans') && !/\b(?:upsertPlan|insertPlan)\(/.test(t)) continue;
    const fileVersioned = /sigOf\(/.test(t) || /\b[A-Z0-9_]+_VERSION\b/.test(t);
    const consts = new Map<string, string>();
    for (const m of t.matchAll(/const\s+([A-Z_]+)\s*=\s*'([a-z_]+)'/g)) consts.set(m[1], m[2]);
    const re = /\.from\((['"])item_plans\1\)\s*\.(upsert|insert)\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      let i = m.index + m[0].length, depth = 1;
      while (i < t.length && depth) { const ch = t[i]; if (ch === '(') depth++; else if (ch === ')') depth--; i++; }
      const body = t.slice(m.index, i);
      const k = /kind:\s*(?:'([a-z_]+)'|([A-Z_]+))/.exec(body);
      const kind = k ? (k[1] ?? consts.get(k[2] ?? '') ?? k[2]) : '?';
      const isCache = /\bsig\b/.test(body) || CACHE_KINDS.has(kind);
      if (!isCache) continue;
      sites++;
      if (fileVersioned || WRITE_ALLOW[`${rel(f)}:${kind}`]) continue;
      offenders.push(`${rel(f)}:${t.slice(0, m.index).split('\n').length} kind=${kind}`);
    }
    // W2.6: writes through THE TYPED DOOR (lib/store/item-plans.ts) name their kind as the 3rd arg.
    const doorRe = /\b(?:upsertPlan|insertPlan)\(\s*[\w.]+,\s*[\w.]+,\s*'([a-z_]+)'/g;
    while ((m = doorRe.exec(t))) {
      const kind = m[1];
      if (!CACHE_KINDS.has(kind)) continue;
      sites++;
      if (fileVersioned || WRITE_ALLOW[`${rel(f)}:${kind}`]) continue;
      offenders.push(`${rel(f)}:${t.slice(0, m.index).split('\n').length} kind=${kind} (door)`);
    }
  }
  check(`S3 every AI-cache write site (${sites}) builds its sig with sigOf or carries a *_VERSION (allowlist w/ reasons)`, sites > 5 && offenders.length === 0, offenders.join(', '));
}

// ── S4 SIG HOMES (AI caches that do not live in item_plans) ────────────────────────────────────
{
  const homes: Array<[string, string]> = [
    ['lib/entities/state.ts', 'STATE_PROMPT_VERSION'],
    ['lib/briefing/compose.ts', 'BRIEFING_PROMPT_VERSION'],
    ['app/api/company/alignment/route.ts', 'ALIGNMENT_PROMPT_VERSION'], // the sig is built by the route
    ['lib/entities/reflect.ts', 'REFLECT_PROMPT_VERSION'],
    ['lib/outbound/resolve.ts', 'OUTBOUND_VERSION'],
    ['lib/room/brief.ts', 'ROOM_BRIEF_VERSION'],
    ['lib/home/day-state.ts', 'DAY_STATE_VERSION'],
    ['lib/home/anticipation.ts', 'ANTICIPATION_BRIEF_VERSION'],
  ];
  const bad = homes.filter(([p, v]) => (src(p).match(new RegExp(`\\b${v}\\b`, 'g')) ?? []).length < 2).map(([p, v]) => `${p} (${v})`);
  check('S4 every non-item_plans AI cache USES its version in-file (declared AND read)', bad.length === 0, bad.join(', '));
  const ds = src('lib/home/day-state.ts');
  check('S4b day-state: version + day are deps, a stale-shape block never serves', /sigOf\(\{ version: DAY_STATE_VERSION, deps: \{ day: todayStr \} \}\)/.test(ds) && /cached\.tasks\.sig === sig/.test(ds));
  const an = src('lib/home/anticipation.ts');
  check('S4c anticipation: the meeting fire record carries the prompt version; an older stamp re-briefs',
    /v: ANTICIPATION_BRIEF_VERSION/.test(an) && /\?\.v \?\? 1\) >= ANTICIPATION_BRIEF_VERSION\) continue;/.test(an));
}

// ── S5 THE JUDGE ─────────────────────────────────────────────────────────────────────────────────
{
  const j = src('lib/work/judge.ts');
  check('S5.1 the judgment sig is built with sigOf, version + day slots positional',
    /const sig = `\$\{JUDGE_VERSION\}:\$\{todayStr\}:\$\{sigOf\(\{ version: JUDGE_VERSION, deps: \{/.test(j));
  check('S5.2 the evidence set rides the sig', /evidence: evidenceSig\(evidence\)/.test(j));
  check('S5.3 the entity\'s own sig rides the sig (read BEFORE the cache check)',
    /select\('name, state, next_move, goals, rules, sig'\)/.test(j) && /entity: ent \?/.test(j)
    && j.indexOf("select('name, state, next_move, goals, rules, sig')") < j.indexOf('const sig = `${JUDGE_VERSION}'));
  check('S5.4 the commitment branch resolves its counterparty ADDRESS through the nominator',
    /whoEmail = await resolveCommitmentAddress\(client, userId,/.test(j));
  check('S5.5 LATER EVIDENCE replaces the inbox-only calendar block, for BOTH kinds, from the batch pool',
    !/calBlock/.test(j) && /matchEvidence\(/.test(j) && /judgeEvidencePool\(client, userId\)/.test(j)
    && /siblingSettledFact\(siblingNom\) \+[\s\S]{0,300}evidenceBlock \+/.test(j));
  check('S5.6 the ALREADY BOOKED rule still has its calendar header to read',
    j.includes("ALREADY ON THE USER'S CALENDAR") && j.includes('- ALREADY BOOKED:'));
}

// ── KNOWN DEBT (out of this wave's fence — printed, never silently accepted) ────────────────────
const DEBT: Array<[string, boolean]> = [
  // PAID (W2.6): the synthesizeBrief sig is sigOf({ version: SYNTH_BRIEF_VERSION, … }) — gated in smoke-typed-stores V1.
  ['lib/entities/recognize.ts — refusals persist as entity_links(via=none) with no law version (a recognition-law change never re-reasons a machine refusal; needs a column → migration, owner-gated)', !/_VERSION/.test(src('lib/entities/recognize.ts'))],
];

let fail = 0;
for (const [n, ok, d] of out) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d ? `\n      ${d}` : ''}`); if (!ok) fail++; }
for (const [n, open] of DEBT) if (open) console.log(`DEBT  ${n}`);
console.log(`\nsmoke-sigs: ${out.length - fail}/${out.length} PASS`);
process.exit(fail ? 1 : 0);
