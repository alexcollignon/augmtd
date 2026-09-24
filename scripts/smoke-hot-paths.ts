/**
 * smoke-hot-paths — THE HOT-PATH LAW (docs/event-spine-plan.md P0 + C.3; registry `hot-path-law`).
 * ZERO AI, ZERO DB — reads source and runs the pure helper against fake clients.
 *
 * THE LAW: a request that renders a surface reads bounded, body-free rows. On the page-load paths a
 * work row (`inbox_items` / `commitments`) is never read `select('*')` or with its WHOLE
 * `source_data`; each read names the JSON paths its derivation reads (lib/home/lean-source.ts); the
 * mail body rides only where a derivation provably reads it, and only under a bound.
 *
 *   H1 — no `select('*')` / whole `source_data` on inbox_items/commitments in the hot files
 *        (shrinking allowlist, each entry with its reason: the object's own POST lanes, background
 *        work, and the declared debt outside P0's fence).
 *   H2 — no body field (`body`, `html_body`, `thread_history`) in a hot-file select, except the
 *        declared bounded served-row reads; `withBody: true` only on the declared pools; a
 *        rules-conditional `withBody` only from `rulesReadBody(`.
 *   H3 — every `leanSelect(` / `readLeanPool(` in the hot files names its reader's key set (`keys:`),
 *        and no lean read is ordered-and-ranged (Postgres evaluates the paths before the sort + OFFSET:
 *        every matching row de-toasted for every page — the measured trap `readLeanPool` exists for).
 *   H4 — THE KEY UNIVERSE: every `source_data` key the code reads (dot, bracket, or a string const)
 *        is declared — projected (LEAN), heavy (HEAVY) or never stored (NEVER_STORED). A new key cannot
 *        silently fall out of the projected readers.
 *   H5 — THE HELD READER'S CLOSURE: every key the held derivation's import closure reads is in its
 *        pool set (CLASSIFY) or a set it hydrates for the rows that need it (PREPARED + body for the
 *        rendered rows, DEED for the deed engine), or declared not-read-on-these-rows with a reason.
 *   H6 — no lean row is written back: a hot file that folds lean rows never builds
 *        `source_data: { ...` (a spread of a lean object would erase the stored body).
 *   H7 — the pure helper: projection, fold, collision refusal, whole-row pass-through, rules
 *        predicate, the hydrate bound (reported, never silent), the pool (ids ordered, projected once
 *        per row, returned in order, a failed chunk throws).
 *   H8 — the fence is wired: held route + brief prime hydrate the rendered rows before the payload;
 *        the brief's commitments pool is column-named; the deck-context thread listing is body-free.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';
import {
  LEAN_SOURCE_KEYS, HEAVY_SOURCE_KEYS, NEVER_STORED_KEYS, CLASSIFY_KEYS, PREPARED_KEYS, DEED_KEYS,
  leanSelect, foldLean, foldLeanRows, isLeanSource, rulesReadBody, hydrateSource, readLeanPool,
} from '../lib/home/lean-source';

const ROOT = join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const walk = (d: string, out: string[] = []): string[] => {
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
};
const rel = (p: string) => relative(ROOT, p);

// ── THE HOT FILES (the P0 fence: every page-load read path of the Home, the held list, the deck,
//    the brief, the item view, triage and the rooms) ─────────────────────────────────────────────
const HOT_FILES = [
  ...walk(join(ROOT, 'app/api/home')).filter((f) => f.endsWith('route.ts')),
  join(ROOT, 'app/api/items/view/route.ts'),
  ...walk(join(ROOT, 'lib/home')),
  ...walk(join(ROOT, 'lib/deeds')).filter((f) => /held-[a-z-]+\.ts$/.test(f)),
  ...walk(join(ROOT, 'lib/triage')),
  ...walk(join(ROOT, 'lib/room')),
  join(ROOT, 'lib/prepare/read.ts'),
  // Named hot paths outside P0's fence — scanned so their debt is VISIBLE (see the allowlist).
  join(ROOT, 'lib/work/machine.ts'),
  join(ROOT, 'lib/work-items/model.ts'),
].map(rel);

/** THE SHRINKING ALLOWLIST — `file · table` → why a whole/`*` read is still legitimate there. */
const WHOLE_READ_ALLOW: Record<string, string> = {
  'lib/home/item-context.ts · inbox_items': 'the prepare lane (POST /api/items/prepare, AI): the model reads the item whole — not a page load',
  'lib/home/prepare-action.ts · inbox_items': 'the prepare/forward lanes (POST, AI): the forwarded body is the work — not a page load',
  'lib/room/open-kicks.ts · inbox_items': 'recognize-on-open: background after() work (entity recognition reads the body) — never on the paint',
  'lib/work/machine.ts · inbox_items': 'DEBT (outside P0 fence): workStatesFor/workStateOf refetch when no row is in hand — every Home caller passes rows; next: ANCHOR_KEYS-shaped read',
  'lib/work-items/model.ts · inbox_items': 'DEBT (outside P0 fence): the timeline spine (`INBOX_COLS`) — next: the work index (P2/P3)',
};
/** Declared body reads on the hot files — each bounded, each a served row. */
const BODY_READ_ALLOW: Record<string, string> = {
  'lib/triage/deck-context-read.ts · emails': 'the founding lines the handed cards quote — one id-keyed read for the chosen emails, ≤ DECK_CONTEXT_MAX_IDS',
  'lib/home/prepare-action.ts · emails': 'the forward lane (POST, AI) — not a page load',
  'lib/home/item-context.ts · emails': 'the prepare lane (POST, AI) — not a page load',
};
/** Declared `withBody: true` pools — the derivation reads the body, bounded. */
const WITH_BODY_ALLOW: Record<string, string> = {
  'app/api/home/brief/route.ts': 'the deck pool: served snippets + synthesis grounding are clipped from it; bounded by DECK_POOL_LIMIT',
  'lib/prepare/read.ts': 'THE ONE READER for ONE item: the window floor reads the item\'s words (one row)',
};

