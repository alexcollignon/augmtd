// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVENT RE-READ DOOR (Wave 2, Sep 22) — a persisted event card is a POINTER, never a snapshot.
//
// The collection card's law, one object over: what a card shows on a reload must be what is TRUE
// now. A stored `event_card` turn keeps `{eventId, proposal}` and this door re-derives the spec —
// the seat, the response, whether it has passed, and therefore WHICH VERBS the card may offer. An
// event accepted in Gmail, moved by its organizer, or already gone comes back wearing the truth.
//
// GET ONLY. Read-only, user-scoped, zero AI. The card's verbs act through ONE address, and it is
// the deeds door next to this one.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildEvent } from '@/lib/present/event-build';
import { sanitizeProposal } from '@/lib/present/event';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const spec = await buildEvent(supabase, user.id, id);
    // NOT YOURS IS INDISTINGUISHABLE FROM NOT THERE — the read is user-scoped, so a stranger's id
    // and a deleted one answer identically.
    if (!spec) return NextResponse.json({ error: 'that event is not on file' }, { status: 404 });

    // THE STORED PROPOSAL IS RE-VALIDATED, NEVER RESTORED. A persisted card carries the verb it was
    // armed with; whether that verb is still permitted is a question only the LIVE facts answer, so
    // the pointer's proposal comes back through `sanitizeProposal` over the spec just built. An
    // invitation accepted elsewhere, a meeting that has since passed, a move to a time now in the
    // past — all three drop the arming rather than re-offering a dead button.
    const sp = req.nextUrl.searchParams;
    const verb = sp.get('verb');
    const proposal = verb ? sanitizeProposal({
      verb,
      ...(sp.get('newStartISO') ? { newStartISO: sp.get('newStartISO') } : {}),
      ...(sp.get('newEndISO') ? { newEndISO: sp.get('newEndISO') } : {}),
      ...(sp.get('newLabel') ? { newLabel: sp.get('newLabel') } : {}),
      ...(sp.get('note') ? { note: sp.get('note') } : {}),
    }, spec.facts, { now: new Date() }) : null;

    return NextResponse.json({ spec: proposal ? { ...spec, proposal } : spec });
  } catch {
    return NextResponse.json({ error: 'that event could not be read' }, { status: 500 });
  }
}
