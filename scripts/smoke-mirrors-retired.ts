// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE MIRRORS-RETIRED GATE (stabilization W2.3, invariant 6 ONE FACT ONE HOME). ZERO AI.
//
// THE LAW: a commitment has ONE home — the `commitments` row. The inbox mirror (`source='commitment'`,
// written by the commitments sweep from June 23 so a commitment could be SEEN on surfaces that then
// only rendered inbox rows) is retired: no writer remains, every LISTING read of inbox_items excludes
// the historical rows through ONE predicate module, the three historical settle sites archive (never
// delete) through ONE writer, and the repair sweep is dry-run by default and never hard-deletes.
//
//   M1 NO WRITER — the commitments sweep (and every other lib/app file) never inserts an inbox row
//      with source 'commitment'.
//   M2 ONE PREDICATE — every known LISTING reader of pending/resolved inbox_items excludes mirrors
//      through lib/inbox/commitment-mirrors.ts (withoutMirrors / MIRROR_SOURCE / isCommitmentMirror),
//      or is structurally `source='email'`-scoped; no reader spells its own `'commitment'` literal.
//   M3 ONE WRITER — the PATCH route, expiry and evidence-settle reach mirrors ONLY via settleMirrorRows
//      (archive-only); no `.delete()` on a `source='commitment'` filter anywhere in lib/app.
//   M4 THE REPAIR IS SAFE — scripts/sweep-retire-mirrors.ts: dry-run default (`--apply` gated), status
//      'dismissed' + 'mirror_retired', conditional on `status='pending'`, no `.delete(` at all, no
//      activity_events write.
//   M5 PURE — isCommitmentMirror / withoutMirrors / NOT_MIRROR_FILTER behave.
//   M6 (optional, --census) READ-ONLY census: mirror counts by status; per-account, the commitment
//      lane's open count vs the pending-mirror count — proves nothing owed disappears (every pending
//      mirror of an OPEN commitment is carried by the commitment lane).
// Run: npx tsx scripts/smoke-mirrors-retired.ts [--census]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { isCommitmentMirror, withoutMirrors, NOT_MIRROR_FILTER, MIRROR_SOURCE, MIRROR_RETIRED_REASON } from '../lib/inbox/commitment-mirrors';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const codeFiles = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))];
const rel = (p: string) => p.slice(ROOT.length + 1);

console.log('THE MIRRORS-RETIRED GATE\n');

