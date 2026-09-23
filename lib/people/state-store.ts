// Person Brain — the LIVE refresh of the PERSON ENTITY (work_entities kind='person'). Persists the
// synthesized per-person state so surfaces read instantly, and refreshes it as interactions happen. The ledger stays
// derived-on-read (brain.ts); only the synthesized bits are stored.
//
// LIVE mechanism: every ingestion point that touches a person (email sync, meeting insight, reply sent) calls
// `refreshPersonStates(userId, identifiers)` in the background — recompute ONLY the people who actually moved.
// A `people_sig` (event count + freshest timestamp) skips the AI call when nothing changed, so it's cheap.

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchPeopleCorpus, assemblePersonLedger, synthesizePerson, resolvePersonSeed, isRealPerson, type PersonCorpus } from '@/lib/people/brain';

// Refresh ONE person's state — WRITES THE PERSON ENTITY (One Brain demolition blocker B: person_state is
// legacy-read-only now; the live path targets work_entities kind='person', alias-aware, so a multi-address
// human keeps ONE fresh row). A new correspondent FOUNDS a person entity (the registry grows live). Sig-
// gated against the entity's sig. Non-fatal. A shared corpus (batch) avoids the bulk fetch.
export async function refreshPersonState(supabase: SupabaseClient, userId: string, idStr: string, opts: { force?: boolean; corpus?: PersonCorpus } = {}): Promise<void> {
  try {
    const corpus = opts.corpus ?? await fetchPeopleCorpus(supabase, userId);
    const seed = resolvePersonSeed(corpus, idStr);
    if (!seed) return;
    if (!isRealPerson(seed.email || idStr, seed.name)) return; // skip automated/no-reply senders
    // Resolve the person ENTITY (alias containment) — its full alias set widens the ledger assembly.
    const { getPersonEntities, findPersonEntity } = await import('@/lib/entities/people');
    let entity = findPersonEntity(await getPersonEntities(supabase, userId), seed.email, seed.name);
    // THE SELF ENTITY IS CODE-OWNED (W7.5): the person brain never writes it — no synthesized
    // relationship state on the user, and above all no alias absorption (this door once taught the
    // self row a correspondent's address). A seed that resolved to self by NAME but carries an address
    // self does not own is SOMEONE ELSE sharing a display name — they found their own row.
    if (entity?.state?.self === true) {
      const addr = seed.email?.toLowerCase().trim() ?? null;
      if (!addr || entity.aliases.includes(addr)) return;
      entity = null;
    }
    if (entity) seed.aliases = entity.aliases;
    const a = assemblePersonLedger(corpus, seed);
    if (!a) return;
    if (!opts.force && entity) {
      const { data: row } = await supabase.from('work_entities').select('sig').eq('id', entity.id).eq('user_id', userId).maybeSingle();
      if ((row as { sig?: string } | null)?.sig === a.sig) return; // unchanged → no AI, no write
    }
    const { state, nextTouch } = await synthesizePerson(supabase, userId, a);
    if (!state) return;
    const patch = {
      summary: state.summary, state, next_move: nextTouch, sig: a.sig,
      last_event_at: a.lastTouchAt, updated_at: new Date().toISOString(),
    };
    if (entity) {
      // Absorb any newly-seen address into the alias set (the registry learns).
      const aliases = [...new Set([...entity.aliases, ...(seed.email ? [seed.email] : [])])].slice(0, 12);
      await supabase.from('work_entities').update({ ...patch, aliases }).eq('id', entity.id).eq('user_id', userId);
    } else {
      await supabase.from('work_entities').insert({
        user_id: userId, kind: 'person', name: a.displayName || a.key,
        aliases: [...new Set([...(seed.email ? [seed.email] : []), ...(a.displayName ? [a.displayName] : [])])],
        tracked: false, status: 'active', ...patch,
      });
    }
  } catch { /* non-fatal */ }
}

// Refresh a SET of people (the ones who moved in a sync batch). Deduped by person key, bounded concurrency,
// ONE shared corpus fetch for the whole batch. Non-fatal; degrades to no-op pre-migration.
export async function refreshPersonStates(supabase: SupabaseClient, userId: string, identifiers: string[], opts: { force?: boolean } = {}): Promise<void> {
  try {
    const clean = [...new Set(identifiers.filter(Boolean).map((s) => s.trim()))];
    if (!clean.length) return;
    const corpus = await fetchPeopleCorpus(supabase, userId).catch(() => undefined);
    if (!corpus) return;
    // Resolve → dedupe by canonical person key (two aliases of one person collapse to one refresh).
    const byKey = new Map<string, string>();
    for (const id of clean) { const seed = resolvePersonSeed(corpus, id); if (seed && !byKey.has(seed.key)) byKey.set(seed.key, id); }
    const ids = [...byKey.values()];
    const CH = 4;
    for (let i = 0; i < ids.length; i += CH) {
      await Promise.all(ids.slice(i, i + CH).map((id) => refreshPersonState(supabase, userId, id, { ...opts, corpus })));
    }
  } catch { /* non-fatal — table may not exist yet */ }
}

// W2.6 DEMOLITION: the legacy `person_state` READERS (getPersonStates / getPersonState) are gone — the
// table has had no writer since July (refreshPersonState above writes the person ENTITY), and its last
// two consumers (the Home brief's relationship cue, the drafter's WHO block) now read the registry only.
