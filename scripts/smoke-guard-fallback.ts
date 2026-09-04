// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE GUARD-FALLBACK FLOOR (permanent, Sep 4 — the sovereign-Home redirect loop).
//
// `guardFeaturePage(feature)` redirects a member whose workspace has that feature off to the front
// door, /home. But /home was ITSELF guarded by a feature key ('home'), so a workspace with
// features.home:false made /home redirect to /home — forever. Found live on the AHK workshop
// (sovereign) workspace: the browser hammered `GET /home` ~3-4×/sec, the (main) layout stayed
// mounted so the sidebar looked healthy, and the page segment never rendered — a blank main column.
// Chrome eventually gave ERR_TOO_MANY_REDIRECTS.
//
// THE LAW: a page guard's fallback route must never be a route that same guard can reject.
// Pure source floors — zero AI, zero DB, runs in milliseconds.
// Run: npx tsx scripts/smoke-guard-fallback.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const guards = readFileSync('lib/workspace/guards.ts', 'utf8');

console.log('THE GUARD ITSELF:');

// The fallback route and the feature key guarding it are both named constants, so the exemption
// below can be checked against them instead of a hardcoded string drifting apart.
const fallbackRoute = guards.match(/const FEATURE_FALLBACK\s*=\s*'([^']+)'/)?.[1];
const fallbackKey = guards.match(/const FEATURE_FALLBACK_PAGE:\s*FeatureKey\s*=\s*'([^']+)'/)?.[1];
ok('the fallback route is a named constant', !!fallbackRoute, 'FEATURE_FALLBACK missing');
ok('the feature key guarding the fallback route is a named constant', !!fallbackKey, 'FEATURE_FALLBACK_PAGE missing');

ok('the feature rejection redirects to the named fallback, not a literal',
  /redirect\(FEATURE_FALLBACK\)/.test(guards),
  'the rejection branch must redirect(FEATURE_FALLBACK)');

ok('the guard EXEMPTS the fallback page\'s own feature (no self-redirect)',
  /feature\s*!==\s*FEATURE_FALLBACK_PAGE/.test(guards),
  'the rejection branch must skip the feature key that guards the fallback route');

// Belt and braces: no literal redirect to the fallback route inside the feature branch.
const featureBranch = guards.slice(guards.indexOf('if (feature'));
ok('no literal redirect back to the fallback route in the feature branch',
  !new RegExp(`redirect\\('${fallbackRoute}'\\)`).test(featureBranch),
  'a literal fallback redirect can drift from the exemption');

console.log('\nTHE CALLERS (the fallback page must be guarded by the exempted key, or by nothing):');

// Walk app/ for guardFeaturePage callers and map route -> feature key.
const roots = ['app'];
const files: string[] = [];
const walk = (dir: string) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p); }
    else if (/\.(ts|tsx)$/.test(e)) files.push(p);
  }
};
for (const r of roots) walk(r);

// app/(main)/home/page.tsx -> '/home'
const routeOf = (f: string) =>
  '/' + f
    .replace(/^app\//, '')
    .replace(/\/(page|layout)\.tsx?$/, '')
    .replace(/\([^/]*\)\/?/g, '')       // route groups
    .replace(/\[[^\]]*\]/g, ':param')   // dynamic segments
    .replace(/^\/+|\/+$/g, '');

const callers: Array<{ file: string; route: string; keys: string[] }> = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (!src.includes('guardFeaturePage(')) continue;
  if (f.endsWith('guards.ts')) continue;
  const keys = [...src.matchAll(/guardFeaturePage\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  if (keys.length) callers.push({ file: f, route: routeOf(f), keys });
}

ok('found guardFeaturePage callers to check', callers.length > 0, 'no callers located');

for (const c of callers) {
  const guardsFallbackRoute = c.route === fallbackRoute;
  if (!guardsFallbackRoute) {
    // Any other page may be gated by anything — its rejection lands on the fallback, which it isn't.
    ok(`${c.route} (${c.keys.join(', ')}) is not the fallback route — free to gate`, true);
    continue;
  }
  ok(`${c.route} — the FALLBACK route — is only guarded by the exempted key`,
    c.keys.every((k) => k === fallbackKey),
    `guarded by [${c.keys.join(', ')}], but only '${fallbackKey}' is exempted from redirecting`);
}

console.log('\nTHE FLAG IS INERT (nothing else may act on the fallback page\'s feature):');
const readers: string[] = [];
for (const dir of ['app', 'lib', 'components']) walkRead(dir);
function walkRead(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walkRead(p); continue; }
    if (!/\.(ts|tsx)$/.test(e)) continue;
    if (p === 'lib/workspace/guards.ts' || p === 'lib/workspace/types.ts') continue;
    const src = readFileSync(p, 'utf8');
    if (new RegExp(`features\\.${fallbackKey}\\b|features\\[['"]${fallbackKey}['"]\\]`).test(src)) readers.push(p);
  }
}
ok(`no surface reads features.${fallbackKey} (turning it off must brick nothing)`,
  readers.length === 0, readers.join(', '));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
