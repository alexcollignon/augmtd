import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { recordOfferDecline, PATTERN_KEY_RE } from '@/lib/skills/offer';

// POST /api/skills/offer-decline { patternKey } → { ok: true }
// W21 (contract: lib/skills/chat-contract.ts): the user declined "save this as a skill" — the pattern is
// never offered again (lib/skills/offer.ts decideSkillOffer reads the declines). Stored in item_plans
// (kind 'skill_offer', entity_id = the pattern key) — no migration.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { patternKey?: unknown };
    const patternKey = typeof body.patternKey === 'string' ? body.patternKey.trim() : '';
    if (!PATTERN_KEY_RE.test(patternKey)) return NextResponse.json({ error: 'patternKey invalid' }, { status: 400 });

    const ok = await recordOfferDecline(supabase, user.id, patternKey);
    if (!ok) return NextResponse.json({ error: 'Failed to record the decline' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Skills/offer-decline] POST error:', err);
    return NextResponse.json({ error: 'Failed to record the decline' }, { status: 500 });
  }
}
