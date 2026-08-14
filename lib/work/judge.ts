// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE WORK JUDGMENT (judged-room J1, docs/judged-room-plan.md).
//
// judgeWork answers "what does DOING this take?" ONCE, with the BRAIN in view — the entity's
// state/next-move/goals-rules, the counterparty's person state, the unified understanding
// (relevance/ownership/mailKind/ask), what's ALREADY PREPARED in the pool, and the roster — and
// its single verdict drives three consequences at once: the COMPONENT the plane mounts, the
// EXECUTOR proposed (coworker / user / system), and the COMMIT GATE. Surfaces never infer locally;
// the ambient pass and the room read the SAME cached verdict, so they can never disagree.
//
// Doctrine: structural floors BEFORE AI (an answered thread, an automated sender, the ownership-
// keyed notice law — imported, never re-implemented); `none` is always legal; conservative
// (a wrong mount costs trust, message_only costs nothing); one reasoned call, schema-validated;
// cached on the item (sig = activity + pool + JUDGE_VERSION).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { coerceUnderstanding, type ItemUnderstanding } from '@/lib/inbox/item-understanding';
import { isNoMoveNotice, isAutomatedSenderStrong, rawMailKindOf } from '@/lib/inbox/notice-demotion';
import { computeThreadReplyState, type ThreadMessage } from '@/lib/inbox/thread-resolution';
import { getPrepared, type PreparedArtifact } from '@/lib/prepare/read';
import { loadRoster, type RosterEntry } from '@/lib/prepare/route-suggestion';
import { userTimezone, localNow, timesInText, dateStatedInText } from '@/lib/utils/user-time';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

// Word-boundary label clip (UI text, no excerpt marker — labels aren't prompts).
function clipLabel(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const w = cut.lastIndexOf(' ');
  return (w > max * 0.5 ? cut.slice(0, w) : cut).trim();
}
import { COMPONENT_KEYS, gateOf, renderComponentOptions, componentForWork, JUDGE_VERSION, WORK_VERBS, type WorkComponentKey, type WorkGate, type WorkVerb } from '@/lib/work/surface-registry';

export type WorkVerdict = {
  work: WorkVerb;
  component: WorkComponentKey;
  executor: { kind: 'coworker' | 'user' | 'system'; id?: string; name?: string };
  gate: WorkGate;
  /** decide-only: the numbered routes (the plane appends the decline). */
  options?: Array<{ label: string }>;
  /** MOOTNESS/CLOSURE (promise fix) — a machine-actionable disposition when work='none':
   *  'expired' = the thing this asked about has already happened / its window passed (acting is
   *  pointless — a link for a past event, "tomorrow" that has gone); 'answered' = the ask is
   *  already settled in the thread (a confirmation, a closure). THE ONE consequence module
   *  (lib/work/apply-verdict.ts) turns this into a resolution — the verdict MOVES the posture,
   *  it never just decorates the room. */
  resolution?: 'expired' | 'answered' | null;
  /** DELIBERATE TIME (proactive-team W4) — "not yet": the item's own words say the right move
   *  comes LATER (a stated get-back date, "after the board meeting on X"). work='none' + revisit
   *  parks it: the deck demotes it (a plain none), the cache serves it WITHOUT AI until the date,
   *  and on/after the date the daily re-judgment is forced fresh so it comes back live. Judged,
   *  never a snooze timer; only with a concrete basis in the item. */
  revisit?: { after: string; reason?: string } | null;
  /** THE DELIVERABLE INVENTORY (the "what does it take" half of the judgment): the concrete
   *  attachable artifacts this work must INCLUDE, in the item's own words ("could you share the
   *  org report, individual report and ALP sheet" → 3 entries). ONLY what the item explicitly
   *  asks for or the work objectively cannot go out without — never inferred nice-to-haves.
   *  The preparation pass resolves each (have it / need it from the user) before drafting. */
  requires?: Array<{ label: string }>;
  /** FAILURE HONESTY (proactive-team W2): true means the judge COULD NOT judge — the reasoning call
   *  failed or returned an unusable verdict. A failed verdict is NEVER cached (the next open retries)
   *  and NEVER moves the posture or strips artifacts (apply-verdict guards on it). "Failed to judge"
   *  and "judged none" are different truths; conflating them cost real drafts. */
  failed?: true;
  reason: string;
};

export type JudgeInput = { kind: 'inbox' | 'commitment'; id: string };

// ONE verb list — the registry's (a verb added there without a preparation path fails the P21 gate).
const WORKS = new Set<string>(WORK_VERBS);

