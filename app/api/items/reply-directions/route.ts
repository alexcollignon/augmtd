// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/items/reply-directions { kind: 'email', id }
//
// REPLY DIRECTIONS (Aug 4 — options are offers, never walls): 2–3 REASONED directions for replying
// to THIS message — grounded in the sender's own words + the judged ask, never generic smart-reply
// filler. The client renders them as chips on the reply stage; a tap rewrites the draft through the
// one steer path (this route only names the directions). Cached per item (item_plans kind
// 'reply_directions', sig = version + thread activity) — one cheap call per thread state, ever.
// Grounded-or-absent: no usable input → empty list, never invented options.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { topMessageOf } from '@/lib/inbox/top-message';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

const DIRECTIONS_VERSION = 2; // 2: excerpt-honesty on the quoted message

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const id = String(body.id ?? '');
    if (body.kind !== 'email' || !id) return NextResponse.json({ directions: [] });

    const { data: item } = await supabase.from('inbox_items')
      .select('id, work_title, source_data, last_activity_at, created_at')
      .eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!item) return NextResponse.json({ directions: [] });
    const sd = (item.source_data ?? {}) as Record<string, unknown>;
    const u = (sd.understanding ?? null) as { ask?: string } | null;
    const ask = typeof u?.ask === 'string' ? u.ask : null;
    const msg = clipForPrompt(topMessageOf(String(sd.body ?? '')).replace(/\s+/g, ' '), 900);
    if (!msg.trim() && !ask) return NextResponse.json({ directions: [] });

    const sig = `${DIRECTIONS_VERSION}:${String(item.last_activity_at ?? item.created_at ?? '')}:${(ask ?? '').slice(0, 80)}`;
    const { data: cached } = await supabase.from('item_plans').select('tasks')
      .eq('user_id', user.id).eq('kind', 'reply_directions').eq('entity_id', id).maybeSingle();
    const prior = (cached?.tasks ?? null) as { sig?: string; directions?: Array<{ label: string; instruction: string }> } | null;
    if (prior?.sig === sig && Array.isArray(prior.directions)) {
      return NextResponse.json({ directions: prior.directions });
    }

    const { aiCall } = await import('@/lib/ai/call');
    const res = await aiCall<{ directions?: Array<{ label?: string; instruction?: string }> }>({
      userId: user.id, supabase, shape: { output: 'json' }, temperature: 0, maxTokens: 260,
      source: 'brain_synthesis',
      prompt:
        `An email needs a reply. Name 2–3 genuinely DIFFERENT directions the reply could take — ` +
        `the real decision space (accept / propose an alternative / decline / ask for something first), ` +
        `grounded ONLY in what the message and ask actually say. Never generic pleasantries, never ` +
        `directions the message makes impossible, never invented facts.\n` +
        `FROM: ${String(sd.from_name ?? sd.from_address ?? 'the sender')}\n` +
        `${ask ? `THE JUDGED ASK: ${ask}\n` : ''}` +
        `THE MESSAGE (sender's own words): """${msg}"""\n${EXCERPT_RULE}\n\n` +
        `Each direction: "label" = ≤5 words, in the language the reply will be written in (mirror the ` +
        `message's language); "instruction" = one imperative sentence a drafter can follow.\n` +
        `JSON only: {"directions":[{"label":"…","instruction":"…"}]}`,
    });
    const directions = (res.json?.directions ?? [])
      .map((d) => ({ label: String(d.label ?? '').slice(0, 40), instruction: String(d.instruction ?? '').slice(0, 200) }))
      .filter((d) => d.label && d.instruction)
      .slice(0, 3);
    if (directions.length) {
      await supabase.from('item_plans').upsert({
        user_id: user.id, kind: 'reply_directions', entity_id: id,
        tasks: { v: DIRECTIONS_VERSION, sig, directions }, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
    }
    return NextResponse.json({ directions });
  } catch (e) {
    console.error('[reply-directions]', e);
    return NextResponse.json({ directions: [] }); // failure = no chips, never an error surface
  }
}
