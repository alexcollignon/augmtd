// PROJECTHOOD BACKFILL (projecthood-plan P1) — re-synthesize every active initiative through the
// NORMAL sig-gated path (STATE_PROMPT_VERSION 4 makes each sig stale, so this is just "run the
// refresh now instead of waiting for natural traffic"), then report the scope distribution per user.
// Usage: npx tsx scripts/backfill-entity-scope.ts [--user <uid>]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { refreshEntityState } from '../lib/entities/state';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const onlyUser = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  const { data: ents } = await sb.from('work_entities')
    .select('id, user_id, name, tracked').eq('kind', 'initiative').eq('status', 'active');
  const rows = (ents ?? []).filter((e) => !onlyUser || e.user_id === onlyUser);
  const byUser = new Map<string, typeof rows>();
  for (const e of rows) (byUser.get(e.user_id as string) ?? byUser.set(e.user_id as string, []).get(e.user_id as string)!).push(e);

  for (const [uid, list] of byUser) {
    const CH = 4;
    for (let i = 0; i < list.length; i += CH) {
      await Promise.all(list.slice(i, i + CH).map((e) => refreshEntityState(sb, uid, e.id as string)));
      process.stdout.write(`\r${uid.slice(0, 8)} · ${Math.min(i + CH, list.length)}/${list.length}   `);
    }
    // Report
    const { data: after } = await sb.from('work_entities').select('id, name, tracked, state, status')
      .eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active');
    const dist: Record<string, string[]> = { project: [], errand: [], background: [], missing: [] };
    for (const e of (after ?? []) as Array<{ name: string; tracked: boolean; state: { scope?: string } | null }>) {
      const sc = e.state?.scope ?? 'missing';
      (dist[sc] ?? dist.missing).push(String(e.name));
    }
    console.log(`\n══ ${uid.slice(0, 8)} — ${(after ?? []).length} active initiatives ══`);
    for (const k of ['project', 'errand', 'background', 'missing']) {
      console.log(`  ${k}: ${dist[k].length}${dist[k].length ? ` — ${dist[k].slice(0, 8).map((n) => n.slice(0, 34)).join(' | ')}${dist[k].length > 8 ? ' …' : ''}` : ''}`);
    }
  }
  process.exit(0);
})();