function fallbackVerdict(reason: string, resolution?: 'expired' | 'answered'): WorkVerdict {
  return { work: 'none', component: 'message_only', executor: { kind: 'user' }, gate: null, reason, ...(resolution ? { resolution } : {}) };
}

/** The user-clock context every time-law compares against (T-class: the brain reasons in the
 *  USER's day and hour, never the server's — and every time claim is checked against the item's
 *  own text, the expired_on pattern extended to hours). */
type TimeCtx = { todayStr: string; nowHHMM: string; itemText: string };

function coerceVerdict(raw: unknown, roster: RosterEntry[], ctx: TimeCtx): WorkVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const work = String(r.work || '').toLowerCase();
  if (!WORKS.has(work)) return null;
  // STRUCTURAL coherence — the model picks the WORK; the COMPONENT DERIVES from the registry,
  // always (the work→component map is 1:1 — letting the model's component half through produced
  // real drift like chase/reply_composer). One source: the registry.
  const component = componentForWork(work) ?? '';
  if (!COMPONENT_KEYS.has(component)) return null;
  const exRaw = (r.executor ?? {}) as Record<string, unknown>;
  const exKind = String(exRaw.kind || 'user').toLowerCase();
  const executor: WorkVerdict['executor'] = { kind: exKind === 'coworker' || exKind === 'system' ? exKind : 'user' };
  if (executor.kind === 'coworker') {
    const w = roster.find((x) => x.name.toLowerCase() === String(exRaw.name || '').toLowerCase());
    if (w) { executor.id = w.id; executor.name = w.name; }
    else executor.kind = 'user'; // an unrecognized name never invents a coworker
  }
  const out: WorkVerdict = {
    work: work as WorkVerdict['work'], component: component as WorkComponentKey,
    executor, gate: gateOf(component as WorkComponentKey),
    // Word-boundary clip — a raw slice served "…whether the proposal meets expect" to the
    // decision card (found on the served room, Aug 12). The clip is honest: cut at a space.
    reason: (() => { const t = String(r.reason || ''); if (t.length <= 240) return t; const c = t.slice(0, 240); return `${c.slice(0, Math.max(120, c.lastIndexOf(' ')))}…`; })(),
  };
  // The disposition is only meaningful on a none verdict (a live work item can't be moot).
  // STRUCTURAL COHERENCE on "expired" (the hallucinated-expiry class): the model must SHOW the
  // stated date that passed (`expired_on`) and the ARITHMETIC is code's, not the model's — an
  // unparseable, missing, or future basis rejects the disposition (the same law as the component
  // half: the model supplies judgment, the registry/calendar supply the facts). T-class extends it
  // to HOURS: a SAME-DAY expiry needs a TIME the item itself states (`expired_time`, verified
  // in-text) that has already passed on the USER'S clock — a 12:30 meeting is honestly over at
  // 20:34 the same day, and an undated-untimed ask can never expire at all.
  const reso = String(r.resolution || '').toLowerCase();
  if (work === 'none' && reso === 'answered') out.resolution = 'answered';
  if (work === 'none' && reso === 'expired') {
    const basis = String(r.expired_on ?? '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(basis)) {
      // THE STATED-DATE CHECK (P27 hardening): a past basis is only an expiry when the item's OWN
      // text states that date (any common rendering — dateStatedInText). A fabricated yesterday
      // no longer defeats the same-day protection; an unverifiable claim keeps the item live.
      if (basis < ctx.todayStr) { if (dateStatedInText(ctx.itemText, basis)) out.resolution = 'expired'; }
      else if (basis === ctx.todayStr) {
        const t = /^(\d{1,2}):(\d{2})$/.exec(String(r.expired_time ?? '').trim());
        if (t) {
          const hhmm = `${t[1].padStart(2, '0')}:${t[2]}`;
          if (timesInText(ctx.itemText).includes(hhmm) && ctx.nowHHMM > hhmm) out.resolution = 'expired';
        }
      }
    }
  }
  // W4 — revisit: none-only, never alongside a closure disposition, a real FUTURE date only (a
  // past or malformed date is meaningless — the item just stays live). Local-day comparison.
  if (work === 'none' && !out.resolution && r.revisit && typeof r.revisit === 'object') {
    const rv = r.revisit as Record<string, unknown>;
    const after = String(rv.after ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(after) && after > ctx.todayStr) {
      out.revisit = { after, ...(rv.reason ? { reason: String(rv.reason).slice(0, 140) } : {}) };
    }
  }
  if (work === 'decide' && Array.isArray(r.options)) {
    out.options = (r.options as unknown[]).slice(0, 4)
      .map((o) => ({ label: String((o as Record<string, unknown>)?.label ?? o ?? '').slice(0, 80) }))
      .filter((o) => o.label);
  }
  // The deliverable inventory is only meaningful on outbound work (a none/chase carries nothing).
  if ((work === 'reply' || work === 'send_file' || work === 'produce') && Array.isArray(r.requires)) {
    const reqs = (r.requires as unknown[]).slice(0, 5)
      // Word-boundary clip — a mid-word label ("…timezone offset an") read as broken UI (Aug 4).
      .map((o) => ({ label: clipLabel(String((o as Record<string, unknown>)?.label ?? o ?? '').trim(), 90) }))
      .filter((o) => o.label);
    if (reqs.length) out.requires = reqs;
  }
  return out;
}

