// THE VERDICT SWEEP — run THE judge over each user's live working set and apply THE ONE
// consequence module (lib/work/apply-verdict.ts): expired/answered items resolve (logged,
// undoable, narrated); artifacts that contradict the verdict strip. Plus POOL HYGIENE for the
// pre-floor era: deliverables that are self-addressed or deliberation-monologue (the classes the
// evaluator's shape rule now blocks at generation) are removed.
// Usage: npx tsx scripts/sweep-verdict-consequences.ts [--user <uid>] [--apply]  (dry-run default)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildWorkItems } from '../lib/work-items/model';
import { judgeWork } from '../lib/work/judge';
import { applyVerdictConsequences } from '../lib/work/apply-verdict';
import { getPersonEntities, resolveIdentity } from '../lib/entities/people';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;
const CAP = 24; // the working set, not the inventory

// The pre-floor monologue tripwire (the DURABLE floor is the evaluator's reasoned shape rule —
// this only cleans the era before it existed).
const MONOLOGUE = /^(i need to|i should|let me|the instruction says|first, i|okay, i)/i;

(async () => {
  const { data: profs } = await sb.from('profiles').select('id');
  for (const p of (profs ?? []) as Array<{ id: string }>) {
    if (ONLY && p.id !== ONLY) continue;
    const uid = p.id;
    const todayStr = new Date().toISOString().slice(0, 10);
    let items;
    try { items = await buildWorkItems(sb, uid, { todayStr, skipReconcile: true }); } catch { continue; }
    const working = items
      .filter((w) => (w.state === 'todo' || w.state === 'waiting') && !w.automated && (w.id.startsWith('inbox:') || w.id.startsWith('commit:')))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .slice(0, CAP);
    let resolved = 0, stripped = 0;
    for (const w of working) {
      const input = { kind: w.id.startsWith('commit:') ? 'commitment' as const : 'inbox' as const, id: w.entityId };
      const v = await judgeWork(sb, uid, input);
      if (!APPLY) {
        if (v.work === 'none' && v.resolution) console.log(`  would resolve (${v.resolution}): ${w.title.slice(0, 60)}`);
        continue;
      }
      const cons = await applyVerdictConsequences(sb, uid, input, v);
      if (cons.resolved) { resolved++; console.log(`  resolved (${v.resolution}): ${w.title.slice(0, 60)}`); }
      if (cons.stripped.length) { stripped += cons.stripped.length; console.log(`  stripped ${cons.stripped.join('+')}: ${w.title.slice(0, 60)}`); }
    }

    // ── Pool hygiene: pre-floor deliverables that are monologue or self-addressed. ──
    let purged = 0;
    try {
      const persons = await getPersonEntities(sb, uid);
      const { data: dels } = await sb.from('item_deliverables').select('id, title, content, type')
        .eq('user_id', uid).in('type', ['draft', 'text']).limit(400);
      for (const d of (dels ?? []) as Array<Record<string, unknown>>) {
        const content = String(d.content ?? '').trim();
        if (!content) continue;
        const firstLine = content.split('\n')[0].trim();
        const greetName = /^(hi|hello|dear|bom dia|boa tarde|olá|ola)\s+([^\s,!.]+)/i.exec(firstLine)?.[2] ?? null;
        const selfAddressed = greetName ? resolveIdentity(persons, greetName).isSelf : false;
        const monologue = MONOLOGUE.test(firstLine);
        if (!selfAddressed && !monologue) continue;
        purged++;
        console.log(`  purge (${selfAddressed ? 'self-addressed' : 'monologue'}): "${content.replace(/\s+/g, ' ').slice(0, 70)}"`);
        if (APPLY) await sb.from('item_deliverables').delete().eq('id', d.id);
      }
    } catch { /* non-fatal */ }
    if (resolved || stripped || purged) console.log(`══ ${uid.slice(0, 8)}: resolved=${resolved} stripped=${stripped} purged=${purged}`);
  }
  process.exit(0);
})();
