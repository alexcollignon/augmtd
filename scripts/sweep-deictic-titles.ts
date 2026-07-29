// THE DEIXIS BACKFILL (proactive-team T-class). Stored titles written before the deixis law can
// carry decayed relative words ("Be at the meeting room at 12:30 PM tomorrow", minted Jul 27).
// This sweep rewrites them ABSOLUTE, anchored to each row's OWN source date — the same reasoned
// scrubber the extractor now runs at write time (lexical detection, reasoned rewrite, code-checked
// that the deixis is actually gone).
//
// Usage: npx tsx scripts/sweep-deictic-titles.ts <user_id|all> [--apply]   (dry-run by default)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { DEICTIC_RE, resolveDeixisInDescriptions } from '../lib/commitments/extract';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const target = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!target) { console.error('usage: sweep-deictic-titles.ts <user_id|all> [--apply]'); process.exit(1); }

(async () => {
  const users = target === 'all'
    ? ((await sb.from('profiles').select('id')).data ?? []).map((p) => p.id as string)
    : [target];
  console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'} deixis backfill for ${users.length} user(s)\n`);
  let fixed = 0;

  for (const uid of users) {
    // 1 — open commitments with deictic descriptions (anchor = created_at).
    const { data: commits } = await sb.from('commitments').select('id, description, created_at')
      .eq('user_id', uid).in('status', ['open', 'pending', 'in_progress', 'suggested']).limit(400);
    for (const c of (commits ?? []) as Array<{ id: string; description: string; created_at: string }>) {
      if (!DEICTIC_RE.test(c.description || '')) continue;
      const [fixedRow] = await resolveDeixisInDescriptions(sb, uid, [{ description: c.description }], c.created_at);
      if (fixedRow.description === c.description) { console.log(`  [skip] could not resolve: "${c.description.slice(0, 70)}"`); continue; }
      console.log(`  [commitment] "${c.description.slice(0, 60)}" → "${fixedRow.description.slice(0, 60)}"`);
      fixed++;
      if (APPLY) await sb.from('commitments').update({ description: fixedRow.description }).eq('id', c.id);
    }
    // 2 — pending inbox work_titles with deictic words (anchor = the email's received_at).
    const { data: items } = await sb.from('inbox_items').select('id, work_title, source_data')
      .eq('user_id', uid).eq('status', 'pending').limit(400);
    for (const it of (items ?? []) as Array<{ id: string; work_title: string | null; source_data: Record<string, unknown> }>) {
      const title = it.work_title || '';
      if (!DEICTIC_RE.test(title)) continue;
      const anchor = String((it.source_data ?? {}).received_at ?? '') || null;
      const [fixedRow] = await resolveDeixisInDescriptions(sb, uid, [{ description: title }], anchor);
      if (fixedRow.description === title) { console.log(`  [skip] could not resolve: "${title.slice(0, 70)}"`); continue; }
      console.log(`  [inbox] "${title.slice(0, 60)}" → "${fixedRow.description.slice(0, 60)}"`);
      fixed++;
      if (APPLY) await sb.from('inbox_items').update({ work_title: fixedRow.description }).eq('id', it.id);
    }
  }
  console.log(`\n${APPLY ? 'DONE' : 'WOULD FIX'}: ${fixed} title(s).${APPLY ? '' : ' Re-run with --apply.'}`);
})();
