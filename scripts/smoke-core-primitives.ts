// smoke-core-primitives.ts — W1.6 SHARED PRIMITIVES + NO SILENT CAPS gate.
//
// ZERO AI, ZERO DB. Two kinds of checks:
//   (1) SOURCE CHECKS — grep the tree for the local-definition shapes that used to be duplicated,
//       and fail if a NEW one shows up outside lib/core/ (or the explicitly listed to-fold-later
//       sites this wave could not touch — see docs/stabilization-plan.md PART III W1.6, out-of-fence
//       files owned by other concurrent agents).
//   (2) PURE CHECKS — the lib/core/email.ts functions behave as documented.
//
// Run: npx tsx scripts/smoke-core-primitives.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  isEmail, isEmailStrict, firstEmailIn, firstEmailTrimmed, looksLikeEmail,
  allEmailsLoose, emailsIn, emailsInDelimited, normalizeEmail,
} from '../lib/core/email';

const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

// ── file walk (lib/ + app/api, skip node_modules and this file's own project scratch dirs) ──
function walk(dir: string, files: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return files; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, files);
    else if (/\.(ts|tsx)$/.test(e)) files.push(p);
  }
  return files;
}

const ROOT = join(__dirname, '..');
const targetDirs = ['lib', 'app'].map((d) => join(ROOT, d));
const allFiles = targetDirs.flatMap((d) => walk(d));

// Sites this wave found but could not touch (DO-NOT-TOUCH fence for other in-flight agents, or a
// deliberate cross-language restatement) — listed once here so the gate documents debt instead of
// silently accepting it forever.
const EMAIL_RE_TO_FOLD_LATER = new Set([
  join(ROOT, 'lib/converse/hands.ts'),           // DO-NOT-TOUCH this wave; restates STANDARD_EXTRACT_RE on purpose
  join(ROOT, 'app/api/compose/send/route.ts'),   // DO-NOT-TOUCH this wave; restates STRICT_WHOLE_RE
]);

// ── SOURCE CHECK 1: no local `const EMAIL_RE = ...` outside lib/core/email.ts + the fold-later list ──
{
  const offenders: string[] = [];
  for (const f of allFiles) {
    if (f === join(ROOT, 'lib/core/email.ts')) continue;
    if (EMAIL_RE_TO_FOLD_LATER.has(f)) continue;
    const text = readFileSync(f, 'utf8');
    if (/const\s+EMAIL_RE\s*=/.test(text)) offenders.push(f.replace(ROOT + '/', ''));
  }
  check('no local EMAIL_RE definitions outside lib/core/email.ts (+ documented to-fold-later)', offenders.length === 0, offenders.join(', '));
}

// ── SOURCE CHECK 2: the automated-sender pattern lists are single-sourced ──
{
  const automated = readFileSync(join(ROOT, 'lib/inbox/automated.ts'), 'utf8');
  const notice = readFileSync(join(ROOT, 'lib/inbox/notice-demotion.ts'), 'utf8');
  check('lib/inbox/automated.ts imports the shared sender patterns (no local addrPatterns array)',
    automated.includes("from '@/lib/core/senders'") && !/const\s+addrPatterns\s*=/.test(automated));
  check('lib/inbox/notice-demotion.ts imports the shared sender patterns (no local addrPatterns array)',
    notice.includes("from '@/lib/core/senders'") && !/const\s+addrPatterns\s*=/.test(notice));
}

// ── SOURCE CHECK 3: the NO-SILENT-CAPS paging sites actually page ──
{
  const pagingSites = [
    'lib/work/sweep-users.ts',
    'lib/entities/people.ts',
    // ⟲ RE-POINTED (W7.1): the commitments sweep is a dispatcher; its full-listing reads (every open
    // commitment + actionable item of an account, the dispatch set) live in the per-account pass.
    'lib/work/evidence-sweep.ts',
    'lib/company/ai-operations-metrics.ts',
    'lib/platform/status.ts',
  ];
  for (const rel of pagingSites) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    check(`${rel} uses fetchAllRows for its full-listing reads`, text.includes('fetchAllRows'));
  }
}

