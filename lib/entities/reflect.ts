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
import { cosine, entityEmbedText, normPerson, personKey } from './recognize';

type Ent = { id: string; name: string; summary: string | null; aliases: string[]; people: string[]; embedding: number[] | null; itemTitles: string[]; standing: string | null; linkCount: number; createdAt: string };

// Bump when the pair-judgment EVIDENCE or prompt changes — versioned into pairSig so an evidence
// upgrade re-judges previously-'separate' pairs (a prompt-driven cache must invalidate on the prompt
// itself, not only on the data — the alignment-cache lesson).
const REFLECT_PROMPT_VERSION = 6;

// A CHANNEL-shaped name ("X x Y", "1:1", "<person> — <topic>") is the anti-pattern the recognition
// judge avoids — but an early entity can still carry one. On a merge, the DEAL-shaped name must win
// regardless of which entity is the structural keeper (else the person-named channel absorbs the
// properly-named deal and the whole portfolio reads like a contacts list).
const CHANNEL_MARKERS = /\b(1[:\-]1|sync|weekly|bi-?weekly|check-?in|catch-?up|standup|monthly)\b|\s[x×]\s/i;
export function looksLikeChannelName(name: string, people: string[]): boolean {
  if (CHANNEL_MARKERS.test(String(name || ''))) return true;
  // Person-led: the name STARTS with one of the entity's own multi-word person tokens.
  const n = personKey(normPerson(name));
  return people.some((p) => !p.startsWith('@') && !p.includes('@') && p.includes(' ') && n.startsWith(personKey(p)));
}

// Shared IDENTITY between two entities: person/company tokens present on BOTH fingerprints (compared
// era-proof via personKey). This is the decisive evidence a bare name/summary comparison misses — two
// facet-founded entries of one deal often DESCRIBE themselves differently while sharing the same small
// external team.
function sharedIdentity(a: Ent, b: Ent): string[] {
  const bKeys = new Map(b.people.map((p) => [personKey(p), p]));
  const outTokens: string[] = [];
  for (const p of new Set(a.people)) { const hit = bKeys.get(personKey(p)); if (hit) outTokens.push(p); }
  return [...new Set(outTokens)].slice(0, 8);
}

// Pair-content signature: if either entity's name/summary evolves substantially — OR their shared
// identity grows (a person newly appears on BOTH, e.g. after a fingerprint refresh) — a stored
// 'separate' verdict expires and the pair is re-judged with the new evidence in view.
const pairSig = (a: Ent, b: Ent): string => {
  const s = `v${REFLECT_PROMPT_VERSION}|${a.name}|${a.summary || ''}|${b.name}|${b.summary || ''}|shared:${sharedIdentity(a, b).length}`;
  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
};
const pairKey = (a: Ent, b: Ent): string => [a.id, b.id].sort().join(':');

/** THE MERGE MECHANICS — winner absorbs loser: editorial name choice (deal-shaped beats
 *  channel-shaped), aliases folded, people fingerprints unioned, links repointed, loser deleted,
 *  stale pair-verdicts cleaned, keeper re-embedded. Used by the reflection loop AND the
 *  user-commanded merge_projects capability (one mechanics, two judges). */
export async function absorbEntity(supabase: SupabaseClient, userId: string, keepId: string, loseId: string): Promise<{ ok: boolean; primaryName?: string }> {
  const { data: rows } = await supabase.from('work_entities')
    .select('id, name, summary, aliases, people').eq('user_id', userId).in('id', [keepId, loseId]);
  const keep = (rows ?? []).find((r) => r.id === keepId) as { id: string; name: string; summary: string | null; aliases: unknown; people: unknown } | undefined;
  const lose = (rows ?? []).find((r) => r.id === loseId) as typeof keep;
  if (!keep || !lose) return { ok: false };
  const keepAliases = Array.isArray(keep.aliases) ? (keep.aliases as string[]) : [];
  const loseAliases = Array.isArray(lose.aliases) ? (lose.aliases as string[]) : [];
  const mergedPeople = [...new Set([...(Array.isArray(keep.people) ? keep.people as string[] : []), ...(Array.isArray(lose.people) ? lose.people as string[] : [])])];
  const keepChannel = looksLikeChannelName(keep.name, mergedPeople);
  const loseChannel = looksLikeChannelName(lose.name, mergedPeople);
  const primaryName = keepChannel && !loseChannel ? lose.name : keep.name;
  const aliasSource = primaryName === keep.name ? [lose.name, ...loseAliases] : [keep.name, ...keepAliases, ...loseAliases];
  const aliases = [...new Set([...keepAliases, ...aliasSource])].filter((x) => x !== primaryName).slice(0, 12);
  await supabase.from('entity_links').update({ entity_id: keep.id }).eq('user_id', userId).eq('entity_id', lose.id);
  const emb = await embedText(entityEmbedText(primaryName, keep.summary, []) + `\naka: ${aliases.join(', ')}`, userId, supabase);
  await supabase.from('work_entities').update({ name: primaryName, aliases, people: mergedPeople.slice(0, 40), embedding: emb, updated_at: new Date().toISOString() }).eq('id', keep.id).eq('user_id', userId);
  await supabase.from('work_entities').delete().eq('id', lose.id).eq('user_id', userId);
  await supabase.from('entity_reflections').delete().eq('user_id', userId).like('pair_key', `%${lose.id}%`).then(() => {}, () => {});
  return { ok: true, primaryName };
}

