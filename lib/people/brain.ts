// The PERSON BRAIN (Step 1 — read-only ledger + synthesized relationship state). Twin of the Initiative Brain
// (lib/initiatives/brain.ts): the person is the entity; emails, meetings, sent mail, commitments are EVENTS
// with them. This derives the per-person interaction LEDGER (deterministic) + a grounded synthesized STATE
// (who they are · where you stand · momentum · whoOwes · cadence) + the ONE relational next touch (Haiku).
//
// PRINCIPLE (same as the initiative brain): assembly is deterministic; the AI only synthesizes the judgment.
// Split assemble (no AI) from synthesize (Haiku) so a `sig` skips the call when nothing moved. Alias-aware
// person matching via lib/projects/identity.ts. Honest "none" — no invented busywork. Refers to the user as
// "you". MUST use the `classification` tier (reasoning tiers burn the budget → empty). Strip ```json fences.

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { isAutomatedSender } from '@/lib/inbox/automated';
import { sameAttendee, canonicalPerson } from '@/lib/projects/identity';

// ── tiny local helpers (kept self-contained; mirrors the initiative brain's private helpers) ──
const emailOf = (s?: string | null): string | null =>
  String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
const domainOf = (s?: string | null): string | null => { const e = emailOf(s); return e ? e.split('@')[1] || null : null; };
const FREE = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com', 'zoho.com', 'pm.me']);
const personName = (s?: string | null): string => String(s || '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || (emailOf(s) || 'someone');
const daysBetween = (a: string, b: number) => Math.floor((b - new Date(a).getTime()) / 86400000);

// ── types ──
export type PersonLedgerEvent = { kind: 'email_in' | 'email_out' | 'meeting' | 'commitment'; at: string; actor: string; counterparty: string | null; summary: string; ref: string };

export type PersonStateData = {
  summary: string;                                              // who they are to you + where you stand
  relationship: 'client' | 'colleague' | 'prospect' | 'vendor' | 'partner' | 'personal' | 'unknown';
  momentum: 'active' | 'waiting_on_them' | 'you_owe' | 'gone_quiet';
  cadence: string | null;                                       // how often you talk + who initiates
  whoOwes: { you: string[]; them: string[] };
  last_touch: { when: string | null; what: string; channel: string } | null;
  style: string | null;                                         // learned comms notes
};
export type PersonNextTouch = { kind: 'reply' | 'followup' | 'none'; title: string; reason: string; entityRef: string | null };

// A seed identifies ONE person to assemble (keyed by email; name carried for alias-aware matching;
// `aliases` = the person ENTITY's full alias set, so a multi-address human assembles ONE ledger).
export type PersonSeed = { key: string; email: string | null; name: string | null; aliases?: string[] };

export type PersonAssembly = {
  key: string; displayName: string | null; emails: string[]; org: string | null; isInternal: boolean;
  initiatives: string[]; ledger: PersonLedgerEvent[]; quietDays: number | null; lastTouchAt: string | null; sig: string;
};
export type PersonBrain = PersonAssembly & { state: PersonStateData | null; nextTouch: PersonNextTouch | null };

// The shared corpus — the user's people-bearing atoms fetched ONCE, so a batch assembles N people from memory
// (vs N × the bulk fetch). NB: unlike the initiative corpus this is NOT filtered by initiative — a person's
// history spans everything, labeled or not.
export type PersonCorpus = {
  inbox: Array<{ id: string; from: string | null; fromName: string | null; subject: string; at: string; initiative: string | null }>;
  sent: Array<{ id: string; to: string[]; subject: string; at: string }>;
  meetings: Array<{ id: string; title: string; at: string; attendees: string[]; initiative: string | null }>;
  commits: Array<{ id: string; description: string; counterparty: string | null; direction: string; created_at: string; initiative: string | null }>;
  contacts: Array<{ email: string; name: string | null; frequency: number }>;
  corp: Set<string>;
  own: Set<string>;   // the user's OWN addresses (login + connected mailboxes) — never a "relationship" with self
};

// The user's corporate domains (for is_internal) AND their own addresses (login + connected mailboxes) —
// both derived from the same one-shot fetch. Own addresses are excluded from the person set (no "relationship
// with yourself" — the bug where a connected mailbox owner became their own person_state row).
async function ownDomainsAndAddresses(supabase: SupabaseClient, userId: string): Promise<{ corp: Set<string>; own: Set<string> }> {
  const [{ data: prof }, { data: conns }] = await Promise.all([
    supabase.from('profiles').select('email, full_name').eq('id', userId).maybeSingle(),
    supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
  ]);
  const corp = new Set<string>(), own = new Set<string>();
  const add = (a?: string | null) => {
    const e = emailOf(a); if (e) own.add(e);
    const d = domainOf(a); if (d && !FREE.has(d)) corp.add(d);
  };
  add((prof as { email?: string } | null)?.email);
  for (const c of (conns ?? []) as Array<{ metadata: { email?: string; name?: string } | null; provider_account_id?: string | null }>) { add(c.metadata?.email || c.provider_account_id); const cn = canonicalPerson(c.metadata?.name || ''); if (cn) own.add(cn.toLowerCase()); }
  // The owner's own NAME (canonical) — so a self-contact under a DIFFERENT address (a connected mailbox owner
  // whose name == the user) is still excluded, not synthesized as "you are <name>".
  const fn = canonicalPerson((prof as { full_name?: string } | null)?.full_name || '');
  if (fn) own.add(fn.toLowerCase());
  return { corp, own };
}

const nameMemo = new Map<string, { at: number; name: string | null }>();
async function getUserName(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const c = nameMemo.get(userId);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.name;
  let name: string | null = null;
  try { const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(); name = (data as { full_name?: string } | null)?.full_name?.trim() || null; } catch { /* non-fatal */ }
  nameMemo.set(userId, { at: Date.now(), name });
  return name;
}

// Normalize a meeting attendee (string | {email,name}) → a matchable identifier string.
const attendeeId = (a: unknown): string => (typeof a === 'string' ? a : ((a as { email?: string; name?: string })?.email || (a as { name?: string })?.name || ''));

/** Fetch the people corpus ONCE. Seeds the person set from relationship_graph + carries the raw atoms. */
export async function fetchPeopleCorpus(supabase: SupabaseClient, userId: string): Promise<PersonCorpus> {
  const [{ data: inbox }, { data: sent }, { data: mtgs }, { data: commits }, { data: contacts }, dom] = await Promise.all([
    supabase.from('inbox_items').select('id, work_title, source_data, created_at').eq('user_id', userId).eq('source', 'email').order('created_at', { ascending: false }).limit(1500),
    supabase.from('emails').select('id, subject, received_at, to_addresses').eq('user_id', userId).eq('is_from_user', true).order('received_at', { ascending: false }).limit(1500),
    supabase.from('meeting_transcripts').select('id, title, start_time, attendees, initiative').eq('user_id', userId).order('start_time', { ascending: false }).limit(400),
    supabase.from('commitments').select('id, description, counterparty, direction, due_date, initiative, created_at, status').eq('user_id', userId).limit(600),
    supabase.from('relationship_graph').select('contact_email, contact_name, interaction_frequency').eq('user_id', userId).limit(1000),
    ownDomainsAndAddresses(supabase, userId),
  ]);
  const { corp, own } = dom;
  const coerceUnd = (sd: Record<string, unknown> | null): string | null => {
    const u = sd?.understanding as { initiative?: string } | null;
    return (u && typeof u.initiative === 'string') ? u.initiative : null;
  };
  return {
    inbox: ((inbox ?? []) as Array<Record<string, unknown>>).map((it) => {
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      return { id: it.id as string, from: (sd.from_address as string) || (sd.from as string) || null, fromName: (sd.from_name as string) || null, subject: String(it.work_title || sd.subject || 'Email'), at: (sd.received_at as string) || (it.created_at as string) || '', initiative: coerceUnd(sd) };
    }),
    sent: ((sent ?? []) as Array<Record<string, unknown>>).map((e) => ({ id: e.id as string, to: (Array.isArray(e.to_addresses) ? (e.to_addresses as string[]) : []), subject: String(e.subject || 'Reply'), at: (e.received_at as string) || '' })),
    meetings: ((mtgs ?? []) as Array<Record<string, unknown>>).map((m) => ({ id: m.id as string, title: String(m.title || 'Meeting'), at: (m.start_time as string) || '', attendees: (Array.isArray(m.attendees) ? (m.attendees as unknown[]).map(attendeeId).filter(Boolean) : []), initiative: (m.initiative as string) || null })),
    commits: ((commits ?? []) as Array<Record<string, unknown>>).map((c) => ({ id: c.id as string, description: String(c.description || ''), counterparty: (c.counterparty as string) || null, direction: String(c.direction || 'you_owe'), created_at: (c.created_at as string) || '', initiative: (c.initiative as string) || null })),
    contacts: ((contacts ?? []) as Array<Record<string, unknown>>).map((c) => ({ email: String(c.contact_email || '').toLowerCase(), name: (c.contact_name as string) || null, frequency: Number(c.interaction_frequency || 0) })),
    corp, own,
  };
}

/** Resolve a raw identifier (email or name) to a person seed, enriched with a display name from contacts. */
export function resolvePersonSeed(corpus: PersonCorpus, idStr: string): PersonSeed | null {
  const email = emailOf(idStr);
  const key = (email || canonicalPerson(idStr) || '').toLowerCase();
  if (!key) return null;
  if (email && corpus.own.has(email)) return null; // the user themselves (own address) — never a "relationship"
  // Prefer a contact's stored display name (matched by email, else alias).
  const contact = email ? corpus.contacts.find((c) => c.email === email) : corpus.contacts.find((c) => c.name && sameAttendee(c.name, idStr));
  const name = contact?.name || (email ? null : personName(idStr));
  // Own NAME guard — a self-contact under a different address (name == the account owner) is still excluded.
  const nameCanon = (canonicalPerson(name || idStr) || '').toLowerCase();
  if (nameCanon && corpus.own.has(nameCanon)) return null;
  return { key, email: email || contact?.email || null, name };
}

/** Assemble ONE person's ledger from the shared corpus — no AI. Returns null when there are no interactions. */
export function assemblePersonLedger(corpus: PersonCorpus, seed: PersonSeed): PersonAssembly | null {
  // "Does this candidate identifier refer to our person?" — alias-aware, against email + name + the
  // entity's full alias set (a human's several addresses assemble ONE ledger).
  const forms = [seed.email, seed.name, ...(seed.aliases ?? [])].filter((s): s is string => !!s);
  const refers = (cand?: string | null): boolean => {
    if (!cand) return false;
    return forms.some((f) => sameAttendee(f, cand));
  };
  const inbox = corpus.inbox.filter((e) => refers(e.from) || refers(e.fromName));
  const sent = corpus.sent.filter((e) => e.to.some((t) => refers(t)));
  const meetings = corpus.meetings.filter((m) => m.attendees.some((a) => refers(a)));
  const commits = corpus.commits.filter((c) => refers(c.counterparty));
  if (!inbox.length && !sent.length && !meetings.length && !commits.length) return null;

  const displayName = seed.name || inbox.find((e) => e.fromName)?.fromName || (seed.email ? personName(seed.email) : null);
  const org = domainOf(seed.email);
  const isInternal = !!org && corpus.corp.has(org);
  const initiatives = [...new Set([...inbox, ...meetings, ...commits].map((x) => (x as { initiative?: string | null }).initiative).filter((s): s is string => !!s))].slice(0, 8);

  const ledger: PersonLedgerEvent[] = [];
  for (const e of inbox) ledger.push({ kind: 'email_in', at: e.at, actor: displayName || 'them', counterparty: 'you', summary: e.subject, ref: `inbox:${e.id}` });
  for (const e of sent) ledger.push({ kind: 'email_out', at: e.at, actor: 'you', counterparty: displayName || 'them', summary: e.subject, ref: `email:${e.id}` });
  for (const m of meetings) ledger.push({ kind: 'meeting', at: m.at, actor: 'meeting', counterparty: null, summary: m.title, ref: `meeting:${m.id}` });
  for (const c of commits) {
    const owes = c.direction === 'awaiting' ? 'they owe' : 'you owe';
    ledger.push({ kind: 'commitment', at: c.created_at, actor: owes === 'you owe' ? 'you' : (displayName || 'them'), counterparty: displayName || 'them', summary: `${owes}: ${c.description}`, ref: `commit:${c.id}` });
  }
  ledger.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());

  const nowMs = Date.now();
  // quietDays = days since the last PAST real touch (email/meeting, not a derived commitment; not a future date).
  const touches = ledger.filter((e) => e.kind !== 'commitment' && e.at && new Date(e.at).getTime() <= nowMs).map((e) => e.at);
  const quietDays = touches.length ? Math.max(0, daysBetween(touches.sort().slice(-1)[0], nowMs)) : null;
  const lastTouchAt = ledger.find((e) => e.at && new Date(e.at).getTime() <= nowMs)?.at ?? null;
  const sig = `${ledger.length}:${ledger[0]?.at ?? ''}`;

  return { key: seed.key, displayName, emails: seed.email ? [seed.email] : [], org, isInternal, initiatives, ledger: ledger.slice(0, 40), quietDays, lastTouchAt, sig };
}

