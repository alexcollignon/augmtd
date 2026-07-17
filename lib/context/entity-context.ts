// ENTITY CONTEXT — the relationship "dossier" around an email's participants + its initiative. A human reads
// a mail inside a web of relationships (this person, our deal, the meeting last week, the commitment I owe);
// this assembles that same neighborhood so the AI (and, later, the user) reasons WITH it instead of blind.
//
// PRINCIPLE: assembly is DETERMINISTIC relational lookup (join by person/initiative — entity resolution),
// the model reasons OVER it. No graph DB, no keyword rules — the graph is implicit in our FKs + initiative
// keys. Reuses identity.ts (alias-aware person match), getInitiativeCandidates (grounded canonical), and the
// tables we already have (commitments / meeting_transcripts / calendar_events / relationship_graph / inbox).
//
// One service, many consumers: classification (Slice 1), the deep-dive context rail (Slice 2), the drafter
// and brief and coworker chat (Slice 3). Build once per email; batched sharing is buildEntityContextMap.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getInitiativeCandidates } from '@/lib/inbox/initiative-candidates';
import { sameAttendee } from '@/lib/projects/identity';

const emailOf = (s?: string | null): string | null =>
  String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;

export type EntityContext = {
  people: { email: string | null; name: string | null }[];
  // The grounded deal/relationship label (canonical) + other variants seen for the same person.
  initiative: { label: string | null; variants: string[] };
  relationship: { name: string | null; frequency: string | null } | null;
  openCommitments: { id: string; description: string; direction: string; dueDate: string | null }[];
  recentMeetings: { id: string; title: string; date: string | null }[];         // past transcripts w/ them
  upcomingMeetings: { id: string; title: string; startTime: string | null }[];  // future calendar w/ them
  recentThreads: { itemId: string; subject: string; lastAt: string | null }[];  // other correspondence w/ them
};

type Attendee = { email?: string | null; name?: string | null } | string;
const attendeeStr = (a: Attendee): string => (typeof a === 'string' ? a : (a?.email || a?.name || '')) || '';

export type BuildOpts = {
  emails: (string | null | undefined)[];
  names?: (string | null | undefined)[];
  threadId?: string | null;
  excludeItemId?: string | null;   // don't list the email we're currently processing among "related threads"
  limits?: { commitments?: number; meetings?: number; threads?: number };
};

// Assemble the dossier for ONE set of participants. Bounded queries + alias-aware JS filtering; safe/non-fatal
// (any lookup that fails just yields an empty slice). For a whole sync batch, prefer buildEntityContextMap.
// The shared corpus — the user's commitments / meetings / calendar / inbox / relationships, fetched ONCE and
// assembled-from many times. This is what makes the per-BATCH map cheap: one set of table reads, N cheap
// in-memory assemblies (vs N × 5 table reads). `scopeEmails` bounds only the relationship_graph read.
type ContextCorpus = {
  rel: Array<Record<string, unknown>>;
  commits: Array<Record<string, unknown>>;
  past: Array<Record<string, unknown>>;
  future: Array<Record<string, unknown>>;
  inbox: Array<Record<string, unknown>>;
};

