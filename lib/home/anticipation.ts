// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ANTICIPATION PASS (the initiative loop, Aug 10 — proactivity beyond arrivals). The judge
// answers "what does this ITEM need"; this pass answers "what does the NEAR FUTURE need" — it
// walks TIME, not the inbox:
//   1. MEETINGS (next 36h, linked to a room): the prep brief EXISTS before the user asks — one
//      reasoned pass over the room's page, narrated into the room with its BECAUSE line, and a
//      "Prep ready" chip on the Home's This-week card.
//   2. DUE-SOON (≤48h, still unprepared): the existing prepare machinery runs EARLY — the same
//      judge-gated prepareOneItem every other door uses; anticipation only moves the clock.
//   3. THE SILENCE WATCH: absence as an event — a counterparty who OWES the user and has been
//      quiet ≥7 days (no inbound on the thread, and no recent chase from the user either) gets
//      the judge-gated chase machinery run on their item. Quiet ≠ settled.
// THE TRUST RULES: legible (every move carries its because, grounded refs) and proportionate
// (hard caps per run; silence is a valid verdict — most runs should fire nothing). Exactly-once
// per (kind, id) via item_plans kind='anticipation' fire records; 6h self-gate.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONE CLOCK PER SURFACE (proactive-reach W4 census, fix #1 — the worst offender: we manufactured
// chores out of our own bug). Found live, in ONE paragraph of a served prep: the header said
// "(Mon 16:00)" — formatted in the EVENT ROW's timezone — while the grounding page handed the model
// raw UTC, so the prep's own prose read "the calendar shows 14:00" and the model, doing exactly what
// a careful colleague would, invented the chore "confirm the correct time". The bug was ours; the
// user got a task.
//
// THE LAW: a meeting's time is resolved ONCE, into the USER'S OWN zone (the T-class clock law —
// lib/utils/user-time), and that ONE resolved string is what the header renders AND what the prompt
// carries as a stated fact (the executeAIStep today-injection idiom). A surface that formats time
// twice will eventually disagree with itself.
//
// AND ITS COROLLARY — CLEAN SILENCE: when the page genuinely holds nothing to prepare, the lane
// writes NOTHING. A receipt for nothing is the chore-manufacturing class in a quieter voice, so the
// composer gets an explicit NOTHING sentinel (the house idiom) and the pass honours it.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The composer's sentinel for "there is nothing here to prepare". Silence is a valid answer. */
export const PREP_NOTHING = 'NOTHING';

/** THE ONE resolved meeting time — the single value both the header and the prompt read. */
export function meetingWhenLabel(startIso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz,
    }).format(new Date(startIso));
  } catch { return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(startIso)); }
}

/**
 * THE PREP TURN'S TEXT — or null when there is nothing to say.
 *
 * The fixed preamble ("— because this meeting is on your calendar and this room holds the work:")
 * died here: it stood on all 30 live anticipation turns, and it is PROCESS NARRATION — it explains
 * the machinery, not the work. The composed prep already leads with its own because; the header
 * names the meeting and its (one, resolved) time. Nothing else is owed.
 */
export function prepTurnText(title: string, when: string, brief: string | null | undefined): string | null {
  const t = String(brief ?? '').trim();
  if (!t) return null;
  // The sentinel may arrive bare or wrapped in the model's own punctuation.
  if (new RegExp(`^["'\\s.]*${PREP_NOTHING}[.\\s"']*$`, 'i').test(t)) return null;
  return `Prep for "${title}" (${when}):\n${t}`;
}

const KIND = 'anticipation';
const RUN_TTL_MS = 6 * 60 * 60_000;
const MAX_BRIEFS_PER_RUN = 2;
const MAX_PREPARES_PER_RUN = 2;
const MAX_CHASES_PER_RUN = 2;
const QUIET_DAYS = 7;

