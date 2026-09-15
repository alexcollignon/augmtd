// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BARE-MARKET-NOTE RULE PATCH (Sep 15). Fixture round 5 (PT) leaked a two-sentence
// "Petróleo da OPEP sobe 5,6%…" note with NO stated consequence for companies in scope — the
// third-country rules name subjects (Chinese milestone, foreign yields) but not the bare
// market/commodity-note shape, so the gate let it stand. This patch REPLACES the third-country
// rule text on Thorsten's two briefing verify steps with a version naming that shape, kept
// ≤480 chars (the gate's v6 render width). Idempotent by exact-match; --rollback restores the
// original text verbatim.
//
// Run:  npx tsx --env-file=.env.local scripts/tmp-ahk-thirdcountry-rule-patch.ts [--rollback] [--dry]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const THORSTEN = '9d3921b2-5a52-4b5b-9815-bc49d37ce0a7';
const ROLLBACK = process.argv.includes('--rollback');
const DRY = process.argv.includes('--dry');

const SWAPS: Array<{ wf: string; old: string; neu: string }> = [
  {
    wf: 'AHK Executive Briefing',
    old:
      "Relevance: remove every item, bullet, and Ausblick entry whose SUBJECT is a third country's own economy or policy (a Japanese rate move, a foreign GDP release) with no concrete stated consequence for companies in Portugal. A Portuguese company expanding abroad stays. An emptied section keeps its honest one-line note.",
    neu:
      "Relevance: remove every item, bullet, and Ausblick entry whose SUBJECT is a third country's own economy or policy (a Japanese rate move, a foreign GDP release) with no concrete stated consequence for companies in Portugal — and remove a bare market or commodity note (an oil price, foreign rates) that states no such consequence. A Portuguese company expanding abroad stays. An emptied section keeps its honest one-line note.",
  },
  {
    wf: 'AHK Mercado Alemão',
    old:
      "Relevance: remove every item, bullet, and Próxima-Semana entry whose SUBJECT is a third country's own economy or policy (outside Germany, the EU, and Portugal) — UNCONDITIONALLY, regardless of how good its relevance paragraph is (a Chinese energy milestone, Japanese bond yields, a foreign GDP release always go). The only exception: a Portuguese or German company operating or expanding abroad stays. An emptied section keeps its honest one-line note ('Sem eventos verificáveis esta semana.').",
    neu:
      "Relevance: remove every item, bullet, and Próxima-Semana entry whose SUBJECT is a third country's own economy or policy (outside Germany, the EU and Portugal), UNCONDITIONALLY, however good its relevance paragraph: a Chinese energy milestone or foreign bond yields always go, and so does a bare market or commodity note (an oil price, foreign rates) with no stated consequence for companies in scope. Only a Portuguese or German company operating abroad stays.",
  },
];

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`${ROLLBACK ? 'ROLLBACK' : 'PATCH'}${DRY ? ' (dry)' : ''} — third-country rule, Thorsten\n`);
  for (const s of SWAPS) {
    const from = ROLLBACK ? s.neu : s.old;
    const to = ROLLBACK ? s.old : s.neu;
    if (to.length > 480) { console.log(`✗ ${s.wf}: replacement is ${to.length} chars (>480 render width)`); process.exitCode = 1; continue; }
    const { data: wf, error } = await sb.from('workflows').select('id, steps')
      .eq('user_id', THORSTEN).eq('name', s.wf).single();
    if (error || !wf) { console.log(`✗ ${s.wf}: not found (${error?.message})`); process.exitCode = 1; continue; }
    const steps = wf.steps as Array<Record<string, unknown>>;
    const verify = steps.find(st => st.type === 'verify');
    if (!verify || !Array.isArray(verify.rules)) { console.log(`✗ ${s.wf}: no verify step with rules`); process.exitCode = 1; continue; }
    const rules = verify.rules as string[];
    const iTo = rules.findIndex(r => r === to);
    if (iTo >= 0) { console.log(`  = ${s.wf}: target text already in place (idempotent skip)`); continue; }
    const i = rules.findIndex(r => r === from);
    if (i < 0) { console.log(`✗ ${s.wf}: expected rule text not found verbatim — NOT touching`); process.exitCode = 1; continue; }
    rules[i] = to;
    if (DRY) { console.log(`  ~ ${s.wf}: would replace rule R${i + 1} (${from.length} → ${to.length} chars)`); continue; }
    const { error: ue } = await sb.from('workflows').update({ steps }).eq('id', wf.id);
    if (ue) { console.log(`✗ ${s.wf}: UPDATE failed ${ue.message}`); process.exitCode = 1; continue; }
    console.log(`  ✓ ${s.wf} [${String(wf.id).slice(0, 8)}]: rule R${i + 1} replaced (${from.length} → ${to.length} chars)`);
  }
}
main().then(() => process.exit(process.exitCode ?? 0)).catch(e => { console.error('FAILED:', e); process.exit(1); });
