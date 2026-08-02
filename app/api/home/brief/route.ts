import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSystemClient } from '@/lib/ai/factory';
import { buildAnsweredSet } from '@/lib/inbox/needs-reply';
import { computeThreadReplyState } from '@/lib/inbox/thread-resolution';
import { classifyItem } from '@/lib/inbox/classify-item';
import { getUnderstanding, coerceUnderstanding } from '@/lib/inbox/item-understanding';
import { lastMeetingRecall } from '@/lib/context/voice-context';
import { buildBriefContext, type EmailSeed } from '@/lib/home/brief-context';
import { synthesizeBrief, type MustRespondCandidate } from '@/lib/home/synthesize-brief';
import { loadUserRules } from '@/lib/inbox/rules/load';
import { buildInitiativeClusters, type ClusterMap } from '@/lib/projects/initiative-clusters';
import { normalizeInitiative } from '@/lib/inbox/item-understanding';
import { resolveOutboundAwaiting } from '@/lib/outbound/resolve';
import { reconcileRepliedItems } from '@/lib/inbox/reconcile-replied';
import { foldDuplicateCommitments, visibleObligationsFromItems } from '@/lib/home/dedupe-deck';
import { isCalendarSystemSubject } from '@/lib/inbox/automated';
import { computeBundles } from '@/lib/home/bundle-brief';
import { nameBundles, type BundleName, type BundleNameInput } from '@/lib/home/name-bundles';

export const maxDuration = 30;

// GET /api/home/brief — the day brief, LAYERED by topic (not a flat task list).
// A meeting with N action items is ONE card (items nested); commitments group under their
// source; emails are one card per thread. The Home stays a brief, not a backlog.

const DAY = 86_400_000;
const BRIEF_TTL = 3 * 60 * 60 * 1000;
const MAX_PRIORITIES = 6;