/** The judgment cache rides item_plans (kind 'judgment', entity_id = `${kind}:${id}` — free TEXT,
 *  zero-migration, owner-RLS). tasks jsonb holds { verdict, sig }. */
async function readCache(
  client: SupabaseClient, userId: string, input: JudgeInput, sig: string,
): Promise<{ hit: WorkVerdict | null; prior: WorkVerdict | null; priorSig: string | null }> {
  const { data } = await client.from('item_plans').select('tasks')
    .eq('user_id', userId).eq('kind', 'judgment').eq('entity_id', `${input.kind}:${input.id}`).maybeSingle();
  const t = (data?.tasks ?? null) as { verdict?: unknown; sig?: string } | null;
  const v = (t?.verdict ?? null) as WorkVerdict | null;
  const valid = !!v && WORKS.has(v.work) && COMPONENT_KEYS.has(v.component);
  if (!valid) return { hit: null, prior: null, priorSig: null };
  // A stale-sig verdict is still the judge's OWN PRIOR JUDGMENT — fed back into the re-judgment
  // as self-consistency context (stickiness through reasoning, never a lock): an ambiguous item
  // must not flip verdicts on a daily re-check unless something material actually changed.
  // SAME-VERSION ONLY: a prior made under an older JUDGE_VERSION was judged under different laws —
  // anchoring on it would entrench exactly the calls a version bump exists to correct.
  const sameVersion = String(t!.sig ?? '').split(':')[0] === String(JUDGE_VERSION);
  if (t!.sig === sig) return { hit: v, prior: v, priorSig: String(t!.sig) };
  return { hit: null, prior: sameVersion ? v : null, priorSig: sameVersion ? String(t!.sig ?? '') : null };
}

/** The sig with its DAY component blanked — the parked-serve comparison: same item facts (version,
 *  activity, pool), only the calendar moved. */
const nonDaySig = (s: string): string => { const p = s.split(':'); return [p[0], ...p.slice(2)].join(':'); };

