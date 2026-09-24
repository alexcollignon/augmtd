// TEMPORARY fidelity probe (untracked) — rebuilds the reference account's served whispers through
// the SAME modules the route serves through, with the pre-fix floors alongside, and prints both.
import { createClient } from '@supabase/supabase-js';
import { classifyItem } from '@/lib/inbox/classify-item';
import { getCampaignSignature, isCampaignEcho } from '@/lib/inbox/campaign-echo';
import { rePromotesToDeck, noticeIsDemoted, readJudgedNone, anchorOf, DECK_POOL_LIMIT, type DeckFloors, type DeckItem } from '@/lib/home/deck-floors';
import { guardDeckLabels } from '@/lib/home/serve-labels';
import { pickWhispers, toWhisper } from '@/lib/home/calm';
import type { DoItem } from '@/lib/home/agenda';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const U = process.argv[2] || '08fe4449-e5eb-431d-9156-02e9324e5903';
const TODAY = new Date().toISOString().slice(0, 10);

async function main() {
  const sig = await getCampaignSignature(sb, U);
  const { data } = await sb.from('inbox_items')
    .select('id, user_id, work_title, work_state, rule_type, type_override, status, source_data, source')
    .eq('user_id', U).eq('status', 'pending')
    .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)')
    .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(DECK_POOL_LIMIT);
  const emails = (data ?? []).filter((r: any) => r.source !== 'meeting' && r.source !== 'commitment') as any[];
  const judgedNone = await readJudgedNone(sb, U, emails.map((e) => e.id));

  const build = (mode: 'pre' | 'post') => {
    const floors: DeckFloors = {
      judgedNone: mode === 'post' ? judgedNone : new Set<string>(),
      isEcho: (it) => (mode === 'post' ? isCampaignEcho(it as never, sig) : false),
    };
    const admitted = emails
      .map((it) => ({ it: it as DeckItem, raw: it, posture: classifyItem(it as never, []) }))
      .filter((x) => (mode === 'post'
        ? rePromotesToDeck(x.it, x.posture, floors) && !noticeIsDemoted(x.it, floors)
        : (x.posture === 'needs_reply' || x.posture === 'to_do'
            || (['needs_reply', 'to_do'].includes(String(x.it.rule_type || '')) && !!(x.raw.source_data?.understanding)))));
    const rowsRaw = admitted.map((x) => {
      const sd: any = x.raw.source_data ?? {};
      const u = sd.understanding ?? {};
      const anchor = anchorOf(x.it);
      return { itemId: x.it.id, who: sd.from_name || sd.from || null, summary: (u.ask as string) || x.it.work_title || '', dueDate: anchor };
    });
    const rows = (mode === 'post' ? (guardDeckLabels({ actionNotices: rowsRaw } as any) as any).actionNotices : rowsRaw) as any[];
    const items: DoItem[] = rows.map((r) => ({
      source: 'notice', key: `n-${r.itemId}`, entityId: r.itemId, href: '',
      primary: r.who, ask: r.summary, second: 'Action needed',
      dueDate: r.dueDate, overdue: !!r.dueDate && r.dueDate < TODAY,
    }));
    return pickWhispers(items, 5).map((i) => toWhisper(i));
  };

  for (const mode of ['pre', 'post'] as const) {
    console.log(`\n──── TOP-5 WHISPERS · ${mode === 'pre' ? 'BEFORE (the floors the route had)' : 'AFTER (the floors it has now)'} ────`);
    build(mode).forEach((w, i) => console.log(`  ${i + 1}. ${w.sentence}${w.urgency ? ` — ${w.urgency}` : ''}   [${w.item.key.slice(2, 10)}]`));
  }
}
main();
