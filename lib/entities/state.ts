// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE BRAIN — ENTITY STATE synthesis (Phase B→C bridge). The brains move INTO the entity registry:
// for each entity, ONE reasoned pass over its linked ledger (all sources) produces where-it-stands,
// momentum, whoOwes, the ONE next move, and — new — the REASONED PRIORITY {weight, reason} that replaces
// the hand-tuned verdict weight tables (the demolition promise: judgment is reasoned, never a formula).
//
// Same discipline as the initiative/person brains: assembly is deterministic + cheap; the AI call is
// sig-gated (unchanged ledger = no AI); classification-shape via the router. Consumers read these fields
// in Phase C exactly where they read initiative_state/verdict today.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { isAutomatedSender } from '@/lib/inbox/automated';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

// VOICE (P5a): bump whenever the synthesis prompt/voice changes — threaded into the stored sig so every
// cached state regenerates through the existing sig-gated paths (the alignment-cache lesson: a
// prompt-driven cache must invalidate on the prompt itself, not only on the data).
export const STATE_PROMPT_VERSION = 7; // 7: THE EXCERPT-HONESTY LAW — clipped gists declare themselves; a clip marker is never source truncation. 6: LAW 6 — settled ledger lines speak history-grammar, never open-debt grammar. 5: THE DEIXIS LAW — no relative day-words in cached prose; pre-today ledger events are the past. 4: the reasoned `scope` verdict.

// The BANNED machinery register — the system describing its own bookkeeping instead of the matter.
// ONE definition: the synthesis self-checks against it (with a corrective retry) and the voice smoke
// gates with the same regex — they can never drift.
export const MACHINERY_REGISTER = /prepared for nudge|nudge (?:sent|prepared|ready)|completion signals?|draft (?:is )?ready|pending confirmation|documentation deliverables|communication (?:to \S+ )?overdue|no (?:response|reply) signal|awaiting your documentation|reminder (?:sent|scheduled)|follow-?up (?:prepared|queued)/i;

export type EntityState = {
  summary: string;                                  // where it stands right now
  momentum: 'active' | 'needs_you' | 'waiting' | 'gone_quiet' | 'stalled';
  category?: 'client' | 'internal' | 'personal' | 'admin'; // what KIND of work (reasoned)
  /** PROJECTHOOD (projecthood-plan P1) — the JUDGED scope. `project` = an ongoing body of work that
   *  belongs in the user's portfolio; `errand` = real but self-contained (one action closes it);
   *  `background` = automated/admin hum. The user's `tracked` pin is a READ-TIME override
   *  (consumers treat tracked as project) — the judgment itself stays pure. */
  scope?: 'project' | 'errand' | 'background';
  whoOwes: { you: string[]; them: string[] };
  stage: string | null;
  blocking: string | null;
};
export type EntityNextMove = {
  kind: 'reply' | 'send' | 'followup' | 'none'; title: string; reason: string; entityRef: string | null;
  /** THE ARBITER (P6a): ledger refs ("inbox:<id>" / "commit:<id>") of the member items this move
   *  RESOLVES — the emails/commitments whose whole point IS this move. Consumers render covered
   *  members as EVIDENCE under the one action instead of parallel calls-to-action ("one deal, one
   *  ask" — the semantic twin of one-obligation-one-row). Items NOT covered keep their own ask. */
  covers?: string[];
};
export type EntityPriority = { weight: number; reason: string };

export type LedgerLine = { at: string; kind: string; who: string | null; text: string; ref: string };

const daysBetween = (a: string, b: number) => Math.floor((b - new Date(a).getTime()) / 86400000);

// The user's own name (so the synthesis says "you") — same memo pattern as the brains.
const nameMemo = new Map<string, { at: number; name: string | null }>();
async function getUserName(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const c = nameMemo.get(userId);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.name;
  let name: string | null = null;
  try { const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(); name = (data as { full_name?: string } | null)?.full_name?.trim() || null; } catch { /* non-fatal */ }
  nameMemo.set(userId, { at: Date.now(), name });
  return name;
}

/** STRUCTURAL FACTS for the projecthood judgment (P1) — computed alongside the ledger, never AI.
 *  They CONSTRAIN the scope verdict the way domain facts constrain category. */
