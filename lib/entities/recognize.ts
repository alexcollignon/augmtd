// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE BRAIN — RECOGNITION (Phase A, docs/one-brain-plan.md). How things enter the memory.
//
// A human doesn't classify a new email into a taxonomy — they RECOGNIZE it against what they remember:
// "ah, this is that pilot we discussed Tuesday." This module replicates that:
//   1. STRUCTURAL — a reply in an already-linked thread IS that conversation (identity by construction,
//      zero AI). The only mechanical step, because no decision exists.
//   2. RECALL — embed the item's content, cosine against the entity summaries (+ recently-active) —
//      memory retrieval, not a decision.
//   3. JUDGMENT — one reasoned call with the candidate entities' actual descriptions in view: which
//      remembered body of work is this about, is it something new, or is it not work at all? Judged by
//      CONTENT — the sender is a participant, never the decider (the person-prior bug this replaces).
//
// The entity's name is an OUTPUT of memory. Items link to entity IDs — synonyms are structurally
// impossible. Every link carries `via` + `reason` (auditable). SHADOW MODE: nothing user-facing reads
// work_entities yet; quality is proven against the Phase-0 label baseline first.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { embedText } from '@/lib/knowledge/indexer';

// ── The item shape recognition reads (assembled by callers from any source: email/meeting/calendar). ──
export type RecogItem = {
  kind: 'inbox_item' | 'meeting' | 'calendar_event' | 'commitment';
  id: string;
  title: string;                 // subject / meeting title / description
  body?: string | null;          // content excerpt
  from?: string | null;          // sender/counterparty — an IDENTITY signal (weighted by item shape)
  participants?: string[];       // other people involved
  at?: string | null;            // ISO timestamp
  threadId?: string | null;      // email thread — the structural-inheritance key
  // PROVENANCE — a DERIVED item (a commitment/task extracted from a parent email or meeting) has no
  // independent identity; it IS a fragment of its parent. It inherits the parent's entity structurally,
  // never re-guessed on topic. This is the fix for same-topic cross-deal over-merge.
  parent?: { kind: 'meeting' | 'inbox_item'; id: string } | null;
  /** Promise fix #5 — KIND-AWARE FOUNDING: noise mail (receipt/newsletter/notification kind, or an
   *  automated sender) may JOIN an existing real body of work, but can never FOUND a new entity —
   *  a Binance alert is not an initiative. Set by the source mappers from the ONE kind resolver. */
  noise?: boolean;
};

// A remembered entity, as recognition sees it (works for both the DB store and the shadow's in-memory one).
export type RecogEntity = {
  id: string;
  name: string;
  summary: string | null;
  aliases?: string[];            // identity forms — with `name`, the ONLY text the named-subject veto trusts
  people: string[];              // the entity's PEOPLE fingerprint — a primary identity signal
  embedding: number[] | null;
};

// ── People identity helpers — the primary separator for a same-domain portfolio (many deals share a
// topic; the PEOPLE distinguish them). A person is identified by EVERY form they arrive in — display
// name, full email address, and their company DOMAIN — because real correspondence mixes forms freely
// (the trust bug this fixes: a deal remembered under a colleague's NAME form never recalled when a NEW
// teammate emailed from the same company; the fragment became a duplicate entity). Agnostic: domains
// derive from each item's own addresses; free providers are excluded; rarity-weighting (below) makes an
// internal always-everywhere domain non-distinctive automatically.
// Canonical free-provider list for the entity layer (a shared consumer domain is NOT a company signal).
export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de',
  'mail.com', 'yandex.com', 'zoho.com', 'pm.me', 'fastmail.com', 'hey.com', 'sapo.pt', 'web.de',
]);
// Diacritics FOLD (é→e), never strip — "Chloé" must normalize to "chloe", not the useless "chlo".
const foldDiacritics = (s: string): string => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