async function fetchContextCorpus(supabase: SupabaseClient, userId: string, scopeEmails: string[]): Promise<ContextCorpus> {
  const nowISO = new Date().toISOString();
  const [relRes, commitsRes, pastRes, futureRes, threadsRes] = await Promise.all([
    scopeEmails.length
      ? supabase.from('relationship_graph').select('contact_email, contact_name, interaction_frequency').eq('user_id', userId).in('contact_email', scopeEmails)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    supabase.from('commitments').select('id, description, counterparty, direction, due_date, initiative').eq('user_id', userId).in('status', ['open', 'pending']).limit(400),
    supabase.from('meeting_transcripts').select('id, title, start_time, attendees, initiative').eq('user_id', userId).lte('start_time', nowISO).order('start_time', { ascending: false }).limit(150),
    supabase.from('calendar_events').select('id, title, start_time, attendees').eq('user_id', userId).eq('status', 'confirmed').gte('start_time', nowISO).order('start_time', { ascending: true }).limit(150),
    supabase.from('inbox_items').select('id, work_title, source_data, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(250),
  ]);
  return {
    rel: (relRes as { data?: Array<Record<string, unknown>> }).data ?? [],
    commits: (commitsRes as { data?: Array<Record<string, unknown>> }).data ?? [],
    past: (pastRes as { data?: Array<Record<string, unknown>> }).data ?? [],
    future: (futureRes as { data?: Array<Record<string, unknown>> }).data ?? [],
    inbox: (threadsRes as { data?: Array<Record<string, unknown>> }).data ?? [],
  };
}

// Assemble ONE dossier from a pre-fetched corpus. getInitiativeCandidates is memoized per-process, so calling
// it per-set inside a batch is cheap (one labeled-corpus load, shared).
async function assembleFromCorpus(corpus: ContextCorpus, supabase: SupabaseClient, userId: string, opts: BuildOpts): Promise<EntityContext> {
  const emails = [...new Set(opts.emails.map(emailOf).filter(Boolean) as string[])];
  const names = [...new Set((opts.names ?? []).map((n) => (n || '').trim()).filter(Boolean))];
  const L = { commitments: opts.limits?.commitments ?? 6, meetings: opts.limits?.meetings ?? 5, threads: opts.limits?.threads ?? 6 };

  const isPerson = (candidate: string | null | undefined): boolean => {
    const c = (candidate || '').trim();
    if (!c) return false;
    return emails.some((e) => sameAttendee(c, e)) || names.some((n) => sameAttendee(c, n));
  };

  const initRes = await getInitiativeCandidates(supabase, userId, { threadId: opts.threadId ?? null, personEmails: emails, personNames: names }).catch(() => ({ canonical: null, candidates: [] as string[] }));
  const initiative = { label: initRes.canonical, variants: initRes.candidates ?? [] };

  const rel0 = corpus.rel.find((r) => emails.includes(emailOf(r.contact_email as string) || ''));
  const relationship = rel0 ? { name: (rel0.contact_name as string) ?? null, frequency: (rel0.interaction_frequency as string) ?? null } : null;

  // Two-hop deal awareness: once the initiative resolves, pull the DEAL's items by initiative too (not just
  // this exact person's) — matches canonical OR a known variant (grounded, not a keyword).
  const dealLabels = new Set([initiative.label, ...initiative.variants].filter(Boolean).map((s) => String(s).toLowerCase()));
  const onDeal = (label: unknown): boolean => !!label && dealLabels.has(String(label).toLowerCase());

  const commitById = new Map<string, Record<string, unknown>>();
  for (const c of corpus.commits) if (isPerson(c.counterparty as string) || onDeal(c.initiative)) commitById.set(String(c.id), c);
  const openCommitments = [...commitById.values()].slice(0, L.commitments)
    .map((c) => ({ id: String(c.id), description: String(c.description || 'Commitment'), direction: String(c.direction || 'you_owe'), dueDate: (c.due_date as string) ?? null }));

  const recentMeetings = corpus.past
    .filter((r) => onDeal(r.initiative) || ((r.attendees as Attendee[]) ?? []).some((a) => isPerson(attendeeStr(a))))
    .slice(0, L.meetings)
    .map((m) => ({ id: String(m.id), title: String(m.title || 'Meeting'), date: (m.start_time as string) ?? null }));

  const upcomingMeetings = corpus.future
    .filter((r) => ((r.attendees as Attendee[]) ?? []).some((a) => isPerson(attendeeStr(a))))
    .slice(0, L.meetings)
    .map((m) => ({ id: String(m.id), title: String(m.title || 'Meeting'), startTime: (m.start_time as string) ?? null }));

  const recentThreads = corpus.inbox
    .filter((it) => {
      if (opts.excludeItemId && String(it.id) === opts.excludeItemId) return false;
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      return isPerson((sd.from_address as string) || (sd.from as string) || (sd.from_name as string));
    })
    .slice(0, L.threads)
    .map((it) => {
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      return { itemId: String(it.id), subject: String(it.work_title || sd.subject || '(no subject)'), lastAt: (sd.received_at as string) ?? (it.created_at as string) ?? null };
    });

  return { people: emails.map((e, i) => ({ email: e, name: names[i] ?? null })), initiative, relationship, openCommitments, recentMeetings, upcomingMeetings, recentThreads };
}

export async function buildEntityContext(supabase: SupabaseClient, userId: string, opts: BuildOpts): Promise<EntityContext> {
  const emails = [...new Set(opts.emails.map(emailOf).filter(Boolean) as string[])];
  const corpus = await fetchContextCorpus(supabase, userId, emails);
  return assembleFromCorpus(corpus, supabase, userId, opts);
}

// BATCHED: one corpus fetch, N cheap assemblies. Keyed by the caller's `key`. This is what the sync pipeline
// uses to enrich every envelope in a batch without N×5 table reads.
export async function buildEntityContextMap(
  supabase: SupabaseClient,
  userId: string,
  sets: Array<{ key: string } & BuildOpts>,
): Promise<Map<string, EntityContext>> {
  const out = new Map<string, EntityContext>();
  if (!sets.length) return out;
  const scopeEmails = [...new Set(sets.flatMap((s) => s.emails.map(emailOf).filter(Boolean) as string[]))];
  const corpus = await fetchContextCorpus(supabase, userId, scopeEmails);
  await Promise.all(sets.map(async (s) => { out.set(s.key, await assembleFromCorpus(corpus, supabase, userId, s)); }));
  return out;
}

// A COMPACT prompt block — the model reasons over this. Kept terse (token-bounded) since it rides every
// classification call. Returns '' when there's genuinely no neighborhood (a brand-new contact).
export function renderEntityContextForPrompt(ctx: EntityContext): string {
  const lines: string[] = [];
  if (ctx.initiative.label) lines.push(`Deal/relationship: ${ctx.initiative.label}${ctx.initiative.variants.length ? ` (also seen as: ${ctx.initiative.variants.join('; ')})` : ''}`);
  if (ctx.relationship?.frequency) lines.push(`Contact cadence: ${ctx.relationship.frequency}`);
  if (ctx.openCommitments.length) lines.push(`Open commitments with them:\n${ctx.openCommitments.map((c) => `  - ${c.direction === 'awaiting' ? 'they owe' : 'you owe'}: ${c.description}${c.dueDate ? ` (due ${c.dueDate})` : ''}`).join('\n')}`);
  if (ctx.recentMeetings.length) lines.push(`Recent meetings: ${ctx.recentMeetings.map((m) => `${m.title}${m.date ? ` (${m.date.slice(0, 10)})` : ''}`).join('; ')}`);
  if (ctx.upcomingMeetings.length) lines.push(`Upcoming meetings: ${ctx.upcomingMeetings.map((m) => `${m.title}${m.startTime ? ` (${m.startTime.slice(0, 10)})` : ''}`).join('; ')}`);
  if (ctx.recentThreads.length) lines.push(`Other recent threads with them: ${ctx.recentThreads.map((t) => t.subject).join('; ')}`);
  if (!lines.length) return '';
  return `[RELATIONSHIP CONTEXT — what you already know about this sender/thread; reason WITH it]\n${lines.join('\n')}`;
}

// A COMPACT one-line signal for the classifier/rule GATES (batchClassifyEmails, batchMatchRules) — they run
// on many envelopes at once, so this is deliberately terse (~15–30 tok).
//
// CONSERVATIVE by design: a false "known relationship" on a newsletter is worse than a miss — it could
// rescue genuine noise. So the gate signal fires ONLY on a GROUNDED active deal (an initiative resolved to
// this thread's participants) — the strong, entity-resolved signal. Open commitments / meetings only ENRICH
// it; they never fire it alone (a loose name-token commitment match, or ≥2 newsletters from one sender, would
// otherwise produce a false positive). The RICHER matching still lives in renderEntityContextForPrompt for
// Phase 2 / the human rail, where a stray fact is low-stakes and the model reasons over it.
export function renderRelationshipSignal(ctx: EntityContext): string | null {
  if (!ctx.initiative.label) return null;
  const parts: string[] = [`active deal "${ctx.initiative.label}"`];
  if (ctx.openCommitments.length) parts.push(`${ctx.openCommitments.length} open commitment${ctx.openCommitments.length > 1 ? 's' : ''}`);
  if (ctx.recentMeetings.length) parts.push('met recently');
  else if (ctx.upcomingMeetings.length) parts.push('meeting upcoming');
  return `known relationship — ${parts.join(', ')}`;
}
