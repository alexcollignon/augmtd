// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LAWS META-GATE (W1.4, Sep 22 2026 — THE STABILIZATION PROGRAM).
//
// The registry (docs/laws-registry.json) is the one home of every law; this gate keeps it honest in
// BOTH directions: every gate a law names must exist as a suite, and every suite must serve at least
// one law. Tier-1 invariants fail on source-only enforcement (a regex proves wording, not behaviour)
// unless their outcome/walk gate is declared `planned` with a wave — reported, not failed, while
// planned. Zero AI, zero DB, zero network. Run: npx tsx scripts/smoke-laws.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

type GateKind = 'source' | 'pure' | 'outcome' | 'walk';
type GateCost = 'zero-ai' | 'cached' | 'live-ai';
// 'holding-uncommitted': a Sep-22 finding was fixed in code by a landed wave, but the fix has not
// been committed, deployed, or browser-walked yet — it names the wave that fixed it in `fixed_by`.
// Distinct from `holding` (already committed/deployed/earned) and `broken-live` (still broken, e.g.
// pending an owner-applied migration).
type Status = 'holding' | 'holding-uncommitted' | 'broken-live' | 'gateless' | 'obsolete';
interface Gate { suite: string; kind: GateKind; cost: GateCost; ids?: string[]; status?: 'planned'; wave?: string; fn?: string; note?: string }
interface Collision { law: string; precedence: string }
interface Law {
  id: string; name: string; aliases: string[]; tier: 1 | 2 | 3; domain: string; statement: string;
  homes: string[]; gates: Gate[]; version_key?: string | null; status: Status; broken_by?: string | null;
  fixed_by?: string | null; collides_with: Collision[]; fn?: string; note?: string;
}
interface Registry { version: number; generated: string; laws: Law[]; lessons: string[] }

const KINDS: GateKind[] = ['source', 'pure', 'outcome', 'walk'];
const COSTS: GateCost[] = ['zero-ai', 'cached', 'live-ai'];
const STATUSES: Status[] = ['holding', 'holding-uncommitted', 'broken-live', 'gateless', 'obsolete'];
const ROOT = process.cwd();