export type LedgerFacts = {
  counts: Record<string, number>;      // members by kind (email/meeting/commitment/event)
  spanDays: number;                    // first→last dated event
  activeDays: number;                  // distinct calendar days with activity
  automatedEmails: number;             // inbox members from automated/no-reply senders
  totalEmails: number;
  humanCounterparty: boolean;          // any real human on the other side (sender or commitment counterparty)
};

/** Assemble the entity's cross-source ledger from its links — deterministic, no AI. */
export async function assembleLedger(supabase: SupabaseClient, userId: string, entityId: string): Promise<{ ledger: LedgerLine[]; sig: string; quietDays: number | null; facts: LedgerFacts }> {
  const { data: links } = await supabase.from('entity_links')
    .select('item_kind, item_id').eq('user_id', userId).eq('entity_id', entityId).neq('item_kind', 'email_thread').limit(200);
  const byKind = new Map<string, string[]>();
  for (const l of (links ?? []) as Array<{ item_kind: string; item_id: string }>) {
    (byKind.get(l.item_kind) ?? byKind.set(l.item_kind, []).get(l.item_kind)!).push(l.item_id);
  }
  const ledger: LedgerLine[] = [];
  let totalEmails = 0, automatedEmails = 0, humanCounterparty = false;
  const inboxIds = byKind.get('inbox_item') ?? [];
  if (inboxIds.length) {
    const { data } = await supabase.from('inbox_items').select('id, work_title, source_data, created_at, status, last_activity_at').in('id', inboxIds.slice(0, 100));
    // THE WATERMARK LAW (Aug 2): a ledger line must carry the thread's CURRENT position, not the
    // founding snapshot — a member whose thread moved ("you replied", "they said thanks, done")
    // used to feed the synthesis its day-one ask forever. ONE batched query: the newest message
    // per member thread; when it's newer than the founding email, a NOW clause rides the line
    // (and, being part of the ledger text, it moves the sig — the state re-synthesizes).
    const nowByThread = new Map<string, { who: string; at: string; gist: string; fromUser: boolean }>();
    try {
      const tids = [...new Set(((data ?? []) as Array<Record<string, any>>)
        .map((it) => (it.source_data?.thread_id as string) || null).filter(Boolean))] as string[];
      if (tids.length) {
        const { data: latest } = await supabase.from('emails')
          .select('thread_id, from_name, from_address, received_at, is_from_user, body')
          .eq('user_id', userId).in('thread_id', tids.slice(0, 60))
          .order('received_at', { ascending: false }).limit(300);
        const { topMessageOf } = await import('@/lib/inbox/top-message');
        for (const m of (latest ?? []) as Array<Record<string, any>>) {
          const t = String(m.thread_id);
          if (nowByThread.has(t)) continue; // desc order — first seen is the newest
          nowByThread.set(t, {
            who: m.is_from_user ? 'the user' : String(m.from_name || m.from_address || 'them'),
            at: String(m.received_at || '').slice(0, 10),
            // EXCERPT-HONESTY (Aug 4): quoted gists declare their clipping — a hard cut read as
            // "the email is truncated" by the synthesis (found live on a normal email).
            gist: clipForPrompt(topMessageOf(String(m.body || '')).replace(/\s+/g, ' ').trim(), 110),
            fromUser: !!m.is_from_user,
          });
        }
      }
    } catch { /* the founding line still stands */ }
    for (const it of (data ?? []) as Array<Record<string, any>>) {
      const sd = it.source_data ?? {};
      // Resolution status rides the line (L2): a handled/dismissed item must read as SETTLED — so the
      // synthesis can see "he already dealt with this" instead of re-arguing it as open.
      // D2 (work-surface): a dismissal's USER NOTE is the strongest line here — the user told the
      // brain something it didn't know ("we'll discuss it Thursday"); the synthesis reasons WITH it.
      const note = typeof sd.dismiss_note === 'string' && sd.dismiss_note.trim() ? ` — user: "${sd.dismiss_note.trim()}"` : '';
      const res = it.status === 'completed' ? ' (handled)' : it.status === 'dismissed' ? ` (dismissed${note})` : '';
      // PROJECTION FLOOR (P7a): the line carries a CONTENT gist + an attachment note, not just the
      // subject — a title-only ledger made the brain confidently wrong about what an email contained
      // (the "no catalog yet" class). Every ledger consumer (state synthesis, entity ask, the
      // conversation loop's grounding) inherits this.
      const gist = clipForPrompt(String(sd.body || '').replace(/\s+/g, ' ').trim(), 90);
      const atts = Array.isArray(sd.attachments) ? (sd.attachments as Array<{ filename?: string }>).map((a) => a.filename).filter(Boolean) : [];
      totalEmails++;
      if (isAutomatedSender((sd.from_address as string) || null, (sd.from_name as string) || null, (sd.subject as string) || '')) automatedEmails++;
      else humanCounterparty = true;
      const nowLine = (() => {
        const n = sd.thread_id ? nowByThread.get(String(sd.thread_id)) : null;
        if (!n || !n.at || n.at <= String(sd.received_at ?? it.created_at ?? '').slice(0, 10)) return '';
        return ` — NOW (${n.at}, ${n.who} spoke last): "${n.gist}"`;
      })();
      ledger.push({
        at: sd.received_at ?? it.created_at ?? '', kind: 'email', who: sd.from_name ?? sd.from_address ?? null,
        text: `${String(it.work_title || sd.subject || '')}${res}${gist ? ` — "${gist}"` : ''}${atts.length ? ` [attached: ${atts.slice(0, 3).join(', ')}]` : ''}${nowLine}`,
        ref: `inbox:${it.id}`,
      });
    }
  }
  const mtgIds = byKind.get('meeting') ?? [];
  if (mtgIds.length) {
    const { data } = await supabase.from('meeting_transcripts').select('id, title, start_time').in('id', mtgIds.slice(0, 40));
    for (const m of (data ?? []) as Array<Record<string, any>>) ledger.push({ at: m.start_time ?? '', kind: 'meeting', who: null, text: String(m.title || 'Meeting'), ref: `meeting:${m.id}` });
  }
  const cIds = byKind.get('commitment') ?? [];
  if (cIds.length) {
    const { data } = await supabase.from('commitments').select('id, description, counterparty, direction, due_date, created_at, status, resolved_reason').in('id', cIds.slice(0, 60));
    // D2: a HUMAN resolved_reason (not one of the machine stamps) is the user's own context — surface it.
    const MACHINE_REASONS = new Set(['user_marked', 'user_dismissed', 'replied', 'chat', 'consolidated', 'completed', 'dismissed']);
    for (const c of (data ?? []) as Array<Record<string, any>>) {
      const owes = String(c.direction || 'you_owe') === 'awaiting' ? 'they owe' : 'you owe';
      if (c.counterparty) humanCounterparty = true;
      const rr = typeof c.resolved_reason === 'string' && c.resolved_reason.trim() && !MACHINE_REASONS.has(c.resolved_reason.trim()) ? ` — user: "${c.resolved_reason.trim()}"` : '';
      // LAW 6 (experience spec — found live Aug 2): a SETTLED obligation must never speak in
      // open-debt grammar. "you owe (done): … (due <today>)" led with the debt and a bare
      // due-today date — the synthesis followed the grammar and re-asserted a delivered report
      // as owed. Settled lines lead with DONE and put the date in the past tense.
      const isSettled = c.status === 'done' || c.status === 'dismissed';
      const text = isSettled
        ? `DONE — ${c.status === 'dismissed' ? `dismissed${rr}` : 'delivered/handled'}: ${c.description}${c.due_date ? ` (was due ${c.due_date})` : ''}`
        : `${owes}: ${c.description}${c.due_date ? ` (due ${c.due_date})` : ''}`;
      ledger.push({ at: c.created_at ?? '', kind: 'commitment', who: c.counterparty ?? null, text, ref: `commit:${c.id}` });
    }
  }
  // COWORKER DELIVERABLES (Prepared-Work C3): what the team produced for this entity's items — the deal's
  // brain SEES prepared work ("a proposal was drafted"), so state/next-move reason with it. Deliverables
  // hang off items (kind+entity_id = the item id), so we join through the entity's linked item ids.
  const itemIds = [...inboxIds.slice(0, 60), ...cIds.slice(0, 40)];
  if (itemIds.length) {
    try {
      const { data } = await supabase.from('item_deliverables').select('entity_id, title, type, created_at, metadata')
        .eq('user_id', userId).in('entity_id', itemIds).order('created_at', { ascending: false }).limit(12);
      for (const d of (data ?? []) as Array<Record<string, any>>) {
        ledger.push({ at: d.created_at ?? '', kind: 'commitment', who: (d.metadata?.agentName as string) ?? (d.metadata?.worker as string) ?? 'team', text: `team prepared: ${String(d.title || d.type || 'deliverable')}`, ref: `deliv:${d.entity_id}` });
      }
    } catch { /* pre-migration / non-fatal */ }
  }
  const calIds = byKind.get('calendar_event') ?? [];
  if (calIds.length) {
    const { data } = await supabase.from('calendar_events').select('id, title, start_time').in('id', calIds.slice(0, 40));
    const nowIso = new Date().toISOString();
    for (const e of (data ?? []) as Array<Record<string, any>>) ledger.push({ at: e.start_time ?? '', kind: 'meeting', who: null, text: `${(e.start_time ?? '') > nowIso ? 'Upcoming meeting' : 'Meeting'}: ${e.title || ''}`, ref: `event:${e.id}` });
  }
  ledger.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const nowMs = Date.now();
  const past = ledger.filter((l) => l.at && new Date(l.at).getTime() <= nowMs);
  const quietDays = past.length ? Math.max(0, daysBetween(past[0].at, nowMs)) : null;
  // CONTENT-HASH sig (L2) — the old `length:newest-at` was DEAF to user actions: resolving an item adds no
  // line and moves no timestamp, so the brain literally could not notice a dismissal/completion. Hashing
  // the line texts (which now carry resolution status) makes any status flip count as change.
  let h = 0; for (const l of ledger) { const s = `${l.at}|${l.text}`; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; }
  const sig = `${ledger.length}:${h}`;
  // Structural facts (P1) — derived from the same rows, deliberately OUTSIDE the sig (they add no
  // information the ledger hash doesn't already cover).
  const counts: Record<string, number> = {};
  for (const l of ledger) counts[l.kind] = (counts[l.kind] ?? 0) + 1;
  const datedMs = ledger.filter((l) => l.at).map((l) => new Date(l.at).getTime()).filter((n) => !Number.isNaN(n));
  const spanDays = datedMs.length >= 2 ? Math.round((Math.max(...datedMs) - Math.min(...datedMs)) / 86400000) : 0;
  const activeDays = new Set(ledger.filter((l) => l.at).map((l) => String(l.at).slice(0, 10))).size;
  const facts: LedgerFacts = { counts, spanDays, activeDays, automatedEmails, totalEmails, humanCounterparty };
  return { ledger: ledger.slice(0, 28), sig, quietDays, facts };
}