// ── SOURCE CHECK 4: W1.6b — the second sweep's paging sites actually page ──
{
  const pagingSites = [
    'lib/inbox/conversation-identity.ts',   // readSiblingNominations
    'lib/room/turns.ts',                    // listRoomSessions
    'lib/entities/founding.ts',             // proposeFoundingAdoptions near-name candidates
    'lib/entities/self.ts',                 // ensureSelfEntity's person-entity listing
    'lib/work-items/model.ts',              // manual-priority commitments listing
    'app/api/entities/portfolio/route.ts',  // entities + entity_links + per-kind item reads
    'app/api/workflows/[id]/route.ts',      // DELETE's workflow_runs id listing
    'app/api/home/brief/route.ts',          // bundle-entities + bundle atom→entity link reads
    'app/api/internal/backfill-intelligence/route.ts', // find-user-by-email connections listing
  ];
  for (const rel of pagingSites) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    check(`${rel} uses fetchAllRows for its full-listing reads (W1.6b)`, text.includes('fetchAllRows'));
  }
}

// ── SOURCE CHECK 5: W1.6b — bounded-working-set caps are NAMED, not bare magic numbers ──
{
  const deckFloors = readFileSync(join(ROOT, 'lib/home/deck-floors.ts'), 'utf8');
  for (const name of ['TRACKED_PROJECTS_LIMIT', 'FYI_POOL_LIMIT', 'BUNDLE_ENTITIES_LIMIT', 'BUNDLE_LINK_ATOMS_LIMIT']) {
    check(`lib/home/deck-floors.ts names its ${name} bound`, deckFloors.includes(`export const ${name}`));
  }
  const briefRoute = readFileSync(join(ROOT, 'app/api/home/brief/route.ts'), 'utf8');
  check('app/api/home/brief/route.ts uses the named brief bounds (no re-introduced bare .limit(100/200/400))',
    briefRoute.includes('TRACKED_PROJECTS_LIMIT') && briefRoute.includes('FYI_POOL_LIMIT') && briefRoute.includes('BUNDLE_ENTITIES_LIMIT'));
  const sweep = readFileSync(join(ROOT, 'lib/work/judgment-sweep.ts'), 'utf8');
  check('lib/work/judgment-sweep.ts names its meeting-anchor lookback bound', sweep.includes('MEETING_ANCHOR_ROW_LIMIT') && sweep.includes('MEETING_ANCHOR_LOOKBACK_DAYS'));
}

// ── PURE CHECKS: lib/core/email.ts behavior ──
check('isEmail: accepts loose shape', isEmail('a@b.co') === true);
check('isEmail: rejects whitespace', isEmail('a b@c.com') === false);
check('isEmail: accepts single-char TLD (loose, historical shape)', isEmail('a@b.c') === true);

check('isEmailStrict: accepts a normal address', isEmailStrict('a@b.com') === true);
check('isEmailStrict: rejects single-char TLD', isEmailStrict('a@b.c') === false);
check('isEmailStrict: rejects delimiter punctuation', isEmailStrict('a,b@c.com') === false);
check('isEmailStrict: case-insensitive TLD', isEmailStrict('a@b.COM') === true);

check('firstEmailIn: extracts from prose, no trim', firstEmailIn('reach me at a@b.com.') === 'a@b.com.');
check('firstEmailIn: null on no match', firstEmailIn('no address here') === null);
check('firstEmailIn: null on null input', firstEmailIn(null) === null);

check('firstEmailTrimmed: strips trailing punctuation', firstEmailTrimmed('reach me at a@b.com.') === 'a@b.com');
check('firstEmailTrimmed: strips trailing comma', firstEmailTrimmed('reach a@b.com, thanks') === 'a@b.com');

check('looksLikeEmail: substring test, unanchored', looksLikeEmail('Name <a@b.com>') === true);
check('looksLikeEmail: false on plain text', looksLikeEmail('just a name') === false);

check('allEmailsLoose: extracts every match', allEmailsLoose('a@b.com and c@d.com') .length === 2);
check('allEmailsLoose: empty array on no match', allEmailsLoose('nothing here').length === 0);
check('allEmailsLoose: empty array on null/empty input', allEmailsLoose('').length === 0);

check('emailsIn: lower-cases + dedupes', JSON.stringify(emailsIn('A@B.com a@b.com C@D.org')) === JSON.stringify(['a@b.com', 'c@d.org']));
check('emailsIn: requires 2+ char alpha TLD', emailsIn('a@b.c').length === 0);

check('emailsInDelimited: extracts, case-insensitive', emailsInDelimited('A@B.COM') .length === 1);
check('emailsInDelimited: excludes delimiter-adjacent text', emailsInDelimited('<a@b.com>,c@d.com;') .length === 2);

check('normalizeEmail: trims + lowercases', normalizeEmail('  A@B.COM  ') === 'a@b.com');

console.log('\n════ CORE PRIMITIVES GATES (W1.6) ════');
let pass = 0;
for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
console.log(`\n${pass}/${out.length} pass`);
process.exit(pass === out.length ? 0 : 1);
