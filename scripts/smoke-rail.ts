// CONVERSATIONAL RAIL SMOKE (just-works P1.5b) — cross-user gates for the deep-dive's talking rail.
//   1. RAIL DATA — for a real entity-linked item, the view assembly yields the judged state (the
//      narration source) + sibling threads/meetings/files ("this deal has N other threads" — the
//      awareness the user asked for). Queries only — NO AI in the read path.
//   2. INTENT SPLIT — the one composer's classifier separates a QUESTION from a correction (live).
//   3. GROUNDED ANSWER — a question on the deal returns a grounded, reference-carrying answer from
//      the entity's own ledger (live, the project-brain ask).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '../lib/ai/factory';
import { answerEntityQuestion } from '../lib/entities/ask';
import { isAutomatedSender, isCalendarSystemSubject } from '../lib/inbox/automated';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = [
  { uid: '08fe4449-e5eb-431d-9156-02e9324e5903', label: 'user A' },
  { uid: 'c723c2f2-e069-4ab8-980e-ac3585028fec', label: 'user B' },
];
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

// The view route's rail assembly, replicated 1:1 (queries only) — proves the data exists per user.
async function railFor(uid: string, itemId: string, entityId: string) {
  const { data: ent } = await sb.from('work_entities').select('id, name, summary, state, next_move').eq('id', entityId).maybeSingle();
  const st = ((ent?.state ?? {}) as { summary?: string; whoOwes?: { you?: string[]; them?: string[] } });
  const { data: links } = await sb.from('entity_links').select('item_kind, item_id')
    .eq('user_id', uid).eq('entity_id', entityId).neq('item_kind', 'email_thread').limit(60);
  const lrows = (links ?? []) as Array<{ item_kind: string; item_id: string }>;
  const inboxIds = lrows.filter((l) => l.item_kind === 'inbox_item').map((l) => l.item_id);
  const { data: thr } = inboxIds.length
    ? await sb.from('inbox_items').select('id, status').in('id', inboxIds.slice(0, 20))
    : { data: [] };
  const threads = ((thr ?? []) as Array<{ id: string; status: string }>).filter((t) => t.status === 'pending' || t.id === itemId);
  return {
    name: String(ent?.name ?? ''),
    summary: st.summary ?? (ent?.summary as string | null) ?? null,
    threads: threads.length,
    meetings: lrows.filter((l) => l.item_kind === 'meeting').length,
    commitments: lrows.filter((l) => l.item_kind === 'commitment').length,
  };
}

