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
import { COMPONENT_KEYS, gateOf, renderComponentOptions, componentForWork, JUDGE_VERSION, type WorkComponentKey, type WorkGate } from '@/lib/work/surface-registry';

export type WorkVerdict = {
  work: 'reply' | 'decide' | 'produce' | 'send_file' | 'schedule' | 'chase' | 'none';
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
  /** THE DELIVERABLE INVENTORY (the "what does it take" half of the judgment): the concrete
   *  attachable artifacts this work must INCLUDE, in the item's own words ("could you share the
   *  org report, individual report and ALP sheet" → 3 entries). ONLY what the item explicitly
   *  asks for or the work objectively cannot go out without — never inferred nice-to-haves.
   *  The preparation pass resolves each (have it / need it from the user) before drafting. */
  requires?: Array<{ label: string }>;
  reason: string;
};

export type JudgeInput = { kind: 'inbox' | 'commitment'; id: string };

const WORKS = new Set(['reply', 'decide', 'produce', 'send_file', 'schedule', 'chase', 'none']);

function fallbackVerdict(reason: string, resolution?: 'expired' | 'answered'): WorkVerdict {
  return { work: 'none', component: 'message_only', executor: { kind: 'user' }, gate: null, reason, ...(resolution ? { resolution } : {}) };
}

function coerceVerdict(raw: unknown, roster: RosterEntry[]): WorkVerdict | null {
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
    reason: String(r.reason || '').slice(0, 240),
  };
  // The disposition is only meaningful on a none verdict (a live work item can't be moot).
  const reso = String(r.resolution || '').toLowerCase();
  if (work === 'none' && (reso === 'expired' || reso === 'answered')) out.resolution = reso;
  if (work === 'decide' && Array.isArray(r.options)) {
    out.options = (r.options as unknown[]).slice(0, 4)
      .map((o) => ({ label: String((o as Record<string, unknown>)?.label ?? o ?? '').slice(0, 80) }))
      .filter((o) => o.label);
  }
  // The deliverable inventory is only meaningful on outbound work (a none/chase carries nothing).
  if ((work === 'reply' || work === 'send_file' || work === 'produce') && Array.isArray(r.requires)) {
    const reqs = (r.requires as unknown[]).slice(0, 5)
      .map((o) => ({ label: String((o as Record<string, unknown>)?.label ?? o ?? '').trim().slice(0, 90) }))
      .filter((o) => o.label);
    if (reqs.length) out.requires = reqs;
  }
  return out;
}

/** The judgment cache rides item_plans (kind 'judgment', entity_id = `${kind}:${id}` — free TEXT,
 *  zero-migration, owner-RLS). tasks jsonb holds { verdict, sig }. */
async function readCache(
  client: SupabaseClient, userId: string, input: JudgeInput, sig: string,
): Promise<{ hit: WorkVerdict | null; prior: WorkVerdict | null }> {
  const { data } = await client.from('item_plans').select('tasks')
    .eq('user_id', userId).eq('kind', 'judgment').eq('entity_id', `${input.kind}:${input.id}`).maybeSingle();
  const t = (data?.tasks ?? null) as { verdict?: unknown; sig?: string } | null;
  const v = (t?.verdict ?? null) as WorkVerdict | null;
  const valid = !!v && WORKS.has(v.work) && COMPONENT_KEYS.has(v.component);
  if (!valid) return { hit: null, prior: null };
  // A stale-sig verdict is still the judge's OWN PRIOR JUDGMENT — fed back into the re-judgment
  // as self-consistency context (stickiness through reasoning, never a lock): an ambiguous item
  // must not flip verdicts on a daily re-check unless something material actually changed.
  // SAME-VERSION ONLY: a prior made under an older JUDGE_VERSION was judged under different laws —
  // anchoring on it would entrench exactly the calls a version bump exists to correct.
  const sameVersion = String(t!.sig ?? '').split(':')[0] === String(JUDGE_VERSION);
  if (t!.sig === sig) return { hit: v, prior: v };
  return { hit: null, prior: sameVersion ? v : null };
}