/** Sig-gated synthesis of ONE entity's state + next move + reasoned priority. */
export async function refreshEntityState(supabase: SupabaseClient, userId: string, entityId: string, opts: { force?: boolean } = {}): Promise<void> {
  try {
    const { data: ent } = await supabase.from('work_entities')
      .select('id, name, summary, aliases, sig, tracked').eq('id', entityId).eq('user_id', userId).maybeSingle();
    if (!ent) return;
    const { ledger, sig: ledgerSig, quietDays, facts } = await assembleLedger(supabase, userId, entityId);
    if (!ledger.length) {
      // SELF-HEAL: an active initiative with NO ledger and NO members is registry pollution — a
      // born-empty row (or one emptied outside reconcile). Archive it here (the same rule reconcile
      // applies on membership moves) so it can't sit in the portfolio/recall/snapshot forever.
      // THE PINNING LAW (July 29, found live): a TRACKED entity is a human decision — a user-created
      // project awaiting its work is NOT a ghost. The machine never auto-archives it, at any door.
      const { count } = await supabase.from('entity_links').select('*', { count: 'exact', head: true })
        .eq('user_id', userId).eq('entity_id', entityId);
      if (!count && !ent.tracked) {
        await supabase.from('work_entities').update({ status: 'archived' }).eq('id', entityId).eq('user_id', userId)
          .then(() => {}, () => {});
      }
      return;
    }
    // T-class EVENT-BOUNDARY invalidation: the ledger hash is content-only — time passing changes
    // nothing in it, which is how "prep session locked for tomorrow" survived the meeting itself.
    // The count of this entity's calendar events already in the PAST rides the sig: every time an
    // event boundary crosses, the state re-synthesizes once (never a daily re-burn for all).
    let pastEvents = 0;
    try {
      const { data: evLinks } = await supabase.from('entity_links').select('item_id')
        .eq('user_id', userId).eq('entity_id', entityId).eq('item_kind', 'calendar_event').limit(100);
      const evIds = ((evLinks ?? []) as Array<{ item_id: string }>).map((l) => l.item_id);
      if (evIds.length) {
        const { count } = await supabase.from('calendar_events').select('id', { count: 'exact', head: true })
          .in('id', evIds).lt('start_time', new Date().toISOString());
        pastEvents = count ?? 0;
      }
    } catch { /* boundary detection is an enhancement */ }
    const sig = `v${STATE_PROMPT_VERSION}:${ledgerSig}:ev${pastEvents}`;
    if (!opts.force && ent.sig === sig) return; // unchanged ledger + unchanged voice + no event boundary → no AI

    const userName = await getUserName(supabase, userId);
    const lines = ledger.map((l, i) => `[#${i + 1}] ${(l.at || '').slice(0, 10)} · ${l.kind}${l.who ? ` · ${l.who}` : ''}: ${l.text.slice(0, 200)}`).join('\n');
    const prompt =
      `You are the user's chief of staff, keeping the live picture of ONE body of work — it can be anything ` +
      `bounded: a deal, a program, a hire, an operation, a personal matter. No funnel assumptions. From its ` +
      `event ledger, write where it stands, pick the single next move, and judge its priority.\n\n` +
      (userName ? `The owner is ${userName} — address them as "you", never by name.\n` : '') +
      // THE DEIXIS LAW (T-class): this prose is CACHED and re-read for days — a relative day-word
      // decays into a lie, and anything already behind today's date is the PAST, not a plan.
      `TODAY is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. This text will be read for DAYS — never write relative day-words ("tomorrow", "next week", "later today"): name absolute dates ("Jul 28"). Anything in the ledger dated BEFORE today already HAPPENED — describe it as past ("they met Jul 28"), never as upcoming.\n` +
      // EXCERPT-HONESTY (Aug 4): the ledger's quoted gists are clipped by US for length.
      `${EXCERPT_RULE} Never describe a message or document as truncated/cut-off/incomplete based on a clipped quote.\n` +
      `A ledger line marked DONE / (handled) / (dismissed) is HISTORY — the obligation is settled; NEVER present it as owed, due, or pending, whatever its original due date says. If everything is settled, say so plainly (the calm is earned).\n` +
      `Body of work: ${ent.name}${ent.summary ? ` — ${ent.summary}` : ''}\n` +
      `Days since last real touch: ${quietDays ?? 'unknown'}\n` +
      `STRUCTURAL FACTS (these CONSTRAIN your scope judgment):\n` +
      `- members: ${Object.entries(facts.counts).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}\n` +
      `- activity span: ${facts.spanDays} days (${facts.activeDays} distinct days)\n` +
      `- automated senders: ${facts.automatedEmails}/${facts.totalEmails} emails\n` +
      `- human counterparty present: ${facts.humanCounterparty ? 'yes' : 'no'}\n\n` +
      `Event ledger (most recent first — ALL you know; never invent beyond it):\n${lines}\n\n` +
      `VOICE — this text renders on the user's cards and briefs; write like a sharp colleague, not a system:\n` +
      `- Speak about the MATTER: the people, the thing being done, what just happened, what's genuinely next. Plain words.\n` +
      `- NEVER describe this system's own bookkeeping or internal status: no "prepared for nudge", "draft ready", ` +
      `"no completion signal", any talk of "signals", "communication overdue", "awaiting deliverables", "pending confirmation", ` +
      `"documentation deliverables" — that register is banned. A ledger line like "team prepared: X" is OUR ` +
      `machinery: reason with it, but the summary talks about the deal, never about us or our drafts.\n` +
      `- "summary": 1-2 short sentences, <=30 words, concrete and current — what you'd say if asked "where's ` +
      `this at?" over coffee. Name the real person or thing driving it. NO semicolon chains, NO status-report telegrams.\n` +
      `- whoOwes entries: short human phrases as a colleague would say them ("send them your pricing", "their signed contract").\n\n` +
      `Return ONLY JSON:\n` +
      `{"summary":"1-2 sentences, <=30 words, colleague voice",` +
      `"momentum":"active|needs_you|waiting|gone_quiet|stalled",` +
      `"whoOwes":{"you":["short items YOU owe"],"them":["short items OTHERS owe you"]},` +
      `"stage":"<=4 words in its own terms, or null",` +
      `"blocking":"<=12 words if something concrete blocks it, else null",` +
      `"scope":"project|errand|background",` +
      `"next_move":{"kind":"reply|send|followup|none","title":"<=10 words, an imperative you could act on as-is","reason":"<=15 words why now","covers":["#N refs of ledger items this move RESOLVES"]},` +
      `"priority":{"weight":0-100,"reason":"<=12 words"}}\n` +
      `priority calibration — judge against a busy person's whole day: 80+ = drop-everything (a major matter ` +
      `needs you now / hard deadline); 50-79 = important active matter; 20-49 = routine upkeep; <20 = background ` +
      `noise/awareness. Judge by stakes IN THE LEDGER (who's waiting, money, deadlines, momentum) — never inflate.\n` +
      `scope — PROJECTHOOD, the judgment that decides whether this earns a slot in the user's portfolio:\n` +
      `- "project" = an ongoing body of work: multiple touches over time, a human counterparty/team, an ` +
      `objective that outlives any single action (a deal, a program, a hire, an engagement).\n` +
      `- "errand" = real but SELF-CONTAINED: one action (or a short exchange) closes it — a bill, a security ` +
      `alert, a single ask, a delivery problem, a one-off intro. Real work, but not a slot in their head.\n` +
      `- "background" = automated/administrative hum with no genuine action for the user.\n` +
      `HARD CONSTRAINTS from the facts: all-automated senders with NO human counterparty can NEVER be ` +
      `"project". A single email with no follow-on is not a "project". When genuinely unsure between ` +
      `project and errand, choose "errand" — the user can always promote it, but a portfolio full of ` +
      `non-projects destroys trust.\n` +
      `next_move — honest: "none" when nothing is owed (do NOT invent a move).\n` +
      `next_move.covers — the ARBITER: list the [#N] refs of OPEN ledger items whose whole point IS this ` +
      `move (the email asking for it, the commitment promising it) — doing the move settles them. Items ` +
      `merely related but with their OWN distinct ask are NOT covered. Empty when unsure.`;

    type StateJson = {
      summary?: string; momentum?: string; whoOwes?: { you?: string[]; them?: string[] }; stage?: string | null; blocking?: string | null;
      scope?: string;
      next_move?: { kind?: string; title?: string; reason?: string; covers?: unknown[] }; priority?: { weight?: number; reason?: string };
    };
    const res = await aiCall<StateJson>({ userId, supabase, shape: { output: 'json' }, prompt, temperature: 0, maxTokens: 900, source: 'brain_synthesis' });
    let p = res.json ?? {};
    if (!p.summary) { console.warn('[state] synthesis returned no summary (likely truncation) — state left as-is'); return; }
    // SELF-CORRECTION: temp-0 can repeat a banned phrase verbatim even when the prompt names it. One
    // corrective retry quoting the violation; if it persists, keep the retry's output (the smoke gate
    // reports any systemic leak). Costs one extra call ONLY on a violation — rare.
    if (MACHINERY_REGISTER.test(String(p.summary))) {
      const bad = String(p.summary).match(MACHINERY_REGISTER)?.[0] ?? '';
      const retry = await aiCall<StateJson>({
        userId, supabase, shape: { output: 'json' }, temperature: 0.4, maxTokens: 900, source: 'brain_synthesis',
        prompt: prompt + `\n\nYOUR PREVIOUS DRAFT used the banned system-register phrase "${bad}" in the summary. Rewrite the WHOLE JSON with the summary in plain colleague speech about the matter — no bookkeeping/status-register words at all.`,
      });
      if (retry.json?.summary) p = retry.json;
    }

    const mo = ['active', 'needs_you', 'waiting', 'gone_quiet', 'stalled'].includes(p.momentum as string) ? p.momentum : 'active';
    // Category is owned by the GROUNDED classifier (scripts/backfill-entity-category.ts — domain-aware),
    // NOT this ledger-only pass. PRESERVE the existing grounded value so a state refresh never overwrites it.
    let priorCategory: EntityState['category'] | undefined;
    try { const { data: cur } = await supabase.from('work_entities').select('state').eq('id', entityId).maybeSingle(); priorCategory = ((cur?.state ?? null) as { category?: EntityState['category'] } | null)?.category; } catch { /* non-fatal */ }
    // SCOPE — validated; the structural constraint is enforced in CODE too (a fact can't be argued
    // with): no human counterparty + majority-automated mail can never judge "project". Missing/invalid
    // scope falls back to a conservative structural read.
    let scope = (['project', 'errand', 'background'].includes(p.scope as string) ? p.scope : null) as EntityState['scope'] | null;
    if (!scope) {
      scope = facts.humanCounterparty && (Object.keys(facts.counts).length >= 2 || facts.spanDays >= 7) ? 'project' : 'errand';
    }
    if (scope === 'project' && !facts.humanCounterparty && facts.totalEmails > 0 && facts.automatedEmails >= facts.totalEmails) {
      scope = 'errand';
    }
    const state: EntityState = {
      summary: String(p.summary).slice(0, 200), momentum: mo as EntityState['momentum'],
      category: priorCategory,
      scope,
      whoOwes: { you: (p.whoOwes?.you ?? []).slice(0, 5).map(String), them: (p.whoOwes?.them ?? []).slice(0, 5).map(String) },
      stage: p.stage ? String(p.stage).slice(0, 40) : null,
      blocking: p.blocking ? String(p.blocking).slice(0, 120) : null,
    };
    let nextMove: EntityNextMove | null = null;
    const nm = p.next_move;
    if (nm?.kind && ['reply', 'send', 'followup'].includes(nm.kind) && nm.title) {
      const latestInbound = ledger.find((l) => l.kind === 'email')?.ref ?? null;
      // covers: "#N" citations → ledger refs. Only refs that actually exist survive (grounded-or-absent).
      const covers = (Array.isArray((nm as { covers?: unknown }).covers) ? ((nm as { covers?: unknown[] }).covers ?? []) : [])
        .map((c) => { const i = parseInt(String(c).replace(/\D/g, ''), 10) - 1; return ledger[i]?.ref ?? null; })
        // Only FOLDABLE members (emails/commitments — the rows the deck arbitrates). A calendar event or
        // team deliverable is context the move may cite, but nothing downstream folds it.
        .filter((r): r is string => !!r && (r.startsWith('inbox:') || r.startsWith('commit:'))).slice(0, 12);
      nextMove = { kind: nm.kind as EntityNextMove['kind'], title: String(nm.title).slice(0, 120), reason: String(nm.reason || '').slice(0, 140), entityRef: latestInbound, ...(covers.length ? { covers } : {}) };
    }
    const priority: EntityPriority = {
      weight: Math.max(0, Math.min(100, Math.round(Number(p.priority?.weight ?? 20)))),
      reason: String(p.priority?.reason || '').slice(0, 100),
    };
    await supabase.from('work_entities').update({
      state, next_move: nextMove, priority, sig,
      last_event_at: ledger[0]?.at || new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', entityId).eq('user_id', userId);
  } catch { /* non-fatal */ }
}

/** Batch refresh (sig-gated per entity — unchanged ones cost nothing). */
export async function refreshEntityStates(supabase: SupabaseClient, userId: string, entityIds?: string[]): Promise<void> {
  let ids = entityIds;
  if (!ids) {
    const { data } = await supabase.from('work_entities').select('id').eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(300);
    ids = (data ?? []).map((r) => r.id as string);
  }
  const CH = 4;
  for (let i = 0; i < ids.length; i += CH) {
    await Promise.all(ids.slice(i, i + CH).map((id) => refreshEntityState(supabase, userId, id)));
  }
}