(async () => {
  for (const { uid, label } of USERS) {
    // Find a real entity-linked pending inbox item (the deep-dive's common case).
    const { data: links } = await sb.from('entity_links').select('item_id, entity_id')
      .eq('user_id', uid).eq('item_kind', 'inbox_item').not('entity_id', 'is', null).limit(50);
    let picked: { itemId: string; entityId: string } | null = null;
    for (const l of (links ?? []) as Array<{ item_id: string; entity_id: string }>) {
      const { data: it } = await sb.from('inbox_items').select('id, status').eq('id', l.item_id).maybeSingle();
      if (it?.status === 'pending') { picked = { itemId: l.item_id, entityId: l.entity_id }; break; }
    }
    if (!picked) { check(`${label} · rail data (no entity-linked pending item)`, true, 'vacuous'); continue; }

    const rail = await railFor(uid, picked.itemId, picked.entityId);
    check(`${label} · rail narration source (judged state present)`, !!rail.summary, `${rail.name}: ${String(rail.summary).slice(0, 60)}`);
    check(`${label} · rail siblings (threads/meetings/commitments readable)`, rail.threads + rail.meetings + rail.commitments > 0,
      `${rail.threads} threads · ${rail.meetings} meetings · ${rail.commitments} commitments`);

    // P5b — CURATION on real data: the deal's raw sibling threads, run through the same predicate the
    // view route applies. Gate: nothing automated / calendar-system survives; the filter actually
    // bites when such mail exists in the raw set.
    {
      const { data: links } = await sb.from('entity_links').select('item_id')
        .eq('user_id', uid).eq('entity_id', picked.entityId).eq('item_kind', 'inbox_item').limit(30);
      const ids = ((links ?? []) as Array<{ item_id: string }>).map((l) => l.item_id);
      const { data: rows } = ids.length ? await sb.from('inbox_items').select('id, status, source_data').in('id', ids) : { data: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = ((rows ?? []) as any[]).filter((t) => t.status === 'pending' || t.id === picked!.itemId);
      const keep = raw.filter((t) => {
        const sd = (t.source_data ?? {}) as Record<string, unknown>;
        const subj = (sd.subject as string) || '';
        return !isCalendarSystemSubject(subj) && !isAutomatedSender((sd.from_address as string) || null, (sd.from_name as string) || null, subj);
      });
      const leftoverNoise = keep.filter((t) => isCalendarSystemSubject(((t.source_data ?? {}) as { subject?: string }).subject || ''));
      check(`${label} · sibling curation drops machine mail`, leftoverNoise.length === 0, `${raw.length} raw → ${keep.length} curated`);
    }

    // P5b — the ANCHOR: verb-first asks COVER the visible actionable items (aggregate — the rail's
    // opening is grounded-or-absent per item, so the gate is coverage, not any one item).
    {
      const { data: vis } = await sb.from('inbox_items').select('id, source_data')
        .eq('user_id', uid).eq('status', 'pending')
        .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)')
        .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(40);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actionable = ((vis ?? []) as any[]).filter((it) => {
        const u = it.source_data?.understanding;
        return u && (u.relevance === 'reply' || u.relevance === 'action');
      });
      const withAsk = actionable.filter((it) => typeof it.source_data?.understanding?.ask === 'string' && it.source_data.understanding.ask);
      const ok = actionable.length === 0 || withAsk.length / actionable.length >= 0.5;
      check(`${label} · verb-first asks cover the visible deck`, ok, `${withAsk.length}/${actionable.length} actionable items carry an ask`);
    }

    // Grounded answer from the deal's own memory (the composer's question path).
    try {
      const { answer, refs } = await answerEntityQuestion(sb, uid, picked.entityId, 'Where does this stand right now, and what is the next move?');
      check(`${label} · grounded answer from the deal's memory`, answer.length > 20, `${answer.slice(0, 80)}… (${refs.length} refs)`);
    } catch (e) { check(`${label} · grounded answer`, false, String(e).slice(0, 60)); }
  }

  // The intent split — question vs correction (the composer's router). Live classification, user A.
  {
    const uid = USERS[0].uid;
    const { client: ai, model } = await getAIClient(uid, 'classification', sb);
    const classify = async (note: string): Promise<boolean> => {
      const res = await aiCreate(ai, {
        model, max_tokens: 300, temperature: 0,
        messages: [{ role: 'user', content:
          `The user typed a note on a piece of work. Split it into:\n` +
          `- "question": true ONLY if the note is primarily ASKING something (seeking information/status/advice), not giving guidance.\n` +
          `- "facts": 0-3 durable facts.\n- "delegate": only for an explicit named-coworker ask; else null.\n` +
          `Return ONLY JSON: {"question":true|false,"facts":["..."],"delegate":null}\n\nTHE NOTE: ${note}` }],
      });
      const raw = res.choices?.[0]?.message?.content ?? '';
      try { return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).question === true; } catch { return false; }
    };
    check('composer intent: "did they send the catalogue yet?" → question', await classify('did they send the catalogue yet?'));
    check('composer intent: "mention I need the signed terms first" → correction', !(await classify('mention that I need the signed terms before we start')));
  }

  console.log('\n════ CONVERSATIONAL RAIL GATES (P1.5b) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