export async function runAnticipationPass(client: DBClient, userId: string): Promise<{ briefs: number; prepared: number; chases: number } | null> {
  try {
    // Self-gate: one row read decides; every caller may invoke freely.
    const { data: last } = await client.from('item_plans').select('updated_at')
      .eq('user_id', userId).eq('kind', KIND).eq('entity_id', 'last_run').maybeSingle();
    if (last?.updated_at && Date.now() - new Date(last.updated_at).getTime() < RUN_TTL_MS) return null;
    await client.from('item_plans').upsert({
      user_id: userId, kind: KIND, entity_id: 'last_run', tasks: {}, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,kind,entity_id' });

    let briefs = 0;
    let prepared = 0;
    let chases = 0;

    // ── 1. MEETING PREP — the brief exists before the ask. ──
    // ONE CLOCK: the user's own zone, resolved once for the whole pass.
    const { userTimezone } = await import('@/lib/utils/user-time');
    const tz = await userTimezone(client, userId);
    const now = new Date();
    const horizon = new Date(now.getTime() + 36 * 60 * 60_000);
    const { data: events } = await client.from('calendar_events')
      // The event row's OWN timezone is deliberately not read — one clock per surface, and it is
      // the user's (reading both is how the header and the prose came to disagree).
      .select('id, title, start_time, attendees')
      .eq('user_id', userId).eq('status', 'confirmed')
      .gte('start_time', new Date(now.getTime() + 30 * 60_000).toISOString())
      .lte('start_time', horizon.toISOString())
      .order('start_time', { ascending: true }).limit(6);
    for (const ev of (events ?? []) as Array<{ id: string; title: string; start_time: string; attendees: unknown }>) {
      if (briefs >= MAX_BRIEFS_PER_RUN) break;
      // THE RESCHEDULE RE-BRIEF (pilot diagnosis, Aug 13 — found live: a demo moved Mon→Thu on the
      // SAME calendar row, and the bare-id fire key meant the room kept its Monday prep brief as
      // standing guidance forever). The fire key carries the event's start — a moved meeting earns
      // a corrected brief, and the turn's UNCHANGED dedupe key below REPLACES the old prep text
      // in place (keyed dedupe updates), so the record never shows two competing briefings.
      const fireKey = `meeting:${ev.id}:${String(ev.start_time).slice(0, 16)}`;
      const { data: fired } = await client.from('item_plans').select('id')
        .eq('user_id', userId).eq('kind', KIND).eq('entity_id', fireKey).maybeSingle();
      if (fired) continue;
      // The meeting must belong to a ROOM — anticipation prepares WORK, it never invents projects.
      const { data: link } = await client.from('entity_links').select('entity_id')
        .eq('user_id', userId).eq('item_kind', 'calendar_event').eq('item_id', ev.id)
        .not('entity_id', 'is', null).maybeSingle();
      const entityId = (link?.entity_id as string) ?? null;
      if (!entityId) continue;

      try {
        const { assembleRoomGrounding } = await import('@/lib/room/grounding');
        const { GROUND_EVIDENCE_RULE } = await import('@/lib/room/ground-evidence');
        const g = await assembleRoomGrounding(client, userId, { kind: 'entity', entityId });
        if (!g?.text) continue;
        // THE ONE resolved time — the header below and the prompt here read the SAME value.
        const when = meetingWhenLabel(ev.start_time, tz);
        const { aiCall } = await import('@/lib/ai/call');
        const res = await aiCall<{ brief?: string }>({
          userId, supabase: client, shape: { output: 'json' }, temperature: 0.2, maxTokens: 600, source: 'brain_synthesis',
          prompt:
            `You prepare a colleague for a meeting. Meeting: "${ev.title}" · ${when}.\n\n` +
            // THE STATED TIME IS A FACT, NOT A QUESTION (W4 census fix #1). The clock is resolved in
            // code, in the user's own zone; the model may never re-derive it, doubt it, or turn it
            // into a chore. "Confirm the time" is not preparation — it is our own bug, spoken.
            `THE MEETING'S TIME IS SETTLED: ${when} (${tz} — the user's own timezone, already ` +
            `converted from the calendar). Treat it as the calendar's word. Never restate it ` +
            `differently, never question it, and never write a line asking anyone to confirm, check ` +
            `or verify the meeting's time, date, or place.\n\n` +
            `THE ROOM'S CURRENT PAGE (ground every line here; never invent):\n${g.text.replace(/\[(?:L|F)\d+\]\s?/g, '').slice(0, 3500)}\n\n` +
            // ONE LAW, ONE COPY (Sep 8): a meeting prep that raises a thing the user already did
            // is the same standing lie the room's brief was told to stop telling.
            `${GROUND_EVIDENCE_RULE}\n\n` +
            `Write a SHORT prep (4-6 lines, plain prose): where this work stands, what they owe / are owed, ` +
            `the one thing to raise, any open ask. Skip anything the page doesn't support.\n` +
            // CLEAN SILENCE: the explicit nothing-path. A prep that has to invent a chore to exist
            // should not exist.
            `If the page holds nothing worth preparing — no open ask, nothing owed either way, a ` +
            `routine recurring sync — answer exactly {"brief": "${PREP_NOTHING}"}. Saying nothing is ` +
            `a correct answer; never invent a task to fill the space.\n` +
            `JSON only: {"brief": "<the prep>"}`,
        });
        const text = prepTurnText(ev.title, when, res.json?.brief);
        if (!text) {
          // Nothing to prepare — and nothing written. The fire record still stamps, so a quiet
          // meeting is not re-judged (and re-spent) every six hours until it starts.
          await client.from('item_plans').insert({
            user_id: userId, kind: KIND, entity_id: fireKey,
            tasks: { kind: 'meeting_brief', silent: true, eventId: ev.id, entityId, at: new Date().toISOString() },
          });
          continue;
        }
        const { writeRoomTurn } = await import('@/lib/room/turns');
        await writeRoomTurn(client, userId, entityId, {
          role: 'system',
          text,
          dedupeKey: `anticipate:meeting:${ev.id}`,
        });
        await client.from('item_plans').insert({
          user_id: userId, kind: KIND, entity_id: fireKey,
          tasks: { kind: 'meeting_brief', eventId: ev.id, entityId, because: `you meet at ${when}`, at: new Date().toISOString() },
        });
        briefs++;
      } catch { /* one meeting failing never stops the pass */ }
    }

    // The work spine, built ONCE — due-soon and the silence watch both read it.
    const todayStr = new Date().toISOString().slice(0, 10);
    let items: unknown[] = [];
    try {
      const { buildWorkItems } = await import('@/lib/work-items/model');
      items = await buildWorkItems(client, userId, { todayStr, skipReconcile: true }) as never[];
    } catch { /* both walks degrade to no-ops */ }

    // ── 2. DUE-SOON — the existing machinery runs early; anticipation only moves the clock. ──
    try {
      const cutoff = new Date(now.getTime() + 48 * 60 * 60_000).toISOString().slice(0, 10);
      const dueSoon = (items as Array<{ id: string; state: string; actor: string; when: { explicit: string | null; bucket: string } }>).filter((i) =>
        i.state === 'todo' && i.actor === 'you' &&
        ((i.when.explicit && i.when.explicit.slice(0, 10) <= cutoff) || i.when.bucket === 'overdue'));
      for (const w of dueSoon) {
        if (prepared >= MAX_PREPARES_PER_RUN) break;
        const fireKey = `due:${w.id}`;
        const { data: fired } = await client.from('item_plans').select('id')
          .eq('user_id', userId).eq('kind', KIND).eq('entity_id', fireKey).maybeSingle();
        if (fired) continue;
        try {
          // Judge-gated: prepareOneItem consults the one judgment — anticipation never bypasses it.
          const { prepareOneItem } = await import('@/lib/prepare/pass');
          await prepareOneItem(client, userId, w as never);
          await client.from('item_plans').insert({
            user_id: userId, kind: KIND, entity_id: fireKey,
            tasks: { kind: 'due_soon', itemId: w.id, because: `due ${(w as unknown as { when: { explicit: string | null } }).when.explicit?.slice(0, 10) ?? 'now'} with nothing prepared`, at: new Date().toISOString() },
          });
          prepared++;
        } catch { /* one item failing never stops the pass */ }
      }
    } catch { /* the meetings half already ran */ }

    // ── 3. THE SILENCE WATCH — absence as an event. A counterparty who owes the user and has
    // gone quiet gets the judge-gated chase machinery; quiet ≠ settled. Proportionate: skip if
    // they spoke recently OR the user already chased recently; re-fire only after another
    // QUIET_DAYS window; hard cap per run. ──
    try {
      const quietCutoffIso = new Date(now.getTime() - QUIET_DAYS * 86_400_000).toISOString();
      const { data: awaiting } = await client.from('commitments')
        .select('id, description, counterparty, due_date, thread_id, created_at')
        .eq('user_id', userId).eq('status', 'open').eq('direction', 'awaiting')
        .lt('created_at', quietCutoffIso)
        .order('due_date', { ascending: true, nullsFirst: false }).limit(10);
      for (const c of (awaiting ?? []) as Array<{ id: string; description: string; counterparty: string | null; due_date: string | null; thread_id: string | null }>) {
        if (chases >= MAX_CHASES_PER_RUN) break;
        const fireKey = `silence:${c.id}`;
        const { data: fired } = await client.from('item_plans').select('tasks')
          .eq('user_id', userId).eq('kind', KIND).eq('entity_id', fireKey).maybeSingle();
        const lastFire = (fired?.tasks as { at?: string } | undefined)?.at;
        if (lastFire && Date.now() - new Date(lastFire).getTime() < QUIET_DAYS * 86_400_000) continue;
        // The quiet check is REAL, not a proxy: any voice on the thread inside the window skips.
        if (c.thread_id) {
          const { data: lastMsg } = await client.from('emails').select('received_at')
            .eq('user_id', userId).eq('thread_id', c.thread_id)
            .gte('received_at', quietCutoffIso).limit(1);
          if (lastMsg?.length) continue; // someone spoke recently — not silence
        }
        const w = (items as Array<{ id: string }>).find((i) => i.id === `commit:${c.id}`);
        if (!w) continue;
        try {
          const { prepareOneItem } = await import('@/lib/prepare/pass');
          await prepareOneItem(client, userId, w as never);
          const quietDays = Math.floor((Date.now() - new Date((c as unknown as { created_at: string }).created_at).getTime()) / 86_400_000);
          await client.from('item_plans').upsert({
            user_id: userId, kind: KIND, entity_id: fireKey,
            tasks: { kind: 'silence', itemId: c.id, because: `${c.counterparty ?? 'they'} owe${c.counterparty ? 's' : ''} you and the thread has been quiet ~${Math.min(quietDays, 60)} days`, at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,kind,entity_id' });
          chases++;
        } catch { /* one commitment failing never stops the pass */ }
      }
    } catch { /* the earlier walks already ran */ }

    return { briefs, prepared, chases };
  } catch { return null; }
}

// `prepReadyEvents` LIVED HERE and died Sep 13 with its only consumer. It answered one question —
// "which upcoming events already have a prep brief waiting?" — for the Home's This-week rail, so
// the rail could wear a "Prep ready" chip. The calm-Home walk (owner, Sep 8) retired the rail, and
// THE THREADS ARC's deciding law says why nothing was lost: the prep brief ARRIVES in the room it
// belongs to as a system turn, with its BECAUSE line leading. A chip pointing at the prep was
// always weaker than the prep itself waiting where the work lives. The pass above still writes it.
