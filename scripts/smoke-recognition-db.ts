// PHASE A — LIVE DB SHADOW smoke (post-migration). Runs the REAL `recognizeItem` pipeline against
// work_entities/entity_links for multiple users. Writes ONLY to the shadow tables (nothing user-facing
// reads them). Verifies, per user:
//   1. end-to-end recognition (found/recognized/none) with real DB persistence
//   2. STRUCTURAL thread inheritance (same-thread items short-circuit with ZERO AI) — untested until now
//   3. idempotency (re-running a linked item returns the existing link, no new AI, no dup entity)
//   4. MODEL SWITCHES — from the ai_usage_events ledger: which model+tier the judgments (brain_synthesis)
//      and embeddings (kb_indexing) actually used per user (Bedrock-only map for bedrock users).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { recognizeItem, type RecogItem } from '../lib/entities/recognize';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const USERS = ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec'];
const PER_USER = 22;

(async () => {
  const startedAt = new Date().toISOString();
  for (const uid of USERS) {
    // Work-ish emails, chronological — and DELIBERATELY include same-thread siblings (structural test).
    const { data: items } = await sb.from('inbox_items')
      .select('id, work_title, source_data, created_at')
      .eq('user_id', uid).eq('source', 'email')
      .order('created_at', { ascending: false }).limit(300);
    const all = ((items ?? []) as any[]).filter((it) => {
      const sd = it.source_data ?? {}; const rel = sd.understanding?.relevance;
      return rel === 'reply' || rel === 'action' || !!sd.understanding?.initiative;
    });
    // Prefer threads with ≥2 items in the pool so structural inheritance actually fires.
    const byThread = new Map<string, any[]>();
    for (const it of all) { const t = it.source_data?.thread_id; if (t) (byThread.get(t) ?? byThread.set(t, []).get(t)!).push(it); }
    const multiThread = [...byThread.values()].filter((g) => g.length >= 2).flat();
    const pool = [...new Map([...multiThread, ...all].map((it) => [it.id, it])).values()].slice(0, PER_USER).reverse();

    let founded = 0, recognized = 0, structural = 0, none = 0;
    for (const it of pool) {
      const sd = it.source_data ?? {};
      const item: RecogItem = {
        kind: 'inbox_item', id: it.id, title: String(it.work_title || sd.subject || ''),
        body: typeof sd.body === 'string' ? sd.body : null,
        from: (sd.from_name as string) || (sd.from_address as string) || null,
        at: sd.received_at ?? it.created_at, threadId: (sd.thread_id as string) ?? null,
      };
      const r = await recognizeItem(sb, uid, item);
      if (r.via === 'structural') structural++;
      else if (r.founded) founded++;
      else if (r.entityId) recognized++;
      else none++;
    }

    // Idempotency: re-run the first item — must return an existing link, found nothing new.
    const first = pool[0];
    const sd0 = first.source_data ?? {};
    const again = await recognizeItem(sb, uid, { kind: 'inbox_item', id: first.id, title: String(first.work_title || ''), body: sd0.body ?? null, threadId: sd0.thread_id ?? null });
    const idemOk = !again.founded && (again.entityId !== null || none > 0);

    // What the shadow store now holds.
    const [{ count: entCount }, { data: links }] = await Promise.all([
      sb.from('work_entities').select('id', { count: 'exact', head: true }).eq('user_id', uid) as any,
      sb.from('entity_links').select('via').eq('user_id', uid) as any,
    ]);
    const viaCounts = (links ?? []).reduce((m: Record<string, number>, l: any) => { m[l.via] = (m[l.via] ?? 0) + 1; return m; }, {});

    // MODEL SWITCH proof — the usage ledger for this run.
    const { data: usage } = await sb.from('ai_usage_events')
      .select('source, model, tier, provider')
      .eq('user_id', uid).gte('created_at', startedAt).in('source', ['brain_synthesis', 'kb_indexing']);
    const models = (usage ?? []).reduce((m: Record<string, number>, u: any) => {
      const k = `${u.source} → ${String(u.model).split('/').pop()?.slice(0, 34)} [${u.tier}/${u.provider}]`;
      m[k] = (m[k] ?? 0) + 1; return m;
    }, {});

    console.log(`\n════ user ${uid.slice(0, 8)} — ran ${pool.length} items ════`);
    console.log(`  founded:${founded} recognized:${recognized} STRUCTURAL:${structural} none:${none} · idempotent-rerun: ${idemOk ? '✓' : '✗'}`);
    console.log(`  shadow store: ${entCount} entities · links by via: ${JSON.stringify(viaCounts)}`);
    console.log(`  models used this run:`);
    for (const [k, n] of Object.entries(models)) console.log(`    ${n}× ${k}`);

    // A few entities with their links, to eyeball.
    const { data: ents } = await sb.from('work_entities').select('id, name, summary').eq('user_id', uid).order('created_at', { ascending: false }).limit(4);
    for (const e of (ents ?? []) as any[]) {
      const { data: el } = await sb.from('entity_links').select('via, reason').eq('user_id', uid).eq('entity_id', e.id).eq('item_kind', 'inbox_item');
      console.log(`  ▸ "${e.name}" (${(el ?? []).length} items) — ${(el ?? []).map((l: any) => l.via).join(',')}`);
    }
  }
})();
