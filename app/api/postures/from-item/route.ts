// ════════════════════════════════════════════════════════════════════════════════════════════════
// ↓ NEVER'S POSTURE TAIL (docs/attention-plan.md PART III, Q9 · THE TRIAGE DECK).
//
// "↓ NEVER — archive + the A8 posture tail ('always?') → look-alikes go straight to Handled."
//
// THE SAME TAIL THE BULK DEED GROWS, ON A SET OF ONE. Everything here is A7/A8's machinery reused:
// the eligibility table, the composed sentence, the primitives, and THE ONE WRITER (`createPosture`)
// with its code-validation floor. This route exists only because the subject differs — one item the
// person just archived instead of a whole class they just swept — and the class that item belongs
// to has to be DERIVED rather than handed over.
//
// THE CLASS IS NEVER TAKEN FROM THE CLIENT. The card knows the row's class (it is served on the
// row), but a class arriving in a request body is a request to write a standing rule over whatever
// kind of mail the caller names. So the class is re-derived here through THE ONE DERIVATION
// (`deriveHeld` → `classifyHeld`), the same pass the ledger itself was read from — which also means
// a posture can only ever be offered over a class this account actually holds this item in.
//
// AND THE ELIGIBILITY TABLE STILL DECIDES. `postureFromDeed` is the one home for "is there a
// keepable standing version of this?", and its answer is unchanged by the subject's size: a class
// whose membership is a read-time verdict, or whose own account a standing archive would cancel,
// offers no tail here either. An unkeepable promise is worse than none.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deriveHeld } from '@/lib/deeds/held-members';
import { classifyHeld } from '@/lib/home/attention';
import { postureFromDeed } from '@/lib/postures/from-deed';
import { createPosture } from '@/lib/postures/registry';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { itemId?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const itemId = String(body.itemId ?? '').trim();
  if (!itemId) return NextResponse.json({ ok: false, reason: 'itemId is required' }, { status: 400 });

  // THE ONE DERIVATION, re-run. A posture is a deliberate, rare, standing decision — paying the
  // ledger's own pass for it buys the guarantee that the class we keep is the class this account
  // actually files the item under.
  const derived = await deriveHeld(supabase, user.id, user.email ?? null);
  const facts = derived.facts.find((f) => String(f.item.id) === itemId);
  if (!facts) {
    return NextResponse.json({
      ok: false,
      reason: 'I can no longer see that one in the held account, so there is no kind of mail for me to keep doing it to.',
    }, { status: 404 });
  }

  // ↓ IS AN ARCHIVE — the standing version of it is the archive verb, never a verb the person did
  // not fire. The eligibility table answers from there.
  const offer = postureFromDeed({ verb: 'archive', classKey: classifyHeld(facts) });
  if (!offer.ok) return NextResponse.json({ ok: false, reason: offer.reason }, { status: 422 });

  // THE CONNECTION THE POSTURE BELONGS TO (the from-deed precedent, and for the same reason: the
  // rules engine evaluates a CONNECTION's own rules, so a posture with no inbox is a promise that
  // could never fire). The item's own inbox first; the single inbox otherwise; a refusal that says
  // where to go rather than a rule that does nothing.
  let connectionId: string | null = null;
  try {
    const { data } = await supabase.from('inbox_items').select('connection_id')
      .eq('user_id', user.id).eq('id', itemId).maybeSingle();
    connectionId = (data?.connection_id as string | null) ?? null;
  } catch { /* fall through to the single-inbox resolution below */ }
  if (!connectionId) {
    const { data: conns } = await supabase.from('connections').select('id').eq('user_id', user.id);
    const list = ((conns ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (list.length === 1) connectionId = list[0];
    else {
      return NextResponse.json({
        ok: false,
        reason: list.length
          ? 'A standing rule belongs to one inbox — set it up per inbox in Settings → Email.'
          : 'There is no connected inbox for me to keep this on.',
      }, { status: 422 });
    }
  }

  const res = await createPosture(supabase, user.id, offer.offer.sentence, {
    connectionId, primitives: offer.offer.primitives,
  });
  if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason }, { status: 422 });
  return NextResponse.json({ ok: true, posture: res.posture, understood: res.understood, sentence: offer.offer.sentence });
}
