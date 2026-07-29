// THE NAMED-SUBJECT REPAIR (proactive-team R-class). Links made before the channel-contact law can
// carry the over-merge: an item filed into an entity whose people all match but whose NAMED
// engagement differs (the "STC Bahrain filed under Arcapita" class — partner-org contacts broker
// several end clients). This sweep re-checks recognized links with the SAME law the judge now
// applies (named_engagement extraction + the code-side distinctive-token veto) and, on a mismatch,
// unlinks + re-recognizes — the item then founds/joins its true body of work through the one
// pipeline, never a manual re-file.
//
// Usage: npx tsx scripts/sweep-recognition-subjects.ts <user_id> [--apply]   (dry-run by default)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { namesOverlap, recognizeItem } from '../lib/entities/recognize';
import { itemFromInbox } from '../lib/entities/sources';
import { aiCall } from '../lib/ai/call';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const userId = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) { console.error('usage: sweep-recognition-subjects.ts <user_id> [--apply]'); process.exit(1); }

(async () => {
  console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'} named-subject repair for ${userId.slice(0, 8)}\n`);
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data: links } = await sb.from('entity_links')
    .select('id, item_id, entity_id, via')
    .eq('user_id', userId).eq('item_kind', 'inbox_item').eq('via', 'recognized')
    .not('entity_id', 'is', null).eq('locked', false)
    .gte('created_at', since).limit(80);
  let mismatches = 0;

  for (const l of (links ?? []) as Array<{ id: string; item_id: string; entity_id: string }>) {
    const { data: it } = await sb.from('inbox_items').select('id, work_title, rule_type, source_data, created_at')
      .eq('id', l.item_id).eq('user_id', userId).maybeSingle();
    // Identity = NAME + ALIASES only — never the summary (an over-merged entity's summary absorbs
    // the intruder's own words and would validate the very contamination being repaired).
    const { data: ent } = await sb.from('work_entities').select('id, name, aliases')
      .eq('id', l.entity_id).maybeSingle();
    if (!it || !ent) continue;
    const sd = (it.source_data ?? {}) as { subject?: string; body?: string };
    // The same extraction the live judge now performs — what engagement does the ITEM say it is about?
    const res = await aiCall<{ named_engagement?: string | null }>({
      userId, supabase: sb, shape: { output: 'json' }, temperature: 0, maxTokens: 80, source: 'brain_synthesis',
      prompt: `What engagement/end-client does THIS item say it is about? Return the PROPER NAME the item ` +
        `itself states (an end client, deal, or program name), or null if it names none.\n` +
        `title: ${String(it.work_title || sd.subject || '').slice(0, 140)}\n` +
        `content: ${String(sd.body || '').slice(0, 500)}\n` +
        `JSON only: {"named_engagement":"<proper name or null>"}`,
    }).catch(() => ({ json: undefined }));
    const named = String(res.json?.named_engagement ?? '').trim();
    if (!named || /^(null|none|n\/a)$/i.test(named)) continue;
    if (namesOverlap(named, `${ent.name} ${(Array.isArray(ent.aliases) ? ent.aliases as string[] : []).join(' ')}`)) continue;
    mismatches++;
    console.log(`  [mismatch] "${String(it.work_title).slice(0, 55)}" names "${named.slice(0, 35)}" but is filed under "${ent.name.slice(0, 40)}"`);
    if (APPLY) {
      await sb.from('entity_links').delete().eq('id', l.id);
      const r = await recognizeItem(sb, userId, itemFromInbox(it as never));
      console.log(`    → re-recognized: via=${r.via} founded=${r.founded}${r.entityId ? ` entity=${r.entityId.slice(0, 8)}` : ''}`);
    }
  }
  console.log(`\n${APPLY ? 'DONE' : 'WOULD REPAIR'}: ${mismatches} mismatched filing(s).${APPLY ? '' : ' Re-run with --apply.'}`);
})();
