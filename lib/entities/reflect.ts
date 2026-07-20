// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE BRAIN — REFLECTION (Phase A, docs/one-brain-plan.md §2.5). Memory maintenance, reasoned.
//
// Recognition judges one item at a time, so the registry can accumulate two entities that are really ONE
// body of work remembered twice (founded from different facets before either was established). A human
// reconciles this on reflection — "wait, the pilot chat and the agent project are the same deal" — not at
// the moment each email arrives. This pass does the same:
//   1. SHORTLIST — embedding-adjacent entity pairs (recall, not a decision).
//   2. JUDGMENT — one reasoned call per pair with both entities' real descriptions + linked items in
//      view: same body of work, or genuinely separate? Same person involved NEVER makes them the same.
//   3. MERGE — the winner absorbs the loser: name → aliases, links repointed, loser deleted, winner
//      re-embedded. A user's merge/split (via='user', locked) always outranks this pass.
//
// Shadow-phase scope: run on demand (script/backfill), dry-run supported. 'separate' verdicts are not yet
// persisted (re-asked on a later reflection) — pair-verdict memory lands with the Phase-B migration batch.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { embedText } from '@/lib/knowledge/indexer';
import { cosine, entityEmbedText } from './recognize';

type Ent = { id: string; name: string; summary: string | null; aliases: string[]; embedding: number[] | null; itemTitles: string[]; linkCount: number; createdAt: string };

// Pair-content signature: if either entity's name/summary evolves substantially, a stored 'separate'
// verdict expires and the pair may be re-judged.
const pairSig = (a: Ent, b: Ent): string => {
  const s = `${a.name}|${a.summary || ''}|${b.name}|${b.summary || ''}`;
  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
};
const pairKey = (a: Ent, b: Ent): string => [a.id, b.id].sort().join(':');

export type ReflectionVerdict = {
  a: string; b: string;                 // entity names
  similarity: number;
  verdict: 'merge' | 'separate';
  reason: string;
  keptId?: string; mergedId?: string;   // set when committed
};

const PAIR_SIM_FLOOR = 0.55;  // shortlist floor — the JUDGE decides; this only bounds cost
const MAX_PAIRS = 8;          // per run