export type ReflectionVerdict = {
  a: string; b: string;                 // entity names
  similarity: number;
  verdict: 'merge' | 'separate';
  reason: string;
  keptId?: string; mergedId?: string;   // set when committed
};

const PAIR_SIM_FLOOR = 0.55;  // shortlist floor — the JUDGE decides; this only bounds cost
// Calibrated Aug 19 on Cohere Embed Multilingual v3 (doc–doc, entityEmbedText): near-duplicate entities
// ≈0.85 (≈0.76 cross-lingual), sibling deals at one company ≈0.62, a person-channel facet ≈0.52,
// unrelated ≈0.44 — so 0.55 admits duplicates + siblings (judge separates) and drops unrelated; facets
// ride the shared-rare-domain path below. (Under the retired e5 model unrelated pairs sat ≈0.7, so
// this floor was effectively "everything" — the cap did the bounding.)
const MAX_PAIRS = 8;          // per run

export async function reflectEntities(
  supabase: SupabaseClient,
  userId: string,
  opts: { commit?: boolean } = {},
): Promise<ReflectionVerdict[]> {
  // Load the registry + each entity's linked item titles (the content evidence for the judgment).
  const { data: rows } = await supabase.from('work_entities')
    .select('id, name, summary, aliases, people, embedding, state, created_at')
    .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(400);
  const entities: Ent[] = [];
  for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
    // Evidence = ALL link kinds (emails + commitments + meetings), each with a CONTENT snippet. The
    // founding summary can misread the matter, and an entity founded from a meeting facet may have NO
    // meaningful inbox items at all (its meat lives in commitments/meetings) — inbox-only evidence
    // starved the judge exactly where fragmentation lives (the same all-kinds lesson as the reconcile
    // over-archiving incident).
    const { data: links, count } = await supabase.from('entity_links')
      .select('item_id, item_kind', { count: 'exact' }).eq('user_id', userId).eq('entity_id', r.id as string).neq('item_kind', 'email_thread').limit(24);
    const lrows = (links ?? []) as Array<{ item_id: string; item_kind: string }>;
    const kindIds = (k: string) => lrows.filter((l) => l.item_kind === k).map((l) => l.item_id);
    // Every evidence line carries its DATE — fragmentation typically happens within days (a meeting on
    // Tuesday, its follow-through email on Wednesday founding a second entity); temporal adjacency is a
    // signal the judge can't use if it can't see it.
    const titles: string[] = [];
    const d10 = (s?: string | null) => (s ? String(s).slice(0, 10) : '');
    const inboxIds = kindIds('inbox_item').slice(0, 4);
    if (inboxIds.length) {
      const { data: items } = await supabase.from('inbox_items').select('work_title, source_data, created_at').in('id', inboxIds);
      for (const i of (items ?? []) as Array<{ work_title?: string; created_at?: string; source_data?: { subject?: string; body?: string; received_at?: string } }>) {
        const t = String(i.work_title || i.source_data?.subject || '').slice(0, 90);
        const snip = String(i.source_data?.body || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        const when = d10(i.source_data?.received_at || i.created_at);
        if (t) titles.push(`email${when ? ` (${when})` : ''}: ${t}${snip ? ` — "${snip}"` : ''}`);
      }
    }
    const commitIds = kindIds('commitment').slice(0, 4);
    if (commitIds.length) {
      const { data: cs } = await supabase.from('commitments').select('description, created_at').in('id', commitIds);
      for (const c of (cs ?? []) as Array<{ description?: string; created_at?: string }>) {
        if (c.description) titles.push(`commitment (${d10(c.created_at)}): ${String(c.description).slice(0, 140)}`);
      }
    }
    const mtgIds = kindIds('meeting').slice(0, 2);
    if (mtgIds.length) {
      const { data: ms } = await supabase.from('meeting_transcripts').select('title, summary, start_time, created_at').in('id', mtgIds);
      for (const m of (ms ?? []) as Array<{ title?: string; summary?: string; start_time?: string; created_at?: string }>) {
        const snip = String(m.summary || '').replace(/\s+/g, ' ').trim().slice(0, 140);
        titles.push(`meeting (${d10(m.start_time || m.created_at)}): ${String(m.title || 'Meeting').slice(0, 70)}${snip ? ` — "${snip}"` : ''}`);
      }
    }
    const calIds = kindIds('calendar_event').slice(0, 3);
    if (calIds.length) {
      const { data: evs } = await supabase.from('calendar_events').select('title, start_time, attendees').in('id', calIds);
      for (const ev of (evs ?? []) as Array<{ title?: string; start_time?: string; attendees?: unknown }>) {
        const att = (Array.isArray(ev.attendees) ? ev.attendees : []).map((x) => (x as { email?: string })?.email).filter(Boolean).slice(0, 4).join(', ');
        titles.push(`calendar (${d10(ev.start_time)}): ${String(ev.title || 'Meeting').slice(0, 70)}${att ? ` [${att}]` : ''}`);
      }
    }
    // The entity's JUDGED state (where it stands / who owes what) — an open "they owe documentation"
    // matched by the other entry's "here is the documentation" is decisive remembered-twice evidence.
    const st = ((r.state ?? {}) as { summary?: string; whoOwes?: { you?: string[]; them?: string[] } });
    const standing = [
      st.summary ? String(st.summary).slice(0, 160) : '',
      st.whoOwes?.them?.length ? `they owe: ${st.whoOwes.them.join('; ').slice(0, 120)}` : '',
      st.whoOwes?.you?.length ? `you owe: ${st.whoOwes.you.join('; ').slice(0, 120)}` : '',
    ].filter(Boolean).join(' · ') || null;
    entities.push({
      id: r.id as string, name: r.name as string, summary: (r.summary as string) ?? null,
      aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
      people: Array.isArray(r.people) ? (r.people as string[]) : [],
      embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
      itemTitles: titles, standing, linkCount: count ?? lrows.length, createdAt: (r.created_at as string) || '',
    });
  }

  // Pair-verdict MEMORY: previously-judged-'separate' pairs (sig-matched) are skipped — no re-asking.
  // Graceful pre-migration (20260721c): a failed read degrades to re-judging.
  const judgedSeparate = new Map<string, string>();
  try {
    const { data: refl } = await supabase.from('entity_reflections').select('pair_key, sig').eq('user_id', userId).eq('verdict', 'separate');
    for (const r of (refl ?? []) as Array<{ pair_key: string; sig: string | null }>) judgedSeparate.set(r.pair_key, r.sig ?? '');
  } catch { /* pre-migration */ }

  // Shortlist adjacent pairs (upper triangle, floor + cap) — PLUS shared-company pairs. Two entities
  // founded from different FACETS of one deal (a person's meeting channel vs the company's thread) can
  // embed far apart, so embedding adjacency alone misses exactly the fragmentation reflection exists to
  // heal. A RARE external "@domain" token shared by two entities (the company held by ≤3 entities — a
  // domain spread wider is a portfolio company with many genuine deals) force-shortlists the pair; the
  // judge still decides, so sibling deals at one company stay separate.
  const domainCount = new Map<string, number>();
  for (const e of entities) for (const d of new Set(e.people.filter((p) => p.startsWith('@')))) domainCount.set(d, (domainCount.get(d) ?? 0) + 1);
  const sharedRareDomain = (a: Ent, b: Ent): boolean => {
    const bd = new Set(b.people.filter((p) => p.startsWith('@')));
    return a.people.some((p) => p.startsWith('@') && bd.has(p) && (domainCount.get(p) ?? 99) <= 3);
  };
  const pairs: Array<{ a: Ent; b: Ent; s: number; domainPair: boolean }> = [];
  for (let i = 0; i < entities.length; i++) for (let j = i + 1; j < entities.length; j++) {
    const a = entities[i], b = entities[j];
    if (!a.embedding || !b.embedding) continue;
    const s = cosine(a.embedding, b.embedding);
    const domainPair = sharedRareDomain(a, b);
    if (s >= PAIR_SIM_FLOOR || domainPair) pairs.push({ a, b, s, domainPair });
  }
  // Shared-company pairs FIRST (they're the fragmentation signal this pass exists to heal — sorted by
  // similarity alone they'd sit below high-sim lookalikes and starve under MAX_PAIRS forever), then
  // embedding-adjacent pairs by similarity.
  pairs.sort((x, y) => (Number(y.domainPair) - Number(x.domainPair)) || (y.s - x.s));
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
      `(one deal, one program, one engagement) referred to in different ways.\n` +
      `One SHARED COMPANY across both (same "@domain" in the people, teammates of each other) plus the same ` +
      `underlying matter is the classic remembered-twice case — one entry was founded from a meeting/person ` +
      `facet, the other from the company facet. Two genuinely different deals at one company stay separate.\n` +
      `CAUTION: each entry's one-line description was written when it was FOUNDED, possibly from a single ` +
      `email — it can misread the matter. Weigh the ITEMS and the SHARED IDENTITY over the descriptions.\n\n` +
      (sharedIdentity(a, b).length
        ? `SHARED IDENTITY — these tokens appear on BOTH entries' fingerprints: ${sharedIdentity(a, b).join(', ')}. ` +
          `The same specific external people/company on both is strong remembered-twice evidence.\n\n`
        : '') +
      `[A] "${a.name}"${a.summary ? ` — ${a.summary}` : ''}${a.standing ? `\n  where it stands: ${a.standing}` : ''}${a.people.length ? `\n  people: ${a.people.slice(0, 8).join(', ')}` : ''}\n  items:\n${a.itemTitles.map((t) => `   - ${t.slice(0, 260)}`).join('\n') || '   (none)'}\n\n` +
      `[B] "${b.name}"${b.summary ? ` — ${b.summary}` : ''}${b.standing ? `\n  where it stands: ${b.standing}` : ''}${b.people.length ? `\n  people: ${b.people.slice(0, 8).join(', ')}` : ''}\n  items:\n${b.itemTitles.map((t) => `   - ${t.slice(0, 260)}`).join('\n') || '   (none)'}\n\n` +
      `A strong cross-check: if one entry's OPEN state ("they owe X", "awaiting X") is FULFILLED by the ` +
      `other entry's items ("as agreed, here is X"), they are one body of work caught mid-handoff.\n` +
      `Return ONLY JSON: {"verdict":"merge|separate","reason":"<=18 words, judged from content"}`;
    // DEEP shape deliberately: a merge verdict is rare (≤MAX_PAIRS per run, sig-memoried), and both
    // failure modes are trust-critical — a wrong merge collapses two deals, a missed merge is the
    // fragmentation the user feels. Recognizing that "catalogue + portal credentials sent after the
    // meeting" fulfills "clarify data source integrations" takes real inference, not pattern-matching.
    //
    // MAJORITY-OF-3 on shared-identity pairs: these are the high-stakes fragmentation candidates AND
    // exactly where a single sample proved unstable (the same borderline pair flipped merge↔separate
    // across temperature-0 runs — and a wrongly-remembered 'separate' blocks healing until the sig
    // changes). Plain similarity pairs stay single-sample (cheap; the default answer is separate).
    const votesNeeded = sharedIdentity(a, b).length ? 3 : 1;
    const votes: Array<{ verdict: string; reason: string }> = [];
    for (let vi = 0; vi < votesNeeded; vi++) {
      const res = await aiCall<{ verdict?: string; reason?: string }>({
        userId, supabase, shape: { output: 'json', reasoning: 'deep' }, prompt, temperature: 0, maxTokens: 500, source: 'brain_synthesis',
      });
      votes.push({ verdict: String(res.json?.verdict || 'separate'), reason: String(res.json?.reason || '').slice(0, 140) });
      // Short-circuit once the majority is decided (2 same votes out of 3).
      if (votesNeeded === 3 && vi === 1 && votes[0].verdict === votes[1].verdict) break;
    }
    const mergeVotes = votes.filter((v) => v.verdict === 'merge').length;
    const isMerge = mergeVotes * 2 > votes.length;
    const reason = (votes.find((v) => (v.verdict === 'merge') === isMerge)?.reason) || votes[0].reason;
    if (!isMerge) {
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
      // THE ONE MERGE MECHANICS (absorbEntity) — editorial name choice + alias fold + link repoint +
      // loser deletion, shared with the user-commanded merge capability.
      await absorbEntity(supabase, userId, keep.id, lose.id);
      absorbed.add(lose.id);
      v.keptId = keep.id; v.mergedId = lose.id;
    }
    out.push(v);
  }
  return out;
}