export const normPerson = (s: string): string => {
  const t = foldDiacritics(String(s || '').toLowerCase()).trim();
  const local = t.includes('@') ? t.split('@')[0] : t;
  return local.replace(/[._\-]+/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
};

/** Era-proof set-membership key: spaces stripped, so "jean marie lambert" ≡ "jeanmarie lambert"
 *  (older fingerprints normalized hyphens differently — matching must not care). */
export const personKey = (s: string): string => s.replace(/\s+/g, '');

/** ALL identity tokens for ONE raw participant string ("Name <email>" / bare email / bare name):
 *  the name form, the full email, and the company "@domain" token (external-company signal). */
export function personForms(raw: string): string[] {
  const t = foldDiacritics(String(raw || '').toLowerCase()).trim();
  if (!t) return [];
  const out = new Set<string>();
  const email = t.match(/[^\s<>"',;]+@[^\s<>"',;]+/)?.[0] ?? null;
  if (email) {
    out.add(email);                                             // exact identity — a bare address matches forever
    const domain = email.split('@')[1] ?? '';
    if (domain && !FREE_EMAIL_DOMAINS.has(domain)) out.add(`@${domain}`); // the company token
    const local = normPerson(email.split('@')[0]);
    if (local.length >= 2) out.add(local);                      // "jean.marie" → "jean marie"
  }
  const nameOnly = normPerson(t.replace(/<[^>]*>/g, ' ').replace(/[^\s]+@[^\s]+/g, ' '));
  if (nameOnly.length >= 2) out.add(nameOnly);
  return [...out];
}

export const itemPeople = (it: RecogItem): string[] =>
  [...new Set([it.from, ...(it.participants ?? [])].filter(Boolean).flatMap((p) => personForms(p as string)))];

export type RecogDecision =
  | { decision: 'existing'; entityId: string; reason: string }
  | { decision: 'new'; name: string; summary: string; reason: string }
  | { decision: 'none'; reason: string };

// ── Pure pieces (shared by the DB pipeline and the in-memory shadow) ─────────────────────────────

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** The text recognition embeds for an ITEM (content-first: title + body lead; people are context). */
export const itemEmbedText = (it: RecogItem): string =>
  `${it.title}\n${(it.body || '').slice(0, 500)}`;

/** The text an ENTITY's recall index embeds (its self-description). */
export const entityEmbedText = (name: string, summary: string | null, people: string[]): string =>
  `${name}\n${summary || ''}\npeople: ${people.slice(0, 6).join(', ')}`;

/** Recall: rank remembered entities by IDENTITY (shared people) FIRST, topic second. Distinctive shared
 *  people (rare across the portfolio) are a strong signal; a person on every body of work (an internal
 *  colleague) is not. Topic breaks ties and generates candidates when people are unknown. Any entity that
 *  shares a distinctive person is ALWAYS a candidate (so the judge sees it even if the topic is lukewarm). */
export function recallCandidates(itemEmb: number[], entities: RecogEntity[], k = 5, people: string[] = []): RecogEntity[] {
  // Era-proof matching: tokens compare on personKey (spaces stripped), so fingerprints written under an
  // older normalization ("jeanmarie lambert") still match today's forms ("jean marie lambert"). The same
  // set carries name forms, full emails, AND "@domain" company tokens — one mechanism, rarity-weighted:
  // an internal domain that appears on everything scores ~0 rarity and is never distinctive, while an
  // external client's domain is rare → a NEW person from that company still force-recalls the deal
  // (the fragmentation fix: same company ⇒ the deal is at least a CANDIDATE the judge must see).
  const want = new Set(people.map(personKey));
  // Token rarity: how many entities contain each token (a token on many entities is not distinctive).
  const freq = new Map<string, number>();
  for (const e of entities) for (const p of new Set(e.people.map(personKey))) freq.set(p, (freq.get(p) ?? 0) + 1);
  const total = Math.max(1, entities.length);
  const scored = entities
    .filter((e) => e.embedding && e.embedding.length)
    .map((e) => {
      const topic = cosine(itemEmb, e.embedding!);
      let personScore = 0; let distinctiveShare = false;
      for (const p of new Set(e.people.map(personKey))) {
        if (!want.has(p)) continue;
        const rarity = 1 - (freq.get(p) ?? total) / total; // 0 = on everything, →1 = unique to few
        const isDomain = p.startsWith('@');
        // A shared person is the strongest signal; a shared company domain is strong but slightly
        // weaker (one company can hold sibling deals — the judge separates those by content).
        personScore += (isDomain ? 0.3 : 0.4) + 0.6 * rarity;
        if (rarity >= 0.7) distinctiveShare = true;         // distinctive shared identity → force-candidate
      }
      return { e, score: topic + personScore, distinctiveShare };
    });
  const top = scored.sort((a, b) => b.score - a.score).slice(0, k);
  // Guarantee: every entity sharing a DISTINCTIVE token is in the candidate set (identity beats topic rank).
  for (const s of scored) if (s.distinctiveShare && !top.some((t) => t.e.id === s.e.id)) top.push(s);
  return top.map((x) => x.e);
}

/** THE judgment — one reasoned call, candidates' real descriptions in view, content decides. */
export async function judgeRecognition(
  userId: string,
  supabase: SupabaseClient,
  item: RecogItem,
  candidates: RecogEntity[],
): Promise<RecogDecision> {
  const cands = candidates
    .map((e, i) => `[E${i + 1}] "${e.name}"${e.summary ? ` — ${e.summary}` : ''}${e.people.length ? ` (people: ${e.people.slice(0, 5).join(', ')})` : ''}`)
    .join('\n');
  const prompt =
    `You maintain a person's MEMORY of the distinct bodies of work in their life — deals, client engagements, ` +
    `programs, hires, recurring operations, personal projects. A new item just arrived. Decide which ` +
    `remembered body of work it belongs to — judged FIRST by IDENTITY (the people involved), then by topic.\n\n` +
    `HOW TO JUDGE (this is a specialist's portfolio — MANY bodies of work share the same topic, e.g. several ` +
    `separate deals are all "AI use cases / GPU / assessment"; TOPIC ALONE CANNOT tell them apart):\n` +
    `- The PEOPLE are the strongest separator. If this item's people match a candidate's people, it is very ` +
    `likely the SAME body of work. If the topic is similar but the PEOPLE are DIFFERENT, it is almost ` +
    `certainly a DIFFERENT body of work — do NOT merge on topic alone.\n` +
    `- A person can be in several bodies of work, so a shared person is strong evidence, not proof; but ` +
    `DISjoint people is strong evidence AGAINST merging. When in doubt between two topically-similar ` +
    `candidates, pick the one whose PEOPLE overlap; if none overlap, prefer "new".\n` +
    `- COMPANY DOMAINS: a token like "@acme.com" in a people list is that body of work's company. A NEW ` +
    `person writing from the SAME company domain as a candidate's people is usually a teammate joining ` +
    `that SAME body of work (teams grow, threads fork) — prefer "existing" unless the content is clearly ` +
    `a genuinely different deal at that company.\n` +
    `- SAME PEOPLE ≠ SAME DEAL (the channel-contact rule): a contact at a PARTNER/vendor/agency org often ` +
    `brokers SEVERAL separate engagements for different end clients — the same account manager runs the ` +
    `Acme assessment AND the Beta Corp assessment. When the item itself NAMES its engagement or end client ` +
    `and that name is NOT the candidate's, it is a DIFFERENT body of work no matter how perfectly the ` +
    `people match. Report the name you see as "named_engagement" (the proper name THIS item says it is ` +
    `about — an end client, deal, or program name; null when the item names none).\n\n` +
    `NEW ITEM (${item.kind}):\n` +
    `title: ${item.title}\n` +
    (item.from ? `person: ${item.from}\n` : '') +
    (item.participants?.length ? `participants: ${item.participants.slice(0, 6).join(', ')}\n` : '') +
    (item.body ? `content: ${item.body.slice(0, 700)}\n` : '') +
    `\nREMEMBERED bodies of work (candidates — note their people):\n${cands || '(none yet)'}\n\n` +
    `A body of work is a DISTINCT ONGOING effort with its own purpose/outcome — a deal, client engagement, ` +
    `program, hire, operation, or personal project — that accrues work over time. A single conversation, a ` +
    `recurring 1:1, or a standing sync is a CHANNEL, NOT a body of work: a meeting named after the people in ` +
    `it ("X x Y") is almost always just the channel for a deal — judge it by what it is ABOUT.\n\n` +
    `Return ONLY JSON:\n` +
    `{"decision":"existing|new|none","entity":"E1|E2|…|null","named_engagement":"the proper name THIS item states for its engagement/end client, or null","new_name":"<=5 words, the body of work's natural name (client/deal/program) — NEVER just two people's names, or null","new_summary":"<=20 words, what this body of work IS, or null","reason":"<=15 words citing the deciding PEOPLE or matter"}\n` +
    `- "existing": the same body of work as a candidate — INCLUDING a 1:1/sync that ADVANCES a candidate deal (attach it to that deal, don't spin off a new one).\n` +
    `- "new": a genuinely DISTINCT ongoing body of work no candidate covers. Do NOT found a project named after the people meeting — if there's no distinct deal/program yet, it is not "new".\n` +
    `- "none": not a body of work — a broadcast/newsletter/notification, a personal/status catch-up, or a recurring 1:1/sync that advances no distinct ongoing work.`;

  const res = await aiCall<{ decision?: string; entity?: string | null; named_engagement?: string | null; new_name?: string | null; new_summary?: string | null; reason?: string }>({
    userId, supabase, shape: { output: 'json' }, prompt, temperature: 0, maxTokens: 300, source: 'brain_synthesis',
  });
  const p = res.json ?? {};
  const reason = String(p.reason || '').slice(0, 140);
  if (p.decision === 'existing' && p.entity) {
    const idx = parseInt(String(p.entity).replace(/\D/g, ''), 10) - 1;
    const hit = candidates[idx];
    if (hit) {
      // ── THE NAMED-SUBJECT VETO (R-class, code-checked like every consequential claim): when the
      // model itself reports the item NAMES an engagement, and that name shares no distinctive
      // token with the chosen entity's IDENTITY — its NAME + ALIASES, deliberately NEVER its
      // summary: an over-merged entity's summary absorbs the intruder's own words ("engagement
      // with Arcapita in Bahrain") and would validate the very contamination being vetoed — the
      // attach is structurally forbidden (the channel-contact over-merge: same partner people
      // running Acme AND Beta Corp). The verdict converts to founding the named work.
      const named = String(p.named_engagement ?? '').trim();
      if (named && !/^(null|none|n\/a)$/i.test(named)
        && !namesOverlap(named, `${hit.name} ${(hit.aliases ?? []).join(' ')}`)) {
        return {
          decision: 'new', name: named.slice(0, 80),
          summary: String(p.new_summary || '').slice(0, 200) || `Engagement the item names as "${named.slice(0, 60)}"`,
          reason: `named-subject veto: item is about "${named.slice(0, 40)}", not ${hit.name.slice(0, 40)} (${reason})`.slice(0, 140),
        };
      }
      return { decision: 'existing', entityId: hit.id, reason };
    }
  }
  if (p.decision === 'new' && p.new_name) {
    return { decision: 'new', name: String(p.new_name).slice(0, 80), summary: String(p.new_summary || '').slice(0, 200), reason };
  }
  return { decision: 'none', reason };
}

// Distinctive-token overlap for the named-subject veto: generic WORK-TYPE words (assessment,
// project, program…) are shared by every engagement in a specialist portfolio and prove nothing —
// only a distinctive token (a client/deal proper name) counts as a match. Mirrors the July-15
// suggestion-guard lesson ("the user's own company token is too broad to drive a match").
export const GENERIC_WORK_WORDS = new Set([
  'assessment', 'assessments', 'project', 'program', 'programme', 'engagement', 'deal', 'report',
  'reports', 'initiative', 'pilot', 'workshop', 'training', 'launch', 'phase', 'sprint', 'review',
  'analysis', 'audit', 'proposal', 'operations', 'alignment', 'readiness', 'strategy', 'the', 'and',
  'for', 'with', 'new',
]);
/** ONE cheap read: what engagement/end-client does this item say it is about? (The same question
 *  the recognition judge answers inline — shared by the thread-drift guard + the repair sweep.) */
export async function extractNamedEngagement(
  supabase: SupabaseClient, userId: string, title: string, body: string,
): Promise<string | null> {
  try {
    const res = await aiCall<{ named_engagement?: string | null }>({
      userId, supabase, shape: { output: 'json' }, temperature: 0, maxTokens: 80, source: 'brain_synthesis',
      prompt: `What engagement/end-client does THIS item say it is about? Return the PROPER NAME the item ` +
        `itself states (an end client, deal, or program name), or null if it names none.\n` +
        `title: ${title.slice(0, 140)}\ncontent: ${body.slice(0, 500)}\n` +
        `JSON only: {"named_engagement":"<proper name or null>"}`,
    });
    const named = String(res.json?.named_engagement ?? '').trim();
    return named && !/^(null|none|n\/a)$/i.test(named) ? named.slice(0, 80) : null;
  } catch { return null; }
}

export function namesOverlap(named: string, entityText: string): boolean {
  const hay = entityText.toLowerCase();
  const tokens = named.toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !GENERIC_WORK_WORDS.has(t) && !/^(ai|ia|ml)$/.test(t));
  if (!tokens.length) return true; // the name is all-generic ("AI Assessment") — no veto signal, trust the judge
  return tokens.some((t) => hay.includes(t));
}

// ── The DB pipeline (Phase A shadow; consumers attach in Phase C) ────────────────────────────────

export async function recognizeItem(
  supabase: SupabaseClient,
  userId: string,
  item: RecogItem,
  depth = 0,
): Promise<{ entityId: string | null; via: 'structural' | 'recognized' | 'none' | null; founded: boolean; reason?: string }> {
  if (depth > 2) return { entityId: null, via: null, founded: false }; // provenance-recursion backstop
  // Already seen? (idempotent — INCLUDING refusals: a via='none' row means "judged not-work", never re-judge.
  // Without this the verdict could flip as the candidate set grows — the duplicate-founding bug.)
  const { data: existing } = await supabase.from('entity_links').select('entity_id, via')
    .eq('user_id', userId).eq('item_kind', item.kind).eq('item_id', item.id).maybeSingle();
  if (existing) return { entityId: (existing.entity_id as string) ?? null, via: existing.via as 'structural' | 'recognized' | 'none', founded: false };

  // 1. STRUCTURAL — the thread is already part of an entity → this item is too… UNLESS the item
  // itself names a DIFFERENT engagement (THE THREAD-DRIFT GUARD, R-class): partner/channel threads
  // get reused and pivoted across end clients, so blind thread inheritance re-imports the
  // channel-contact over-merge PAST every judge (found live: an "STC Bahrain" email inheriting an
  // Arcapita thread link). Deterministic fast path first — an item whose own text carries the
  // entity's identity tokens inherits at zero cost; only a never-mentions-it item pays ONE cheap
  // named-engagement read. A conflicting name refuses inheritance and falls through to the judged
  // path, whose named-subject veto places it correctly. A contentless follow-up (names nothing)
  // still inherits — that is what threads are for.
  if (item.threadId) {
    const { data: threadLink } = await supabase.from('entity_links').select('entity_id')
      .eq('user_id', userId).eq('item_kind', 'email_thread').eq('item_id', item.threadId).maybeSingle();
    if (threadLink) {
      let drifted = false;
      try {
        const { data: tEnt } = await supabase.from('work_entities').select('name, aliases')
          .eq('id', threadLink.entity_id as string).eq('user_id', userId).maybeSingle();
        const identity = `${tEnt?.name ?? ''} ${(Array.isArray(tEnt?.aliases) ? (tEnt!.aliases as string[]) : []).join(' ')}`.trim();
        const itemText = `${item.title} ${(item.body || '').slice(0, 600)}`;
        if (identity && !namesOverlap(identity, itemText)) {
          const named = await extractNamedEngagement(supabase, userId, item.title, item.body || '');
          if (named && !namesOverlap(named, identity)) drifted = true;
        }
      } catch { /* the guard is a refinement — inheritance stands on failure */ }
      if (!drifted) {
        await writeLink(supabase, userId, threadLink.entity_id as string, item, 'structural', 'same thread');
        return { entityId: threadLink.entity_id as string, via: 'structural', founded: false };
      }
      // drifted → no inheritance; the item is judged on its own below.
    }
  }

  // 2. PROVENANCE — a DERIVED item (a commitment extracted from a meeting/email) inherits its PARENT's
  // entity as a FACT. Its own text is a generic fragment ("obtain the GPU specs") that topic-recognition
  // would scatter into a same-topic-but-wrong deal; its parent's identity is certain. If the parent isn't
  // recognized yet, recognize it inline (one level; a parent never has a parent → no loop). If the parent
  // is 'none' (not work), the fragment falls through to its own recognition.
  if (item.parent) {
    let parentEntity = await lookupLink(supabase, userId, item.parent.kind, item.parent.id);
    if (parentEntity === undefined) {
      const parentItem = await fetchParent(supabase, userId, item.parent);
      if (parentItem) { await recognizeItem(supabase, userId, parentItem, depth + 1); parentEntity = await lookupLink(supabase, userId, item.parent.kind, item.parent.id); }
    }
    if (parentEntity) {
      await writeLink(supabase, userId, parentEntity, item, 'structural', `from ${item.parent.kind === 'meeting' ? 'meeting' : 'email'}`);
      await supabase.from('work_entities').update({ last_event_at: item.at ?? new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', parentEntity).eq('user_id', userId).then(() => {}, () => {});
      return { entityId: parentEntity, via: 'structural', founded: false, reason: 'provenance' };
    }
    // parentEntity === null means the parent was judged 'none' → let the fragment try on its own.
  }

  // 3. RECALL — the user's remembered entities WITH their people fingerprint, scored IDENTITY-first.
  // Resilient to pre-migration (no `people` column): fall back to the fingerprint-less select.
  let rows = (await supabase.from('work_entities')
    .select('id, name, summary, aliases, embedding, people')
    .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(400)).data as Array<Record<string, unknown>> | null;
  if (!rows) rows = (await supabase.from('work_entities')
    .select('id, name, summary, embedding')
    .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(400)).data as Array<Record<string, unknown>> | null;
  const entities: RecogEntity[] = (rows ?? []).map((r) => ({
    id: r.id as string, name: r.name as string, summary: (r.summary as string) ?? null,
    aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
    people: Array.isArray(r.people) ? (r.people as string[]) : [],
    embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
  }));
  const people = itemPeople(item);
  const itemEmb = await embedText(itemEmbedText(item), userId, supabase);
  const candidates = recallCandidates(itemEmb, entities, 5, people);

  // 3. JUDGMENT — reasoned, content-first, candidates in view.
  const verdict = await judgeRecognition(userId, supabase, item, candidates);

  if (verdict.decision === 'existing') {
    await writeLink(supabase, userId, verdict.entityId, item, 'recognized', verdict.reason);
    await supabase.from('work_entities').update({ last_event_at: item.at ?? new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', verdict.entityId).eq('user_id', userId);
    return { entityId: verdict.entityId, via: 'recognized', founded: false, reason: verdict.reason };
  }
  if (verdict.decision === 'new') {
    // Promise fix #5 — noise never founds: a receipt/newsletter/notification (or automated sender)
    // can join an EXISTING entity above, but a NEW entity from it would be registry pollution
    // (the "82 smaller things" class). Record the refusal instead.
    if (item.noise) {
      await supabase.from('entity_links').upsert(
        { user_id: userId, entity_id: null, item_kind: item.kind, item_id: item.id, via: 'none', reason: 'noise mail — never founds a new body of work' },
        { onConflict: 'user_id,item_kind,item_id' },
      ).then(() => {}, () => {});
      return { entityId: null, via: 'none', founded: false, reason: 'noise mail — never founds a new body of work' };
    }
    const emb = await embedText(entityEmbedText(verdict.name, verdict.summary, item.from ? [item.from] : []), userId, supabase);
    const { data: created } = await supabase.from('work_entities')
      .insert({ user_id: userId, kind: 'initiative', name: verdict.name, summary: verdict.summary, embedding: emb, last_event_at: item.at ?? new Date().toISOString() })
      .select('id').single();
    const entityId = (created?.id as string) ?? null;
    if (entityId) await writeLink(supabase, userId, entityId, item, 'recognized', verdict.reason);
    return { entityId, via: 'recognized', founded: true, reason: verdict.reason };
  }
  // 'none' — record the REFUSAL (entity_id NULL) so the item is never re-judged. Non-fatal pre-ALTER
  // (20260721b): if the column is still NOT NULL the write fails silently and behavior degrades to re-judging.
  await supabase.from('entity_links').upsert(
    { user_id: userId, entity_id: null, item_kind: item.kind, item_id: item.id, via: 'none', reason: verdict.reason.slice(0, 140) },
    { onConflict: 'user_id,item_kind,item_id' },
  ).then(() => {}, () => {});
  return { entityId: null, via: 'none', founded: false, reason: verdict.reason };
}

async function writeLink(supabase: SupabaseClient, userId: string, entityId: string, item: RecogItem, via: 'structural' | 'recognized' | 'user', reason: string): Promise<void> {
  await supabase.from('entity_links').upsert(
    { user_id: userId, entity_id: entityId, item_kind: item.kind, item_id: item.id, via, reason: reason.slice(0, 140) },
    { onConflict: 'user_id,item_kind,item_id' },
  );
  // The thread inherits the entity too, so every later reply short-circuits structurally (no AI).
  if (item.threadId) {
    await supabase.from('entity_links').upsert(
      { user_id: userId, entity_id: entityId, item_kind: 'email_thread', item_id: item.threadId, via, reason: 'thread of a linked item' },
      { onConflict: 'user_id,item_kind,item_id' },
    );
  }
  // ACCUMULATE the entity's PEOPLE fingerprint — the identity signal recall/judge use to separate
  // same-topic deals. Additive union, capped; cheap read-merge-write.
  const add = itemPeople(item);
  if (add.length) {
    try {
      const { data: e } = await supabase.from('work_entities').select('people').eq('id', entityId).eq('user_id', userId).maybeSingle();
      const cur = Array.isArray(e?.people) ? (e!.people as string[]) : [];
      const merged = [...new Set([...cur, ...add])].slice(0, 40);
      if (merged.length !== cur.length) await supabase.from('work_entities').update({ people: merged }).eq('id', entityId).eq('user_id', userId);
    } catch { /* pre-migration / non-fatal */ }
  }
}

/** Look up an item's entity link: entityId string if linked, null if refused ('none'), undefined if unseen. */
async function lookupLink(supabase: SupabaseClient, userId: string, kind: string, id: string): Promise<string | null | undefined> {
  const { data } = await supabase.from('entity_links').select('entity_id, via').eq('user_id', userId).eq('item_kind', kind).eq('item_id', id).maybeSingle();
  if (!data) return undefined;
  return (data.entity_id as string) ?? null;
}

/** Build a parent's RecogItem from its row (for inline provenance recognition). */
async function fetchParent(supabase: SupabaseClient, userId: string, parent: { kind: 'meeting' | 'inbox_item'; id: string }): Promise<RecogItem | null> {
  const { itemFromMeeting, itemFromInbox } = await import('./sources');
  if (parent.kind === 'meeting') {
    const { data } = await supabase.from('meeting_transcripts').select('id, title, summary, attendees, start_time, created_at').eq('id', parent.id).eq('user_id', userId).maybeSingle();
    return data ? itemFromMeeting(data) : null;
  }
  const { data } = await supabase.from('inbox_items').select('id, work_title, source_data, created_at').eq('id', parent.id).eq('user_id', userId).maybeSingle();
  return data ? itemFromInbox(data) : null;
}
