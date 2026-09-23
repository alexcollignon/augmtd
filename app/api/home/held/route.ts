// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HELD-QUIET LEDGER (docs/attention-plan.md, law A3).
//
// "Suppression is a POSTURE WITH RECEIPTS, never a dismissal." This route is the account: everything
// the agent ingested and chose not to interrupt you with, in classes, each with a stated
// consequence of waiting, each member carrying why IT is held.
//
// ONE HOME (Sep 17): the derivation itself lives in `lib/deeds/held-members.ts` (`deriveHeld`) —
// the SAME function the bulk deed acts through and the SAME function the Home's door counts with.
// This route is now what it should always have been: auth, one call, one pure ledger build, one
// JSON shape. Its two hard properties survive in the module and are gated there:
//   • ZERO AI — every class derives from verdicts and floors that ALREADY EXIST.
//   • THE PARTITION — every held item lands in EXACTLY ONE class (one pass, first-match precedence
//     in `lib/home/attention.ts`), so the class counts can only sum to the held total.
//
// Q2 · THE THREE BANDS (Sep 17, PART III). "Held ≠ handled — it's 0 to 100, no in-between." The
// payload now splits the same one partition into WAITING (alive, real, held only by the budget — the
// ONLY number the Home's door speaks), WATCHED (copied in / somebody else owes the move — one line),
// and HANDLED (the big number: the classes, their counts, their consequences, their verbs). The
// bands are computed by the SAME pure pass that files the classes, so they cannot disagree with it,
// and `filedThisMonth` is Q3's receipt read from the activity log rather than estimated.
//
// ⚠️ THE DECK'S NON-MAIL HELD ROWS, stated rather than faked. This ledger's pool is PENDING MAIL, so
// a held commitment or a quietly-slipping deal is not in it. Those rows are NOT derivable here and
// the route deliberately does not try: a commitment's held-ness is a verdict of the DECK's budget
// (`attention.heldBack` on the brief, computed over the agenda's own lanes with the reasoned
// weights), and the slipping-deal lane exists only inside that agenda synthesis. Re-deriving either
// here would mean a second budget over a second pool — and the first time the two disagreed, the
// ledger would claim to be holding a row the Home is showing right now. So the Home hands them to
// the lens already worded in its OWN vocabulary (`deckHeldRows`), and the door's number adds the two
// the same way the ledger's intro does. One scale, two organs, each owning what it can derive.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse, after, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { HELD_MEMBERS_PER_CLASS } from '@/lib/home/attention';
import { deriveHeld } from '@/lib/deeds/held-members';
import { hydrateHeldBodies } from '@/lib/deeds/held-members';
// THE ONE PAYLOAD SHAPE + THE ONE WRITER, shared with the brief's primer (lib/deeds/held-cache).
import { HELD_CACHE_KIND, HELD_CACHE_MS, HELD_CACHE_MAX_MS, buildHeldPayload, storeHeldCache } from '@/lib/deeds/held-cache';
import { countGraduatedThisMonth } from '@/lib/work/graduation';

export const maxDuration = 60;

// ── THE LEDGER PAINTS WARM (owner, live Sep 18 — "it's not opening") ────────────────────────────
// `deriveHeld` walks the whole pending pool through the deck's own floors: ~8.7s on a real account,
// worse on a dev server. A lens the reader ASKED FOR must not make them watch that. So this route
// follows the house's instant-load doctrine exactly where the timeline route already does (the
// `item_plans` kind 'timeline_cache' precedent — zero-migration free-row idiom): serve the stored
// last-good NOW, converge in `after()`. The client's localStorage hydrate covers the paint before
// even this returns, and the deck opens on the rows it already holds before either.
//
// THE STALENESS IS 3 MINUTES, not the timeline's 45s: the derivation is ~10× the cost, and this
// page's own deeds bust the cache explicitly rather than waiting for a cycle.
//
// THE BUST IS THE DEED'S OWN (`?fresh=1`). Every mutation door this lens reaches — the row rail,
// the deck's verbs, a committed bulk deed — ends in the host's `reload`, which asks for a FRESH
// read; that path derives synchronously and REPLACES the stored payload. An account that still
// lists thirty messages it just archived is not an account, and a cache must never make it one.
//
// ONLY THE DEFAULT SHAPE IS CACHED. A paged read (`offset`/`limit`) is a different payload; it
// derives for itself and never reads or writes the one row.
// (The kind, the two staleness bounds, the payload shape and the writer all live in
//  lib/deeds/held-cache.ts — the brief's after() primes THIS row through the same two functions.)

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const todayISO = new Date().toISOString().slice(0, 10);
  const url = new URL(req.url);
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
  const perClass = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? HELD_MEMBERS_PER_CLASS) || HELD_MEMBERS_PER_CLASS));
  const fresh = url.searchParams.get('fresh') === '1';
  const cacheable = offset === 0 && perClass === HELD_MEMBERS_PER_CLASS;

  const derive = async () => {
    const derived = await deriveHeld(supabase, user.id, user.email ?? null);
    // Q3's RECEIPT — counted from the activity log's own rows, never estimated from the ledger's shape.
    const filedThisMonth = await countGraduatedThisMonth(supabase, user.id);
    // Q9 · THE DECK'S OWN DAY rides the payload: the triage deck composes its ← LATER whens from a
    // date, and a client that reads its own clock offers "tomorrow" for yesterday at 23:58 in the
    // wrong zone. `buildHeldPayload` stamps the day it was computed against.
    // THE HOT-PATH LAW: the derivation read no bodies; the rows this payload RENDERS get theirs now.
    await hydrateHeldBodies(supabase, user.id, derived, todayISO, { perClass, offset });
    return buildHeldPayload(derived, todayISO, { perClass, offset, filedThisMonth });
  };

  const deriveAndStore = async () => {
    const payload = await derive();
    if (cacheable) await storeHeldCache(supabase as never, user.id, payload);
    return payload;
  };

  if (!cacheable) return NextResponse.json(await derive());
  // THE DEED'S OWN READ — synchronous, and it restores the cache it just invalidated.
  if (fresh) return NextResponse.json(await deriveAndStore());

  const { data: cached } = await supabase.from('item_plans').select('tasks, updated_at')
    .eq('user_id', user.id).eq('kind', HELD_CACHE_KIND).eq('entity_id', 'home').maybeSingle();
  const cachedPayload = (cached?.tasks ?? null) as Record<string, unknown> | null;
  const age = cached?.updated_at ? Date.now() - Date.parse(cached.updated_at as string) : Infinity;

  if (cachedPayload && age < HELD_CACHE_MAX_MS) {
    // A last-good payload never speaks a day it did not compute against — the served day is the
    // server's own clock, always, because the deck's whens are composed from it.
    const served = { ...cachedPayload, today: todayISO, cachedAgeMs: age };
    if (age >= HELD_CACHE_MS) after(deriveAndStore); // serve last-good NOW; converge behind it
    return NextResponse.json(served);
  }
  return NextResponse.json(await deriveAndStore()); // first ever (or a day old) — derive in place
}