// ── Display-level dedup backstop for commitments ──────────────────────────────────────────────
// Even before any data cleanup, existing near-duplicate commitment rows shouldn't double up in a
// lane. General (token-overlap, no text special-casing — mirrors the extractor's write-time dedup):
// two descriptions with heavy content-word overlap are the same obligation; keep the first, drop the
// rest. Works for any wording/language; never merges distinct tasks that merely share a noun.
const DEDUP_STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'with', 'on', 'in', 'at', 'by', 'from', 'up',
  'out', 'over', 'about', 'into', 'as', 'is', 'be', 'will', 'would', 'should', 'need', 'needs',
  'please', 'get', 'send', 'this', 'that', 'it', 'them', 'me', 'you', 'we', 'i', 'he', 'she', 'they',
]);
function dedupNorm(s: string): string { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function dedupTokens(s: string): Set<string> {
  const toks = dedupNorm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
    .filter((t) => t.length > 2 && !DEDUP_STOPWORDS.has(t));
  return new Set(toks);
}
function sameObligation(a: string, b: string, threshold = 0.6): boolean {
  const na = dedupNorm(a), nb = dedupNorm(b);
  if (na === nb) return true;
  if (na && nb && (na.includes(nb) || nb.includes(na))) return true;
  const ta = dedupTokens(a), tb = dedupTokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= threshold;
}
function dedupByDescription<T extends { description: string }>(rows: T[]): T[] {
  const kept: T[] = [];
  for (const r of rows) {
    if (kept.some((k) => sameObligation(k.description, r.description))) continue;
    kept.push(r);
  }
  return kept;
}

// Automated / transactional senders are never a reply YOU owe — a "payment failed", "account
// suspended", "verify your email", or no-reply notification is not a human waiting on you, even if
// the classifier tagged it needs_reply. Keep this heuristic CONSERVATIVE and well-scoped: it only
// removes an item from the must-respond (needs_reply) pool — the item still flows through the FYI /
// awareness path. Matches on the from ADDRESS localpart (no-reply@, notifications@, billing@…), a few
// bulk-sender domains, and unmistakable automated display-name / subject phrases.
// The ONE quiet relationship CUE for a card, from the durable Person Brain — short + snappy (≤1 word / "quiet
// Nw"), rendered as a muted tag on the item card so stakes read at a glance WITHOUT a new section. Priority:
// a gone-quiet relationship's time signal ("quiet 3w") beats the relationship word. Skips low-signal
// (colleague/unknown) so only meaningful cues show → the ones that do stand out.
function relationshipCue(relationship?: string | null, momentum?: string | null, quietDays?: number | null): { label: string; tone: 'neutral' | 'amber' } | null {
  if (momentum === 'gone_quiet' && typeof quietDays === 'number' && quietDays >= 4) {
    return { label: quietDays >= 10 ? `quiet ${Math.round(quietDays / 7)}w` : `quiet ${quietDays}d`, tone: 'amber' };
  }
  const rel = (relationship || '').toLowerCase();
  if (rel && rel !== 'unknown' && rel !== 'colleague') return { label: rel, tone: 'neutral' };
  return null;
}

// H4/J1 — the ownership-keyed notice law + the strong automated-sender read live in ONE module
// (lib/inbox/notice-demotion.ts) shared with judgeWork. Local aliases keep call sites unchanged.
import { isAutomatedSenderStrong as isAutomatedSender, isActionWorthyAutomated, isNoMoveNotice, rawMailKindOf } from '@/lib/inbox/notice-demotion';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attendeeEmails(ev: any): string[] {
  return (ev?.attendees ?? []).map((a: any) => (a?.email || '').toLowerCase()).filter(Boolean);
}

// A calendar-CANCELLATION event whose title is the raw provider string ("Canceled event: …",
// "Cancelled: …") is not an upcoming meeting even when its row status is still 'confirmed'. These
// ARE the literal Google/Outlook-generated titles, so a small prefix list is the right tool.
function isCancelledEventTitle(title: string | null | undefined): boolean {
  const t = (title || '').trimStart().toLowerCase();
  return t.startsWith('canceled event:') || t.startsWith('cancelled event:') ||
    t.startsWith('canceled:') || t.startsWith('cancelled:');
}

// Calendar-SYSTEM email subjects (invite created/updated/cancelled, RSVP replies) leak into the
// "last thread" subtitle as raw provider strings. These are the literal multi-language subjects
// providers auto-generate — a prefix/pattern list is correct here (not a content heuristic). When a
// related email's subject matches, suppress the subtitle rather than show the raw string.
// (isCalendarSystemSubject → lib/inbox/automated.ts — one module owns machine-mail tests.)

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const endOfDay = `${todayStr}T23:59:59Z`;
  // Start-of-today (UTC approximation) — the boundary for "cleared TODAY" counts. Computed fresh
  // per request so the ring's `cleared` half rises as the day goes on and resets each morning.
  const startOfDay = `${todayStr}T00:00:00Z`;
  const self = user.email?.toLowerCase();

  // ── P0 perf: coarse phase marks, logged as ONE line when a request runs slow (catch regressions). ──
  const t0 = Date.now();
  const marks: Array<[string, number]> = [];
  const mark = (label: string) => { marks.push([label, Date.now() - t0]); };

  // Profile FIRST (one cheap read): home_brief carries the last-good brief AND the `aux` side-cache
  // (reconcile stamp + clusters/outbound snapshots) that lets the hot path SKIP its expensive phases.
  // The GET path's hard rule (P0): no AI call, no >500ms phase — heavy work serves last-good and
  // recomputes in after().
  const { data: profileRow } = await supabase.from('profiles').select('full_name, home_brief').eq('id', user.id).single();
  const profileRes = { data: profileRow as { full_name?: string; home_brief?: Record<string, unknown> } | null };
  type BriefAux = {
    reconciledAt?: string;
    clustersAt?: string;
    outbound?: Awaited<ReturnType<typeof resolveOutboundAwaiting>>;
    clusters?: Array<[string, { key: string; label: string; total: number }]>;
  };
  const aux: BriefAux = ((profileRow?.home_brief as { aux?: BriefAux } | null | undefined)?.aux) ?? {};
  // Read-merge-write a patch into home_brief.aux (never clobbers the brief or sibling aux keys).
  const mergeAux = async (patch: Partial<BriefAux>) => {
    try {
      const { data } = await supabase.from('profiles').select('home_brief').eq('id', user.id).single();
      const hb = ((data?.home_brief as Record<string, unknown>) ?? {});
      const curAux = ((hb.aux as BriefAux) ?? {});
      await supabase.from('profiles').update({ home_brief: { ...hb, aux: { ...curAux, ...patch } } }).eq('id', user.id).then(() => {}, () => {});
    } catch { /* non-fatal */ }
  };

  // SELF-HEAL (trust), THROTTLED: re-derive reply state from the actual threads and resolve any "reply
  // needed" item the user has ALREADY answered. Correct but ~0.7s — so it runs at most every 10 min (a
  // stamp in aux), not on every 90s poll. No cache-bust needed: a resolution changes the pending counts,
  // which changes the brief's sig naturally.
  const RECONCILE_EVERY_MS = 10 * 60_000;
  if (!aux.reconciledAt || now.getTime() - Date.parse(aux.reconciledAt) > RECONCILE_EVERY_MS) {
    await reconcileRepliedItems(supabase, user.id, { bustBriefCache: async () => {} });
    after(async () => { await mergeAux({ reconciledAt: now.toISOString() }); });
  }
  mark('reconcile');

  // Initiative CLUSTERS (Phase 5) — an actionable item belongs to a real initiative (a deal/client/program)
  // when its initiative has ≥2 TOTAL items (correspondence + commitments). Together with the cold-outbound
  // resolve this is ~5s of queries, so BOTH are served from the aux side-cache (15-min TTL): last-good
  // instantly, recomputed in after() when stale. Synchronous ONLY when no snapshot exists at all
  // (first-ever load) so initiative tags aren't blank forever. `clusterTag` resolves an item's
  // initiative → {label, total}; outbound also feeds the "waiting on" lane below.
  const AUX_TTL_MS = 15 * 60_000;
  let outboundAwaiting: Awaited<ReturnType<typeof resolveOutboundAwaiting>> = aux.outbound ?? [];
  let clusters: ClusterMap = new Map((aux.clusters ?? []) as Array<[string, { key: string; label: string; total: number }]>);
  const clustersFresh = !!aux.clustersAt && now.getTime() - Date.parse(aux.clustersAt) < AUX_TTL_MS;
  if (!aux.clustersAt) {
    outboundAwaiting = await resolveOutboundAwaiting(supabase, user.id, todayStr).catch(() => []);
    try { clusters = await buildInitiativeClusters(supabase, user.id, { includeCalendar: false, outbound: outboundAwaiting }); } catch { /* non-fatal */ }
    const snapOb = outboundAwaiting, snapCl = [...clusters.entries()];
    after(async () => { await mergeAux({ clustersAt: now.toISOString(), outbound: snapOb, clusters: snapCl }); });
  } else if (!clustersFresh) {
    after(async () => {
      try {
        const ob = await resolveOutboundAwaiting(supabase, user.id, todayStr).catch(() => []);
        let cl: ClusterMap = new Map();
        try { cl = await buildInitiativeClusters(supabase, user.id, { includeCalendar: false, outbound: ob }); } catch { /* non-fatal */ }
        await mergeAux({ clustersAt: new Date().toISOString(), outbound: ob, clusters: [...cl.entries()] });
      } catch { /* non-fatal */ }
    });
  }
  mark('clusters');
  // USER-CREATED ONLY (every surface): a row's project tag may only name a TRACKED project —
  // recognition keeps running underneath, but an untracked entity is invisible AS a project.
  // Loaded here (before clusterTag) so the ONE tag-derivation point gates every serving site
  // (mustRespond, priorities, commitments, waitingOn, outbound) at once; the same list is served
  // to the client for By-project grouping.
  let trackedProjects: Array<{ name: string; aliases: string[] }> = [];
  // id → tracked name: the row-tag source for ENTITY-LINKED atoms (independent of state synthesis —
  // a freshly-filled project has a null state until the pass runs, and its tag must show anyway).
  const trackedNameById = new Map<string, string>();
  try {
    const { data: tps } = await supabase.from('work_entities').select('id, name, aliases')
      .eq('user_id', user.id).eq('kind', 'initiative').eq('tracked', true).eq('status', 'active').limit(100);
    trackedProjects = ((tps ?? []) as Array<{ id: string; name: string; aliases: unknown }>).map((t) => {
      trackedNameById.set(String(t.id), String(t.name));
      return { name: String(t.name), aliases: Array.isArray(t.aliases) ? (t.aliases as string[]) : [] };
    });
  } catch { /* non-fatal */ }
  const trackedTagLookup = new Map<string, string>();
  for (const t of trackedProjects) {
    trackedTagLookup.set(t.name.toLowerCase(), t.name);
    for (const a of t.aliases) trackedTagLookup.set(String(a).toLowerCase(), t.name);
  }
  const clusterTag = (init: string | null | undefined): { initiative: string; initiativeTotal: number } | null => {
    const k = init ? (normalizeInitiative(init)?.replace(/\s+/g, '') || null) : null;
    const c = k ? clusters.get(k) : null;
    if (!c) return null;
    // Gate on the tracked set — the tag shows the tracked project's CANONICAL name (the same name
    // the client's By-project group header uses), or nothing.
    const canonical = trackedTagLookup.get(c.label.toLowerCase()) ?? (init ? trackedTagLookup.get(init.toLowerCase()) : undefined);
    return canonical ? { initiative: canonical, initiativeTotal: c.total } : null;
  };

  // Home must use the same persisted deterministic rules as Inbox. Passing them explicitly avoids
  // relying on classify-item's process-global render cache, which is not a safe source of per-user
  // configuration in a server route.
  const userRules = await loadUserRules(user.id, supabase);

  const since24 = new Date(now.getTime() - DAY).toISOString();
  const [itemsRes, commitsRes, meetingsRes, handledRes, triagedRes, summarisedRes, trackedRes, filteredRes, fyiRes] = await Promise.all([
    supabase.from('inbox_items')
      .select('id, work_title, work_state, rule_type, type_override, source, source_id, source_meeting_transcript_id, source_data, created_at, last_activity_at')
      .eq('user_id', user.id).eq('status', 'pending')
      // Action work_states (reply-via-email + external tasks + meeting action items) OR a rule that
      // classified it actionable (rule_type) — so a needs_reply the RULES found on a 'noted' email
      // still reaches the Home. classifyItem (which reads rule_type) makes the final call.
      .or('work_state.in.(work_prepared,decision_required,action_required),rule_type.in.(needs_reply,to_do,waiting_on)')
      // Order by latest THREAD activity, not first-seen created_at: a fresh reply to an old thread
      // (sync bumps last_activity_at) must rank as current, not stale. NULLS LAST guards legacy rows
      // synced before the column existed / before backfill.
      // NO SILENT CAPS (Aug 2 — found live: a genuinely OVERDUE obligation ranked 61st by
      // last-activity and fell off the deck as fresher noise-lane mail arrived; every downstream
      // pool silently followed). A quiet thread is not a settled one — recency must never evict
      // an open obligation. High bound + a loud log when it saturates.
      .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(250),
    supabase.from('commitments').select('*').eq('user_id', user.id).eq('status', 'open'),
    supabase.from('calendar_events')
      .select('id, title, start_time, attendees, timezone, is_all_day')
      .eq('user_id', user.id).eq('status', 'confirmed')
      .gte('start_time', new Date(now.getTime() - 30 * 60_000).toISOString())
      .lte('start_time', endOfDay).order('start_time', { ascending: true }).limit(6),
    supabase.from('commitments').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('status', 'done').gte('updated_at', new Date(now.getTime() - DAY).toISOString()),
    // (profiles row is fetched FIRST, before this batch — it carries the aux side-cache)
    // ── Heartbeat (Slice D): what the system handled autonomously in the last 24h ──
    supabase.from('inbox_items').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', since24),                                  // triaged
    supabase.from('meeting_transcripts').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', since24),                                  // summarised
    supabase.from('commitments').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', since24),                                  // tracked
    supabase.from('inbox_items').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', since24)
      .or('work_state.eq.noise,rule_type.eq.marketing,rule_type.eq.notifications'),         // filtered as noise
    // FYI tier (for the FYI-by-topic brief): awareness emails, grouped by sender downstream. Wide
    // window so high-volume people (not just recent newsletters) surface in the people section.
    // (id/created_at carried so a PERSON-kind awareness email can be promoted to "keep an eye on".)
    supabase.from('inbox_items').select('id, work_title, source_data, rule_type, created_at, last_activity_at')
      .eq('user_id', user.id).eq('status', 'pending').eq('work_state', 'noted')
      .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(200),
  ]);
  mark('queries');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (itemsRes.data ?? []) as any[];
  if (items.length >= 250) console.warn('[home/brief] actionable pool SATURATED the 250 cap — oldest obligations may be missing; raise the bound or tighten the actionable filter');
  // CROSS-TYPE DEDUP (P2): a commitment extracted from an email/meeting the deck ALSO shows as an
  // actionable row is the SAME obligation wearing two types — the item is the resolving surface, the
  // commitment folds (filtered here, so every lane, count, sig and synthesis input downstream agrees).
  // Deterministic (structural source/thread tie + text overlap; strong overlap alone across sources).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commitsRaw = (commitsRes.data ?? []) as any[];
  const { kept: commits, foldedIds: foldedCommitmentIds } = foldDuplicateCommitments(
    commitsRaw, visibleObligationsFromItems(items),
  );
  if (foldedCommitmentIds.length) mark(`fold:${foldedCommitmentIds.length}`);

  // The item's freshness = latest thread activity. Prefer the explicit last_activity_at column
  // (bumped by sync on every new message), fall back to the newest message time in source_data,
  // then to created_at. Used for ordering, the "already replied" check, and the cache signature so
  // a fresh reply to an old thread is treated as current everywhere in the brief.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activityAt = (it: any): string =>
    (it?.last_activity_at as string) || (it?.source_data?.received_at as string) || (it?.created_at as string) || '';

  // A source card: grouped by where it's from (email thread / meeting), carrying the unified
  // posture (what it needs) — the digest shape from docs/unified-classifier-digest-plan.md.
  type Posture = 'needs_reply' | 'to_do' | 'waiting_on';
  type Priority = { id: string; source: 'email' | 'meeting'; posture: Posture; title: string; context: string | null; href: string; itemId?: string; items?: { id: string; text: string }[]; overdue?: boolean; effort?: 'quick' | 'medium' | 'deep' | null; dueDate?: string | null; initiative?: string | null; initiativeTotal?: number | null };
  const priorities: Priority[] = [];

  // ── Meetings: group action items under their meeting (LAYERED — one card, items nested) ──
  const byMeeting = new Map<string, { title: string; items: { id: string; text: string }[] }>();
  for (const it of items) {
    if (it.source === 'meeting' && it.source_meeting_transcript_id) {
      const key = it.source_meeting_transcript_id;
      const m = byMeeting.get(key) ?? { title: (it.source_data?.meeting_title as string) || 'Meeting', items: [] };
      m.items.push({ id: it.id, text: it.work_title || 'Action item' });
      byMeeting.set(key, m);
    }
  }
  for (const [tid, m] of byMeeting) {
    priorities.push({
      id: `meeting:${tid}`, source: 'meeting', posture: 'to_do', title: m.title,
      // Past-tense framing — this meeting already happened; these are follow-ups, not a "do this now".
      context: `You had this meeting · ${m.items.length} follow-up${m.items.length > 1 ? 's' : ''} to consider`,
      // Deep-dive IN PLACE (the one nav rule): the meeting's OWN room, never the meetings list.
      href: `/item/${tid}?kind=meeting`, items: m.items.slice(0, 6),
    });
  }

  // ── Email cards — via the SHARED classifier (rule-aware). needs_reply AND to_do (email tasks),
  // so the Home is as complete as the inbox, not just replies.
  const classifiedEmails = items
    .filter((it) => it.source !== 'meeting' && it.source !== 'commitment')
    .map((it) => ({ it, posture: classifyItem(it as never, userRules) }));
  const emailCandidates = classifiedEmails
    .filter((x) => {
      if (x.posture === 'needs_reply' || x.posture === 'to_do') return true;
      // RE-PROMOTE an item classifyItem demoted (usually to 'fyi' for being cc-only) when the UNDERSTANDING
      // says it's genuinely addressed to the user with an action they OWE — role='addressed' / ownership=
      // 'you_owe' / relevance='action' — AND the rules classified it actionable (needs_reply/to_do). The
      // CONTENT signal (you are addressed, you owe) beats the header-based cc-only demotion, so a direct ask
      // ("Alex, what access can they use?") is NEVER dropped. It flows to "Worth acting on" / "What needs
      // you" in the loop below. (Same trust rule as the mustRespond gate: a false extra card ≪ a missed ask.)
      const rt = String(x.it.rule_type || '');
      if (rt !== 'needs_reply' && rt !== 'to_do') return false;
      const u = getUnderstanding(x.it);
      return !!u && (u.role === 'addressed' || u.ownership === 'you_owe' || u.relevance === 'action');
    });
  // Awareness candidates for the "keep an eye on" tier. Two sources:
  //  (a) cc'd-important items the SHARED classifier demoted to 'fyi' purely because the user is only
  //      cc'd (isCcOnlyBystander). We do NOT change classify-item.ts (the inbox depends on that blunt
  //      rule) — instead the Home re-surfaces these as awareness candidates so the synthesis can
  //      PROMOTE the substantive ones (e.g. a cc'd urgent meeting request). Scoped to the Home only.
  //  (b) person-kind FYI emails (real senders, not newsletters) — added below where the FYI groups
  //      are split by sender kind.
  // The synthesis judges which few of these rise to keep_an_eye_on; the rest stay in the FYI digest.
  const awarenessRaw = new Map<string, { it: (typeof items)[number]; ccOnly: boolean }>();
  for (const { it, posture } of classifiedEmails) {
    if (posture !== 'fyi') continue;
    // RESPECT the per-item classification: a `noted` item is FYI (newsletter / notification / awareness
    // digest) — it belongs in the FYI digest, NOT the "keep an eye on" awareness tier (which is for
    // substantive person/relationship threads). Excluding it here stops FYI mail polluting keep-an-eye
    // and — since only substantive cc'd items remain — stops the synthesis inventing a "why" for a
    // newsletter. Gate on work_state, never sender/subject keywords.
    if (it.work_state === 'noted') continue;
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    // Only worth promoting if there's a real sender AND the user was demoted for being a BYSTANDER on
    // a real person-thread (not because it's inherently noise). The demotion signal is, in order:
    //  (1) the unified `understanding` (role bystander/one_of_many, or awareness) — catches the group
    //      "Dear Team" To case where is_cc_only is false but the user is one of many; else
    //  (2) the legacy is_cc_only header input (no understanding on legacy items).
    // Newsletters have no personal signal and are excluded above (work_state 'noted').
    const u = getUnderstanding(it);
    const demotedByUnderstanding = !!u && (u.role === 'bystander' || u.role === 'one_of_many' || u.relevance === 'awareness');
    const bystander = demotedByUnderstanding || (!u && sd.is_cc_only === true);
    if (bystander && (sd.from_address || sd.from)) awarenessRaw.set(it.id, { it, ccOnly: true });
  }
  // Drop reply threads you've already answered. Also pull the FULL thread messages (both directions)
  // so we can compute the STRUCTURAL reply-state (computeThreadReplyState — direction+time only, no
  // keyword matching) per thread and feed it to the synthesis as a first-class "already handled" signal.
  const candThreadIds = [...new Set(emailCandidates.map((c) => c.it.source_data?.thread_id).filter(Boolean))] as string[];
  let answered = new Map<string, string>();
  const threadMsgsById = new Map<string, { is_from_user: boolean; received_at: string | null }[]>();
  if (candThreadIds.length) {
    const { data: threadRows } = await supabase.from('emails')
      .select('thread_id, is_from_user, received_at').eq('user_id', user.id).in('thread_id', candThreadIds);
    for (const r of (threadRows ?? []) as { thread_id: string | null; is_from_user: boolean; received_at: string | null }[]) {
      if (!r.thread_id) continue;
      const arr = threadMsgsById.get(r.thread_id) ?? [];
      arr.push({ is_from_user: r.is_from_user, received_at: r.received_at });
      threadMsgsById.set(r.thread_id, arr);
    }
    // The "already replied" set is the user's SENT messages only — same shape as before.
    answered = buildAnsweredSet(
      (threadRows ?? []).filter((r: { is_from_user: boolean }) => r.is_from_user).map((r: { thread_id: string | null; received_at: string | null }) => ({ thread_id: r.thread_id, received_at: r.received_at })),
    );
  }
  // needs_reply items (with content) feed the Must-respond synthesis; they stay in priorities for
  // counts. NOTE: supersession/staleness is NO LONGER hardcoded here (the old SCHEDULING regex +
  // meeting-supersession `continue` were bandaids that patched one observed case). Layer 3 (the
  // grounded synthesis pass) now reasons about supersession/staleness over the full per-person
  // context and returns the ids to drop — general for any phrasing, any person. Here we only apply
  // the deterministic "already replied" resolution + collect the candidates.
  const mustRespondRaw: MustRespondCandidate[] = [];
  // "Worth acting on" — action-NOTICES: an actionable item that is NOT a reply-to-a-person (a payment
  // failed, a security alert, an account expiring, storage full, "pay for your booking"). These are the
  // items the unified understanding reasoned `relevance === 'action'`. They get their OWN Home section,
  // distinct from replies (What needs you), so automated/notice actions don't clutter the reply lane.
  // Grounded one-liner (the real subject), deep-dive on click, quiet dismiss — same affordances as FYA.
  type ActionNotice = { itemId: string; who: string; summary: string; dueDate: string | null; initiative: string | null };
  const actionNoticesRaw: ActionNotice[] = [];
  const actionNoticeIds = new Set<string>();
  const emailSeeds: EmailSeed[] = [];
  // itemId → whether the NEWEST message on the thread is the user's own (structural, direction+time).
  // `lastFromUser === false` means the newest message is INBOUND, i.e. a genuinely unanswered reply the
  // user still owes — such an item is PROTECTED and can never be dropped by the AI synthesis. Only items
  // where the user has the last word (`lastFromUser === true`) may be closure-dropped by the model.
  const lastFromUserByItem = new Map<string, boolean>();
  const fromEmailOf = (sd: Record<string, unknown>): string | null => {
    const raw = String((sd.from_address as string) || (sd.from as string) || '').toLowerCase();
    return raw.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || (raw.includes('@') ? raw : null);
  };
  const contextSignalsOf = (sd: Record<string, unknown>) => {
    const raw = sd.signals && typeof sd.signals === 'object' ? sd.signals as Record<string, unknown> : {};
    const urgency = raw.impliedUrgency;
    return {
      explicitDeadline: typeof raw.explicitDeadline === 'string' ? raw.explicitDeadline : null,
      impliedUrgency: urgency === 'immediate' || urgency === 'soon' || urgency === 'flexible' ? urgency : null,
      isTimebound: raw.isTimebound === true,
      hasPreviousCommitment: raw.hasPreviousCommitment === true,
      isFollowUp: raw.isFollowUp === true,
    } as const;
  };
  const contextInitiativeOf = (sd: Record<string, unknown>): string | null => {
    const u = getUnderstanding({ source_data: sd });
    return u?.initiative ?? (typeof sd.initiative === 'string' ? sd.initiative : null);
  };
  // H4: ids demoted as ownership-none notices — EVERY deck-feeding pool filters by this set, so a
  // demoted notice can never re-enter through a side door (priorities / keep-an-eye-on were one).
  const demotedNoticeIds = new Set<string>();
  // ── THE DECK CONSULTS THE ONE JUDGMENT (cached only — zero AI at read). An item whose CACHED
  // verdict is a plain NONE ("nothing to do here") must not sit on the deck as an actionable/
  // overdue row — the flip-flop exposure class (a daily re-judgment occasionally mis-fires on an
  // ambiguous item precisely BECAUSE it kept being presented as work). Joins the SAME demotion set
  // every pool already filters by; un-judged items are untouched; the user's explicit
  // type_override stays authoritative (guarded below like every demotion). Dispositioned nones
  // (expired/answered) are handled harder by apply-verdict — this covers the plain ones. ──
  const judgedNoneIds = new Set<string>();
  try {
    const candIds = emailCandidates.map((c) => `inbox:${c.it.id}`);
    if (candIds.length) {
      const { data: js } = await supabase.from('item_plans').select('entity_id, tasks')
        .eq('user_id', user.id).eq('kind', 'judgment').in('entity_id', candIds.slice(0, 300));
      for (const j of (js ?? []) as Array<{ entity_id: string; tasks: { verdict?: { work?: string; resolution?: string } } }>) {
        const v = j.tasks?.verdict;
        if (v?.work === 'none' && !v.resolution) judgedNoneIds.add(j.entity_id.replace(/^inbox:/, ''));
      }
    }
  } catch { /* the judge consult is an enhancement — the notice law below still holds */ }
  for (const { it, posture } of emailCandidates) {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    const tid = sd.thread_id as string | undefined;
    const sentAt = tid ? answered.get(tid) : undefined;
    // Answered only if our reply is newer than the latest inbound activity — a fresh reply that
    // landed AFTER we last sent still needs us.
    if (posture === 'needs_reply' && sentAt && sentAt > activityAt(it)) continue; // already replied
    const fromEmail = fromEmailOf(sd);
    const subj = it.work_title || (sd.subject as string) || null;
    const fromName = (sd.from_name as string) || null;
    const contextSignals = contextSignalsOf(sd);
    const initiative = contextInitiativeOf(sd);
    // The unified understanding's RELEVANCE is the primary router: `reply` = a person awaits your reply
    // → "What needs you"; `action` = an actionable item that is NOT a reply (payment failed, security
    // alert, expiring, "pay for your booking") → the NEW "Worth acting on" section; `awareness` = FYI.
    // ONE relevance → ONE home (no overlap). Items lacking understanding fall back to today's behavior
    // (the automated re-posture below). No keyword/sender heuristic drives the split — relevance encodes it.
    const u = getUnderstanding(it);
    // H4 (work-surface, OWNERSHIP-KEYED): a notice nobody owes a move on is NOT a task, whatever an
    // AI rule guessed. Verified against real data: junk (portal responses, calendar acceptances) =
    // ownership 'none' + kind notification/calendar; real obligations (bank data update, tax
    // discrepancy) = ownership 'you_owe' — protected by the same key, language-proof (no keyword
    // list). Legacy items with NO understanding fall to the structural floor (automated sender +
    // not action-worthy). The user's explicit type_override is the only authoritative override
    // here — rule_type includes AI-rule guesses, which is exactly what this corrects.
    const noticeSubj = ((sd.subject as string) || it.work_title || null);
    // W6 — the PRECEDENCE CHAIN holds against the judgment too: a you_owe ACTION notice is never
    // silently demoted by a judged-none (the sender floor rightly says "no EMAIL work" for an
    // automated dunning notice — but "no email work" is not "no work"; the action lives outside
    // the mailbox and the deck must still surface it). Same law as the eb510b1 deck-miss fix.
    const youOweAction = !!u && u.ownership === 'you_owe' && u.relevance === 'action';
    const noticeDemoted = it.type_override !== 'needs_reply' && it.type_override !== 'to_do'
      && (isNoMoveNotice({ u, rawKind: rawMailKindOf(sd), fromEmail: fromEmailOf(sd), fromName: (sd.from_name as string) || null, subject: noticeSubj, workState: (it.work_state as string) || null })
        || (judgedNoneIds.has(it.id) && !youOweAction)); // the ONE judgment said "nothing to do" — the deck listens, except where the notice law outranks
    if (noticeDemoted) demotedNoticeIds.add(it.id); // filters EVERY downstream pool (priorities, keep-an-eye-on, …)
    if (u && u.relevance === 'action' && !noticeDemoted) {
      // An action-notice: its own section, never a reply card, never a needs-you priority. We DON'T push
      // it into `priorities` (so it can't count as needs-you) or `mustRespondRaw`; we still feed
      // emailSeeds so per-person context stays complete, then skip the reply/priority wiring.
      const who = fromName || (sd.from as string) || 'Notice';
      const snippet = ((sd.body as string) || '').replace(/\s+/g, ' ').trim();
      // VERB-FIRST (P4): lead with the understanding's imperative ask ("Fix the failing payment"),
      // never the raw subject ("Serif AI Subscription") — the deck reads as to-dos, not mail headers.
      const summary = (typeof u.ask === 'string' && u.ask ? u.ask : '') || (subj || '').trim() || (snippet ? snippet.slice(0, 90) : 'Action needed');
      actionNoticesRaw.push({ itemId: it.id, who, summary: summary.length > 120 ? summary.slice(0, 117) + '…' : summary, dueDate: (u.deadline as string) ?? null, initiative: clusterTag(u.initiative as string | null)?.initiative ?? (u.initiative as string | null) ?? null });
      actionNoticeIds.add(it.id);
      const threadMsgsA = tid ? threadMsgsById.get(tid) : undefined;
      const replyStateA = threadMsgsA && threadMsgsA.length
        ? computeThreadReplyState(threadMsgsA, it.created_at ? new Date(it.created_at as string) : null)
        : null;
      emailSeeds.push({
        itemId: it.id, fromAddress: fromEmail, fromName: (sd.from_name as string) || null,
        subject: it.work_title || (sd.subject as string) || '(no subject)',
        at: activityAt(it), posture: 'to_do',
        snippet: ((sd.body as string) || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        userResponded: replyStateA?.userReplied ?? undefined,
        lastFromUser: replyStateA?.lastMessageFromUser ?? undefined,
        ...contextSignals, initiative,
      });
      continue;
    }
    // A `reply`/`awareness` (or no-understanding) item continues down the reply/priority path below.
    // When understanding says `awareness`, it's not a reply you owe → keep it out of must-respond (it
    // still flows to FYA / keep-an-eye via classify-item). `reply` stays a real reply candidate.
    const understoodAwareness = !!u && u.relevance === 'awareness';
    const automated = posture === 'needs_reply' && isAutomatedSender(fromEmail, fromName, subj);
    // Bug C — an AUTOMATED item classified needs_reply isn't a reply you owe (no human is waiting), but
    // it may still DEMAND action (payment failed / account suspended / security alert / expiring). If
    // so, re-posture it to `to_do` so it surfaces as a visible ACTION card (the "Worth acting on"
    // path), never buried in FYI. Informational automated mail (posture stays needs_reply here) is
    // dropped from must-respond below and flows to the FYI/awareness digest as before — no reply-flood.
    const actionWorthy = automated && isActionWorthyAutomated((it.work_state as string) || null, fromName, subj);
    const effectivePosture: Posture = actionWorthy ? 'to_do' : (posture as Posture);
    priorities.push({
      id: `email:${it.id}`, source: 'email', posture: effectivePosture,
      title: subj || 'Email',
      context: fromName || (sd.from as string) || null,
      href: '/inbox', itemId: it.id,
      effort: u?.effort ?? null, dueDate: u?.deadline ?? null, // Track A signals — "feels doable" + real date
      initiative: clusterTag(initiative)?.initiative ?? null, initiativeTotal: clusterTag(initiative)?.initiativeTotal ?? null,
    });
    // Structural reply-state for this thread (direction+time only — no keyword/text matching). The
    // synthesis reasons "the user already responded → drop/deprioritize" over the REAL thread, not a
    // regex. `since` = the item's created_at so only a reply AFTER the item appeared counts.
    const threadMsgs = tid ? threadMsgsById.get(tid) : undefined;
    const replyState = threadMsgs && threadMsgs.length
      ? computeThreadReplyState(threadMsgs, it.created_at ? new Date(it.created_at as string) : null)
      : null;
    // Feed the per-person entity map (Layer 1) — identity carried by the counterparty email.
    emailSeeds.push({
      itemId: it.id, fromAddress: fromEmail, fromName: (sd.from_name as string) || null,
      subject: it.work_title || (sd.subject as string) || '(no subject)',
      at: activityAt(it), posture: effectivePosture,
      snippet: ((sd.body as string) || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      userResponded: replyState?.userReplied ?? undefined,
      lastFromUser: replyState?.lastMessageFromUser ?? undefined,
      ...contextSignals, initiative,
    });
    if (replyState && typeof replyState.lastMessageFromUser === 'boolean') {
      lastFromUserByItem.set(it.id, replyState.lastMessageFromUser);
    }
    if (effectivePosture === 'needs_reply') {
      // Automated / transactional mail is not a reply you owe — keep it OUT of must-respond (it still
      // flows through FYI/awareness). This cleans the pool so "show every real reply" isn't polluted by
      // no-reply notifications the model then over-drops. Action-worthy automated items were already
      // re-postured to `to_do` above (so they surface as action cards), so anything still automated
      // here is informational → drop it from must-respond (it flows to the FYI/awareness digest).
      if (automated) continue;
      // The understanding's `awareness` verdict may DEMOTE a needs_reply — but ONLY when the user is
      // CC-ONLY (a genuine bystander cc'd on a thread). For a DIRECT recipient (To), the `needs_reply`
      // rule is AUTHORITATIVE: the AI can mis-judge a real client ask to a small team ("confirm the
      // dates", "you have the green light") as `one_of_many`/`awareness`, and silently dropping that
      // breaks trust far worse than an extra card costs. So a directly-addressed reply ALWAYS surfaces;
      // only a cc-only awareness item is demoted. (is_cc_only is stamped at sync; absent → treat as
      // direct → surface — err toward showing the reply.)
      const ccOnlyBystander = (sd.is_cc_only === true);
      if (understoodAwareness && ccOnlyBystander) continue;
      // H4: an automated notice NOBODY owes a move on (ownership 'none' + structural notice) never
      // owes a reply either — whatever the AI rule matched. The July-13 protection guards REAL
      // small-team asks (a person's thread never has ownership none + an automated/notification
      // shape); the user's explicit type_override still wins above.
      if (noticeDemoted) continue;
      mustRespondRaw.push({
        itemId: it.id,
        from: (sd.from_name as string) || (sd.from as string) || 'Someone',
        fromEmail: fromEmail || '',
        subject: it.work_title || (sd.subject as string) || '(no subject)',
        snippet: ((sd.body as string) || '').replace(/\s+/g, ' ').trim().slice(0, 400),
        receivedAt: activityAt(it),
        effort: u?.effort ?? null, dueDate: u?.deadline ?? null,
        initiative: clusterTag(initiative)?.initiative ?? null, initiativeTotal: clusterTag(initiative)?.initiativeTotal ?? null,
      });
    }
  }
  // Layer 1: assemble the reconciled per-person context (meetings + commitments + these emails).
  const briefCtx = await buildBriefContext(user.id, self, now, supabase, emailSeeds);
  mark('context');

  // ── Commitment CANDIDATES — every open commitment, normalized. The raw ingest `direction` is only
  // a DEFAULT hint here: the grounded synthesis (Layer 3) re-judges each one's placement (on_your_plate
  // / ball_in_court / informational) so a REQUESTED action (the user is waiting on someone) can't sit
  // in "On your plate" just because the extractor guessed you_owe.
  // See docs/brief-and-labeling-plan.md ("DIRECTION corrected July 2") + Bug #1.
  //
  // Bug B: meeting-sourced commitments are INCLUDED. They used to be excluded wholesale (`source !==
  // 'meeting'`) on the assumption they'd double the meeting action-item priority cards — but those
  // cards come from `inbox_items` (a distinct table/extraction), so the exclusion instead HID every
  // "you owe X" promise captured from a meeting (21 real open items → an empty "On your plate"). A
  // meeting commitment is a genuine thing the user owes and belongs in the same placement pipeline as
  // any other; the synthesis + the top-N cap keep the section a brief, not a backlog.
  // Source-derived fallback label for commitments with NO counterparty — so the UI never prints a
  // placeholder ("Someone"). For a meeting commitment we resolve the meeting title ("from <title>");
  // an email commitment has no better source string, so it stays null and the UI omits the name.
  // General: keyed off the commitment's own source_id, no hardcoded titles/ids.
  const meetingCommitTids = [...new Set(commits
    .filter((c) => c.source === 'meeting' && !c.counterparty && c.source_id)
    .map((c) => c.source_id as string))];
  const meetingTitleById = new Map<string, string>();
  if (meetingCommitTids.length) {
    const { data: mts } = await supabase.from('meeting_transcripts')
      .select('id, title').eq('user_id', user.id).in('id', meetingCommitTids);
    for (const m of (mts ?? []) as { id: string; title: string | null }[]) {
      if (m.title) meetingTitleById.set(m.id, m.title);
    }
  }
  // The label shown when counterparty is null: a source-derived string ("from <meeting title>") or
  // null (UI omits the name entirely). NEVER a literal placeholder.
  const sourceLabelOf = (c: (typeof commits)[number]): string | null => {
    if (c.source === 'meeting' && c.source_id) {
      const t = meetingTitleById.get(c.source_id as string);
      return t ? `from ${t}` : null;
    }
    return null;
  };
  // ONE OBLIGATION = ONE TASK: `commits` was already folded against the visible actionable rows
  // at load (the shared dedupe-deck module, line ~248) — the promise fix lowered its STRUCTURAL
  // floor so an extractor rephrase can't produce two rows for one ask.
  const commitmentCands = commits
    .map((c) => ({
      id: c.id as string,
      description: c.description as string,
      counterparty: (c.counterparty as string | null) ?? null,
      // A display-only fallback (never printed as the person's name in prose contexts that need a
      // real name — the UI uses it only where it currently showed "Someone"/"them").
      sourceLabel: sourceLabelOf(c),
      direction: (c.direction as string) || 'you_owe',
      dueDate: (c.due_date as string | null) ?? null,
      overdue: !!(c.due_date && c.due_date < todayStr),
      dueToday: !!(c.due_date && c.due_date === todayStr),
      ageDays: Math.floor((now.getTime() - new Date(c.created_at).getTime()) / DAY),
      initiative: (c.initiative as string | null) ?? null,
    }));
  // PREPARED tokens for commitment rows (5B.3 — one cheap pool query, facts only): a commitment with
  // a prepared draft/deliverable shows "drafted" / the preparer's name on the deck like inbox rows do.
  const commitPrepared = new Map<string, string>();
  try {
    const openCommitIds = commitmentCands.map((c) => c.id);
    if (openCommitIds.length) {
      const { data: dl } = await supabase.from('item_deliverables').select('entity_id, type, metadata')
        .eq('user_id', user.id).eq('kind', 'commitment').in('entity_id', openCommitIds.slice(0, 200))
        .in('type', ['draft', 'document']).order('created_at', { ascending: false }).limit(100);
      for (const d of (dl ?? []) as Array<Record<string, unknown>>) {
        const id = d.entity_id as string;
        if (commitPrepared.has(id)) continue;
        const meta = (d.metadata ?? {}) as { agentName?: string; worker?: string };
        commitPrepared.set(id, (meta.agentName ?? meta.worker ?? 'draft') as string);
      }
    }
  } catch { /* non-fatal — tokens are an enhancement */ }

  // Default placement from the ingest direction — used as the fallback when the synthesis has no
  // verdict for a commitment (failure / not enumerated), so behavior degrades to the old routing.
  const defaultPlacement = (dir: string): 'on_your_plate' | 'ball_in_court' | 'informational' =>
    dir === 'awaiting' ? 'ball_in_court' : 'on_your_plate';

  // Overdue → reply → to-do → finished meetings last (a past meeting is context, not "do this now").
  const rank = (p: Priority) => (p.overdue ? 0 : p.source === 'meeting' ? 4 : p.posture === 'needs_reply' ? 1 : p.posture === 'to_do' ? 2 : 3);
  priorities.sort((a, b) => rank(a) - rank(b));
  for (let i = priorities.length - 1; i >= 0; i--) {
    if (priorities[i].itemId && demotedNoticeIds.has(priorities[i].itemId!)) priorities.splice(i, 1); // H4
  }
  const cappedPriorities = priorities.slice(0, MAX_PRIORITIES);

  // ── FYI-by-topic: group the awareness emails by sender; the AI digests each group below. ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fyiRows = (fyiRes.data ?? []) as Array<{ id: string; work_title: string | null; source_data: any; created_at: string }>;
  // Split the `noted` pool into REAL human correspondence (→ "For your awareness") vs BULK list mail
  // (→ "Newsletters & promotions"). The deciding signal is BULK-ness, NOT whether a content rule fired.
  // The old AND-gate required `rule_type ∈ {needs_reply,to_do,waiting_on}` on top of awareness, which
  // stranded real 1:1s that no rule happened to fire on (a colleague's fee note, `rule_type=null`) down
  // in Newsletters. A newsletter/notification always carries a MACHINE signal — a List-Unsubscribe
  // header or an automated sender; a real person's email does not. So among awareness items: bulk →
  // newsletters, non-bulk → real correspondence. No sender-name/localpart heuristic — a machine signal
  // only. Shared with the actionable-pool FYA collection below via the same `isBulk` helper.
  const isBulk = (sd: Record<string, unknown>): boolean => {
    // PRIMARY: the understanding's reasoned bulk judgment (the model read the body and knows a
    // "Zumub 25% cashback" blast from a colleague's forwarded note — header signals miss both, since
    // real marketing senders often carry no automated localpart and no captured List-Unsubscribe).
    const u = coerceUnderstanding(sd.understanding);
    if (u?.bulk === true) return true;
    // BACKSTOP: header/sender signals for legacy items that predate the `bulk` field (belt-and-suspenders).
    return !!sd.has_unsubscribe ||
      isAutomatedSender(fromEmailOf(sd), (sd.from_name as string) || null, (sd.subject as string) || (sd.work_title as string) || null);
  };
  // Real-correspondence rows lifted OUT of the noted/newsletter pool into "For your awareness" below.
  const fyaFromNoted: Array<{ id: string; source_data: Record<string, unknown>; work_title: string | null }> = [];
  const fyiBySender = new Map<string, { subjects: string[]; address: string; unsub: boolean }>();
  for (const r of fyiRows) {
    const sd = (r.source_data ?? {}) as Record<string, unknown>;
    const u = coerceUnderstanding(sd.understanding);
    // Understanding says awareness (no move expected) AND it isn't bulk → a real person kept you in the
    // loop → For your awareness, not a newsletter.
    if (u && u.relevance === 'awareness' && !isBulk(sd)) {
      fyaFromNoted.push({ id: r.id, source_data: sd, work_title: r.work_title });
      continue;
    }
    const label = (sd.from_name as string) || (sd.from as string);
    if (!label) continue;
    const g = fyiBySender.get(label) ?? { subjects: [], address: ((sd.from as string) || '').toLowerCase(), unsub: false };
    g.subjects.push(r.work_title || (sd.subject as string) || '');
    if (sd.has_unsubscribe) g.unsub = true;
    fyiBySender.set(label, g);
  }
  // ── "Newsletters & promotions" — the `noted` bulk pool. This ENTIRE pool is `work_state='noted'`
  // (the fyiRes query filters on it), which IS the definitive newsletter/promotion/notification signal
  // (the per-item classifier's FYI verdict, driven by the default `noted` rule + List-Unsubscribe). So
  // every group here is a `newsletter` — the OLD person-vs-newsletter split (a sender-name-looks-human
  // heuristic) MIS-bucketed brand digests with human-looking display names (Morning Brew, Bay Area
  // Times) as "person awareness". REAL correspondence you're only informed on (a "Dear Team" broadcast,
  // a group CC) is NOT here — it's the separate `forYourAwareness` set below (understanding-driven).
  // No name/localpart heuristic: bucket membership is the `noted` rule, full stop.
  const fyiGroupsAll = [...fyiBySender.entries()]
    .map(([label, g]) => ({ label, subjects: g.subjects, count: g.subjects.length, kind: 'newsletter' as const }))
    .sort((a, b) => b.count - a.count);
  const fyiTop = fyiGroupsAll.slice(0, 8);
  const fyiTailItems = fyiGroupsAll.reduce((n, g) => n + g.count, 0) - fyiTop.reduce((n, g) => n + g.count, 0);
  const fyiTailGroups = Math.max(0, fyiGroupsAll.length - fyiTop.length);

  // DETERMINISTIC FYI DIGEST — a fallback the section can ALWAYS render when FYI groups exist, even
  // if the AI synthesis omits/returns null for fyiDigest (Bug A: the model frequently drops the fyi
  // block on a large mailbox, and the enrich path only overwrote fyiDigest when synth.fyiDigest was
  // non-null OR there were no groups — so with groups + a null model result the section stayed empty
  // forever). This builds one plain digest line per group directly from the sender + a couple of its
  // subjects, so "For your awareness" is never blank while noted mail exists. The AI's nicer prose
  // still wins when present (used only as the fallback below + when no cache/synth is available).
  const buildDeterministicFyiDigest = (): FyiDigest | null => {
    if (!fyiTop.length) return null;
    const groups = fyiTop.map((g) => {
      const subs = g.subjects.map((s) => (s || '').trim()).filter(Boolean).slice(0, 2);
      const summary = subs.length
        ? `${g.count} message${g.count > 1 ? 's' : ''} — ${subs.map((s) => `“${s.length > 60 ? s.slice(0, 57) + '…' : s}”`).join(', ')}`
        : `${g.count} message${g.count > 1 ? 's' : ''}`;
      return { label: g.label, summary, kind: g.kind };
    });
    return { groups, tailGroups: fyiTailGroups, tailItems: fyiTailItems };
  };

  // ── Awareness candidates (source b) REMOVED — `noted`/FYI mail is NOT a keep-an-eye candidate.
  // Previously this promoted person-kind FYI rows (every one `work_state='noted'`) into the awareness
  // tier, which (i) leaked FYI mail into "keep an eye on" and (ii) let the synthesis FABRICATE a "why"
  // for a newsletter (the observed "Natia Kurdadze — SEO hacks" / CryptoSlate hallucinations). RESPECT
  // the per-item classification: `noted` items belong to the FYI DIGEST only. Keep-an-eye is fed solely
  // by source (a) — substantive NON-`noted` threads the user was cc'd on. No sender/subject keywords.
  const fromEmailFrom = (sd: Record<string, unknown>): string | null => {
    const raw = String((sd.from_address as string) || (sd.from as string) || '').toLowerCase();
    return raw.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || (raw.includes('@') ? raw : null);
  };
  // Order cc'd human threads first (someone deliberately looped the user in — the strongest awareness
  // signal), then freshest. Cap the pool small so the prompt stays lean and selective.
  const keepAnEyeOnRaw = [...awarenessRaw.values()]
    .sort((a, b) => (a.ccOnly === b.ccOnly ? activityAt(b.it).localeCompare(activityAt(a.it)) : a.ccOnly ? -1 : 1))
    .slice(0, 12)
    .map(({ it, ccOnly }) => {
    const sd = (it.source_data ?? {}) as Record<string, unknown>;
    return {
      itemId: it.id,
      from: (sd.from_name as string) || (sd.from as string) || 'Someone',
      fromEmail: fromEmailFrom(sd) || '',
      subject: it.work_title || (sd.subject as string) || '(no subject)',
      snippet: ((sd.body as string) || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      receivedAt: activityAt(it),
      ccOnly,
    };
  });

  // ── Today's schedule + light prep on the next meeting ──
  // Drop provider cancellation rows: the query already excludes status='cancelled', but a cancellation
  // can arrive as a still-'confirmed' row with a raw "Canceled event: …" title — that's not upcoming.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meetings = ((meetingsRes.data ?? []) as any[]).filter((m) => !isCancelledEventTitle(m.title));
  let nextPrep: { lastEmail?: { subject: string }; openCommitments: string[]; lastMeeting?: { title: string; date: string; recall: string; person: string } } | null = null;
  if (meetings[0]) {
    const others = attendeeEmails(meetings[0]).filter((e) => e !== self);
    if (others.length) {
      const { data: le } = await supabase.from('emails').select('subject')
        .eq('user_id', user.id).contains('to_addresses', [others[0]])
        .order('received_at', { ascending: false }).limit(1);
      const related = commits.filter((c) => others.includes((c.counterparty || '').toLowerCase())).map((c) => c.description);
      // Reminder (Slice C): if you've met this person before, recall what was discussed.
      const recall = await lastMeetingRecall(user.id, others[0], supabase);
      // Suppress the "last thread" subtitle when the only related email is a calendar-system
      // notification (invite update/cancel/RSVP) — its raw subject would leak in as noise.
      const lastSubject = le?.[0]?.subject && !isCalendarSystemSubject(le[0].subject) ? le[0].subject : null;
      nextPrep = {
        ...(lastSubject ? { lastEmail: { subject: lastSubject } } : {}),
        openCommitments: related.slice(0, 3),
        ...(recall ? { lastMeeting: { ...recall, person: (others[0].split('@')[0] || others[0]) } } : {}),
      };
    }
  }
  // The USER's home timezone — a meeting must show in the user's local clock, NOT the organiser's zone (a
  // Dubai-created event would otherwise read +4h). No stored preference, so derive it agnostically: the most
  // common timezone across the user's own calendar events (their home zone), fallback UTC.
  const { data: tzRows } = await supabase.from('calendar_events').select('timezone').eq('user_id', user.id).not('timezone', 'is', null).limit(300);
  const tzFreq = new Map<string, number>();
  for (const r of (tzRows ?? []) as Array<{ timezone: string | null }>) { const t = r.timezone; if (t) tzFreq.set(t, (tzFreq.get(t) ?? 0) + 1); }
  const userTz = [...tzFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'UTC';
  // The model has no browser TZ, so a raw UTC ISO reads as the wrong hour; format every event in userTz.
  const localHHMM = (iso: string, allDay: boolean): string => {
    if (allDay) return 'all day';
    try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTz }).format(new Date(iso)); }
    catch { return String(iso).slice(11, 16); }
  };
  const schedule = meetings.map((m, i) => ({
    id: m.id, time: m.start_time, localTime: localHHMM(m.start_time, !!m.is_all_day), title: m.title || '(untitled)',
    attendees: attendeeEmails(m).filter((e) => e !== self).length,
    prep: i === 0 ? nextPrep : null,
  }));

  // ── Status chips (live, alive) ── waitingOn counts commitments the INGEST flagged awaiting; the
  // synthesis may re-place some, but this pre-synthesis count is a stable input for the cache sig.
  const replyP = priorities.filter((p) => p.posture === 'needs_reply').length;
  const status = {
    needsReply: replyP,
    meetingsToday: schedule.length,
    waitingOn: commitmentCands.filter((c) => c.direction === 'awaiting').length,
    handledToday: handledRes.count ?? 0,
  };

  // ── Heartbeat: what was handled autonomously in the last 24h (the "I'm on top of it" panel) ──
  const handled = {
    triaged: triagedRes.count ?? 0,
    filtered: filteredRes.count ?? 0,
    summarised: summarisedRes.count ?? 0,
    tracked: trackedRes.count ?? 0,
    resolved: handledRes.count ?? 0,
  };

  // ── Cached one-line narration (posture-aware + busts when the day's shape changes) ──
  const emailP = cappedPriorities.filter((p) => p.posture === 'needs_reply').length;
  const meetingP = cappedPriorities.filter((p) => p.source === 'meeting').length;
  // Sig uses the pre-synthesis (ingest-default) owed set — stable regardless of the AI verdict, so the
  // signature is deterministic. Placements are cached alongside so a cache-hit still routes correctly.
  const owedByIngest = commitmentCands.filter((c) => c.direction !== 'awaiting');
  const commitP = owedByIngest.length;
  const overdueC = owedByIngest.filter((c) => c.overdue).length;
  const overdueP = cappedPriorities.filter((p) => p.overdue).length;
  const fyiSig = fyiTop.map((g) => `${g.label}:${g.count}`).join(',');
  // Freshness: the newest pending item's LATEST-ACTIVITY timestamp + the newest commitment update.
  // Folding these into the signature makes the brief regenerate the moment new activity lands (a
  // fresh reply on an old thread now bumps last_activity_at) — not just every 3h — so it feels live.
  const freshest = items.reduce((mx, it) => { const a = activityAt(it); return a > mx ? a : mx; }, '');
  const commitFresh = commits.reduce((mx, c) => (c.updated_at && c.updated_at > mx ? c.updated_at : mx), '');
  // Include today's date so the brief re-contextualizes on a day change (ages/overdue shift daily),
  // not only on the 3h TTL — a true daily recheck.
  // Awareness signature: count + freshest awareness item, so promoting/refreshing "keep an eye on"
  // regenerates the brief when the awareness pool shifts (not just on the 3h TTL).
  const eyeFresh = keepAnEyeOnRaw.reduce((mx, k) => (k.receivedAt > mx ? k.receivedAt : mx), '');
  const sig = `${todayStr}|${emailP}|${meetingP}|${commitP}|${overdueP}|${overdueC}|${status.waitingOn}|${schedule.length}|${fyiSig}|${freshest}|${commitFresh}|${keepAnEyeOnRaw.length}|${eyeFresh}`;

  const fullName = (profileRes.data as { full_name?: string } | null)?.full_name ?? null;
  const firstName = fullName?.split(' ')[0] ?? null;

  // ── Daily brief — ONE grounded synthesis pass (Layer 3) over the reconciled per-person context,
  // replacing the four blind silo passes. It writes the whole brief (TLDR + must-respond + follow-ups
  // + FYI) coherently and cross-aware BY CONSTRUCTION: it drops scheduling emails a meeting already
  // superseded (subsumes the retired SCHEDULING regex), never emits two fragments about one person,
  // and drops stale asks. It returns the ids it dropped so the cards match the prose. Cached on
  // profiles.home_brief, busts when the day's shape (sig) changes. ──
  type Tldr = { teaser: string; bullets: string[]; dontMiss: string | null };
  type FollowUp = { id?: string; who: string; status: string; nextMove: string };
  type Followups = { teaser: string; items: FollowUp[]; closing: string | null };
  type FyiDigest = { groups: { label: string; summary: string; kind: 'person' | 'newsletter' }[]; tailGroups: number; tailItems: number };
  type Reply = { who: string; ask: string; angle: string; itemId: string; subject?: string; snippet?: string; receivedAt?: string; effort?: 'quick' | 'medium' | 'deep' | null; dueDate?: string | null; initiative?: string | null; initiativeTotal?: number | null };
  type MustRespond = { teaser: string; items: Reply[] };
  type KeepAnEyeOn = { items: { who: string; why: string; itemId: string }[] };
  type CommitmentPlacement = 'on_your_plate' | 'ball_in_court' | 'informational';
  const cached = (profileRes.data as { home_brief?: { text?: string; tldr?: Tldr; followups?: Followups | null; fyiDigest?: FyiDigest | null; mustRespond?: MustRespond | null; keepAnEyeOn?: KeepAnEyeOn | null; droppedItemIds?: string[]; commitmentPlacements?: Record<string, CommitmentPlacement>; bundleNames?: { sig: string; names: Record<string, BundleName> }; generated_at: string; sig?: string } } | null)?.home_brief ?? null;
  let tldr: Tldr | null = cached?.tldr ?? null;
  let followups: Followups | null = cached?.followups ?? null;
  let fyiDigest: FyiDigest | null = cached?.fyiDigest ?? null;
  let mustRespond: MustRespond | null = cached?.mustRespond ?? null;
  let keepAnEyeOn: KeepAnEyeOn | null = cached?.keepAnEyeOn ?? null;
  let briefLine = cached?.text ?? null;
  let droppedItemIds: string[] = cached?.droppedItemIds ?? [];
  // The synthesis's per-commitment placement verdict (Bug #1). Cached so a cache-hit routes the same
  // way it did when generated. Falls back to the ingest-direction default per-commitment below.
  let commitmentPlacements: Record<string, CommitmentPlacement> = cached?.commitmentPlacements ?? {};
  // A cache blob written BEFORE the placement fix has no `commitmentPlacements` field at all (a code
  // revert doesn't touch cached data). Serving it makes every open commitment fall back to the ingest
  // direction — so a REQUESTED action (e.g. a refund you're owed) wrongly sits in "On your plate". Force
  // a one-time regen for such legacy caches when there are open commitments to (re-)place, so the
  // synthesis verdict actually takes without a manual cache wipe. General — no hardcoded item.
  const legacyPlacements = cached != null && cached.commitmentPlacements === undefined && commitmentCands.length > 0;
  const stale = !cached || cached.sig !== sig || legacyPlacements || (now.getTime() - new Date(cached.generated_at).getTime()) > BRIEF_TTL;
  if (stale) {
    // ── OPTIMISTIC SURFACING ─────────────────────────────────────────────────────────────────────
    // The AI synthesis (~10–30s) is what enriches the brief (ask/angle/ordering/supersession drops).
    // "What needs you" items must NOT wait on it: build a BASIC mustRespond from the deterministic
    // candidates so a freshly-synced item is PRESENT immediately, then enrich in the BACKGROUND.
    //
    // 1. BASIC mustRespond — same shape the synthesis returns, minus the AI ask/angle (the Home
    //    position-fallbacks the missing ones). Freshest-first, capped to the synthesis's own cap (25).
    // Reuse the AI ask/angle from the LAST-GOOD cache for items we already enriched, keyed by itemId —
    // so a reload/regenerate KEEPS the beautiful synthesized context line for known items. Only a
    // genuinely NEW item has no cached ask (the UI shows its snippet until the bg enrich fills it in).
    const cachedAsk = new Map((cached?.mustRespond?.items ?? []).map((i) => [i.itemId, { ask: i.ask, angle: i.angle }]));
    const basicMustItems: Reply[] = [...mustRespondRaw]
      .sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''))
      // High safety bound, not a functional gate — real replies must never be hidden by a cap.
      .slice(0, 100)
      .map((c) => {
        const prev = cachedAsk.get(c.itemId);
        return { who: c.from, ask: prev?.ask || '', angle: prev?.angle || '', itemId: c.itemId, subject: c.subject, snippet: c.snippet, receivedAt: c.receivedAt, effort: c.effort ?? null, dueDate: c.dueDate ?? null, initiative: c.initiative ?? null, initiativeTotal: c.initiativeTotal ?? null };
      });
    const basicMustRespond: MustRespond | null = basicMustItems.length ? { teaser: '', items: basicMustItems } : null;

    // 2. Assemble the basic brief: NEW must-respond (so new items appear now) + the last-good CACHED
    //    AI content for the other lanes (so they don't blank on a refresh). Falls back to null/empty
    //    when there's no cache. Commitment placements keep the cached verdicts (or {}) so the routing
    //    below degrades to the ingest-direction default — never breaks.
    mustRespond = basicMustRespond;
    // tldr / followups / keepAnEyeOn / droppedItemIds / commitmentPlacements already initialized
    // from `cached` above — leave them as-is (last-good, or null/[]/{}).
    // fyiDigest: seed the DETERMINISTIC fallback if the cache has none but groups exist (Bug A), so
    // "For your awareness" renders immediately on the basic brief and never depends on the AI pass.
    if ((!fyiDigest || !fyiDigest.groups?.length) && fyiTop.length) fyiDigest = buildDeterministicFyiDigest();

    // 3. Persist the basic brief IMMEDIATELY with the NEW sig. This is the anti-regen-storm guard:
    //    the very next request (poll / realtime refetch) is a cache-HIT on this basic brief and does
    //    NOT trigger a second synthesis while the background one is still running.
    //    SPREAD the cached blob first (P0): the persist must PRESERVE the sibling caches that live in
    //    home_brief (aux / bundleNames / briefing) — writing a fresh object silently wiped them, which
    //    re-fired the bundle-naming + briefing AI passes on every sig change.
    await supabase.from('profiles').update({ home_brief: { ...((profileRes.data?.home_brief as Record<string, unknown>) ?? {}), text: briefLine, tldr, followups, fyiDigest, mustRespond, keepAnEyeOn, droppedItemIds, commitmentPlacements, generated_at: now.toISOString(), sig } }).eq('id', user.id).then(() => {}, () => {});

    // 4. Enrich in the BACKGROUND — same inputs as before — and persist the ENRICHED brief with the
    //    SAME sig (upgrades the cache in place: real ask/angle, ordering, supersession drops,
    //    placements). Non-fatal: any failure leaves the basic brief cached, which is still correct.
    const owedFacts = owedByIngest.map((c) => ({ description: c.description, overdue: c.overdue, dueToday: c.dueToday, dueDate: c.dueDate }));
    // PROTECTED members = must-respond candidates whose newest thread message is INBOUND
    // (lastFromUser === false), i.e. genuinely unanswered human replies the user still owes. These
    // can NEVER be dropped by the AI (no appear-then-vanish); only items where the user has the last
    // word (lastFromUser === true) remain droppable for closure. Missing from the map (no thread
    // reply-state) → treated as unanswered/protected, the safe default (don't silently drop).
    const protectedItemIds = new Set<string>(
      mustRespondRaw.filter((c) => lastFromUserByItem.get(c.itemId) !== true).map((c) => c.itemId),
    );
    after(async () => {
      try {
        // SINGLE-FLIGHT (P0): concurrent stale loads each persisted a basic brief stamped with their own
        // `generated_at`; only the request whose stamp SURVIVED the write race runs the expensive AI tail.
        // Before this gate, 5 stacked polls each kicked a full synthesis (dozens of concurrent AI calls →
        // 429 backoff storms → the 100s loads). Losers exit here for free.
        {
          const { data: gate } = await supabase.from('profiles').select('home_brief').eq('id', user.id).single();
          const gen = ((gate?.home_brief as { generated_at?: string } | null | undefined)?.generated_at) ?? null;
          if (gen !== now.toISOString()) return;
        }
        // Step 2 — the durable Person-Brain verdict for each must-respond correspondent (keyed by lowercased
        // email). Targeted (only the relevant people), non-fatal → the synthesis reasons the reply ANGLE WITH
        // the relationship. Empty map pre-backfill / for unknown senders.
        const personStates = new Map<string, { momentum: string; summary: string }>();
        try {
          const { getPersonEntities, findPersonEntity } = await import('@/lib/entities/people');
          const registry = await getPersonEntities(supabase, user.id);
          for (const k of [...new Set(mustRespondRaw.map((m) => (m.fromEmail || '').toLowerCase()).filter(Boolean))]) {
            const pe = findPersonEntity(registry, k, null);
            if (pe?.state?.summary) personStates.set(k, { momentum: pe.state.momentum || 'active', summary: pe.state.summary });
          }
        } catch { /* non-fatal */ }
        const synth = await synthesizeBrief(getSystemClient('summarization'), {
            firstName, now, ctx: briefCtx, schedule,
            commitments: owedFacts,
            commitmentCandidates: commitmentCands,
            waitingOnCount: status.waitingOn, triaged: handled.triaged, filtered: handled.filtered,
            emailReplyCount: emailP,
            topPriorities: cappedPriorities.map((p) => ({ title: p.title, posture: p.posture, source: p.source, overdue: !!p.overdue })),
            mustRespond: mustRespondRaw,
            protectedItemIds,
            personStates,
            // Waiting candidates = the ingest-awaiting commitments — the synthesis writes the follow-up
            // prose (status + nextMove) over these. Final lane routing is by the placement verdict below;
            // a commitment re-placed to ball_in_court that wasn't here still appears via the raw fallback.
            waiting: commitmentCands.filter((c) => c.direction === 'awaiting').map((c) => ({ id: c.id, counterparty: c.counterparty || c.sourceLabel, description: c.description, ageDays: c.ageDays })),
            fyiGroups: fyiTop.map((g) => ({ label: g.label, count: g.count, kind: g.kind, subjects: g.subjects })),
            keepAnEyeOn: keepAnEyeOnRaw,
          }, { userId: user.id, supabase });
        // ONE BRAIN — on Home activity: BOOTSTRAP the memory incrementally for users who never got a
        // backfill (chunked, idempotent, self-completing → the onboarding path that lets the label-era
        // fallbacks die). Cheap once complete; now behind the single-flight gate so it can't stack.
        // NOTE (P0): the blanket `refreshEntityStates` sweep was REMOVED from this tail — per-entity
        // refresh already happens where ledgers actually change (noteItemAction on user actions,
        // reconcileEntities on moves, the sync/insights hooks); the catch-all sweep lives in the
        // 2-hourly draft-sweep cron. Running it here made every sig change a potential multi-minute
        // token burn (dozens of entity syntheses), saturating the AI channel for all other requests.
        try {
          const { bootstrapMemory } = await import('@/lib/entities/hooks');
          await bootstrapMemory(supabase, user.id);
        } catch { /* non-fatal */ }
        // Start from the basic brief we just persisted; upgrade each section the synthesis produced
        // (nulls only overwrite when we got something, same rule as before). This is the ENRICHED blob.
        let enrTldr = tldr, enrFollowups = followups, enrFyiDigest = fyiDigest;
        let enrMustRespond = mustRespond, enrKeepAnEyeOn = keepAnEyeOn, enrBriefLine = briefLine;
        let enrDropped = droppedItemIds, enrPlacements = commitmentPlacements;
        if (synth.tldr) { enrTldr = synth.tldr; enrBriefLine = synth.tldr.teaser || enrBriefLine; }
        if (synth.mustRespond !== null || !mustRespondRaw.length) enrMustRespond = synth.mustRespond;
        if (synth.keepAnEyeOn !== null || !keepAnEyeOnRaw.length) enrKeepAnEyeOn = synth.keepAnEyeOn;
        if (synth.followups !== null || !commitmentCands.some((c) => c.direction === 'awaiting')) enrFollowups = synth.followups;
        // FYI: the AI's nicer summary wins when present; otherwise, whenever groups exist, fall back to
        // the DETERMINISTIC digest so the section never goes empty while noted mail exists (Bug A). Only
        // a genuinely empty FYI pool (no groups) yields null.
        enrFyiDigest = synth.fyiDigest
          ? { ...synth.fyiDigest, tailGroups: fyiTailGroups, tailItems: fyiTailItems }
          : buildDeterministicFyiDigest();
        // Belt-and-suspenders: a protected (unanswered inbound) item can NEVER be in droppedItemIds,
        // so it can't be removed from the priority cards either — enriched membership ⊇ protected set.
        enrDropped = synth.droppedItemIds.filter((id) => !protectedItemIds.has(id));
        if (Object.keys(synth.commitmentPlacements).length) enrPlacements = synth.commitmentPlacements;
        // Persist the enriched brief under the SAME sig — upgrades the cache in place so the next
        // refetch is a cache-hit on the fully-synthesized version. READ-MERGE-WRITE (P0): preserve the
        // sibling caches (aux / bundleNames / briefing) that other after() callbacks may have written
        // while the synthesis ran.
        const { data: curRow } = await supabase.from('profiles').select('home_brief').eq('id', user.id).single();
        const curHb = ((curRow?.home_brief as Record<string, unknown>) ?? {});
        await supabase.from('profiles').update({ home_brief: { ...curHb, text: enrBriefLine, tldr: enrTldr, followups: enrFollowups, fyiDigest: enrFyiDigest, mustRespond: enrMustRespond, keepAnEyeOn: enrKeepAnEyeOn, droppedItemIds: enrDropped, commitmentPlacements: enrPlacements, generated_at: now.toISOString(), sig } }).eq('id', user.id).then(() => {}, () => {});
      } catch { /* non-fatal — basic brief stays cached */ }
    });
  }

  // ── Route each open commitment by the synthesis's VERDICT (fallback = the ingest-direction default).
  // on_your_plate → "On your plate" (you owe, act) · ball_in_court → "Ball in your court" (waiting,
  // nudge) · informational → neither lane (awareness only). This is the real Bug #1/#3 fix: a REQUESTED
  // action the extractor mislabeled you_owe now lands in ball_in_court (or informational), never in the
  // action lane. General — driven by grounded judgment, no hardcoded senders/subjects.
  const placementOf = (c: (typeof commitmentCands)[number]): CommitmentPlacement =>
    commitmentPlacements[c.id] ?? defaultPlacement(c.direction);
  // Display dedup backstop (general): collapse near-identical descriptions within each lane so
  // existing bad rows can't double up even before the data-cleanup script runs. `counterparty` falls
  // back to the source-derived label (never a placeholder); UI omits the name when both are null.
  // NOTE: "On your plate" is NO LONGER hard-capped — it renders a few and expands (Show N more) in the
  // UI; we pass the full deduped set (bounded only by the 60-row commitments query upstream).
  const commitments = dedupByDescription(
    commitmentCands
      .filter((c) => placementOf(c) === 'on_your_plate')
      .map((c) => ({ id: c.id, description: c.description, counterparty: c.counterparty || c.sourceLabel, dueDate: c.dueDate, overdue: c.overdue, dueToday: c.dueToday, prepared: commitPrepared.get(c.id) ?? null, initiative: clusterTag(c.initiative)?.initiative ?? null, initiativeTotal: clusterTag(c.initiative)?.initiativeTotal ?? null })),
  )
    .sort((a, b) => {
      const rk = (x: typeof a) => (x.overdue ? 0 : x.dueToday ? 1 : x.dueDate ? 2 : 3);
      return rk(a) !== rk(b) ? rk(a) - rk(b) : (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    });
  // "Waiting on" (ball in their court) = awaiting-commitments + the cold outreach resolved above. Both
  // carry their initiative tag so they can group into "In motion" project cards on the Home.
  const waitingOn = dedupByDescription([
    ...commitmentCands
      .filter((c) => placementOf(c) === 'ball_in_court')
      .map((c) => ({ id: c.id, description: c.description, counterparty: c.counterparty || c.sourceLabel, ageDays: c.ageDays, initiative: clusterTag(c.initiative)?.initiative ?? null, initiativeTotal: clusterTag(c.initiative)?.initiativeTotal ?? null })),
    ...outboundAwaiting.map((o) => ({ id: `outbound:${o.recipient}`, description: o.subject || `Reached out to ${o.who || 'someone'}`, counterparty: o.who, ageDays: o.ageDays, initiative: clusterTag(o.initiative)?.initiative ?? null, initiativeTotal: clusterTag(o.initiative)?.initiativeTotal ?? null })),
  ])
    .sort((a, b) => b.ageDays - a.ageDays);
  // Keep the status chip honest with the routed set.
  status.waitingOn = waitingOn.length;

  // Reconcile the synthesized follow-up prose with the ball_in_court routing so the "Ball in your
  // court" lane and the counts agree. Keep only follow-up items whose commitment is ball_in_court,
  // then append any ball_in_court commitment the prose didn't cover (with a plain status/nextMove) so
  // a re-placed you_owe→waiting item still surfaces with a nudge affordance. General, id-grounded.
  const ballIds = new Set(waitingOn.map((w) => w.id));
  {
    const covered = new Set<string>();
    const keptItems = (followups?.items ?? []).filter((f) => {
      if (!f.id || !ballIds.has(f.id)) return false;
      covered.add(f.id);
      return true;
    });
    const extras = waitingOn
      .filter((w) => !covered.has(w.id))
      // `who` = the counterparty or its source-derived label; NEVER a placeholder. Falls back to the
      // description when there's no name/source at all, so a row still reads as a real thing to nudge.
      .map((w) => ({ id: w.id, who: w.counterparty || w.description, status: `Waiting ${w.ageDays}d`, nextMove: 'Send a nudge' }));
    const allItems = [...keptItems, ...extras];
    followups = allItems.length
      ? { teaser: followups?.teaser || '', items: allItems, closing: followups?.closing ?? null }
      : null;
  }

  // Apply the synthesis's supersession/staleness verdict to the CARDS too, so the "Needs you" grid
  // can't contradict the prose (a reply the synthesis dropped as superseded shouldn't reappear as a
  // priority card). Deterministic: we only hide ids the model returned as dropped.
  if (droppedItemIds.length) {
    const dropped = new Set(droppedItemIds);
    for (let i = cappedPriorities.length - 1; i >= 0; i--) {
      if (cappedPriorities[i].itemId && dropped.has(cappedPriorities[i].itemId!)) cappedPriorities.splice(i, 1);
    }
    // Keep the "N replies needed" chip honest — a superseded reply is no longer a reply you owe.
    status.needsReply = Math.max(0, status.needsReply - droppedItemIds.length);
  }

  // Attach any prepared auto-draft (from the draft-sweep) to its must-respond item, so the Home can
  // show "Draft ready" + a pre-filled, editable, sendable reply. Done at response time so it reflects
  // the latest draft even when the brief prose is served from cache.
  const draftByItem = new Map<string, string>();
  for (const it of items) {
    const b = (it.source_data as { draft?: { body?: string } })?.draft?.body;
    if (b && it.id) draftByItem.set(it.id, b);
  }
  // Drop must-respond items whose inbox item is no longer pending (dismissed/completed since the
  // brief prose was cached) — so the list + count reflect actions on reload without a full regen.
  const pendingItemIds = new Set(items.map((it) => it.id));
  // C3 SURFACING — who/what prepared each item ("✦ drafted" / "✦ prepared by <coworker>") rides the
  // payload so the deck announces arrival + attribution (the jaws-drop is seeing it before you ask).
  const { preparedBadge } = await import('@/lib/prepare/read');
  const preparedByItem = new Map<string, string>();
  for (const it of items) {
    const badge = preparedBadge(it.source_data as never);
    if (badge) preparedByItem.set(String(it.id), badge);
  }
  const mustRespondOut = mustRespond
    ? { ...mustRespond, items: mustRespond.items
        .filter((r) => !r.itemId || pendingItemIds.has(r.itemId))
        .map((r) => ({ ...r, draft: draftByItem.get(r.itemId) ?? null, preparedBy: preparedByItem.get(r.itemId) ?? null })) }
    : mustRespond;
  // "Keep an eye on" is awareness — no action buttons — but still drop items that are no longer
  // pending (dismissed elsewhere) so a stale cached tier can't show a gone item. Also enforce the
  // cross-tier dedup (Bug #2) HERE too, as a route-level backstop: even if the cache mixes a fresh
  // mustRespond with a stale keepAnEyeOn (or vice-versa), an itemId that surfaces as a must-respond
  // reply must never ALSO appear in keep-an-eye-on. Must-respond wins.
  const mustItemIds = new Set((mustRespondOut?.items ?? []).map((r) => r.itemId).filter(Boolean));
  const keepAnEyeOnOut = keepAnEyeOn
    ? { items: keepAnEyeOn.items.filter((k) => (!k.itemId || pendingItemIds.has(k.itemId) || awarenessRaw.has(k.itemId)) && !mustItemIds.has(k.itemId) && !demotedNoticeIds.has(k.itemId)) } // H4: demoted notices filtered
    : keepAnEyeOn;

  // ── "For your awareness" — REAL correspondence you're only informed on (understanding-driven). ──
  // Two conditions decide it, both from EXISTING signals (no new keyword/name heuristic):
  //   (1) the ONE unified understanding reasoned `relevance === 'awareness'` — no move expected of you
  //       (a "RE: <project>" you're cc'd on, a group CC — real people, real work, kept-in-the-loop),
  //       AND
  //   (2) the item carries a REAL-CORRESPONDENCE signal: a content RULE fired on it
  //       (`rule_type ∈ {needs_reply,to_do,waiting_on}`) — a human actually wrote asking/owing something.
  //       The user is only one_of_many / cc'd, so the understanding DEMOTED it from a reply to awareness;
  //       but a real ask was there, which is precisely what separates it from bulk.
  // A pure newsletter/promotion is `work_state='noted'` with `rule_type=null` (no content rule fired —
  // it's bulk, not correspondence), so it can NEVER satisfy (2) — even when the per-email classifier
  // happened to tag its understanding `one_of_many/awareness` (a group blast reads as "one of many").
  // That's why understanding ALONE is insufficient here and the content-rule signal is the deciding
  // second condition. The `items` query already pre-filters to actionable rule_type/work_state, so this
  // pool is exactly the real-correspondence candidates; the `noted` bulk lives only in `fyiRows`.
  //
  // Precedence (ONE home per item, no overlap): needs-you (must-respond / a needs-you priority card) →
  // keep-an-eye (watch) → for-your-awareness → newsletters. An item placed earlier is excluded here.
  // Identity is DETERMINISTIC (sender + a grounded one-liner from the real subject/snippet — never a
  // model's free text, never fabricated). Missing understanding → not eligible → non-fatal fallback.
  const eyeItemIds = new Set((keepAnEyeOnOut?.items ?? []).map((k) => k.itemId).filter(Boolean));
  const priorityItemIds = new Set(cappedPriorities.map((p) => p.itemId).filter(Boolean) as string[]);
  const fyaSeen = new Set<string>();
  // Candidates come from BOTH pools, merged into one section:
  //   • the ACTIONABLE pool — understanding demoted the item to awareness (a content rule or an action
  //     work_state landed it here, but no move is expected of the user). The old CONTENT_RULE AND-gate is
  //     GONE: an actionable-pool item that reads as awareness IS real correspondence, and `isBulk` (not a
  //     fired rule) keeps machine/list mail out. Real-correspondence noted rows arrive via `fyaFromNoted`.
  //   • the NOTED pool — `fyaFromNoted`, the non-bulk awareness rows lifted out of Newsletters above.
  // A user's EXPLICIT manual re-type (`type_override` to an actionable type) is authoritative and never
  // demoted to awareness here — the understanding only refines what the user hasn't pinned.
  const USER_ACTIONABLE = new Set(['needs_reply', 'to_do', 'waiting_on']);
  type FyaCand = { id: string; source_data: Record<string, unknown>; work_title: string | null };
  const fyaFromItems: FyaCand[] = items
    .filter((it) => it.source !== 'meeting' && it.source !== 'commitment')
    .filter((it) => !USER_ACTIONABLE.has(String(it.type_override || ''))) // user's explicit type wins
    .filter((it) => { const u = getUnderstanding(it); return !!u && u.relevance === 'awareness'; })
    .filter((it) => !isBulk((it.source_data ?? {}) as Record<string, unknown>)) // real correspondence only
    .map((it) => ({ id: it.id as string, source_data: (it.source_data ?? {}) as Record<string, unknown>, work_title: (it.work_title as string) || null }));
  const forYourAwareness = ([...fyaFromItems, ...fyaFromNoted] as FyaCand[])
    // No overlap: excluded if already surfaced as a reply/action (needs-you) or in keep-an-eye.
    .filter((c) => !mustItemIds.has(c.id) && !eyeItemIds.has(c.id) && !priorityItemIds.has(c.id))
    // dedup by id (an item can't be in both pools, but guard anyway).
    .filter((c) => { if (fyaSeen.has(c.id)) return false; fyaSeen.add(c.id); return true; })
    // Deliberately-cc'd / bystander threads first (strongest awareness signal), then freshest.
    .sort((a, b) => {
      const ua = coerceUnderstanding(a.source_data.understanding);
      const ub = coerceUnderstanding(b.source_data.understanding);
      const ra = (ua?.role === 'bystander' || a.source_data.is_cc_only === true) ? 0 : 1;
      const rb = (ub?.role === 'bystander' || b.source_data.is_cc_only === true) ? 0 : 1;
      const at = String(a.source_data.received_at || ''); const bt = String(b.source_data.received_at || '');
      return ra === rb ? bt.localeCompare(at) : ra - rb;
    })
    .slice(0, 12)
    .map((c) => {
      const sd = c.source_data;
      const who = (sd.from_name as string) || (sd.from as string) || 'Someone';
      const subject = (c.work_title as string) || (sd.subject as string) || '';
      // A grounded one-liner: the real subject (trimmed), else a short body snippet. No AI, no invention.
      const snippet = ((sd.body as string) || '').replace(/\s+/g, ' ').trim();
      const summary = subject.trim() || (snippet ? snippet.slice(0, 90) : 'Kept in the loop');
      return { itemId: c.id, who, summary: summary.length > 120 ? summary.slice(0, 117) + '…' : summary };
    });

  // ── "Worth acting on" — the action-NOTICES set (understanding.relevance === 'action'). Collected in
  // the candidate loop above; here we only keep the still-pending ones and cap the list. By construction
  // these are mutually exclusive of must-respond (never pushed there), the needs-you priority cards
  // (never pushed to `priorities`), keep-an-eye and for-your-awareness (both gated on relevance !=
  // action). ONE relevance → ONE home; no overlap. Ordered freshest-first isn't tracked here (order of
  // discovery follows the last_activity_at ordering of `items`), which is already recency-first.
  const actionNotices = actionNoticesRaw.filter((a) => pendingItemIds.has(a.itemId)).slice(0, 30); // high bound, not a functional gate — a real obligation must never be silently dropped

  // ── "Day cleared" progress ring — the LIVE half. `cleared` = things the user handled TODAY.
  // Computed fresh here (NOT baked into the cached AI blob) via a cheap batch of head-count queries,
  // so new activity moves the ring on the very next load. `needYou` is the current count of things
  // still on the user's plate — the same live section data the dashboard already shows (must-respond
  // replies + non-meeting/needs-you priority cards + on-your-plate commitments). The client re-derives
  // `needYou` from its own live state and increments `cleared` as the user acts, so the ring rises
  // instantly without a reload. This route value is the fresh baseline on each load.
  // The "cleared" half counts things the user RESOLVED today — keyed on a real resolution timestamp,
  // NOT updated_at. updated_at bumps on ANY write (sync, label reconcile, reclassification, backfill
  // scripts), so a thread resolved weeks ago gets pulled into today's window by routine maintenance
  // and the ring fills passively with zero user action. Instead:
  //   • inbox_items → source_data.resolved_at (a jsonb ISO string, stamped on every resolve path,
  //     cleared on every reopen). ISO strings sort lexicographically = chronologically, so `>=` works.
  //     Legacy rows without it simply don't count — the correct, conservative behaviour (under-count,
  //     never over-count).
  //   • commitments → the resolved_at column (migration 20260705d), stamped on resolve.
  // We DELIBERATELY no longer count raw sent emails: a reply that actually clears an item already stamps
  // the inbox_item's `source_data.resolved_at` (send-reply + resolve-on-reply paths) and is counted in
  // `inboxClearedRes`. Counting `emails.is_from_user` over-counted massively — it swept in duplicate
  // sent-rows (observed: one "Re: …" thread stored ~110× → a 96% ring with 2 real actions) and external
  // replies to threads that were never an inbox item. The ring must reflect ITEMS the user resolved here,
  // which the Activity log mirrors — not the mailbox's raw outbound volume.
  const [inboxClearedRes, commitClearedRes] = await Promise.all([
    supabase.from('inbox_items').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).in('status', ['completed', 'dismissed']).gte('source_data->>resolved_at', startOfDay),
    // Count only USER-driven resolutions — exclude auto-fulfillment (`resolved_reason='fulfilled'`, the
    // commitments-sweep detecting a commitment was met, often a phantom created + closed the same minute).
    // "Day cleared" reflects what YOU cleared, not what the system auto-closed. User done/dismiss (reason
    // null) + reply-resolution ('replied') still count.
    supabase.from('commitments').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).in('status', ['done', 'dismissed']).gte('resolved_at', startOfDay)
      .or('resolved_reason.is.null,resolved_reason.neq.fulfilled'),
  ]);
  const clearedToday = (inboxClearedRes.count ?? 0) + (commitClearedRes.count ?? 0);
  // needYou baseline = live counts already computed above: replies you owe (mustRespondOut) +
  // non-meeting/needs-you priority cards + on-your-plate commitments still pending.
  const needYouReplies = (mustRespondOut?.items ?? []).length;
  // Meeting cards ARE shown in "What needs you" (a Review action + follow-ups), so each meeting CARD
  // counts as 1 unit of needYou — otherwise the ring reads "1 needs you" while 2 items show, and
  // handling the meeting never moves it. (One card per meeting, not per nested action item.) Cleared
  // already counts meeting follow-ups: they're inbox_items (source='meeting') and inboxClearedRes has
  // no source filter — so clearing them moves the cleared half. The two halves stay consistent.
  const needYouCards = cappedPriorities.filter((p) => p.posture !== 'needs_reply').length;
  // Action-notices ("Worth acting on") are a needs-you lane too — count them so the ring baseline
  // reflects everything the user still has to act on (the client re-derives this live as they dismiss).
  const needYou = needYouReplies + needYouCards + commitments.length + actionNotices.length;
  const dayProgress = { cleared: clearedToday, needYou };

  // L1 BUNDLING (server-side, deterministic) — group the "what needs you" atoms (replies + action notices +
  // commitments) into ≥2 bundles by INITIATIVE (primary) → MEETING → THREAD. The client renders by the key
  // we hand it. Recomputed each request (cheap, no AI); atoms not in the map are singles.
  const itemById = new Map(items.map((it) => [it.id as string, it]));
  const commitById = new Map(commits.map((c) => [c.id as string, c]));
  // Fetch titles for the meetings that our commitments came from, so a meeting bundle reads with its name.
  const meetingIds = [...new Set(commits.filter((c) => c.source === 'meeting' && c.source_id).map((c) => c.source_id as string))];
  const meetingTitle = new Map<string, string>();
  if (meetingIds.length) {
    const { data: mt } = await supabase.from('meeting_transcripts').select('id, title').in('id', meetingIds);
    for (const m of (mt ?? []) as Array<{ id: string; title: string | null }>) if (m.title) meetingTitle.set(m.id, m.title);
  }
  const bundleAtoms: Array<import('@/lib/home/bundle-brief').BundleAtom> = [
    ...((mustRespondOut?.items ?? []) as Array<{ itemId: string; subject?: string }>).map((m) => {
      const raw = itemById.get(m.itemId);
      return { id: m.itemId, threadId: (raw?.source_data?.thread_id as string) ?? null, subject: (raw?.work_title as string) ?? m.subject ?? null };
    }),
    ...actionNotices.map((n) => {
      const raw = itemById.get(n.itemId);
      return { id: n.itemId, threadId: (raw?.source_data?.thread_id as string) ?? null, subject: (raw?.work_title as string) ?? n.summary ?? null };
    }),
    ...(commitments as Array<{ id: string; description?: string }>).map((c) => {
      const raw = commitById.get(c.id);
      const mId = raw?.source === 'meeting' ? ((raw?.source_id as string) ?? null) : null;
      return { id: c.id, meetingId: mId, meetingLabel: mId ? (meetingTitle.get(mId) ?? 'Meeting follow-ups') : null, threadId: (raw?.thread_id as string) ?? null, subject: c.description ?? null };
    }),
  ];
  // ONE BRAIN (Blocker C): resolve each atom's ENTITY (its own link) BEFORE bundling — the entity IS the
  // primary grouping key. ONE fetch here also feeds slipping / bundleStates / deckEntityIds below.
  let wentsRows: Array<Record<string, unknown>> = [];
  let alinksRows: Array<{ item_id: string; entity_id: string }> = [];
  try {
    const { data: wents } = await supabase.from('work_entities')
      .select('id, name, status, state, next_move, priority, last_event_at, tracked')
      .eq('user_id', user.id).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null).limit(400);
    wentsRows = (wents ?? []) as Array<Record<string, unknown>>;
    const atomIds = bundleAtoms.map((a) => a.id);
    if (atomIds.length) {
      const { data: alinks } = await supabase.from('entity_links').select('item_id, entity_id').eq('user_id', user.id)
        .in('item_kind', ['inbox_item', 'commitment']).in('item_id', atomIds.slice(0, 400)).not('entity_id', 'is', null);
      alinksRows = (alinks ?? []) as Array<{ item_id: string; entity_id: string }>;
    }
    const nameById = new Map(wentsRows.map((e) => [e.id as string, e.name as string]));
    const linkByAtom = new Map(alinksRows.map((l) => [l.item_id, l.entity_id]));
    for (const a of bundleAtoms) {
      const eid = linkByAtom.get(a.id);
      const nm = eid ? nameById.get(eid) : undefined;
      if (eid && nm) a.entity = { id: eid, name: nm };
    }
  } catch { /* non-fatal — atoms bundle by meeting/thread only */ }
  const bundles = computeBundles(bundleAtoms);

  // ── PROACTIVE SLIPPING (one-digest, no new section) — a deal that's quietly SLIPPING (gone-quiet/stalled
  // with something open on you, per the ONE verdict) surfaces as a card IN the deck EVEN WITH NO NEW MAIL.
  // Deduped against the deck's actionable pool (bundleAtoms) so a deal already in play never doubles up. The
  // card leads with the SAME one next move the deck/projects/deep-dive show. Read-only, non-fatal. ──
  const slippingDeals: Array<{ key: string; label: string; momentum: string; summary: string; weight: number; nextMove: { title: string; entityRef: string | null } | null }> = [];
  // The deck's per-bundle ENTITY state (the membership join — bundle atoms → their entity links → the
  // dominant entity's state+next-move). Replaces the label-keyed initiative_state join (Blocker A).
  const bundleStates: Record<string, { momentum: string; summary: string | null; quietDays: number | null; nextMove: { title: string; entityRef: string | null; reason?: string; covers?: string[] } | null }> = {};
  let deckEntityIdsOut: string[] = [];
  try {
    const nowMs = Date.now();
    const entById = new Map(wentsRows.map((e) => [e.id as string, e]));

    // ── SLIPPING (entity verdict, inline): gone-quiet/stalled + something open on you → a proactive card,
    // deduped against entities already actionable in the deck (their atoms' links, fetched above). ──
    const deckEntityIds = new Set(alinksRows.map((l) => l.entity_id));
    deckEntityIdsOut = [...deckEntityIds];
    for (const e of wentsRows) {
      const st = (e.state ?? {}) as { momentum?: string; summary?: string; whoOwes?: { you?: string[]; them?: string[] } };
      const quiet = e.last_event_at ? Math.floor((nowMs - new Date(e.last_event_at as string).getTime()) / 86400000) : null;
      // Slipping = quiet/stalled with something open ON YOU. Quiet with NO open loops is the OPPOSITE
      // signal (a closure candidate — the portfolio proposes "mark done?"), never a proactive deck card.
      const slipping = (st.momentum === 'gone_quiet' || st.momentum === 'stalled') && (st.whoOwes?.you?.length ?? 0) > 0;
      // USER-CREATED ONLY: a slipping card names an entity AS a project (and opens its room) —
      // only a TRACKED project may surface this way; recognition keeps judging underneath.
      if (!slipping || !st.summary || !e.tracked || deckEntityIds.has(e.id as string)) continue;
      const nm = (e.next_move ?? null) as { title?: string; entityRef?: string | null } | null;
      slippingDeals.push({
        key: e.id as string, label: e.name as string, momentum: st.momentum || 'stalled', summary: st.summary,
        weight: Number((e.priority as { weight?: number } | null)?.weight ?? 20),
        nextMove: nm?.title ? { title: nm.title, entityRef: nm.entityRef ?? null } : null,
      });
    }
    slippingDeals.sort((a, b) => b.weight - a.weight);
    slippingDeals.splice(3); // the deck stays calm — top 3 by reasoned weight; the rest live on the portfolio/Timeline

    // ── BUNDLE STATES (the membership vote per bundle key). ──
    const votes = new Map<string, Map<string, number>>(); // bundleKey → entityId → votes
    for (const l of alinksRows) {
      const ref = bundles[l.item_id];
      if (!ref) continue;
      (votes.get(ref.key) ?? votes.set(ref.key, new Map()).get(ref.key)!).set(l.entity_id, ((votes.get(ref.key)!.get(l.entity_id)) ?? 0) + 1);
    }
    for (const [bkey, m] of votes) {
      const [best] = [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
      const e = best ? entById.get(best) : undefined;
      if (!e) continue;
      const st = (e.state ?? {}) as { momentum?: string; summary?: string };
      if (!st.summary) continue;
      const nm = (e.next_move ?? null) as { title?: string; entityRef?: string | null; reason?: string; covers?: string[] } | null;
      const quiet = e.last_event_at ? Math.floor((nowMs - new Date(e.last_event_at as string).getTime()) / 86400000) : null;
      // THE ARBITER (P6a): covers rides along as PLAIN item ids (the deck matches on DoItem.entityId),
      // so covered members render as evidence under the ONE next move instead of parallel asks.
      const covers = Array.isArray(nm?.covers) ? nm!.covers!.map((r) => String(r).split(':')[1]).filter(Boolean) : [];
      bundleStates[bkey] = { momentum: st.momentum || 'active', summary: st.summary, quietDays: quiet, nextMove: nm?.title ? { title: nm.title, entityRef: nm.entityRef ?? null, reason: nm.reason, covers } : null };
    }
  } catch { /* non-fatal — no proactive cards / no bundle states */ }

  // REASONED NAMING (conservative, cached) — turn each bundle into a short human name + grounded "why".
  // The deterministic `label` above is the fallback; a cached AI pass (keyed by the bundle-set signature)
  // upgrades it. On a signature MISS we serve the fallback now and refresh the cache in the background, so
  // the response never waits on the AI. Names/whys ride back as `bundleNames` (key → {name, why?}).
  const bundleKeys = [...new Set(Object.values(bundles).map((b) => b.key))].sort();
  const bundleSig = bundleKeys.join('|');
  const cachedBundleNames = cached?.bundleNames?.sig === bundleSig ? (cached.bundleNames.names ?? {}) : {};
  const bundleNames: Record<string, BundleName> = {};
  for (const key of bundleKeys) {
    const label = Object.values(bundles).find((b) => b.key === key)?.label ?? key;
    const named = cachedBundleNames[key];
    bundleNames[key] = named ?? { name: label };
  }
  // Refresh names in the background when the bundle set changed (and there are real bundles to name).
  if (bundleKeys.length && cached?.bundleNames?.sig !== bundleSig) {
    // Build per-bundle inputs (kind + fallback label + member gists) for the naming pass.
    const gistsByKey = new Map<string, string[]>();
    for (const a of bundleAtoms) {
      const ref = bundles[a.id];
      if (!ref) continue;
      const arr = gistsByKey.get(ref.key) ?? [];
      if (a.subject) arr.push(a.subject);
      gistsByKey.set(ref.key, arr);
    }
    const nameInputs: BundleNameInput[] = bundleKeys.map((key) => ({
      key,
      kind: key.startsWith('e:') ? 'initiative' : key.startsWith('m:') ? 'meeting' : 'thread',
      label: bundleNames[key].name,
      members: gistsByKey.get(key) ?? [],
    }));
    after(async () => {
      try {
        const names = await nameBundles(user.id, supabase, nameInputs);
        if (!Object.keys(names).length) return;
        // Read-merge-write so we upgrade only `bundleNames` and preserve the rest of home_brief.
        const { data } = await supabase.from('profiles').select('home_brief').eq('id', user.id).single();
        const hb = ((data?.home_brief as Record<string, unknown>) ?? {});
        await supabase.from('profiles').update({ home_brief: { ...hb, bundleNames: { sig: bundleSig, names } } }).eq('id', user.id).then(() => {}, () => {});
      } catch { /* non-fatal — deterministic labels stay */ }
    });
  }

  // ── The ONE quiet relationship cue per must-respond item (Person Brain) — itemId → {label,tone}. Computed
  // from mustRespondRaw (fresh every load, like the other facts), so no cache plumbing. One cheap query on the
  // must-respond senders. The card renders a muted tag; a miss = no cue (only meaningful stakes show). ──
  // itemWeights (itemId → 0–100) come from the SHARED verdict (lib/brains/verdict.ts personVerdict) — the
  // ONE judgment authority. The deck's "Important" lens READS this; it does not re-derive priority. Same
  // person_state row also yields the cue. (Timeline/Projects will call the same verdict functions.)
  const personCues: Record<string, { label: string; tone: 'neutral' | 'amber' }> = {};
  const itemWeights: Record<string, number> = {};
  try {
    const { personVerdict } = await import('@/lib/brains/verdict');
    const keyToItems = new Map<string, string[]>();
    for (const m of mustRespondRaw) { const k = (m.fromEmail || '').toLowerCase(); if (!k) continue; const a = keyToItems.get(k) ?? []; a.push(m.itemId); keyToItems.set(k, a); }
    const keys = [...keyToItems.keys()];
    if (keys.length) {
      // ENTITY-FIRST (One Brain cutover #4): resolve each sender to the ONE human in the person registry
      // (alias-matched — a person's several addresses land on one entity, killing duplicate cues/weights).
      // person_state remains only for senders the registry doesn't know.
      const unresolved = new Set(keys);
      try {
        const { getPersonEntities, findPersonEntity } = await import('@/lib/entities/people');
        const registry = await getPersonEntities(supabase, user.id);
        for (const k of keys) {
          const pe = findPersonEntity(registry, k, null);
          if (!pe?.state?.summary) continue;
          unresolved.delete(k);
          const cue = relationshipCue(pe.state.relationship, pe.state.momentum, pe.quietDays);
          const v = personVerdict({ state: pe.state, next_touch: pe.nextTouch, quiet_days: pe.quietDays } as never);
          for (const id of (keyToItems.get(k) ?? [])) { if (cue) personCues[id] = cue; itemWeights[id] = v.weight; }
        }
      } catch { /* fall through to person_state for all keys */ }
      if (unresolved.size) {
        const { data: ps } = await supabase.from('person_state').select('person_key, state, next_touch, quiet_days').eq('user_id', user.id).in('person_key', [...unresolved]);
        for (const r of (ps ?? []) as Array<{ person_key: string; state: { relationship?: string; momentum?: string; summary?: string; whoOwes?: { you: string[]; them: string[] } } | null; next_touch: { title?: string; reason?: string; entityRef?: string | null } | null; quiet_days: number | null }>) {
          const ids = keyToItems.get(r.person_key.toLowerCase()) ?? [];
          const cue = relationshipCue(r.state?.relationship, r.state?.momentum, r.quiet_days);
          const v = personVerdict(r);
          for (const id of ids) { if (cue) personCues[id] = cue; itemWeights[id] = v.weight; }
        }
      }
    }
  } catch { /* non-fatal — cards just render without a cue / default weight */ }

  // ── PHASE-C CUTOVER #1 (One Brain): where an item is LINKED to an entity, its weight is the entity's
  // REASONED priority (the memory's judgment: stakes read from the whole ledger — deadlines, money, who's
  // waiting), OVERRIDING the person-verdict formula above. Self-gating: users without entity memory have no
  // links → the formula fallback stands (the staged cutover; the formula dies at demolition). Covers both
  // inbox items AND commitments (the deck's two weighted atom kinds). One query, non-fatal. ──
  try {
    const atomIds = [
      ...mustRespondRaw.map((m) => m.itemId),
      ...actionNotices.map((n) => n.itemId),
      ...commitments.map((c) => c.id),
    ].filter(Boolean);
    if (atomIds.length) {
      const { data: elinks } = await supabase.from('entity_links')
        .select('item_id, entity_id').eq('user_id', user.id)
        .in('item_kind', ['inbox_item', 'commitment']).in('item_id', atomIds).not('entity_id', 'is', null);
      const entIds = [...new Set((elinks ?? []).map((l) => l.entity_id as string))];
      if (entIds.length) {
        const { data: ents } = await supabase.from('work_entities').select('id, priority').in('id', entIds);
        const prioById = new Map((ents ?? []).map((e) => [e.id as string, (e.priority as { weight?: number } | null)?.weight]));
        for (const l of (elinks ?? []) as Array<{ item_id: string; entity_id: string }>) {
          const w = prioById.get(l.entity_id);
          if (typeof w === 'number') itemWeights[l.item_id] = w;
        }
      }
    }
  } catch { /* non-fatal — the formula fallback stands */ }

  // ══ THE REASONED BRIEFING (S1, docs/home-briefing-plan.md) — the chief-of-staff brief, WRITTEN BY THE
  // BRAIN over judged state. daySig-gated (composes only when the day's SHAPE changed), background,
  // last-good served. Stored inside home_brief.briefing (read-merge-write — the bundleNames pattern). ══
  const cachedBriefing = (cached as { briefing?: import('@/lib/briefing/compose').Briefing } | null)?.briefing ?? null;
  try {
    const { composeBriefing, briefingDaySig } = await import('@/lib/briefing/compose');
    const entNameById = new Map(wentsRows.map((e) => [e.id as string, { name: e.name as string, move: ((e.next_move ?? null) as { title?: string } | null)?.title ?? null }]));
    const entByAtom = new Map(alinksRows.map((l) => [l.item_id, entNameById.get(l.entity_id) ?? null]));
    const entIdByAtom = new Map(alinksRows.map((l) => [l.item_id, l.entity_id]));
    const entStateById = new Map(wentsRows.map((e) => [e.id as string, (e.state ?? {}) as { category?: string }]));
    const isAdminEntity = (id: string | undefined | null) => id != null && entStateById.get(id)?.category === 'admin';
    // ── THE AGENDA (Living-Home S1) — replicate the deck's ordering server-side with the SAME pure spine
    // (lib/home/agenda) so the brief's lead anchors on the SAME first thing the deck shows as its hero.
    // Session state (this browser's dismissals / chosen lens) can't be known here — this is the canonical
    // default-lens (Urgent) agenda, which is what a fresh load renders.
    const { buildAgenda, agendaAtomOrder } = await import('@/lib/home/agenda');
    const todayISOStr = todayStr;
    const serverAgenda = buildAgenda({
      // THE ROW TAG (July 30 — the invisible-EG-Bank bug): EVERY deck row derives its project tag
      // from its own ENTITY LINK against the tracked registry (P15 tracked-only law) — reply and
      // notice rows were never given one (only commitments carried a label-era string).
      replyItems: ((mustRespondOut?.items ?? []) as Array<{ itemId: string; who: string; ask: string; dueDate?: string | null }>).map((m) => ({
        source: 'reply' as const, key: `r-${m.itemId}`, entityId: m.itemId, href: `/item/${m.itemId}?kind=email`,
        ask: m.ask, primary: m.who, dueDate: m.dueDate ?? null,
        initiative: trackedNameById.get(entIdByAtom.get(m.itemId) ?? '') ?? null,
      })),
      noticeItems: actionNotices.map((n) => ({
        source: 'notice' as const, key: `n-${n.itemId}`, entityId: n.itemId, href: `/item/${n.itemId}?kind=email`,
        ask: n.summary, primary: n.who || null, dueDate: n.dueDate ?? null, overdue: !!n.dueDate && n.dueDate < todayISOStr,
        initiative: trackedNameById.get(entIdByAtom.get(n.itemId) ?? '') ?? null,
      })),
      commitItems: commitments.map((c) => ({
        source: 'commitment' as const, key: `c-${c.id}`, entityId: c.id, href: `/item/${c.id}?kind=commitment`,
        ask: c.description, overdue: !!c.overdue, dueDate: c.dueDate ?? null,
        initiative: trackedNameById.get(entIdByAtom.get(c.id) ?? '') ?? c.initiative ?? null,
      })),
      priorityCards: cappedPriorities.filter((p) => p.posture !== 'needs_reply'),
      deals: slippingDeals,
      bundles, bundleNames: bundleNames ?? {},
      bundleStates: bundleStates as Record<string, import('@/lib/home/agenda').BundleState | null>,
      weights: itemWeights,
    });
    const realCounterpartyById = new Map(commitmentCands.map((c) => [c.id, c.counterparty]));
    // Deck-order index: itemId → its position in the agenda's atom order (bundle members expanded).
    const atomOrder = agendaAtomOrder(serverAgenda);
    const orderIdx = new Map(atomOrder.map((id, i) => [id, i]));
    const inputs: import('@/lib/briefing/compose').BriefingInputs = {
      todayStr, firstName: firstName || 'there',
      // ACTION prose = genuine HUMAN obligations only: replies you owe + commitments. Automated/system
      // notices (payment/subscription/security) are deliberately EXCLUDED — the brief must never invent a
      // person or urgency for a no-reply sender ("before X escalates again"). They still surface in the deck.
      // Ordered by the AGENDA (deck order) — the composer keeps this order, so {A1} IS the deck's first
      // actionable and the prose lead and the deck hero point at the same thing by construction.
      actions: [
        ...((mustRespondOut?.items ?? []) as Array<{ itemId: string; who: string; ask: string; dueDate?: string | null }>).map((m) => ({
          itemId: m.itemId, itemKind: 'inbox_item' as const, who: m.who, ask: m.ask,
          move: entByAtom.get(m.itemId)?.move ?? null, entityId: entIdByAtom.get(m.itemId) ?? null, entityName: entByAtom.get(m.itemId)?.name ?? null,
          weight: itemWeights[m.itemId] ?? 20, overdue: false, dueDate: m.dueDate ?? null, href: `/item/${m.itemId}?kind=email`,
        })),
        ...commitments.map((c) => ({
          itemId: c.id, itemKind: 'commitment' as const,
          // The REAL counterparty only (nullable) — `c.counterparty` here is the display-mapped
          // `counterparty || sourceLabel`, and a sourceLabel ("from <meeting>") must never become a
          // briefing ref's name. The composer resolves null → the deal's registry name.
          who: realCounterpartyById.get(c.id) ?? null, ask: c.description,
          move: entByAtom.get(c.id)?.move ?? null, entityId: entIdByAtom.get(c.id) ?? null, entityName: entByAtom.get(c.id)?.name ?? null,
          weight: itemWeights[c.id] ?? 18, overdue: !!c.overdue, dueDate: c.dueDate ?? null, href: `/item/${c.id}?kind=commitment`,
        })),
      ].sort((a, b) => (orderIdx.get(a.itemId) ?? 1e9) - (orderIdx.get(b.itemId) ?? 1e9)),
      // WATCH / PULSE = real bodies of work only — an admin/vendor/SaaS entity (a subscription, a utility
      // account) is background, never surfaced as "quietly slipping" or "moving without you".
      watch: slippingDeals.filter((d) => !isAdminEntity(d.key)).map((d) => ({ entityId: d.key, name: d.label, summary: d.summary, move: d.nextMove?.title ?? null, quietDays: null, weight: d.weight })),
      moving: (() => {
        const deckSet = new Set(deckEntityIdsOut);
        const mv = wentsRows.filter((e) => { const st = (e.state ?? {}) as { momentum?: string; summary?: string; category?: string }; return !deckSet.has(e.id as string) && st.summary && st.category !== 'admin' && (st.momentum === 'active' || st.momentum === 'waiting'); });
        const best = [...mv].sort((a, b) => Number((b.priority as { weight?: number } | null)?.weight ?? 0) - Number((a.priority as { weight?: number } | null)?.weight ?? 0))[0];
        return { count: mv.length, closest: best ? { entityId: best.id as string, name: best.name as string, summary: String(((best.state ?? {}) as { summary?: string }).summary ?? '') } : null };
      })(),
      schedule: schedule.map((sc) => ({ time: sc.localTime, title: sc.title })),
      counts: { needYou: (mustRespondOut?.items?.length ?? 0) + actionNotices.length + commitments.length, cleared: dayProgress?.cleared ?? 0, fromTeam: 0, followUps: followups?.items?.length ?? 0, fyi: forYourAwareness.length },
      prior: cachedBriefing ? { lead: cachedBriefing.lead?.text, action: cachedBriefing.action?.text, watchlist: cachedBriefing.watchlist?.text, pulse: cachedBriefing.pulse?.text, composedAt: cachedBriefing.composedAt } : null,
    };
    if (cachedBriefing?.daySig !== briefingDaySig(inputs)) {
      after(async () => {
        try {
          const briefing = await composeBriefing(supabase, user.id, inputs);
          if (!briefing) return;
          const { data } = await supabase.from('profiles').select('home_brief').eq('id', user.id).single();
          const hb = ((data?.home_brief as Record<string, unknown>) ?? {});
          await supabase.from('profiles').update({ home_brief: { ...hb, briefing } }).eq('id', user.id).then(() => {}, () => {});
        } catch { /* non-fatal — last-good briefing stays */ }
      });
    }
  } catch { /* non-fatal */ }

  // P0 perf watchdog: one line when the GET path itself (pre-after()) ran slow — names the phase.
  mark('assemble');
  const totalMs = Date.now() - t0;
  if (totalMs > 2500) console.log(`[home/brief] slow ${totalMs}ms — ${marks.map(([l, m]) => `${l}:${m}ms`).join(' · ')}`);
  // trackedProjects was loaded early (before clusterTag) — served for By-project grouping.
  // MAIL STATE (new-user honesty): the Home's empty state must distinguish "nothing connected" /
  // "first sync in flight" / "genuinely all clear" — one cheap query, no AI.
  let mail = { connections: 0, syncing: false };
  try {
    const { data: conns } = await supabase.from('connections').select('id, last_sync')
      .eq('user_id', user.id).in('provider', ['gmail', 'outlook']).eq('status', 'active');
    mail = { connections: conns?.length ?? 0, syncing: (conns ?? []).some((c) => !c.last_sync) };
  } catch { /* non-fatal */ }
  // THE ROW TAG on the SERVED payload (July 30 — the invisible-EG-Bank bug, take 2: the client
  // builds the deck from THESE lanes, not from the server-side agenda): every deck lane carries its
  // project tag derived from the item's ENTITY LINK against the tracked registry (P15 tracked-only;
  // independent of state synthesis). Entity truth outranks the label-era string where both exist.
  const tagByAtom = new Map<string, string>();
  for (const l of alinksRows) { const nm = trackedNameById.get(l.entity_id); if (nm) tagByAtom.set(l.item_id, nm); }
  const taggedMustRespond = mustRespondOut
    ? { ...mustRespondOut, items: (mustRespondOut.items ?? []).map((m: { itemId: string; initiative?: string | null }) => ({ ...m, initiative: tagByAtom.get(m.itemId) ?? m.initiative ?? null })) }
    : mustRespondOut;
  return NextResponse.json({ firstName, briefLine, tldr, followups, fyiDigest, forYourAwareness, actionNotices: actionNotices.map((n) => ({ ...n, preparedBy: preparedByItem.get(n.itemId) ?? null, initiative: tagByAtom.get(n.itemId) ?? null })), mustRespond: taggedMustRespond, keepAnEyeOn: keepAnEyeOnOut, status, priorities: cappedPriorities, commitments: commitments.map((c) => ({ ...c, initiative: tagByAtom.get(c.id) ?? c.initiative ?? null })), waitingOn, schedule, handled, dayProgress, bundles, bundleNames, personCues, itemWeights, slippingDeals, bundleStates, deckEntityIds: deckEntityIdsOut, briefing: cachedBriefing, trackedProjects, mail });
}
