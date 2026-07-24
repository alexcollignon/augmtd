// POST /api/entities/[id]/status-update — THE SHAREABLE DEAL STATUS UPDATE (projecthood Phase 5C).
// ONE reasoned compose over judgment we already hold: the entity's judged state + the ledger since
// the last shared update → "where it stands · what happened · what's next · what we need". The
// briefing's voice laws apply (colleague speech, say-less-than-you-know, grounded-or-absent — the
// banned machinery register self-checks with one corrective retry). CACHED as an `item_deliverables`
// row (kind 'entity') keyed to the entity's sig — an unchanged deal never re-composes, and past
// updates form the "since last time" anchor. Nothing sends from here — Copy/Send live in the UI
// behind the user's explicit action.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { aiCall } from '@/lib/ai/call';
import { assembleLedger, MACHINERY_REGISTER } from '@/lib/entities/state';

export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const { force } = (await request.json().catch(() => ({}))) as { force?: boolean };

    const { data: ent } = await supabase.from('work_entities')
      .select('id, name, state, next_move, sig, people').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!ent) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // A SUGGESTED recipient (never auto-filled beyond suggestion): the first external email on the
    // deal's people fingerprint.
    const people = Array.isArray(ent.people) ? (ent.people as string[]) : [];
    const suggestedTo = people.find((p) => p.includes('@') && !p.startsWith('@')) ?? null;

    // Cache: the latest stored update for THIS sig is served as-is (unchanged deal → no AI).
    const { data: prior } = await supabase.from('item_deliverables')
      .select('id, content, created_at, metadata').eq('user_id', user.id)
      .eq('kind', 'entity').eq('entity_id', id).eq('type', 'document')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const priorMeta = (prior?.metadata ?? {}) as { statusUpdate?: boolean; sig?: string };
    if (!force && prior && priorMeta.statusUpdate && priorMeta.sig === ent.sig) {
      return NextResponse.json({ text: prior.content, composedAt: prior.created_at, cached: true, suggestedTo, name: ent.name });
    }

    const st = (ent.state ?? {}) as { summary?: string; momentum?: string; whoOwes?: { you?: string[]; them?: string[] } };
    const nm = (ent.next_move ?? null) as { title?: string } | null;
    const { ledger } = await assembleLedger(supabase, user.id, id);
    const sinceAt = prior && priorMeta.statusUpdate ? String(prior.created_at) : null;
    const recent = ledger
      .filter((l) => l.at && (!sinceAt || l.at > sinceAt))
      .slice(0, 10)
      .map((l) => `- ${l.at.slice(0, 10)} ${l.kind}${l.who ? ` (${l.who})` : ''}: ${l.text.slice(0, 140)}`)
      .join('\n');

    const prompt =
      `Write a SHORT status update on ONE body of work, to be shared with its counterparty or a teammate. ` +
      `Plain prose, a colleague's voice — 3 short paragraphs max: where it stands, what happened${sinceAt ? ' since the last update' : ' recently'}, ` +
      `and what happens next (including anything we need from them, if the facts say so).\n\n` +
      `Body of work: ${ent.name}\n` +
      `Where it stands (judged): ${st.summary ?? '(no summary)'}\n` +
      (st.whoOwes?.them?.length ? `They owe: ${st.whoOwes.them.join('; ')}\n` : '') +
      (st.whoOwes?.you?.length ? `We owe: ${st.whoOwes.you.join('; ')}\n` : '') +
      (nm?.title ? `Next move: ${nm.title}\n` : '') +
      `\nEvents${sinceAt ? ` since ${sinceAt.slice(0, 10)}` : ''} (ALL you know — never invent beyond these):\n${recent || '(none — say the period was quiet, do not pad)'}\n\n` +
      `Rules: grounded-or-absent (no invented names/dates/promises); no internal bookkeeping language ` +
      `("draft ready", "signals", "pending confirmation" — banned); no greeting or signature (the user adds those); ` +
      `PLAIN TEXT, no markdown. Return ONLY JSON: {"update":"..."}`;

    let res = await aiCall<{ update?: string }>({ userId: user.id, supabase, shape: { output: 'json' }, prompt, temperature: 0.2, maxTokens: 500, source: 'brain_synthesis' });
    let text = String(res.json?.update ?? '').trim();
    if (text && MACHINERY_REGISTER.test(text)) {
      const bad = text.match(MACHINERY_REGISTER)?.[0] ?? '';
      res = await aiCall<{ update?: string }>({
        userId: user.id, supabase, shape: { output: 'json' }, temperature: 0.4, maxTokens: 500, source: 'brain_synthesis',
        prompt: prompt + `\n\nYOUR PREVIOUS DRAFT used the banned phrase "${bad}". Rewrite in plain colleague speech about the matter itself.`,
      });
      text = String(res.json?.update ?? text).trim();
    }
    if (!text) return NextResponse.json({ error: 'compose failed' }, { status: 500 });

    const { data: saved } = await supabase.from('item_deliverables').insert({
      user_id: user.id, kind: 'entity', entity_id: id, type: 'document',
      title: `Status update — ${String(ent.name).slice(0, 80)}`, content: text, ref: null,
      metadata: { statusUpdate: true, sig: ent.sig },
    }).select('created_at').single();

    return NextResponse.json({ text, composedAt: saved?.created_at ?? new Date().toISOString(), cached: false, suggestedTo, name: ent.name });
  } catch (e) {
    console.error('[entities/status-update]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
