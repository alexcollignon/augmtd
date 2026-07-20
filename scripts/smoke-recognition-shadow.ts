// PHASE A SHADOW — READ-ONLY, no DB writes (in-memory entity registry over the SAME pure recognition
// pieces the DB pipeline uses). Replays each user's recent emails CHRONOLOGICALLY through recognition
// (structural → recall → judgment) and compares the formed memory against the OLD label system:
//   • SPLITS  — one old label whose items landed in ≥2 entities (over-merge fixed: content separated
//               what the person-prior lumped)
//   • MERGES  — one entity holding ≥2 distinct old labels (under-merge fixed: synonyms unified)
//   • STRUCTURAL savings — items linked by thread inheritance (zero AI)
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { judgeRecognition, recallCandidates, itemEmbedText, entityEmbedText, type RecogItem, type RecogEntity } from '../lib/entities/recognize';
import { embedText } from '../lib/knowledge/indexer';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const PER_USER = 35;
const USERS = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec'];

type ShadowEntity = RecogEntity & { items: { title: string; oldLabel: string | null }[] };

(async () => {
  for (const uid of USERS) {
    // Recent WORK-ish emails, oldest→newest (chronological replay — the system "remembers its history").
    const { data: items } = await sb.from('inbox_items')
      .select('id, work_title, source_data, created_at')
      .eq('user_id', uid).eq('source', 'email')
      .order('created_at', { ascending: false }).limit(PER_USER * 10);
    const replay = ((items ?? []) as any[])
      .filter((it) => { const sd = it.source_data ?? {}; const rel = sd.understanding?.relevance; return rel === 'reply' || rel === 'action' || !!sd.understanding?.initiative; })
      .slice(0, PER_USER)
      .reverse();

    const entities: ShadowEntity[] = [];
    const threadTo = new Map<string, ShadowEntity>();
    let structural = 0, judged = 0, none = 0;

    for (const it of replay) {
      const sd = it.source_data ?? {};
      const oldLabel = (sd.understanding?.initiative as string) ?? null;
      const item: RecogItem = {
        kind: 'inbox_item', id: it.id, title: String(it.work_title || sd.subject || ''),
        body: typeof sd.body === 'string' ? sd.body : null,
        from: (sd.from_name as string) || (sd.from_address as string) || null,
        at: sd.received_at ?? it.created_at, threadId: (sd.thread_id as string) ?? null,
      };
      // 1. structural
      if (item.threadId && threadTo.has(item.threadId)) {
        threadTo.get(item.threadId)!.items.push({ title: item.title, oldLabel });
        structural++;
        continue;
      }
      // 2+3. recall + judgment
      const emb = await embedText(itemEmbedText(item), uid, sb);
      const cands = recallCandidates(emb, entities);
      const verdict = await judgeRecognition(uid, sb, item, cands);
      judged++;
      if (verdict.decision === 'existing') {
        const e = entities.find((x) => x.id === verdict.entityId)!;
        e.items.push({ title: item.title, oldLabel });
        if (item.threadId) threadTo.set(item.threadId, e);
      } else if (verdict.decision === 'new') {
        const e: ShadowEntity = {
          id: `s${entities.length + 1}`, name: verdict.name, summary: verdict.summary,
          people: item.from ? [item.from] : [],
          embedding: await embedText(entityEmbedText(verdict.name, verdict.summary, item.from ? [item.from] : []), uid, sb),
          items: [{ title: item.title, oldLabel }],
        };
        entities.push(e);
        if (item.threadId) threadTo.set(item.threadId, e);
      } else none++;
    }

    // ── Report ──
    console.log(`\n════ user ${uid.slice(0, 8)} — replayed ${replay.length} items → ${entities.length} entities · structural:${structural} judged:${judged} none:${none} ════`);
    for (const e of entities.filter((x) => x.items.length > 1)) {
      console.log(`  ▸ "${e.name}" (${e.items.length}) — ${e.summary?.slice(0, 60) ?? ''}`);
      for (const m of e.items.slice(0, 4)) console.log(`      · ${m.title.slice(0, 62)}${m.oldLabel ? `  [was: ${m.oldLabel.slice(0, 28)}]` : ''}`);
    }
    // MERGES: entity holding ≥2 distinct old labels (synonyms unified by content).
    const merges = entities.filter((e) => new Set(e.items.map((i) => i.oldLabel).filter(Boolean)).size >= 2);
    // SPLITS: an old label whose items landed in ≥2 entities (person-prior lumping separated by content).
    const byOld = new Map<string, Set<string>>();
    for (const e of entities) for (const m of e.items) if (m.oldLabel) (byOld.get(m.oldLabel) ?? byOld.set(m.oldLabel, new Set()).get(m.oldLabel)!).add(e.name);
    const splits = [...byOld.entries()].filter(([, s]) => s.size >= 2);
    console.log(`  MERGES (entity unifying ≥2 old labels): ${merges.length}${merges.length ? ' — ' + merges.map((e) => `"${e.name}" ⇐ {${[...new Set(e.items.map((i) => i.oldLabel).filter(Boolean))].join(' | ')}}`).join(' ; ').slice(0, 300) : ''}`);
    console.log(`  SPLITS (old label separated into ≥2 entities): ${splits.length}${splits.length ? ' — ' + splits.map(([l, s]) => `"${l}" → {${[...s].join(' | ')}}`).join(' ; ').slice(0, 300) : ''}`);
  }
})();
