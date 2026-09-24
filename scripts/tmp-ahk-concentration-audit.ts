// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONCENTRATION AUDIT — the same statistics the Sep 2 bias audit computed, recomputed from a
// report so before and after can be read side by side.
//
// Read-only. Parses the LAST run of a named workflow (or a markdown file passed with --file) and
// reports: match lines · distinct profiles · top-3 share · the size-band distribution of the
// matched profiles (read off the badges the report itself prints).
//
//   npx tsx --env-file=.env.local scripts/tmp-ahk-concentration-audit.ts [--file path.md]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const OWNER = '08fe4449-e5eb-431d-9156-02e9324e5903';
const NAME = 'AHK Tender Matching';
const argOf = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] ?? null : null; };

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** The audited baseline (Sep 2, before the fairness bundle). */
const BASELINE = {
  label: 'baseline (audited Sep 2)',
  lines: 60, distinct: 13, top3: 62,
  sizes: { '50–249': 26, '250+': 29, '10–49': 4 } as Record<string, number>,
};

const SIZE_BANDS = ['1–9', '10–49', '50–249', '250+'];

function statsOf(md: string) {
  // Match rows: "- **Name** (flags)" or "- **[Name](url)** (flags)", only inside a matches block.
  const counts = new Map<string, number>();
  const sizes: Record<string, number> = {};
  let lines = 0;
  for (const raw of md.split('\n')) {
    const m = /^- \*\*(?:\[([^\]]+)\]\([^)]*\)|([^*]+))\*\* \((.+)\)\s*$/.exec(raw.trim());
    if (!m) continue;
    const name = (m[1] ?? m[2] ?? '').trim();
    const flags = m[3];
    // The tail rows carry no grade word — a match line always leads with its grade.
    if (!/(strong fit|possible fit|starke Passung|mögliche Passung)/.test(flags)) continue;
    lines++;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    const band = SIZE_BANDS.find((b) => flags.includes(`${b} MA`)) ?? 'unbekannt';
    sizes[band] = (sizes[band] ?? 0) + 1;
  }
  const ordered = [...counts.values()].sort((a, b) => b - a);
  const top3 = lines ? Math.round((ordered.slice(0, 3).reduce((a, b) => a + b, 0) / lines) * 100) : 0;
  return { lines, distinct: counts.size, top3, sizes, counts };
}

const pad = (s: string, n: number) => s.padEnd(n);

(async () => {
  let md = '';
  let label = '';
  const file = argOf('--file');
  if (file) { md = readFileSync(file, 'utf-8'); label = `file ${file}`; }
  else {
    const { data: wf } = await sb.from('workflows').select('id').eq('user_id', OWNER).eq('name', NAME).maybeSingle();
    if (!wf) throw new Error(`no workflow "${NAME}" on the owner account`);
    const { data: runs } = await sb.from('workflow_runs')
      .select('id, status, created_at, step_outputs')
      .eq('workflow_id', wf.id).order('created_at', { ascending: false }).limit(1);
    const run = runs?.[0];
    if (!run) throw new Error('no runs');
    const outs = (run.step_outputs ?? []) as Array<{ output?: string }>;
    md = outs.map((o) => String(o?.output ?? '')).find((o) => /Matching profiles|Passende Profile/.test(o)) ?? '';
    label = `run ${String(run.id).slice(0, 8)} · ${run.status} · ${String(run.created_at).slice(0, 16)}`;
  }
  if (!md.trim()) throw new Error('no report markdown found');

  const now = statsOf(md);
  console.log(`\n═══ concentration audit — ${label}\n`);
  console.log(md.split('\n').filter((l) => /^(Spread:|Verteilung:|\*\*\d)/.test(l)).map((l) => `  ${l}`).join('\n'));

  console.log(`\n  ${pad('', 24)}${pad(BASELINE.label, 26)}after the fairness bundle`);
  const row = (k: string, a: string | number, b: string | number) =>
    console.log(`  ${pad(k, 24)}${pad(String(a), 26)}${b}`);
  row('match lines', BASELINE.lines, now.lines);
  row('distinct profiles', BASELINE.distinct, now.distinct);
  row('top-3 share', `${BASELINE.top3}%`, `${now.top3}%`);
  row('lines per profile', (BASELINE.lines / BASELINE.distinct).toFixed(1),
    now.distinct ? (now.lines / now.distinct).toFixed(1) : '—');
  console.log('\n  size distribution of matched profiles');
  for (const b of [...SIZE_BANDS, 'unbekannt']) {
    if (!BASELINE.sizes[b] && !now.sizes[b]) continue;
    row(`  ${b}`, BASELINE.sizes[b] ?? 0, now.sizes[b] ?? 0);
  }
  console.log('\n  most-matched profiles now:');
  for (const [n, c] of [...now.counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(c).padStart(3)} × ${n}`);
  }
  console.log('');
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