async function writeCache(client: SupabaseClient, userId: string, input: JudgeInput, sig: string, verdict: WorkVerdict): Promise<void> {
  await client.from('item_plans').upsert({
    user_id: userId, kind: 'judgment', entity_id: `${input.kind}:${input.id}`,
    tasks: { verdict, sig }, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
}

export async function judgeWork(client: SupabaseClient, userId: string, input: JudgeInput): Promise<WorkVerdict> {
  try {
    // ── Load the item + its brain neighborhood. ──
    let title = '', body = '', who: string | null = null, whoEmail: string | null = null, threadNow = '';
    let u: ItemUnderstanding | null = null, activityAt = '', workState: string | null = null, rawKind: string | null = null;
    let dueDate: string | null = null; // the item's own stated date (commitment due / extracted deadline) — the event-boundary anchor
    let threadMsgs: ThreadMessage[] = [];
    if (input.kind === 'inbox') {
      const { data: it } = await client.from('inbox_items')
        .select('id, work_title, work_state, status, last_activity_at, created_at, source_data')
        .eq('id', input.id).eq('user_id', userId).maybeSingle();
      if (!it || it.status !== 'pending') return fallbackVerdict('no longer open');
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      title = String(it.work_title || sd.subject || '');
      // EXCERPT-HONESTY LAW (Aug 4): a hard character cut quoted as the sender's words made the
      // judge read a normal email as "cut off mid-sentence" — clips end at boundaries and declare
      // themselves; the prompt carries the rule that a marker is OUR clipping, never source truth.
      body = clipForPrompt(String(sd.body || ''), 1200);
      who = (sd.from_name as string) || (sd.from_address as string) || null;
      whoEmail = (sd.from_address as string) || null;
      u = coerceUnderstanding(sd.understanding);
      dueDate = u?.deadline ?? null;
      rawKind = rawMailKindOf(sd);
      workState = (it.work_state as string) || null;
      activityAt = String(it.last_activity_at || it.created_at || '');
      const tid = (sd.thread_id as string) || null;
      if (tid) {
        const { data: msgs } = await client.from('emails').select('is_from_user, received_at, from_address, from_name, to_addresses, cc_addresses, body')
          .eq('user_id', userId).eq('thread_id', tid);
        threadMsgs = ((msgs ?? []) as Array<Record<string, unknown>>).map((m) => ({
          is_from_user: !!m.is_from_user, received_at: (m.received_at as string) ?? null,
          from: (m.from_address as string) ?? null,
          to: [...((m.to_addresses as string[]) ?? []), ...((m.cc_addresses as string[]) ?? [])],
        }));
        // THE WATERMARK LAW (Aug 2): the judge judges the thread's PRESENT, never the founding
        // snapshot — a thread that moved past its stored ask ("thank you, all fixed") was still
        // judged as the original investigation. The newest messages (own words only — quoted
        // tails stripped) ride the item text, so every code-check (stated dates/times) and the
        // verdict itself read the CURRENT position.
        const ordered = ((msgs ?? []) as Array<Record<string, unknown>>)
          .filter((m) => m.received_at)
          .sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
        const newest = ordered.slice(-2);
        if (newest.length && String(newest[newest.length - 1].received_at) > String(it.created_at)) {
          const { topMessageOf } = await import('@/lib/inbox/top-message');
          threadNow = newest.map((m) =>
            `[${String(m.received_at).slice(0, 16)}] ${m.is_from_user ? 'THE USER' : String(m.from_name || m.from_address || 'them')}: "${clipForPrompt(topMessageOf(String(m.body || '')).replace(/\s+/g, ' '), 400)}"`,
          ).join('\n');
        }
      }
    } else {
      const { data: c } = await client.from('commitments')
        .select('id, description, counterparty, direction, status, due_date, updated_at, created_at, source')
        .eq('id', input.id).eq('user_id', userId).maybeSingle();
      if (!c || !['open', 'pending', 'in_progress'].includes(String(c.status))) return fallbackVerdict('no longer open');
      // THE STANDING FLOOR (Arc 2 binding): a source='workflow' commitment is the team's standing
      // promise — its WORKFLOW produces it. Structurally none: the pass must never delegate it,
      // no drafter touches it; overdue-ness is its whole surface (the missed-run debt).
      if (String(c.source) === 'workflow') {
        return {
          work: 'none', component: 'message_only', executor: { kind: 'system' }, gate: null,
          reason: 'a standing scheduled task — its workflow produces the deliverable; overdue means a run was missed',
        };
      }
      title = String(c.description || '');
      who = (c.counterparty as string) || null;
      activityAt = String(c.updated_at || c.created_at || '');
      dueDate = (c.due_date as string) || null;
      body = `direction: ${c.direction}${c.due_date ? ` · due ${c.due_date}` : ''}`;
    }

    // ── The pool (the judge must KNOW prepared work exists) + the sig. ──
    const pool: PreparedArtifact[] = await getPrepared(client, userId, { kind: input.kind === 'inbox' ? 'inbox_item' : 'commitment', id: input.id });
    // THE USER'S CLOCK (T-class): the day boundary, "now", and every time law run in the USER'S
    // timezone (derived from their own calendar), never the server's. The day rides the sig: with
    // time-awareness a verdict is a function of TODAY — at most one re-judgment per item per day,
    // PLUS one when a same-day event boundary crosses: an item due today whose own stated time has
    // passed flips the sig, so "be there at 12:30" is re-judged the pass after 12:30, not at
    // midnight (day-blindness was how a finished meeting stayed on the plate all evening).
    const tzName = await userTimezone(client, userId);
    const nowL = localNow(tzName);
    const todayStr = nowL.dateStr;
    const itemText = `${title}\n${body}${threadNow ? `\n\nWHERE THE THREAD STANDS NOW (newest last — judge the PRESENT position, not the founding ask; a pure closure/thank-you with nothing further asked = resolution "answered"):\n${threadNow}` : ''}`;
    const eventPassed = !!dueDate && dueDate === todayStr && timesInText(itemText).some((t) => t < nowL.hhmm);
    const sig = `${JUDGE_VERSION}:${todayStr}:${activityAt}:${pool.length}:${pool[0]?.at ?? ''}${eventPassed ? ':past' : ''}`;
    const { hit: cached, prior, priorSig } = await readCache(client, userId, input, sig);
    if (cached) return cached;
    // W4 PARKED SERVE — a revisit verdict holds WITHOUT AI until its date: same item facts (only
    // the day moved) + the revisit date still ahead → re-serve the parked verdict under today's
    // sig. Parking an item costs one judgment, not one per day.
    if (prior?.revisit?.after && prior.revisit.after > todayStr
      && priorSig && nonDaySig(priorSig) === nonDaySig(sig)) {
      await writeCache(client, userId, input, sig, prior);
      return prior;
    }

    // ── STRUCTURAL FLOORS (no AI): answered → none · the ownership notice law → none. ──
    if (input.kind === 'inbox' && threadMsgs.length) {
      const st = computeThreadReplyState(threadMsgs, null);
      if (st.lastMessageFromUser) {
        const v = fallbackVerdict('you have the last word on this thread — nothing owed until they reply', 'answered');
        await writeCache(client, userId, input, sig, v);
        return v;
      }
    }
    if (input.kind === 'inbox' && isNoMoveNotice({ u, rawKind, fromEmail: whoEmail, fromName: who, subject: title, workState })) {
      const v = fallbackVerdict('an automated notice nobody owes a move on');
      await writeCache(client, userId, input, sig, v);
      return v;
    }

    // ── The brain neighborhood: entity + person (assembled, not re-derived). ──
    let dealBlock = '';
    const { data: link } = await client.from('entity_links').select('entity_id')
      .eq('user_id', userId).eq('item_kind', input.kind === 'inbox' ? 'inbox_item' : 'commitment')
      .eq('item_id', input.id).not('entity_id', 'is', null).maybeSingle();
    if (link?.entity_id) {
      const { data: ent } = await client.from('work_entities').select('name, state, next_move, goals, rules')
        .eq('id', link.entity_id).eq('user_id', userId).maybeSingle();
      if (ent) {
        const st = (ent.state ?? {}) as { summary?: string };
        const nm = (ent.next_move ?? null) as { title?: string } | null;
        const goals = Array.isArray(ent.goals) ? (ent.goals as string[]).filter(Boolean) : [];
        const rules = Array.isArray(ent.rules) ? (ent.rules as string[]).filter(Boolean) : [];
        dealBlock = `THE DEAL (${ent.name}): ${st.summary ?? ''}${nm?.title ? ` · next move: ${nm.title}` : ''}` +
          `${goals.length ? ` · goals: ${goals.join('; ')}` : ''}${rules.length ? ` · rules: ${rules.join('; ')}` : ''}\n`;
      }
    }
    let personBlock = '';
    if (who) {
      try {
        const { getPersonEntities, findPersonEntity, parseWho } = await import('@/lib/entities/people');
        const pw = parseWho(who);
        const pe = findPersonEntity(await getPersonEntities(client, userId), whoEmail ?? pw.email, pw.name);
        if (pe?.state?.summary) personBlock = `THE COUNTERPARTY (${pe.name}): ${pe.state.summary}\n`;
      } catch { /* non-fatal */ }
    }
    // W3 — an OPEN ASK on this item is a fact the judgment must hold: the user owes inputs; the
    // work is waiting on them, not on re-judgment. Live asks only (archived = history).
    let askBlock = '';
    try {
      const { data: ask } = await client.from('room_turns').select('component, created_at, author')
        .eq('user_id', userId)
        .or(`dedupe_key.eq.requires:${input.id},dedupe_key.like.delegate:${input.id}:*`)
        .filter('component->>key', 'eq', 'input_checklist').is('archived_at', null)
        .limit(1).maybeSingle();
      const st = (ask?.component as { state?: { items?: string[]; proceeded?: boolean } } | null)?.state;
      if (ask && st?.items?.length) {
        askBlock = st.proceeded
          ? `AN ASK to the user stood on this item and they said GO AHEAD with what's available — the work proceeds around the gaps.\n`
          : `AN OPEN ASK to the user has stood since ${String(ask.created_at).slice(0, 10)}: ${st.items.slice(0, 4).join('; ')}. They have not supplied these yet — the item is waiting on THEM, which does not make it moot. THIS ASK IS OURS, TO THE USER, for material WE need to produce THEIR deliverable — it is NEVER something the counterparty owes: do not flip the judgment to "chase" because of it, and never treat the missing input as the other side's debt (chasing the counterparty for the thing WE owe THEM inverts the obligation).\n`;
      }
    } catch { /* the ask fact is an enhancement */ }
    // ── THE BOOKED-CALENDAR FACT (JUDGE v16, found live: a `schedule` verdict stood on a meeting
    // the counterparty had ALREADY ACCEPTED on the real calendar — the lane floor caught the
    // duplicate invite, but the verdict persisted and burned an extraction every pass visit).
    // The judge sees the user's actual bookings with THIS counterparty as facts. ──
    let calBlock = '';
    if (whoEmail) {
      try {
        const { data: evs } = await client.from('calendar_events').select('title, start_time')
          .eq('user_id', userId)
          .filter('attendees', 'cs', JSON.stringify([{ email: whoEmail.toLowerCase() }]))
          .gte('start_time', new Date(Date.now() - 24 * 3_600_000).toISOString())
          .lte('start_time', new Date(Date.now() + 21 * 86_400_000).toISOString())
          .order('start_time', { ascending: true }).limit(3);
        if (evs?.length) {
          calBlock = `ALREADY ON THE USER'S CALENDAR with this sender:\n` +
            evs.map((e) => `- "${String(e.title ?? 'meeting').slice(0, 70)}" at ${String(e.start_time).slice(0, 16).replace('T', ' ')}`).join('\n') + '\n';
        }
      } catch { /* the calendar fact is an enhancement */ }
    }
    const roster = await loadRoster(client, userId);
    const poolBlock = pool.length
      ? `ALREADY PREPARED (prefill, don't redo): ${pool.slice(0, 3).map((d) => `${d.kind}${d.by ? ` by ${d.by}` : ''}${d.attachment ? ` (+${d.attachment.filename})` : ''}`).join(' · ')}\n`
      : '';

    // ── THE ONE REASONED CALL. ──
    const judgePrompt =
        `You are the user's chief of staff judging ONE piece of work: what does DOING it take?\n\n` +
        askBlock +
        // The WEEKDAY and the CLOCK are stated, never derived — "by Thursday" / "tomorrow" / "at
        // 12:30" reasoning from a bare ISO date made the model guess (real mootness misfires). All
        // in the USER'S zone: their day boundary, their hour.
        `RIGHT NOW for the user it is ${nowL.pretty} (${nowL.tz}); today's date is ${todayStr}. Times mentioned in items are in this zone unless they say otherwise. The item's last activity was ${activityAt.slice(0, 10) || 'unknown'}.\n\n` +
        dealBlock + personBlock + poolBlock + calBlock +
        (u ? `UNDERSTANDING: relevance=${u.relevance} ownership=${u.ownership ?? '?'} kind=${u.mailKind ?? '?'}${u.ask ? ` ask="${u.ask}"` : ''}${u.deadline ? ` deadline=${u.deadline}` : ''}\n` : '') +
        `THE ITEM${who ? ` (from ${who})` : ''}: ${title.slice(0, 140)}\n${body ? `${body}\n` : ''}` +
        `${threadNow ? `\nWHERE THE THREAD STANDS NOW (newest last — judge THIS position, not the founding ask): \n${threadNow}\n` : ''}` +
        // EXCERPT-HONESTY (Aug 4): our own length-clips must never read as source truncation.
        `${EXCERPT_RULE}\n\n` +
        `THE TEAM (for executor "coworker"):\n${roster.map((w) => `- ${w.name} — ${w.role.replace(/_/g, ' ')}: ${w.description}`).join('\n') || '(none)'}\n\n` +
        `COMPONENTS (pick exactly one — what the work surface should mount):\n${renderComponentOptions()}\n\n` +
        (prior ? `YOUR PRIOR JUDGMENT on this item: work=${prior.work}${prior.resolution ? ` resolution=${prior.resolution}` : ''}${prior.revisit ? ` revisit=${prior.revisit.after}` : ''} — "${prior.reason.slice(0, 120)}". BE CONSISTENT with it unless something in the item MATERIALLY changed since; do not flip an ambiguous call on a re-read.${prior.revisit && prior.revisit.after <= todayStr ? ' YOU SET THIS ASIDE until that date and THE DATE HAS ARRIVED — judge it fresh NOW as live work (the wait is over; do not re-park it without a NEW stated basis).' : ''}\n\n` : '') +
        `Rules:\n` +
        `- work: reply|decide|produce|send_file|schedule|forward|chase|none. CONSERVATIVE: unsure → "none"/"message_only" — a wrong mount costs trust, none costs nothing.\n` +
        `- "forward" ONLY when the item explicitly asks the user to PASS this thread/document on to a NAMED third party ("please forward this to…", "can you share this with finance/legal/<person>") — the passing-on IS the work. A reply that merely mentions someone else is still "reply".\n` +
        `- "schedule" when the real move is putting a meeting/call on the calendar (a proposed time to confirm, an ask to set up a call). A negotiation about WHICH time is still "reply"; "schedule" is for when the invite itself is the deliverable.\n` +
        `- COHERENCE: your work must MATCH your reason. If your reason says something is still owed, live, or "requires a response", work CANNOT be "none" — name the work that does it (a proposed call/times → "schedule" or "reply"; a stated either-way choice → "decide" with its options; an open question → "reply"). "none" is only for items where your reason says nothing is owed by anyone.\n` +
        `- A commitment with direction "awaiting" means the COUNTERPARTY owes the user — the natural work is "chase" (nudge what you're owed) unless it's moot or the item clearly says otherwise.\n` +
        `- ALREADY BOOKED: when the item's work is scheduling/confirming a meeting and the calendar above ALREADY shows that meeting booked with this sender (same encounter — the time fits what the thread converged on), the scheduling work is DONE: work="none" with resolution="answered" (the calendar is the settled fact; a second invite would double-book). This rule applies ONLY when a calendar block appears above — never from the thread alone. A calendar entry does NOT settle a reply the sender still awaits — only the scheduling half. And a WAIT-UNTIL item ("reconnect after X", "circle back once Y lands", "not before <date>") is NEVER "answered" — nothing is settled, the moment is simply later: that is work="none" WITH "revisit" carrying the stated date.\n` +
        `- TIME: if the thing this asks about has ALREADY HAPPENED or its window has passed such that acting now is pointless (a meeting that took place, access for a past event, a "tomorrow" that has gone), work="none" with resolution="expired". Resolve RELATIVE deadlines ("by Thursday", "tomorrow", "end of week") FORWARD from the item's OWN date (its last-activity date above): "by Thursday" in a message from Monday July 27 means Thursday July 30 — a FUTURE date, still live. resolution="expired" requires CERTAINTY that the window truly passed: it needs a SPECIFIC time/date STATED IN THE ITEM whose passing you can point to — name it as "expired_on" (the stated date, resolved to an absolute YYYY-MM-DD, in the past) and, when the window passed EARLIER TODAY (a meeting/call/slot whose stated clock time is already behind the user's RIGHT NOW above), ALSO name "expired_time" (that stated time as HH:MM 24h — e.g. a 12:30 meeting when it is now 20:34: expired_on=today, expired_time="12:30"). An UNDATED request can NEVER be expired (there is no window to have passed; an open ask with no deadline is simply live work) — no expired_on, no expiry. A deadline that is TODAY or LATER is never expired, and when you are not sure of the dates, judge the work normally (wrongly resolving live work costs trust; judging it costs nothing). resolution="answered" is ONLY for items that ARE closures: the message itself announces settlement (a confirmation, "all set", a done-deal notice) and asks nothing of anyone anymore. If the item still ASKS the user for anything not yet given — a reply, a time, a decision, a document — it is NOT answered, it IS the live work ("not yet confirmed/settled" describes work to do, never a reason to file it). And "answered" never means the user merely HAS what's needed to act: an unfulfilled request ("please forward this", "please send X") still owes the doing. NOT every passed date is expired — an unpaid invoice or an unanswered substantive ask still needs the work; when acting late still has value, judge the work normally.\n` +
        `- REVISIT ("not yet"): when the item's OWN WORDS say the right move comes LATER — a stated get-back date ("I'll send the numbers next week"), "let's reconnect after the board meeting on X", "check back in once the pilot ends" — then work="none" with revisit={"after":"YYYY-MM-DD"} (the date resolved FORWARD from the item's own date; if only a rough window is stated, pick its earliest day). The item leaves the desk and RETURNS on that date. Only with a concrete stated basis; NEVER park work that can and should be done now (an ask due today or undated is live work, not a revisit).\n` +
        `- decide ONLY when the real move is a choice between 2-3 CONCRETE routes stated in the item (accept/decline/redirect) — then give options (short labels, ≤4; do NOT include a decline, the surface adds it).\n` +
        `- executor: "coworker" (name one from THE TEAM — only when producing something is genuinely their craft) · "user" (replying, deciding, personal/admin) · "system" (an atomic mechanical act: send an existing file, book the stated invite).\n` +
        `- requires: for reply/send_file/produce ONLY — the concrete ATTACHABLE artifacts this work must INCLUDE, each as a short noun phrase in the item's OWN words (an email asking for "the organizational report, the individual report and the allocation sheet" requires those 3). An artifact is a THING that can be attached: a document, file, sheet, deck, link. NEVER a confirmation, approval, decision, answer, availability, or time — those are the user's sign-off or the reply's own words, not attachments (a "confirm the Thursday time" ask requires [], the reply itself carries the answer). ONLY what the item explicitly asks for or the work objectively cannot go out without; a plain conversational reply requires []. Never invent.\n` +
        `- Respect the deal's rules; never invent people, files, or dates.\n\n` +
        `JSON only: {"work":"…","component":"…","executor":{"kind":"coworker|user|system","name":"<team name if coworker>"},"options":[{"label":"…"}],"requires":[{"label":"…"}],"resolution":"expired|answered|null","expired_on":"YYYY-MM-DD (expired only — the stated date that passed)","expired_time":"HH:MM (only when it passed earlier TODAY — the stated clock time)","revisit":{"after":"YYYY-MM-DD","reason":"<why later>"}|null,"reason":"<one sentence>"}`;
    const judgeOnce = async (extra = '') => {
      const res = await aiCall<Record<string, unknown>>({
        userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 350, source: 'task_preparation',
        prompt: judgePrompt + extra,
      });
      return coerceVerdict(res.json, roster, { todayStr, nowHHMM: nowL.hhmm, itemText });
    };
    // The structural floors — applied to EVERY verdict (first pass and coherence retry alike).
    const applyFloors = (v: NonNullable<ReturnType<typeof coerceVerdict>>) => {
      // STRUCTURAL TIME FLOOR — the brain's own extracted deadline outranks the model's date
      // arithmetic: a deadline that is TODAY or LATER can never be "expired" (the for-Friday
      // misfire). Facts are structural; the disposition drops, nothing resolves, the item stays live.
      if (v.resolution === 'expired' && u?.deadline && u.deadline >= todayStr) delete v.resolution;
      // STRUCTURAL SENDER FLOOR — an automated sender's mailbox has NO READER: work can never be
      // "reply" or "chase" (the failed-payments class). The item's ACTION visibility is untouched.
      if (input.kind === 'inbox' && (v.work === 'reply' || v.work === 'chase')
        && isAutomatedSenderStrong(whoEmail, who, title)) {
        v.work = 'none'; v.component = 'message_only'; v.gate = null;
        delete v.requires; delete v.options;
        v.reason = `automated sender — a reply reaches no one; the action happens outside the mailbox. (${v.reason.slice(0, 110)})`;
      }
      return v;
    };
    // THE COHERENCE FLOOR (Aug 4 — the P18 class, promoted from "logged" to law): a plain none
    // whose OWN REASON claims the window passed — with no code-verified expired_on surviving the
    // floors — is an INCOHERENT verdict, not a judgment ("due tomorrow, but it is now past" stood
    // as none and vanished live work). Deterministic check on the model's own words; one
    // corrective retry; still incoherent → FAILED (never cached, never demotes — failure honesty).
    const incoherentNone = (v: NonNullable<ReturnType<typeof coerceVerdict>>) =>
      v.work === 'none' && !v.resolution && !v.revisit &&
      !v.reason.startsWith('automated sender') &&
      /(?:\bis\b|\bnow\b|\balready\b|\bhas\b)[^.]{0,20}\b(?:past|passed|expired)\b|\bwindow (?:has )?(?:passed|closed)\b|\bno longer (?:relevant|actionable|needed|possible)\b|\btoo late\b/i.test(v.reason);

    let verdict = await judgeOnce();
    // FAILURE HONESTY (W2): an unusable/absent model reply is a FAILED judgment, not a judged none.
    // It is never cached (caching it made an AI hiccup a confident day-long "nothing to do" — and the
    // deck's judgedNoneIds then demoted live work on an outage). The next open simply retries.
    if (!verdict) return { ...fallbackVerdict('could not judge this yet — it will retry'), failed: true };
    verdict = applyFloors(verdict);
    if (incoherentNone(verdict)) {
      const retry = await judgeOnce(
        `\n\nYOUR PREVIOUS VERDICT WAS INCOHERENT: its reason claimed the window/deadline had passed, ` +
        `but no date stated in the item verifies that (deadlines resolve FORWARD from the item's own ` +
        `date — "by tomorrow"/"by ${todayStr}" or later is FUTURE, never past). Re-judge: if the work ` +
        `is live, name it (reply/send_file/produce with its requires); "none" is lawful only with a ` +
        `verifiable expired_on or a reason that says nothing is owed by anyone.`);
      const rv = retry ? applyFloors(retry) : null;
      if (!rv || incoherentNone(rv)) {
        return { ...fallbackVerdict('incoherent verdict (claimed a passed window with no verifiable date) — it will retry'), failed: true };
      }
      verdict = rv;
    }
    await writeCache(client, userId, input, sig, verdict);
    return verdict;
  } catch { return { ...fallbackVerdict('could not judge this yet — it will retry'), failed: true }; }
}
