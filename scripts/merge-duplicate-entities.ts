// NEAR-NAME DUPLICATE MERGE (the "ACME" / "Acme AI Agent System" near-name class). Conservative:
// only merges an UNTRACKED entity INTO a TRACKED one when the shorter name's tokens are a subset
// of the longer's (the same deterministic recognition the founding proposal uses) — the tracked
// project is the user's declared container; the untracked twin is recognition's duplicate.
// Uses THE ONE absorb mechanic. Dry-run default.
// Usage: npx tsx scripts/merge-duplicate-entities.ts [--user <uid>] [--apply]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { absorbEntity } from '../lib/entities/reflect';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t.length > 2);

(async () => {
  const { data: profs } = await sb.from('profiles').select('id, email');
  for (const p of (profs ?? []) as Array<{ id: string; email: string | null }>) {
    if (ONLY && p.id !== ONLY) continue;
    const companyTok = (String(p.email ?? '').split('@')[1]?.split('.')[0] ?? '').toLowerCase();
    const { data: ents } = await sb.from('work_entities').select('id, name, tracked, aliases')
      .eq('user_id', p.id).eq('kind', 'initiative').eq('status', 'active').limit(500);
    const rows = (ents ?? []) as Array<{ id: string; name: string; tracked: boolean; aliases: unknown }>;
    const tracked = rows.filter((e) => e.tracked);
    const untracked = rows.filter((e) => !e.tracked);
    for (const t of tracked) {
      const tToks = norm(t.name);
      for (const u of untracked) {
        const forms = [u.name, ...(Array.isArray(u.aliases) ? (u.aliases as string[]) : [])];
        const match = forms.some((f) => {
          const ft = norm(f);
          if (!ft.length || !tToks.length) return false;
          const [short, long] = tToks.length <= ft.length ? [tToks, new Set(ft)] : [ft, new Set(tToks)];
          return short.every((tok) => long.has(tok)) && short.some((tok) => tok !== companyTok);
        });
        if (!match) continue;
        console.log(`${p.id.slice(0, 8)}: "${u.name}" → INTO tracked "${t.name}" ${APPLY ? '' : '(dry-run)'}`);
        if (APPLY) {
          const r = await absorbEntity(sb, p.id, t.id, u.id);
          console.log(`  ${r.ok ? 'merged' : 'FAILED'}`);
        }
      }
    }
  }
  process.exit(0);
})();
