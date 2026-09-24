// TEMPORARY fidelity probe (untracked) — census fixes #3/#9 on the reference account.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildWorkItems } from '@/lib/work-items/model';
import { partitionDailyReport } from '@/lib/work-items/report';
import { itemIsNoise } from '@/lib/prepare/noise-floor';
import { whisperSentence, isDerivedSpeech, speechRank } from '@/lib/home/calm';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const U = process.argv[2] || '08fe4449-e5eb-431d-9156-02e9324e5903';
const TODAY = new Date().toISOString().slice(0, 10);

async function main() {
  // ── (1) THE PREPARE LANES, rebuilt exactly as runPreparationPass builds them ──
  const items = await buildWorkItems(sb, U, { todayStr: TODAY, skipReconcile: true });
  const rep = partitionDailyReport(items, TODAY);
  const lanes = [
    rep.needsYou.filter((x: any) => x.kind === 'reply' && x.id.startsWith('inbox:')),
    rep.openQuestions.filter((x: any) => x.blockedOn),
    rep.needsYou.filter((w: any) => !w.automated && w.kind !== 'reply' && (w.id.startsWith('inbox:') || w.id.startsWith('commit:'))),
  ];
  const seen = new Set<string>();
  const cands: any[] = [];
  for (const lane of lanes) for (const w of lane) { if (!seen.has(w.id)) { seen.add(w.id); cands.push(w); } }
  const inbox = cands.filter((w) => w.id.startsWith('inbox:'));
  console.log(`PREPARE CANDIDATES: ${cands.length} (${inbox.length} inbox rows the floor can speak about)`);

  const skipped: Array<{ t: string; why: string }> = [];
  for (const w of inbox) {
    const n = await itemIsNoise(sb, U, w.entityId);
    if (n.noise) skipped.push({ t: w.title, why: `${n.via}: ${n.reason}` });
  }
  console.log(`\nTHE FLOOR WOULD SKIP: ${skipped.length} of ${inbox.length}`);
  skipped.forEach((s, i) => console.log(`  ${i + 1}. "${s.t.slice(0, 72)}"  [${s.why.slice(0, 6)}]`));

  // ── (3) THE WHISPER TABLE, before/after ──
  const { data: rows } = await sb.from('inbox_items')
    .select('id, work_title, source_data').eq('user_id', U).eq('status', 'pending').limit(1500);
  const chrome = (rows ?? []).filter((r: any) => {
    const ask = r.source_data?.understanding?.ask;
    const body = String(ask || r.work_title || '');
    return body && !isDerivedSpeech(body);
  });
  const fromAsk = chrome.filter((r: any) => !!r.source_data?.understanding?.ask).length;
  console.log(`\nWHISPER SENTENCES CARRYING CHROME: ${chrome.length} (${fromAsk} from a derived ask, ${chrome.length - fromAsk} from a raw title/subject)`);
  chrome.slice(0, 10).forEach((r: any) => {
    const ask = r.source_data?.understanding?.ask;
    const item: any = { source: 'notice', key: r.id, entityId: r.id, href: '',
      primary: r.source_data?.from_name ?? null, ask: String(ask || r.work_title || ''), second: null };
    const before = `${(item.primary ?? '').trim() ? `${item.primary} — ` : ''}${item.ask}`;
    console.log(`  BEFORE: ${before.slice(0, 92)}`);
    console.log(`  AFTER : ${whisperSentence(item).slice(0, 92)}   [speechRank ${speechRank(item)}]`);
  });
}
main();