let pass = 0, fail = 0, warn = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const warnIf = (name: string, cond: boolean, detail?: string) => {
  if (cond) { warn++; console.log(`  ⚠ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── 1. THE JSON PARSES AND VALIDATES ITS SCHEMA ─────────────────────────────────────────────────
console.log('THE REGISTRY:');
let reg: Registry;
try {
  reg = JSON.parse(readFileSync(join(ROOT, 'docs/laws-registry.json'), 'utf8')) as Registry;
  ok('docs/laws-registry.json parses', true);
} catch (e) {
  ok('docs/laws-registry.json parses', false, String(e));
  console.log(`\n❌ ${pass} passed, ${fail} failed`);
  process.exit(1);
}
ok('registry carries version + generated + laws[] + lessons[]',
  typeof reg.version === 'number' && typeof reg.generated === 'string' && Array.isArray(reg.laws) && Array.isArray(reg.lessons));

const schemaErrors: string[] = [];
const ids = new Set<string>();
for (const law of reg.laws) {
  const where = law.id ?? '(no id)';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(law.id ?? '')) schemaErrors.push(`${where}: id must be kebab-case`);
  if (ids.has(law.id)) schemaErrors.push(`${where}: duplicate id`);
  ids.add(law.id);
  if (typeof law.name !== 'string' || !law.name.trim()) schemaErrors.push(`${where}: name missing`);
  if (!Array.isArray(law.aliases)) schemaErrors.push(`${where}: aliases must be an array`);
  if (![1, 2, 3].includes(law.tier)) schemaErrors.push(`${where}: tier must be 1|2|3`);
  if (typeof law.statement !== 'string' || law.statement.length < 20) schemaErrors.push(`${where}: statement missing/too short`);
  if (!Array.isArray(law.homes)) schemaErrors.push(`${where}: homes must be an array`);
  if (!Array.isArray(law.gates)) schemaErrors.push(`${where}: gates must be an array`);
  if (!STATUSES.includes(law.status)) schemaErrors.push(`${where}: status must be one of ${STATUSES.join('|')}`);
  if (!Array.isArray(law.collides_with)) schemaErrors.push(`${where}: collides_with must be an array`);
  if (law.status === 'broken-live' && !(law.broken_by && law.broken_by.length > 20)) schemaErrors.push(`${where}: broken-live needs a broken_by finding`);
  if (law.status !== 'broken-live' && law.broken_by) schemaErrors.push(`${where}: broken_by set but status is ${law.status}`);
  if (law.status === 'holding-uncommitted' && !(law.fixed_by && law.fixed_by.length > 3)) schemaErrors.push(`${where}: holding-uncommitted needs a fixed_by wave`);
  if (law.status !== 'holding-uncommitted' && law.fixed_by) schemaErrors.push(`${where}: fixed_by set but status is ${law.status}`);
  for (const g of law.gates ?? []) {
    if (typeof g.suite !== 'string' || !g.suite) schemaErrors.push(`${where}: gate without suite`);
    if (!KINDS.includes(g.kind)) schemaErrors.push(`${where}: gate ${g.suite} kind must be ${KINDS.join('|')}`);
    if (!COSTS.includes(g.cost)) schemaErrors.push(`${where}: gate ${g.suite} cost must be ${COSTS.join('|')}`);
    if (g.status && g.status !== 'planned') schemaErrors.push(`${where}: gate ${g.suite} status may only be 'planned'`);
    if (g.status === 'planned' && !/^W\d+\.\d+$/.test(g.wave ?? '')) schemaErrors.push(`${where}: planned gate ${g.suite} must name its wave (Wn.n)`);
  }
  for (const c of law.collides_with ?? []) {
    if (typeof c.law !== 'string' || typeof c.precedence !== 'string' || c.precedence.length < 10)
      schemaErrors.push(`${where}: collision needs {law, precedence}`);
  }
}
ok('every entry validates the schema', schemaErrors.length === 0, schemaErrors.slice(0, 12).join(' · '));

// ── 2. COLLISIONS POINT AT REGISTERED LAWS ──────────────────────────────────────────────────────
const badCollisions = reg.laws.flatMap(l => (l.collides_with ?? []).filter(c => !ids.has(c.law)).map(c => `${l.id} → ${c.law}`));
ok('every collision names a registered law id', badCollisions.length === 0, badCollisions.join(', '));

// ── 3. NO TWO ENTRIES SHARE A NAME OR ALIAS ─────────────────────────────────────────────────────
const norm = (s: string) => s.trim().toUpperCase().replace(/^THE\s+/, '').replace(/\s+/g, ' ');
const seen = new Map<string, string>();
const dupes: string[] = [];
const claim = (label: string, owner: string) => {
  const k = norm(label);
  const prev = seen.get(k);
  if (prev && prev !== owner) dupes.push(`"${label}" in ${prev} and ${owner}`);
  else seen.set(k, owner);
};
for (const law of reg.laws) { claim(law.name, law.id); for (const a of law.aliases ?? []) claim(a, law.id); }
for (const lesson of reg.lessons) claim(lesson, 'lessons[]');
ok('no two entries share a name or alias (lessons included)', dupes.length === 0, dupes.slice(0, 10).join(' · '));

// ── 4. HOMES EXIST ON DISK (obsolete laws carry none) ───────────────────────────────────────────
const missingHomes: string[] = [];
for (const law of reg.laws) {
  for (const h of law.homes ?? []) {
    const p = h.replace(/\/\*$/, '');
    if (!existsSync(join(ROOT, p))) missingHomes.push(`${law.id}: ${h}`);
  }
  if (law.status === 'obsolete' && (law.homes ?? []).length > 0) missingHomes.push(`${law.id}: obsolete laws name no homes`);
}
ok('every home file exists on disk', missingHomes.length === 0, missingHomes.join(' · '));

// ── 5. REGISTRY → SUITES: every live gate suite exists; planned ones only with status+wave ───────
const scriptsDir = join(ROOT, 'scripts');
const suitesOnDisk = new Set(readdirSync(scriptsDir).filter(f => /^smoke-.*\.ts$/.test(f)).map(f => f.replace(/\.ts$/, '')));
const missingSuites: string[] = [];
for (const law of reg.laws) {
  for (const g of law.gates ?? []) {
    if (g.status === 'planned') continue;
    if (!suitesOnDisk.has(g.suite)) missingSuites.push(`${law.id} → scripts/${g.suite}.ts`);
  }
}
ok('every live gate suite exists in scripts/', missingSuites.length === 0, missingSuites.join(' · '));
// A planned gate on a suite that exists AND on which the law has no live gate at all means the suite
// landed and the registry was not told — extend the suite or register what it already proves.
const plannedExisting = reg.laws.flatMap(l => (l.gates ?? [])
  .filter(g => g.status === 'planned' && suitesOnDisk.has(g.suite) && !(l.gates ?? []).some(x => x.status !== 'planned' && x.suite === g.suite))
  .map(g => `${l.id} → ${g.suite} (${g.wave})`));
warnIf('planned gates on a suite that exists but is not yet registered live for that law', plannedExisting.length > 0, plannedExisting.join(' · '));

// ── 6. TIER-1: an outcome or walk gate, or planned (reported, never failed while planned) ────────
console.log('\nTIER 1 — THE INVARIANTS:');
const tier1 = reg.laws.filter(l => l.tier === 1);
ok('exactly 14 invariants (docs/stabilization-plan.md PART II)', tier1.length === 14, `found ${tier1.length}`);
const tier1Planned: string[] = [];
const tier1SourceOnly: string[] = [];
for (const law of tier1) {
  const live = (law.gates ?? []).filter(g => g.status !== 'planned');
  const hasOutcome = live.some(g => g.kind === 'outcome' || g.kind === 'walk');
  const planned = (law.gates ?? []).filter(g => g.status === 'planned' && (g.kind === 'outcome' || g.kind === 'walk'));
  if (hasOutcome) continue;
  if (planned.length > 0) tier1Planned.push(`${law.id} (${[...new Set(planned.map(p => p.wave))].join(',')})`);
  else tier1SourceOnly.push(law.id);
}
ok('every invariant has a live outcome/walk gate OR a planned one with a wave', tier1SourceOnly.length === 0,
  `source-only or gateless with no plan: ${tier1SourceOnly.join(', ')}`);
warnIf('invariants still on planned outcome gates (not enforced yet)', tier1Planned.length > 0, tier1Planned.join(' · '));
const tier1Walk = tier1.filter(l => !(l.gates ?? []).some(g => g.kind === 'walk')).map(l => l.id);
warnIf('invariants with no browser walk declared (the plan asks for one per release)', tier1Walk.length > 0, tier1Walk.join(', '));

// ── 7. TIER-2: status honesty ───────────────────────────────────────────────────────────────────
console.log('\nTIER 2 — THE DOMAIN LAWS:');
const tier2 = reg.laws.filter(l => l.tier === 2);
// A law with no live gate is either honestly `gateless` or already `broken-live` (the audit found it
// before any gate could) — it can never read `holding`.
const t2NoGateNotFlagged = tier2.filter(l => (l.gates ?? []).filter(g => g.status !== 'planned').length === 0 && !['gateless', 'broken-live'].includes(l.status)).map(l => l.id);
ok('a tier-2 law with no live gate is marked gateless or broken-live, never holding', t2NoGateNotFlagged.length === 0, t2NoGateNotFlagged.join(', '));
const t2GateButFlagged = tier2.filter(l => (l.gates ?? []).some(g => g.status !== 'planned') && l.status === 'gateless').map(l => l.id);
ok('a tier-2 law marked gateless names no live gate', t2GateButFlagged.length === 0, t2GateButFlagged.join(', '));
const t2NoFn = tier2.filter(l => !l.fn).map(l => l.id);
ok('every tier-2 law names the function a pure test would exercise', t2NoFn.length === 0, t2NoFn.join(', '));
const t2SourceOnly = tier2.filter(l => { const live = (l.gates ?? []).filter(g => g.status !== 'planned'); return live.length > 0 && live.every(g => g.kind === 'source'); }).map(l => l.id);
warnIf('tier-2 laws enforced by source gates only (W1.1 owes them a pure test)', t2SourceOnly.length > 0, t2SourceOnly.join(', '));

// ── 8. OBSOLETE LAWS CARRY NO LIVE GATE REQUIREMENT ─────────────────────────────────────────────
console.log('\nTIER 3 — LESSONS + OBSOLETE:');
const obsolete = reg.laws.filter(l => l.status === 'obsolete');
ok('obsolete laws sit in tier 3', obsolete.every(l => l.tier === 3), obsolete.filter(l => l.tier !== 3).map(l => l.id).join(', '));
ok('obsolete laws declare no live gate', obsolete.every(l => (l.gates ?? []).length === 0), obsolete.filter(l => (l.gates ?? []).length > 0).map(l => l.id).join(', '));
ok('lessons[] is non-empty', reg.lessons.length > 0);

// ── 9. SUITES → REGISTRY: every scripts/smoke-*.ts serves a law (WARN for now) ──────────────────
console.log('\nSUITES → REGISTRY:');
const referenced = new Set(reg.laws.flatMap(l => (l.gates ?? []).map(g => g.suite)));
const unreferenced = [...suitesOnDisk].filter(s => !referenced.has(s) && s !== 'smoke-laws').sort();
warnIf(`${unreferenced.length} suite(s) referenced by no law (retire, or register the law they serve)`, unreferenced.length > 0, unreferenced.join(', '));
ok('at least one suite is referenced', referenced.size > 0);

// ── 10. VERSION KEYS NAME REAL CONSTANTS ────────────────────────────────────────────────────────
console.log('\nVERSION KEYS:');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(f)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
};
const libFiles = walk(join(ROOT, 'lib'));
const constants = new Set<string>();
for (const f of libFiles) for (const m of readFileSync(f, 'utf8').matchAll(/export const ([A-Z_]+_VERSION)\b/g)) constants.add(m[1]);
const badKeys = reg.laws.filter(l => l.version_key && !constants.has(l.version_key)).map(l => `${l.id}: ${l.version_key}`);
ok('every version_key is an exported *_VERSION constant under lib/', badKeys.length === 0, badKeys.join(', '));

// ── SUMMARY ─────────────────────────────────────────────────────────────────────────────────────
const byTier = [1, 2, 3].map(t => `tier ${t}: ${reg.laws.filter(l => l.tier === t).length}`).join(' · ');
const byStatus = STATUSES.map(s => `${s}: ${reg.laws.filter(l => l.status === s).length}`).join(' · ');
const gateless = reg.laws.filter(l => l.status !== 'obsolete' && (l.gates ?? []).filter(g => g.status !== 'planned').length === 0).map(l => l.id);
const gateCount = reg.laws.reduce((n, l) => n + (l.gates ?? []).filter(g => g.status !== 'planned').length, 0);
const plannedCount = reg.laws.reduce((n, l) => n + (l.gates ?? []).filter(g => g.status === 'planned').length, 0);
console.log(`\nSUMMARY: ${reg.laws.length} laws (${byTier}) + ${reg.lessons.length} lessons`);
console.log(`  status — ${byStatus}`);
console.log(`  gates — ${gateCount} live · ${plannedCount} planned · suites on disk ${suitesOnDisk.size} · referenced ${referenced.size} · unreferenced ${unreferenced.length}`);
console.log(`  gateless (no live gate) — ${gateless.length}: ${gateless.join(', ')}`);
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed, ${warn} warnings`);
if (fail > 0) process.exit(1);
