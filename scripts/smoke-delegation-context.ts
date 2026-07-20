// READ-ONLY cross-user smoke for Step 4 (grounded delegation). Exercises the SAME path the delegate route
// uses: buildItemContext → its participants → renderBrainContext (the person brain). Confirms a delegated
// coworker would receive relationship grounding, and that the INITIATIVE brain is already inside itemContext.
// No writes, no coworker run, no AI.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildItemContext } from '../lib/home/item-context';
import { renderBrainContext } from '../lib/context/brain-context';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { data: psUsers } = await sb.from('person_state').select('user_id').limit(20000);
  const userIds = [...new Set((psUsers ?? []).map((r: any) => r.user_id))];

  let tot = 0, withPerson = 0, withInitiativeInCtx = 0, shown = 0;

  for (const uid of userIds) {
    const { data: items } = await sb.from('inbox_items').select('id').eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(25);
    let up = 0;
    for (const it of (items ?? []) as any[]) {
      tot++;
      const ctx = await buildItemContext(sb, uid, 'email', it.id);
      if (!ctx) continue;
      const initInCtx = ctx.text.includes('[INITIATIVE —');
      if (initInCtx) withInitiativeInCtx++;
      const primary = (ctx.participants ?? []).find((p) => p.email) ?? (ctx.participants ?? [])[0];
      if (!primary) continue;
      const brain = await renderBrainContext(sb, uid, { personEmail: primary.email ?? null, personName: primary.name ?? null });
      if (brain) {
        withPerson++; up++;
        if (shown < 4) { shown++; console.log(`\n─── delegated grounding (person brain injected into the prompt) ───\n` + brain.split('\n').slice(0, 6).map((l) => '  ' + l).join('\n') + (initInCtx ? '\n  …+ [INITIATIVE brain already in itemContext]' : '')); }
      }
    }
    console.log(`\nuser ${uid.slice(0, 8)} — items:${(items ?? []).length} would-get-person-grounding:${up}`);
  }

  console.log('\n════ TOTALS ════');
  console.log(`items checked: ${tot}  ·  delegated coworker gets PERSON grounding: ${withPerson} (${tot ? Math.round(100*withPerson/tot) : 0}%)  ·  INITIATIVE brain already in itemContext: ${withInitiativeInCtx}`);
})();
