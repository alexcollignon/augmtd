// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BULK DEED'S POSTURE TAIL (docs/attention-plan.md — A7 → A8: "Every bulk deed may end with
// 'keep doing this?' → a posture").
//
// THIN, AND DELIBERATELY ZERO-AI. The sentence and the rule primitives are composed by
// `lib/postures/from-deed.ts` from the DEED'S OWN FACTS (its verb, its class) — there is no model on
// this path and no AI client is imported or reachable from it. The registry's reasoned parser is for
// what a person types in their own words; here the user is saying "again, for this exact class", and
// the class is something the house already has a word for.
//
// It still lands through THE ONE WRITER (`createPosture`), so the code-validation floor runs on the
// primitives exactly as it does for a typed sentence — the deed side is never trusted with a rule
// shape the engine has not re-checked.
//
// TWO REFUSALS THAT ARE THE POINT:
//   • Only a COMMITTED deed may leave a posture. "Keep doing this" about something that never
//     happened is not a thing to be kept.
//   • Only where the class is expressible as a standing rule AND the class's own account survives
//     it (the eligibility table). An unkeepable promise is worse than none.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readBulkDeed } from '@/lib/deeds/bulk';
import { postureFromDeed } from '@/lib/postures/from-deed';
import { createPosture } from '@/lib/postures/registry';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { deedId?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const deedId = String(body.deedId ?? '').trim();
  if (!deedId) return NextResponse.json({ ok: false, reason: 'deedId is required' }, { status: 400 });

  const deed = await readBulkDeed(supabase, user.id, deedId);
  if (!deed) return NextResponse.json({ ok: false, reason: 'that deed is not on file' }, { status: 404 });
  if (!deed.committedAt) {
    return NextResponse.json({ ok: false, reason: 'that deed has not run yet — there is nothing to keep doing.' }, { status: 400 });
  }

  const offer = postureFromDeed(deed);
  if (!offer.ok) return NextResponse.json({ ok: false, reason: offer.reason }, { status: 422 });

  // THE CONNECTION THE POSTURE BELONGS TO, AND WHY IT IS REQUIRED. The rules engine evaluates a
  // connection's OWN rules at process time (`loadInboxRules(connectionId)`), so a posture stored with
  // no inbox would never fire — a promise we could not keep, written down. It rides the inbox its own
  // members came from; when that is ambiguous, the user's single inbox stands in; when they have
  // several and the deed spanned them, we REFUSE and say where to set it up, rather than saving a
  // rule that does nothing.
  let connectionId: string | null = null;
  try {
    const ids = deed.items.slice(0, 50).map((i) => i.itemId);
    const { data } = await supabase.from('inbox_items').select('connection_id')
      .eq('user_id', user.id).in('id', ids);
    const distinct = [...new Set(((data ?? []) as Array<{ connection_id: string | null }>)
      .map((r) => r.connection_id).filter(Boolean))] as string[];
    if (distinct.length === 1) connectionId = distinct[0];
  } catch { /* fall through to the single-inbox resolution below */ }
  if (!connectionId) {
    const { data: conns } = await supabase.from('connections').select('id').eq('user_id', user.id);
    const list = ((conns ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (list.length === 1) connectionId = list[0];
    else {
      return NextResponse.json({
        ok: false,
        reason: list.length
          ? 'Those came from more than one inbox, and a standing rule belongs to one — set it up per inbox in Settings → Email.'
          : 'There is no connected inbox for me to keep this on.',
      }, { status: 422 });
    }
  }

  // THE USER'S ACCEPTED SENTENCE IS THE STORED VERBATIM (A8: the object is one plain sentence).
  const res = await createPosture(supabase, user.id, offer.offer.sentence, {
    connectionId,
    primitives: offer.offer.primitives,
  });
  if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason }, { status: 422 });
  return NextResponse.json({ ok: true, posture: res.posture, understood: res.understood, sentence: offer.offer.sentence });
}