async function writeCache(client: SupabaseClient, userId: string, input: JudgeInput, sig: string, verdict: WorkVerdict): Promise<void> {
  await client.from('item_plans').upsert({
    user_id: userId, kind: 'judgment', entity_id: `${input.kind}:${input.id}`,
    tasks: { verdict, sig }, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
}

export async function judgeWork(client: SupabaseClient, userId: string, input: JudgeInput): Promise<WorkVerdict> {
  try {
    // ── Load the item + its brain neighborhood. ──
    let title = '', body = '', who: string | null = null, whoEmail: string | null = null;
    let u: ItemUnderstanding | null = null, activityAt = '', workState: string | null = null, rawKind: string | null = null;
    let threadMsgs: ThreadMessage[] = [];
    if (input.kind === 'inbox') {
      const { data: it } = await client.from('inbox_items')
        .select('id, work_title, work_state, status, last_activity_at, created_at, source_data')
        .eq('id', input.id).eq('user_id', userId).maybeSingle();
      if (!it || it.status !== 'pending') return fallbackVerdict('no longer open');
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      title = String(it.work_title || sd.subject || '');
      body = String(sd.body || '').slice(0, 1600);
      who = (sd.from_name as string) || (sd.from_address as string) || null;
      whoEmail = (sd.from_address as string) || null;
      u = coerceUnderstanding(sd.understanding);
      rawKind = rawMailKindOf(sd);
      workState = (it.work_state as string) || null;
      activityAt = String(it.last_activity_at || it.created_at || '');
      const tid = (sd.thread_id as string) || null;
      if (tid) {
        const { data: msgs } = await client.from('emails').select('is_from_user, received_at, from_address, to_addresses, cc_addresses')
          .eq('user_id', userId).eq('thread_id', tid);
        threadMsgs = ((msgs ?? []) as Array<Record<string, unknown>>).map((m) => ({
          is_from_user: !!m.is_from_user, received_at: (m.received_at as string) ?? null,
          from: (m.from_address as string) ?? null,
          to: [...((m.to_addresses as string[]) ?? []), ...((m.cc_addresses as string[]) ?? [])],
        }));
      }
    } else {
      const { data: c } = await client.from('commitments')
        .select('id, description, counterparty, direction, status, due_date, updated_at, created_at')
        .eq('id', input.id).eq('user_id', userId).maybeSingle();
      if (!c || !['open', 'pending', 'in_progress'].includes(String(c.status))) return fallbackVerdict('no longer open');
      title = String(c.description || '');
      who = (c.counterparty as string) || null;
      activityAt = String(c.updated_at || c.created_at || '');
      body = `direction: ${c.direction}${c.due_date ? ` · due ${c.due_date}` : ''}`;
    }

    // ── The pool (the judge must KNOW prepared work exists) + the sig. ──
    const pool: PreparedArtifact[] = await getPrepared(client, userId, { kind: input.kind === 'inbox' ? 'inbox_item' : 'commitment', id: input.id });
    // The day rides the sig: with time-awareness a verdict is a function of TODAY (what's live now
    // can be moot tomorrow) — at most one re-judgment per item per day.
    const sig = `${JUDGE_VERSION}:${new Date().toISOString().slice(0, 10)}:${activityAt}:${pool.length}:${pool[0]?.at ?? ''}`;
    const { hit: cached, prior } = await readCache(client, userId, input, sig);
    if (cached) return cached;

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
    const roster = await loadRoster(client, userId);
    const poolBlock = pool.length
      ? `ALREADY PREPARED (prefill, don't redo): ${pool.slice(0, 3).map((d) => `${d.kind}${d.by ? ` by ${d.by}` : ''}${d.attachment ? ` (+${d.attachment.filename})` : ''}`).join(' · ')}\n`
      : '';

    // ── THE ONE REASONED CALL. ──
    const res = await aiCall<Record<string, unknown>>({
      userId, supabase: client, shape: { output: 'json' }, temperature: 0, maxTokens: 350, source: 'task_preparation',
      prompt:
        `You are the user's chief of staff judging ONE piece of work: what does DOING it take?\n\n` +
        `TODAY is ${new Date().toISOString().slice(0, 10)}. The item's last activity was ${activityAt.slice(0, 10) || 'unknown'}.\n\n` +
        dealBlock + personBlock + poolBlock +
        (u ? `UNDERSTANDING: relevance=${u.relevance} ownership=${u.ownership ?? '?'} kind=${u.mailKind ?? '?'}${u.ask ? ` ask="${u.ask}"` : ''}${u.deadline ? ` deadline=${u.deadline}` : ''}\n` : '') +
        `THE ITEM${who ? ` (from ${who})` : ''}: ${title.slice(0, 140)}\n${body ? `${body.slice(0, 1200)}\n` : ''}\n` +
        `THE TEAM (for executor "coworker"):\n${roster.map((w) => `- ${w.name} — ${w.role.replace(/_/g, ' ')}: ${w.description}`).join('\n') || '(none)'}\n\n` +
        `COMPONENTS (pick exactly one — what the work surface should mount):\n${renderComponentOptions()}\n\n` +
        (prior ? `YOUR PRIOR JUDGMENT on this item: work=${prior.work}${prior.resolution ? ` resolution=${prior.resolution}` : ''} — "${prior.reason.slice(0, 120)}". BE CONSISTENT with it unless something in the item MATERIALLY changed since; do not flip an ambiguous call on a re-read.\n\n` : '') +
        `Rules:\n` +
        `- work: reply|decide|produce|send_file|schedule|chase|none. CONSERVATIVE: unsure → "none"/"message_only" — a wrong mount costs trust, none costs nothing.\n` +
        `- A commitment with direction "awaiting" means the COUNTERPARTY owes the user — the natural work is "chase" (nudge what you're owed) unless it's moot or the item clearly says otherwise.\n` +
        `- TIME: if the thing this asks about has ALREADY HAPPENED or its window has passed such that acting now is pointless (a meeting that took place, access for a past event, a "tomorrow" that has gone), work="none" with resolution="expired". If the ask is already settled/confirmed in the item itself (a closure, a confirmation of something now locked), work="none" with resolution="answered" — but "answered" means the ASK ITSELF is settled, NOT that the user merely has everything needed to act: an unfulfilled request ("please forward this", "please send X") still owes the doing even when the material to do it is right there in the message. NOT every passed date is expired — an unpaid invoice or an unanswered substantive ask still needs the work; when acting late still has value, judge the work normally.\n` +
        `- decide ONLY when the real move is a choice between 2-3 CONCRETE routes stated in the item (accept/decline/redirect) — then give options (short labels, ≤4; do NOT include a decline, the surface adds it).\n` +
        `- executor: "coworker" (name one from THE TEAM — only when producing something is genuinely their craft) · "user" (replying, deciding, personal/admin) · "system" (an atomic mechanical act: send an existing file, book the stated invite).\n` +
        `- requires: for reply/send_file/produce ONLY — the concrete attachable artifacts this work must INCLUDE, each as a short noun phrase in the item's OWN words (an email asking for "the organizational report, the individual report and the allocation sheet" requires those 3). ONLY what the item explicitly asks for or the work objectively cannot go out without; a plain conversational reply requires []. Never invent.\n` +
        `- Respect the deal's rules; never invent people, files, or dates.\n\n` +
        `JSON only: {"work":"…","component":"…","executor":{"kind":"coworker|user|system","name":"<team name if coworker>"},"options":[{"label":"…"}],"requires":[{"label":"…"}],"resolution":"expired|answered|null","reason":"<one sentence>"}`,
    });
    const verdict = coerceVerdict(res.json, roster) ?? fallbackVerdict('could not judge — showing the message');
    await writeCache(client, userId, input, sig, verdict);
    return verdict;
  } catch { return fallbackVerdict('could not judge — showing the message'); }
}