/** The SYNTHESIS (the AI cost) — separated so the store can sig-check the cheap assembly first and skip this.
 *  Routed by SHAPE (aiCall {output:'json'}) — fence-stripping, budgets, and the reasoning-model trap are the
 *  router's job now, not this call site's. */
export async function synthesizePerson(supabase: SupabaseClient, userId: string, a: PersonAssembly): Promise<{ state: PersonStateData | null; nextTouch: PersonNextTouch | null }> {
  const userName = await getUserName(supabase, userId);
  const recent = a.ledger.slice(0, 24).map((e) => `${(e.at || '').slice(0, 10)} · ${e.kind} · ${e.actor}${e.counterparty && e.counterparty !== e.actor ? `→${e.counterparty}` : ''}: ${e.summary}`).join('\n');
  const content =
    `You maintain the live RELATIONSHIP state between the user (its owner) and ONE person. Ground strictly in the ledger of their interactions — never invent beyond it.\n\n` +
    (userName ? `The user (owner) is ${userName} — always refer to them as "you", NEVER by name; if the ledger names ${userName}, that is YOU.\n\n` : '') +
    `Person: ${a.displayName || a.key}${a.org ? ` (${a.org})` : ''}${a.isInternal ? ' — an INTERNAL colleague (same organisation as you)' : ''}\n` +
    `Shared initiatives: ${a.initiatives.join(', ') || '(none)'}\n` +
    `Days since last contact: ${a.quietDays ?? 'unknown'}\n\n` +
    `Interaction ledger (most recent first — this is ALL you know):\n${recent || '(empty)'}\n\n` +
    `Return ONLY JSON, grounded strictly in the ledger:\n` +
    `{"summary":"<=15 words: who they are to you + where you stand right now, factual",` +
    `"relationship":"client|colleague|prospect|vendor|partner|personal|unknown",` +
    `"momentum":"active|waiting_on_them|you_owe|gone_quiet",` +
    `"cadence":"<=12 words: how often you talk + who usually initiates, or null",` +
    `"whoOwes":{"you":["short things YOU owe them"],"them":["short things THEY owe you"]},` +
    `"last_touch":{"when":"YYYY-MM-DD or null","what":"<=8 words","channel":"email|meeting"},` +
    `"style":"<=12 words on how they communicate (brevity/tone), or null",` +
    `"next_touch":{"kind":"reply|followup|none","title":"<=10 words, imperative — the single next thing YOU should do with them","reason":"<=15 words, why now"}}\n` +
    `momentum: you_owe = you owe the next step; waiting_on_them = waiting on them; active = healthy back-and-forth; gone_quiet = no contact in a while with something open.\n` +
    `next_touch — pick ONE, honestly: "reply" = you owe a response on a live thread; "followup" = they've gone quiet and something is open, nudge them; "none" = nothing you owe right now (do NOT invent a move).`;
  const res = await aiCall<Partial<PersonStateData> & { next_touch?: { kind?: string; title?: string; reason?: string } }>({
    userId, supabase, shape: { output: 'json' }, prompt: content, maxTokens: 600, temperature: 0, source: 'brain_synthesis',
  }).catch(() => null);
  const p = res?.json ?? {};
  if (!p.summary) return { state: null, nextTouch: null };
  const rel = ['client', 'colleague', 'prospect', 'vendor', 'partner', 'personal', 'unknown'].includes(p.relationship as string) ? (p.relationship as PersonStateData['relationship']) : 'unknown';
  const mo = ['active', 'waiting_on_them', 'you_owe', 'gone_quiet'].includes(p.momentum as string) ? (p.momentum as PersonStateData['momentum']) : 'active';
  const state: PersonStateData = {
    summary: String(p.summary).slice(0, 200), relationship: rel, momentum: mo,
    cadence: p.cadence ? String(p.cadence).slice(0, 100) : null,
    whoOwes: { you: (p.whoOwes?.you ?? []).slice(0, 5).map(String), them: (p.whoOwes?.them ?? []).slice(0, 5).map(String) },
    last_touch: p.last_touch && typeof p.last_touch === 'object' ? { when: p.last_touch.when ? String(p.last_touch.when).slice(0, 10) : null, what: String(p.last_touch.what || '').slice(0, 80), channel: String(p.last_touch.channel || 'email') } : null,
    style: p.style ? String(p.style).slice(0, 120) : null,
  };
  const nt = p.next_touch;
  let nextTouch: PersonNextTouch | null = null;
  if (nt && ['reply', 'followup', 'none'].includes(nt.kind as string) && nt.kind !== 'none' && nt.title) {
    // Deterministic entityRef: the latest inbound email to act on.
    const latestInbound = a.ledger.find((e) => e.kind === 'email_in')?.ref ?? null;
    nextTouch = { kind: nt.kind as PersonNextTouch['kind'], title: String(nt.title).slice(0, 120), reason: String(nt.reason || '').slice(0, 140), entityRef: latestInbound };
  }
  return { state, nextTouch };
}

// Full read-only person brain = assemble (cheap) + synthesize (AI). Used by one-off reads / smoke.
export async function buildPersonBrain(supabase: SupabaseClient, userId: string, seed: PersonSeed, corpus?: PersonCorpus): Promise<PersonBrain | null> {
  const c = corpus ?? await fetchPeopleCorpus(supabase, userId);
  const a = assemblePersonLedger(c, seed);
  if (!a) return null;
  const { state, nextTouch } = await synthesizePerson(supabase, userId, a);
  return { ...a, state, nextTouch };
}

// Whether a raw identifier is worth a person row (skip automated/no-reply senders — they are not people).
export function isRealPerson(idStr: string, name?: string | null): boolean {
  return !isAutomatedSender(emailOf(idStr), name ?? null, null);
}