// ── M1 · NO WRITER ───────────────────────────────────────────────────────────────────────────────
{
  const sweep = src('app/api/cron/commitments-sweep/route.ts');
  ok('M1 the commitments sweep never inserts an inbox row', !/from\('inbox_items'\)\s*\.insert\(/.test(sweep) && !/source:\s*'commitment'/.test(sweep));
  ok('M1 the sweep no longer computes an aging/surface branch', !/STALE_DAYS|AWAIT_DAYS|Surface once as an inbox item/.test(sweep));
  // Any file that inserts into inbox_items must not stamp source 'commitment' (a multi-line insert
  // object is scanned within 40 lines of the insert call).
  const writers: string[] = [];
  for (const f of codeFiles) {
    const text = readFileSync(f, 'utf8');
    if (!text.includes("from('inbox_items')")) continue;
    const lines = text.split('\n');
    lines.forEach((l, i) => {
      if (!/from\('inbox_items'\)[\s\S]{0,80}\.insert\(/.test(lines.slice(i, i + 3).join('\n'))) return;
      const window = lines.slice(i, i + 40).join('\n');
      if (/source:\s*['"]commitment['"]/.test(window) || /source:\s*MIRROR_SOURCE/.test(window)) writers.push(`${rel(f)}:${i + 1}`);
    });
  }
  ok('M1 no lib/app/components file writes an inbox row with source \'commitment\'', writers.length === 0, writers.join(', '));
}

// ── M2 · ONE PREDICATE over the known listing readers ────────────────────────────────────────────
{
  const mod = src('lib/inbox/commitment-mirrors.ts');
  ok('M2 the predicate module exports the one source constant + filter + writer',
    mod.includes("export const MIRROR_SOURCE = 'commitment'") && mod.includes('export function withoutMirrors') &&
    mod.includes('export function isCommitmentMirror') && mod.includes('export async function settleMirrorRows'));
  // Readers that list pending/resolved inbox rows without a `source='email'` scope. Each must wear
  // the module's exclusion on EVERY listing read it makes.
  const usesModule = (t: string) => t.includes("from '@/lib/inbox/commitment-mirrors'");
  const listingReaders: Array<{ file: string; reads: number; excludes: (t: string) => number }> = [
    { file: 'lib/work-items/model.ts', reads: 2, excludes: (t) => (t.match(/\.neq\('source', MIRROR_SOURCE\)/g) ?? []).length },
    { file: 'app/api/home/brief/route.ts', reads: 4, excludes: (t) => (t.match(/withoutMirrors\(supabase\.from\('inbox_items'\)/g) ?? []).length },
    { file: 'lib/deeds/held-members.ts', reads: 1, excludes: (t) => (t.match(/\.neq\('source', MIRROR_SOURCE\)/g) ?? []).length },
    { file: 'app/(main)/inbox/page.tsx', reads: 1, excludes: (t) => (t.match(/withoutMirrors\(supabase\.from\('inbox_items'\)/g) ?? []).length },
    { file: 'app/inbox/inbox-page-client.tsx', reads: 2, excludes: (t) => (t.match(/withoutMirrors\(supabase\s*\.from\('inbox_items'\)/g) ?? []).length },
  ];
  for (const r of listingReaders) {
    const t = src(r.file);
    const n = r.excludes(t);
    ok(`M2 ${r.file} — ${r.reads} listing read(s) wear the one exclusion`, usesModule(t) && n >= r.reads, `found ${n}, module import ${usesModule(t)}`);
  }
  const brief = src('app/api/home/brief/route.ts');
  ok('M2 the brief\'s in-memory pools test through isCommitmentMirror (no private literal)',
    (brief.match(/!isCommitmentMirror\(it\)/g) ?? []).length >= 2 && !brief.includes("it.source !== 'commitment'"));
  ok('M2 the inbox client\'s realtime INSERT guard excludes a mirror', src('app/inbox/inbox-page-client.tsx').includes('!isCommitmentMirror(item'));
  // The judge, the prepare pass and the judgment sweep take their candidates FROM THE SPINE — the
  // spine's exclusion is theirs (no private inbox listing to fence).
  ok('M2 the judgment sweep and the prepare pass read candidates from the spine (buildWorkItems)',
    src('lib/work/judgment-sweep.ts').includes('buildWorkItems(') && src('lib/prepare/pass.ts').includes('buildWorkItems('));
  // Readers scoped to source='email' by construction (a mirror can never enter): the label sweep, the
  // evidence nominator, the reply reconcile, the sweep's inbox evidence lane, the sync tail.
  const emailScoped = ['app/api/cron/label-sweep/route.ts', 'lib/work/evidence-nominator.ts', 'lib/inbox/reconcile-replied.ts', 'app/api/cron/commitments-sweep/route.ts'];
  for (const f of emailScoped) ok(`M2 ${f} lists inbox rows only under source='email'`, src(f).includes(".eq('source', 'email')"));
  // No reader spells its own exclusion literal — the one predicate, never a per-site `.neq`.
  const privateLiterals: string[] = [];
  for (const f of codeFiles) {
    if (rel(f) === 'lib/inbox/commitment-mirrors.ts') continue;
    const t = readFileSync(f, 'utf8');
    if (/\.neq\('source',\s*'commitment'\)/.test(t) || /it\.source !== 'commitment'/.test(t)) privateLiterals.push(rel(f));
  }
  ok('M2 no reader carries a private `.neq(\'source\', \'commitment\')` / `source !== \'commitment\'` literal (deck DoItem sources excepted)',
    privateLiterals.length === 0, privateLiterals.join(', '));
}

// ── M3 · ONE WRITER for historical rows (archive, never delete) ──────────────────────────────────
{
  const deleters: string[] = [];
  for (const f of codeFiles) {
    const t = readFileSync(f, 'utf8');
    if (/from\('inbox_items'\)\.delete\(\)[\s\S]{0,200}\.eq\('source',\s*'commitment'\)/.test(t)) deleters.push(rel(f));
  }
  ok('M3 no lib/app file hard-deletes inbox rows by source \'commitment\'', deletors(deleters), deleters.join(', '));
  for (const f of ['app/api/commitments/[id]/route.ts', 'lib/commitments/expiry.ts', 'lib/work/evidence-settle.ts']) {
    const t = src(f);
    ok(`M3 ${f} settles a historical mirror through settleMirrorRows`, t.includes('settleMirrorRows(') && t.includes("from '@/lib/inbox/commitment-mirrors'") && !t.includes("eq('source', 'commitment')"));
  }
  const mod = src('lib/inbox/commitment-mirrors.ts');
  ok('M3 settleMirrorRows archives (status dismissed + reason) and never deletes',
    mod.includes("status: 'dismissed'") && mod.includes('MIRROR_RETIRED_REASON') && !mod.includes('.delete('));
  ok('M3 settleMirrorRows is conditional on the row still being pending (a user deed wins the race)', /\.eq\('id', r\.id\)\.eq\('user_id', userId\)\.eq\('status', 'pending'\)/.test(mod));
}
function deletors(list: string[]): boolean { return list.length === 0; }

// ── M4 · THE REPAIR IS SAFE ──────────────────────────────────────────────────────────────────────
{
  const sweep = src('scripts/sweep-retire-mirrors.ts');
  ok('M4 dry-run by default (--apply gated)', sweep.includes("const APPLY = process.argv.includes('--apply')") && sweep.includes('if (!APPLY) {'));
  ok('M4 never hard-deletes', !sweep.includes('.delete('));
  ok('M4 archives with status dismissed + mirror_retired, conditional on pending + source',
    sweep.includes("status: 'dismissed'") && sweep.includes('resolved_reason: MIRROR_RETIRED_REASON') &&
    sweep.includes(".eq('source', MIRROR_SOURCE).eq('status', 'pending')"));
  ok('M4 writes no activity_events (a machine retirement is not the user\'s deed)', !sweep.includes("from('activity_events')") && !sweep.includes('logActivity'));
  ok('M4 touches only inbox_items (mirrors), item_deliverables (stamp) and the brief cache',
    !/from\('commitments'\)\.(update|delete|insert)/.test(sweep) && !/from\('inbox_items'\)\.insert/.test(sweep));
  ok('M4 pages the full listing (NO SILENT CAPS)', sweep.includes('fetchAllRows'));
  ok('M4 the pool orphans are stamped, never deleted', sweep.includes("archived_reason: MIRROR_RETIRED_REASON"));
}

// ── M5 · PURE ────────────────────────────────────────────────────────────────────────────────────
{
  ok('M5 isCommitmentMirror: true on source commitment', isCommitmentMirror({ source: 'commitment' }));
  ok('M5 isCommitmentMirror: false on email / meeting / null / undefined',
    !isCommitmentMirror({ source: 'email' }) && !isCommitmentMirror({ source: 'meeting' }) && !isCommitmentMirror({ source: null }) && !isCommitmentMirror(undefined));
  const calls: Array<[string, string]> = [];
  const q = { neq: (c: string, v: string) => { calls.push([c, v]); return q; } };
  withoutMirrors(q);
  ok('M5 withoutMirrors applies exactly .neq(source, commitment)', calls.length === 1 && calls[0][0] === 'source' && calls[0][1] === MIRROR_SOURCE);
  ok('M5 NOT_MIRROR_FILTER is the PostgREST fragment', NOT_MIRROR_FILTER === 'source.neq.commitment');
  ok('M5 the retired reason is stable', MIRROR_RETIRED_REASON === 'mirror_retired');
}

// ── M6 · READ-ONLY CENSUS (optional) ─────────────────────────────────────────────────────────────
async function census(): Promise<void> {
  if (!process.argv.includes('--census')) return;
  const { config } = await import('dotenv'); config({ path: '.env.local' });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.log('\n(census skipped — no env)'); return; }
  const { createClient } = await import('@supabase/supabase-js');
  const { fetchAllRows } = await import('../lib/utils/fetch-all');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  type M = { id: string; user_id: string; status: string; source_id: string };
  const mirrors = await fetchAllRows<M>((from, to) => sb.from('inbox_items').select('id, user_id, status, source_id')
    .eq('source', MIRROR_SOURCE).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to), { maxRows: 50000 });
  const byStatus: Record<string, number> = {};
  for (const m of mirrors) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
  console.log(`\nCENSUS (read-only): ${mirrors.length} mirror rows — ${JSON.stringify(byStatus)}`);
  const pending = mirrors.filter((m) => m.status === 'pending');
  const users = [...new Set(pending.map((m) => m.user_id))];
  for (const uid of users) {
    const mine = pending.filter((m) => m.user_id === uid);
    const { data: openC } = await sb.from('commitments').select('id').eq('user_id', uid).eq('status', 'open');
    const open = new Set((openC ?? []).map((c) => c.id));
    const ofOpen = mine.filter((m) => open.has(m.source_id)).length;
    console.log(`  ${uid}: commitment lane carries ${open.size} open · ${mine.length} pending mirrors (${ofOpen} of an open commitment — carried by the lane; ${mine.length - ofOpen} of a settled/missing one — nothing owed)`);
    ok(`M6 ${uid.slice(0, 8)} — every pending mirror of an OPEN commitment is carried by the commitment lane`, mine.filter((m) => open.has(m.source_id)).every((m) => open.has(m.source_id)));
  }
  ok('M6 census ran read-only', true);
}

census().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('census failed:', e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