export async function reflectEntities(
  supabase: SupabaseClient,
  userId: string,
  opts: { commit?: boolean } = {},
): Promise<ReflectionVerdict[]> {
  // Load the registry + each entity's linked item titles (the content evidence for the judgment).
  const { data: rows } = await supabase.from('work_entities')
    .select('id, name, summary, aliases, embedding, created_at')
    .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(400);
  const entities: Ent[] = [];
  for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
    const { data: links, count } = await supabase.from('entity_links')
      .select('item_id, item_kind', { count: 'exact' }).eq('user_id', userId).eq('entity_id', r.id as string).eq('item_kind', 'inbox_item').limit(6);
    const ids = (links ?? []).map((l) => l.item_id as string);
    let titles: string[] = [];
    if (ids.length) {
      const { data: items } = await supabase.from('inbox_items').select('work_title').in('id', ids);
      titles = (items ?? []).map((i) => String(i.work_title || '')).filter(Boolean);
    }
    entities.push({
      id: r.id as string, name: r.name as string, summary: (r.summary as string) ?? null,
      aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
      embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
      itemTitles: titles, linkCount: count ?? ids.length, createdAt: (r.created_at as string) || '',
    });
  }

  // Pair-verdict MEMORY: previously-judged-'separate' pairs (sig-matched) are skipped — no re-asking.
  // Graceful pre-migration (20260721c): a failed read degrades to re-judging.
  const judgedSeparate = new Map<string, string>();
  try {
    const { data: refl } = await supabase.from('entity_reflections').select('pair_key, sig').eq('user_id', userId).eq('verdict', 'separate');
    for (const r of (refl ?? []) as Array<{ pair_key: string; sig: string | null }>) judgedSeparate.set(r.pair_key, r.sig ?? '');
  } catch { /* pre-migration */ }

  // Shortlist adjacent pairs (upper triangle, floor + cap).
  const pairs: Array<{ a: Ent; b: Ent; s: number }> = [];
  for (let i = 0; i < entities.length; i++) for (let j = i + 1; j < entities.length; j++) {
    const a = entities[i], b = entities[j];
    if (!a.embedding || !b.embedding) continue;
    const s = cosine(a.embedding, b.embedding);
    if (s >= PAIR_SIM_FLOOR) pairs.push({ a, b, s });
  }
  pairs.sort((x, y) => y.s - x.s);
  const shortlist = pairs.slice(0, MAX_PAIRS);

  const out: ReflectionVerdict[] = [];
  const absorbed = new Set<string>();
  for (const { a, b, s } of shortlist) {
    if (absorbed.has(a.id) || absorbed.has(b.id)) continue; // already merged away this run
    const key = pairKey(a, b), sig = pairSig(a, b);
    if (judgedSeparate.get(key) === sig) continue; // remembered 'separate' — never re-ask until they evolve
    const prompt =
      `You maintain a person's MEMORY of the distinct bodies of work in their life. Two remembered entries ` +
      `look similar — decide whether they are actually ONE body of work remembered twice, or genuinely SEPARATE.\n\n` +
      `Judge by the CONTENT of the work. The same people being involved does NOT make two bodies of work the ` +
      `same — people run several things at once. Merge ONLY when the underlying matter is one and the same ` +
      `(one deal, one program, one engagement) referred to in different ways.\n\n` +
      `[A] "${a.name}"${a.summary ? ` — ${a.summary}` : ''}\n  items:\n${a.itemTitles.map((t) => `   - ${t.slice(0, 90)}`).join('\n') || '   (none)'}\n\n` +
      `[B] "${b.name}"${b.summary ? ` — ${b.summary}` : ''}\n  items:\n${b.itemTitles.map((t) => `   - ${t.slice(0, 90)}`).join('\n') || '   (none)'}\n\n` +
      `Return ONLY JSON: {"verdict":"merge|separate","reason":"<=18 words, judged from content"}`;
    const res = await aiCall<{ verdict?: string; reason?: string }>({
      userId, supabase, shape: { output: 'json' }, prompt, temperature: 0, maxTokens: 220, source: 'brain_synthesis',
    });
    const p = res.json ?? {};
    const reason = String(p.reason || '').slice(0, 140);
    if (p.verdict !== 'merge') {
      out.push({ a: a.name, b: b.name, similarity: s, verdict: 'separate', reason });
      if (opts.commit) {
        // Remember the 'separate' verdict (sig-keyed) — graceful pre-migration.
        await supabase.from('entity_reflections').upsert(
          { user_id: userId, pair_key: key, verdict: 'separate', reason, sig, judged_at: new Date().toISOString() },
          { onConflict: 'user_id,pair_key' },
        ).then(() => {}, () => {});
      }
      continue;
    }
    // KEEPER is structural, not the model's pick: the ESTABLISHED entity (more linked evidence; older on
    // tie) absorbs the newcomer — that's how memory works. The model only decides merge/separate.
    const keep = (b.linkCount > a.linkCount || (b.linkCount === a.linkCount && b.createdAt < a.createdAt)) ? b : a;
    const lose = keep.id === a.id ? b : a;
    const v: ReflectionVerdict = { a: a.name, b: b.name, similarity: s, verdict: 'merge', reason };
    if (opts.commit) {
      // Absorb: loser's name+aliases → winner's aliases; links repointed; loser deleted; winner re-embedded.
      const aliases = [...new Set([...keep.aliases, lose.name, ...lose.aliases])].slice(0, 12);
      await supabase.from('entity_links').update({ entity_id: keep.id }).eq('user_id', userId).eq('entity_id', lose.id);
      const emb = await embedText(entityEmbedText(keep.name, keep.summary, []) + `\naka: ${aliases.join(', ')}`, userId, supabase);
      await supabase.from('work_entities').update({ aliases, embedding: emb, updated_at: new Date().toISOString() }).eq('id', keep.id).eq('user_id', userId);
      await supabase.from('work_entities').delete().eq('id', lose.id).eq('user_id', userId);
      // Stale pair-verdicts referencing the merged-away entity die with it (graceful pre-migration).
      await supabase.from('entity_reflections').delete().eq('user_id', userId).like('pair_key', `%${lose.id}%`).then(() => {}, () => {});
      absorbed.add(lose.id);
      v.keptId = keep.id; v.mergedId = lose.id;
    }
    out.push(v);
  }
  return out;
}
