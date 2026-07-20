// READ-ONLY cross-user smoke for the ONE quiet relationship CUE on deck cards. Replicates the brief route's
// relationshipCue over real needs-reply items → what short tag each card would show. Checks: coverage, that
// cues are SHORT (≤ ~9 chars), and no low-signal noise (colleague/unknown skipped). No writes, no AI.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const emailOf = (s?: string | null) => String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;

// Mirror app/api/home/brief/route.ts relationshipCue exactly.
function relationshipCue(relationship?: string | null, momentum?: string | null, quietDays?: number | null): { label: string; tone: string } | null {
  if (momentum === 'gone_quiet' && typeof quietDays === 'number' && quietDays >= 4) {
    return { label: quietDays >= 10 ? `quiet ${Math.round(quietDays / 7)}w` : `quiet ${quietDays}d`, tone: 'amber' };
  }
  const rel = (relationship || '').toLowerCase();
  if (rel && rel !== 'unknown' && rel !== 'colleague') return { label: rel, tone: 'neutral' };
  return null;
}

(async () => {
  const { data: psUsers } = await sb.from('person_state').select('user_id').limit(20000);
  const userIds = [...new Set((psUsers ?? []).map((r: any) => r.user_id))];

  let totItems = 0, totCued = 0, maxLen = 0, shown = 0;
  const labelCounts = new Map<string, number>();

  for (const uid of userIds) {
    const { data: items } = await sb.from('inbox_items').select('source_data, rule_type').eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(150);
    const mr = ((items ?? []) as any[]).filter((it) => it.rule_type === 'needs_reply' || it.source_data?.understanding?.relevance === 'reply');
    const keyToWho = new Map<string, string>();
    for (const it of mr) { const k = emailOf(it.source_data?.from_address || it.source_data?.from); if (k && !keyToWho.has(k)) keyToWho.set(k, it.source_data?.from_name || k); }
    const keys = [...keyToWho.keys()];
    if (!keys.length) continue;
    const { data: ps } = await sb.from('person_state').select('person_key, state, quiet_days').eq('user_id', uid).in('person_key', keys);
    const byKey = new Map(((ps ?? []) as any[]).map((r) => [r.person_key, r]));

    let cued = 0;
    for (const k of keys) {
      totItems++;
      const r = byKey.get(k);
      const cue = r ? relationshipCue(r.state?.relationship, r.state?.momentum, r.quiet_days) : null;
      if (!cue) continue;
      cued++; totCued++;
      maxLen = Math.max(maxLen, cue.label.length);
      labelCounts.set(cue.label, (labelCounts.get(cue.label) ?? 0) + 1);
      if (shown < 8) { shown++; console.log(`  ${(keyToWho.get(k) || k).slice(0, 22).padEnd(22)} → "${cue.label}" (${cue.tone})`); }
    }
    console.log(`user ${uid.slice(0, 8)} — needs-reply senders:${keys.length} cued:${cued} (${keys.length ? Math.round(100*cued/keys.length) : 0}%)`);
  }

  console.log('\n════ TOTALS ════');
  console.log(`needs-reply senders: ${totItems}  ·  show a cue: ${totCued} (${totItems ? Math.round(100*totCued/totItems) : 0}%)`);
  console.log(`longest cue label: ${maxLen} chars ${maxLen <= 9 ? '✓ snappy' : '⚠️ too long'}`);
  console.log(`cue distribution: ${JSON.stringify(Object.fromEntries([...labelCounts.entries()].sort((a, b) => b[1] - a[1])))}`);
})();