// ── statement-level select extraction (multi-line aware) ────────────────────────────────────────
type Sel = { file: string; table: string; cols: string; stmt: string; line: number };
function selectsOf(file: string): Sel[] {
  const src = read(file);
  const out: Sel[] = [];
  const re = /from\(\s*['"`](\w+)['"`]\s*\)\s*\.select\(\s*(?:(['"`])([\s\S]*?)\2|([A-Za-z_][\w.[\]]*(?:\([^)]*\))?))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = src.indexOf(';', m.index);
    // An identifier select resolves through the file's own string constant, when it has one.
    const constVal = m[4] ? new RegExp(String.raw`const ${m[4]}\s*=\s*'([^']*)'`).exec(src)?.[1] : undefined;
    out.push({
      file, table: m[1], cols: (m[3] ?? constVal ?? `<expr:${m[4]}>`).replace(/\s+/g, ' '),
      stmt: src.slice(m.index, end === -1 ? m.index + 600 : Math.min(end, m.index + 1200)),
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  // `.select()` with no argument is `*`.
  for (const mm of src.matchAll(/from\(\s*['"`](inbox_items|commitments)['"`]\s*\)\s*\.select\(\s*\)/g)) {
    out.push({ file, table: mm[1], cols: '*', stmt: '', line: src.slice(0, mm.index).split('\n').length });
  }
  return out;
}
const wholeSourceData = (cols: string) => /(^|[\s,(])source_data\s*(,|$|\))/.test(cols) || /(^|[\s,])source_data\s*$/.test(cols);

console.log('\nH1 — no select(*) / whole source_data on work rows in the hot files');
const hotSelects = HOT_FILES.filter((f) => existsSync(join(ROOT, f))).flatMap(selectsOf);
const violations: string[] = [];
const allowUsed = new Set<string>();
for (const s of hotSelects) {
  if (s.table !== 'inbox_items' && s.table !== 'commitments') continue;
  const bad = s.cols.trim() === '*' || wholeSourceData(s.cols);
  if (!bad) continue;
  const key = `${s.file} · ${s.table}`;
  if (WHOLE_READ_ALLOW[key]) { allowUsed.add(key); continue; }
  violations.push(`${s.file}:${s.line} ${s.table} [${s.cols.slice(0, 80)}]`);
}
ok(`every hot inbox_items/commitments select is column-named and body-free (${hotSelects.length} selects scanned)`, violations.length === 0, violations.join(' | '));
// An expression select must be one of the named lean shapes.
const exprSelects = hotSelects.filter((s) => (s.table === 'inbox_items' || s.table === 'commitments') && s.cols.startsWith('<expr:'));
const exprOk = exprSelects.filter((s) => !/leanSelect|ANCHOR_ROW_SELECT|COMMITMENT_ROW_COLS|OPEN_COMMITMENT_COLS|cols\b|INBOX_COLS|COMMIT_COLS/.test(s.cols));
ok(`every expression select on a work row is a declared lean shape (${exprSelects.length})`, exprOk.length === 0, exprOk.map((s) => `${s.file}:${s.line} ${s.cols}`).join(' | '));
const staleAllow = Object.keys(WHOLE_READ_ALLOW).filter((k) => !allowUsed.has(k));
ok('the whole-read allowlist only SHRINKS (no entry outlives its read)', staleAllow.length === 0, `stale: ${staleAllow.join(', ')}`);

console.log('\nH2 — bodies only where a derivation reads them, bounded');
const bodyViolations: string[] = [];
for (const s of hotSelects) {
  const cols = s.cols.split(',').map((c) => c.trim());
  const hasBody = cols.some((c) => /^(body|html_body|thread_history)$/.test(c) || /source_data->>?(body|html_body|thread_history)\b/.test(c));
  if (!hasBody) continue;
  const key = `${s.file} · ${s.table}`;
  if (BODY_READ_ALLOW[key]) continue;
  bodyViolations.push(`${s.file}:${s.line} ${s.table}`);
}
ok('no body field selected on a hot file outside the declared served-row reads', bodyViolations.length === 0, bodyViolations.join(' | '));
const withBodyTrue = HOT_FILES.filter((f) => existsSync(join(ROOT, f)) && !f.endsWith('lean-source.ts') && /withBody:\s*true/.test(read(f)));
ok('`withBody: true` only on the declared pools', withBodyTrue.every((f) => !!WITH_BODY_ALLOW[f]), withBodyTrue.filter((f) => !WITH_BODY_ALLOW[f]).join(', '));
const condBody = HOT_FILES.filter((f) => existsSync(join(ROOT, f)) && /\{[^}]*\bwithBody\b(?!:)[^}]*\}/.test(read(f)) && !f.endsWith('lean-source.ts'));
ok('a rules-conditional body comes only from rulesReadBody(', condBody.every((f) => /const withBody = rulesReadBody\(/.test(read(f))), condBody.filter((f) => !/const withBody = rulesReadBody\(/.test(read(f))).join(', '));
const lean = read('lib/home/lean-source.ts');
ok('the hydrate is bounded and SAYS what it left behind', /leftBehind/.test(lean) && /console\.warn\(`\[lean-source\] hydrate bound/.test(lean));

console.log('\nH3 — every lean read names its reader\'s set; no ordered+ranged lean read');
const unnamed: string[] = [];
const rangedLean: string[] = [];
for (const f of HOT_FILES.filter((x) => existsSync(join(ROOT, x)) && !x.endsWith('lean-source.ts'))) {
  const src = read(f);
  for (const m of src.matchAll(/\b(leanSelect|readLeanPool)\(/g)) {
    // the call's argument text up to its balanced close paren
    let depth = 0, i = m.index! + m[0].length - 1, j = i;
    for (; j < src.length; j++) { if (src[j] === '(') depth++; else if (src[j] === ')') { depth--; if (depth === 0) break; } }
    const call = src.slice(m.index!, j + 1);
    if (/^(leanSelect|readLeanPool)\(\s*[a-z]/.test(call) && /function|=>/.test(call.slice(0, 40)) === false && !/keys:/.test(call)) unnamed.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    if (m[1] === 'leanSelect') {
      // the chain this select heads: to the statement's end or the next query, whichever is first
      const ends = [src.indexOf(';', j), src.indexOf('.from(', j), src.indexOf('Promise.resolve', j)].filter((x) => x > -1);
      const tail = src.slice(j, ends.length ? Math.min(...ends) : j + 400);
      if (/\.range\(/.test(tail) && /\.order\(/.test(tail)) rangedLean.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
}
ok('every leanSelect/readLeanPool names `keys:` (a declared reader set)', unnamed.length === 0, unnamed.join(', '));
ok('no ordered + range()-paged lean select (page ids, then project — readLeanPool)', rangedLean.length === 0, rangedLean.join(', '));

console.log('\nH4 — the key universe: every source_data key read is declared');
const ALL = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))];
/** Files whose `sd` alias names something other than an inbox row's source_data. */
const NOT_SOURCE_DATA: Record<string, string> = {
  'lib/prepare/outcome-facts.ts': '`sd` there is a learning signal\'s signal_data',
};
const consts = new Map<string, string>();
for (const f of ALL) for (const m of readFileSync(f, 'utf8').matchAll(/export const ([A-Z_]+)\s*=\s*'([a-z_]+)'/g)) consts.set(m[1], m[2]);
const ALIAS = String.raw`(?:\bsd|\bsourceData|\bsource_data|\bisd|\bliveSd|\bexistingSd|\bsdCur|\bfreshSd)`;
const KEY_RE = new RegExp(String.raw`${ALIAS}\??\.([a-zA-Z_][a-zA-Z0-9_]*)|${ALIAS}\[\s*(?:'([a-zA-Z_]+)'|"([a-zA-Z_]+)"|([A-Z_]+))\s*\]`, 'g');
const PROTO = new Set([...Object.getOwnPropertyNames(Object.prototype), ...Object.getOwnPropertyNames(String.prototype), ...Object.getOwnPropertyNames(Array.prototype)]);
const KNOWN = new Set<string>([...LEAN_SOURCE_KEYS, ...HEAVY_SOURCE_KEYS, ...NEVER_STORED_KEYS]);
const keysRead = (files: string[]) => {
  const out = new Map<string, Set<string>>();
  for (const f of files) {
    if (NOT_SOURCE_DATA[rel(f)]) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(KEY_RE)) {
      const k = m[1] ?? m[2] ?? m[3] ?? (m[4] ? consts.get(m[4]) : undefined);
      if (!k || PROTO.has(k)) continue;
      (out.get(k) ?? out.set(k, new Set()).get(k)!).add(rel(f));
    }
  }
  return out;
};
const universe = keysRead(ALL);
const undeclared = [...universe.entries()].filter(([k]) => !KNOWN.has(k));
ok(`every key the code reads off source_data is declared (${universe.size} keys, ${ALL.length} files)`, undeclared.length === 0,
  undeclared.map(([k, fs]) => `${k} (${[...fs].slice(0, 2).join(', ')})`).join(' | '));
ok('the sets are disjoint where they must be (HEAVY never projected; NEVER_STORED never projected)',
  !LEAN_SOURCE_KEYS.some((k) => (HEAVY_SOURCE_KEYS as readonly string[]).includes(k) || (NEVER_STORED_KEYS as readonly string[]).includes(k)));

console.log('\nH5 — the held derivation\'s closure reads only what its reads carry');
const resolveImport = (from: string, spec: string): string | null => {
  let p: string;
  if (spec.startsWith('@/')) p = join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) p = resolve(dirname(from), spec);
  else return null;
  for (const c of [`${p}.ts`, `${p}.tsx`, join(p, 'index.ts'), p]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
};
const closureOf = (entry: string): string[] => {
  const seen = new Set<string>(); const stack = [join(ROOT, entry)];
  while (stack.length) {
    const f = stack.pop()!; if (seen.has(f)) continue; seen.add(f);
    for (const m of readFileSync(f, 'utf8').matchAll(/(?:import|export)[^'";]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const r = resolveImport(f, m[1] ?? m[2]); if (r) stack.push(r);
    }
  }
  return [...seen];
};
/** Keys the closure reads that the held rows never need — each with the reason. */
const HELD_NOT_ON_THESE_ROWS: Record<string, string> = {
  proof_of_life: 'provedAliveOf (lib/home/attention.ts) — read only by the brief\'s deck seat, never on held facts',
  thread_id: 'read by the deed engine (DEED_KEYS, hydrated) and by sibling modules on other objects — the held facts never read it',
};
const heldCarries = new Set<string>([...CLASSIFY_KEYS, ...PREPARED_KEYS, ...DEED_KEYS, 'body', ...NEVER_STORED_KEYS, ...Object.keys(HELD_NOT_ON_THESE_ROWS)]);
const heldClosure = closureOf('lib/deeds/held-members.ts');
const heldKeys = keysRead(heldClosure);
const heldMissing = [...heldKeys.keys()].filter((k) => KNOWN.has(k) && !heldCarries.has(k));
ok(`held closure (${heldClosure.length} files) reads only CLASSIFY ∪ hydrated PREPARED/DEED/body ∪ declared`, heldMissing.length === 0,
  heldMissing.map((k) => `${k} (${[...heldKeys.get(k)!].slice(0, 2).join(', ')})`).join(' | '));
const hm = read('lib/deeds/held-members.ts');
ok('the held pool reads CLASSIFY_KEYS through readLeanPool (ids paged, projected once)', /readLeanPool\(client, userId,/.test(hm) && /keys: CLASSIFY_KEYS, withBody, maxRows: HELD_POOL_MAX/.test(hm));
ok('the rendered rows hydrate PREPARED + body; the deed members hydrate DEED', /hydrateSource\(client, userId, served as never, \[\.\.\.PREPARED_KEYS, 'body'\], served\.length\)/.test(hm)
  && /hydrateSource\(client, userId, all, DEED_KEYS, all\.length\)/.test(hm));

console.log('\nH6 — no lean row is written back');
const folding = HOT_FILES.filter((f) => existsSync(join(ROOT, f)) && /foldLean|foldLeanRows|readLeanPool|foldAnchorRow/.test(read(f)) && !f.endsWith('lean-source.ts'));
const writers = folding.filter((f) => /source_data:\s*\{\s*\.\.\./.test(read(f)));
ok(`no hot file that folds lean rows spreads a source_data into a write (${folding.length} files)`, writers.length === 0, writers.join(', '));

async function pure() {
  console.log('\nH7 — the pure helper');
  const sel = leanSelect('id, work_title', { keys: ['subject', 'draft'] });
  ok('leanSelect names one JSON path per key', sel === 'id, work_title, source_data->subject, source_data->draft', sel);
  ok('withBody adds `body` only (never html_body)', leanSelect('id', { keys: ['subject'], withBody: true }) === 'id, source_data->subject, source_data->body');
  let threw = false; try { leanSelect('id, source_data'); } catch { threw = true; }
  ok('a base list carrying source_data is refused', threw);
  threw = false; try { leanSelect('id, subject', { keys: ['subject'] }); } catch { threw = true; }
  ok('a key colliding with a base column is refused', threw);
  const f = foldLean({ id: 'a', work_title: 'T', subject: 'Hi', draft: null }, { keys: ['subject', 'draft'] });
  ok('the fold rebuilds source_data (null = absent) and keeps the row\'s own columns', f.work_title === 'T' && JSON.stringify(f.source_data) === '{"subject":"Hi"}' && !('subject' in f));
  ok('a folded source_data is known lean; a whole one is not', isLeanSource(f.source_data) && !isLeanSource({ subject: 'x' }));
  const whole = { id: 'b', source_data: { subject: 'x', body: 'y' } };
  ok('a WHOLE row passes the fold untouched (the benchmark\'s before mode)', foldLean(whole) === whole && !isLeanSource(whole.source_data));
  ok('rulesReadBody: an enabled deterministic body_* rule reads the body', rulesReadBody([{ enabled: true, ai_match: false, conditions: [{ field: 'body_contains' }] }]));
  ok('rulesReadBody: AI rules, disabled rules and header rules do not', !rulesReadBody([
    { enabled: true, ai_match: true, conditions: [{ field: 'body_contains' }] },
    { enabled: false, ai_match: false, conditions: [{ field: 'body_excludes' }] },
    { enabled: true, ai_match: false, conditions: [{ field: 'from' }] },
  ]) && !rulesReadBody(null));

  // A fake PostgREST: records every call; answers `in('id', …)` from a table.
  type Call = { cols: string; ops: string[] };
  const table = new Map<string, Record<string, unknown>>(Array.from({ length: 450 }, (_, i) => {
    const id = `id${String(i).padStart(4, '0')}`;
    return [id, { id, work_title: `t${i}`, subject: `s${i}`, body: `b${i}` }];
  }));
  const calls: Call[] = [];
  const fake = (failOn?: (c: Call) => boolean) => ({
    from: () => ({
      select: (cols: string) => {
        const call: Call = { cols, ops: [] }; calls.push(call);
        let ids: string[] = [];
        const b: Record<string, unknown> = {
          eq: () => { call.ops.push('eq'); return b; },
          in: (_c: string, v: string[]) => { call.ops.push('in'); ids = v; return b; },
          order: () => { call.ops.push('order'); return b; },
          then: (res: (v: unknown) => unknown) => {
            if (failOn?.(call)) return Promise.resolve(res({ data: null, error: { message: 'boom' } }));
            const want = cols.split(',').map((c) => c.trim().replace('source_data->', ''));
            return Promise.resolve(res({ data: ids.map((id) => table.get(id)).filter(Boolean).map((r) => Object.fromEntries(want.map((k) => [k, (r as Record<string, unknown>)[k] ?? null]))), error: null }));
          },
        };
        return b;
      },
    }),
  });
  const order = [...table.keys()].reverse(); // the id page order (e.g. newest-first)
  const pageIds = (from: number, to: number) => Promise.resolve({ data: order.slice(from, to + 1).map((id) => ({ id })), error: null });
  calls.length = 0;
  const pool = await readLeanPool(fake(), 'u', pageIds, 'work_title', { keys: ['subject'], maxRows: 6000, chunk: 100 });
  ok('readLeanPool returns every row, in the id page order', pool.length === 450 && pool.every((r, i) => r.id === order[i]));
  ok('…each row projected exactly once, by id, with no sort on the projection', calls.length === 5 && calls.every((c) => c.ops.includes('in') && !c.ops.includes('order')));
  ok('…folded lean, with the reader\'s set only', pool.every((r) => isLeanSource(r.source_data) && !('body' in r.source_data) && typeof r.source_data.subject === 'string'));
  let poolThrew = false;
  try { await readLeanPool(fake(() => true), 'u', pageIds, 'work_title', { keys: ['subject'], maxRows: 6000 }); } catch { poolThrew = true; }
  ok('…a failed chunk THROWS (a pool that silently lost rows would count wrong)', poolThrew);
  let capped = 0;
  const rows = foldLeanRows([...table.values()].slice(0, 30).map((r) => ({ id: r.id, subject: r.subject })), { keys: ['subject'] });
  const warn = console.warn; console.warn = () => { capped++; };
  const h = await hydrateSource(fake(), 'u', rows, ['body'], 10);
  console.warn = warn;
  ok('hydrateSource reads only the missing key, for at most `max` rows, and REPORTS the rest', h.read === 10 && h.leftBehind === 20 && capped === 1
    && rows.slice(0, 10).every((r) => typeof r.source_data.body === 'string') && rows.slice(10).every((r) => !('body' in r.source_data)));
  calls.length = 0;
  const again = await hydrateSource(fake(), 'u', rows.slice(0, 10), ['body'], 10);
  ok('…and never re-reads a key the row already carries', again.read === 0 && calls.length === 0);

  console.log('\nH8 — the fence is wired');
  const heldRoute = read('app/api/home/held/route.ts');
  const brief = read('app/api/home/brief/route.ts');
  ok('the held route hydrates the rendered rows before building the payload',
    /await hydrateHeldBodies\(supabase, user\.id, derived, todayISO, \{ perClass, offset \}\);\s*return buildHeldPayload\(/.test(heldRoute));
  ok('the brief\'s ledger prime hydrates before storing', /await hydrateHeldBodies\(supabase, user\.id, c\.derived, todayStr\);\s*await storeHeldCache\(/.test(brief));
  ok('the brief\'s deck pool reads DECK_KEYS (+ body), the FYI pool FYI_KEYS, commitments by column',
    /keys: DECK_KEYS, withBody: true/.test(brief) && /keys: FYI_KEYS/.test(brief) && /select\(OPEN_COMMITMENT_COLS\)/.test(brief) && !/from\('commitments'\)\.select\('\*'\)/.test(brief));
  const dcr = read('lib/triage/deck-context-read.ts');
  ok('the deck-context thread listing is body-free; bodies are read for the chosen emails only',
    /const EMAIL_COLS = 'id, thread_id, from_name, from_address, received_at, is_from_user';/.test(dcr) && /select\('id, body'\)\.eq\('user_id', userId\)\.in\('id', bodyIds\)/.test(dcr));
  // ⟲ RE-POINTED (W14.1): the ONE reader reads READER_FACT_KEYS (PREPARED + the notice law's facts +
  // the thread for the exact ground) — still a projection, never the whole source_data.
  ok('the prepared batch reader reads a declared lean key set and hydrates an invite\'s words', /keys: READER_FACT_KEYS/.test(read('lib/prepare/read.ts')) && /const READER_FACT_KEYS: readonly string\[\] = \[\.\.\.ONE_READER_KEYS, 'thread_id'\];/.test(read('lib/prepare/read.ts')) && /some\(\(a\) => a\.kind === 'invite'\)/.test(read('lib/prepare/read.ts')));
  ok('the anchor row (the view door, the warm, the open kick) folds through foldAnchorRow',
    ['app/api/items/view/route.ts', 'lib/room/open-kicks.ts', 'lib/room/warm-briefs.ts'].every((f) => /foldAnchorRow\(linkKind,/.test(read(f))));

  console.log(`\nsmoke-hot-paths: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
pure().catch((e) => { console.error(e); process.exit(1); });
