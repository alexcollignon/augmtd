// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DECK CARD'S CONTEXT DOOR (W3.6 · DECK CARDS WITH CONTEXT).
//
// POST { ids: string[] } — the commitment ids the Home handed the triage deck — returns each one's
// source (W16.4 — the item page's OWN source: the source message by its id, its quote, or the
// meeting; the thread's inbox item only as the "Open thread" door) in ONE batched read through the
// one source reader (lib/triage/deck-context-read.ts → lib/commitments/source.ts). The session's own
// client (RLS), zero AI, no writes. The brief's hot path is untouched: the deck asks for this only
// when a stack is actually opened, and the client door coalesces every card's ask into one call.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readDeckContexts, DECK_CONTEXT_MAX_IDS } from '@/lib/triage/deck-context-read';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string').slice(0, DECK_CONTEXT_MAX_IDS) : [];
  } catch { /* an unreadable body is an empty ask */ }
  try {
    const contexts = await readDeckContexts(supabase, user.id, ids);
    return NextResponse.json({ contexts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // A failed read is silence on the card, never an error card (the deck's in-flight rule).
    return NextResponse.json({ contexts: {} }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
