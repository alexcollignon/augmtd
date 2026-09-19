// ════════════════════════════════════════════════════════════════════════════════════════════════
// ← LATER (docs/attention-plan.md PART III, Q9 · THE TRIAGE DECK).
//
// "one-keystroke when (tomorrow / next week / date) → THE REVISIT PARK → returns ON that date as a
// deck candidate wearing 'you asked to see this today'."
//
// THIN, ON PURPOSE, AND IT OWNS NOTHING. Everything this route does already existed:
//   · `parkItem` (lib/work/judge.ts) writes THE REVISIT RECORD — the judgment's own `revisit`, in
//     the judgment's own row, in the shape `applyVerdictConsequences` has always owned. There is no
//     snooze table in this house and this route does not start one.
//   · `applyVerdictConsequences` then does what it does for a JUDGED park, byte for byte: the keyed
//     room line ("Set … aside until <date>. Say the word if you want it now.") and the undoable
//     `work_parked` activity entry carrying the date.
// The ONE thing that differs from a judged park is the author, which the record itself carries
// (`revisit.by === 'user'`) — and which is why it holds until its date instead of yielding to the
// next thing that moves on the item. A user's word outranks the judge.
//
// LATER ALWAYS RECORDS A DATE. There is no "someday" here: the park's whole promise is the day it
// comes back, and a park with no day is a dismissal wearing a kinder word. `parkItem` refuses a
// past day, a malformed day and a day past its horizon, in the USER'S timezone.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parkItem, type JudgeInput } from '@/lib/work/judge';
import { applyVerdictConsequences } from '@/lib/work/apply-verdict';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { kind?: string; id?: string; after?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const kind = body.kind === 'commitment' ? 'commitment' : 'inbox';
  const id = String(body.id ?? '').trim();
  const after = String(body.after ?? '').trim();
  if (!id) return NextResponse.json({ ok: false, reason: 'id is required' }, { status: 400 });

  const input: JudgeInput = { kind, id };
  const parked = await parkItem(supabase, user.id, input, { after });
  if (!parked.ok) return NextResponse.json({ ok: false, reason: parked.reason }, { status: 422 });

  // THE ONE CONSEQUENCE MODULE — never a second narration, never a second ledger entry. Non-fatal by
  // its own construction: the park is already on the record before this runs.
  await applyVerdictConsequences(supabase, user.id, input, parked.verdict);
  // The deck's door counts the waiting band; a parked row leaves it.
  try {
    const { softBustBrief } = await import('@/lib/home/bust-brief');
    await softBustBrief(supabase, user.id);
  } catch { /* the brief re-reads on its own cadence anyway */ }

  return NextResponse.json({ ok: true, after: parked.after });
}
