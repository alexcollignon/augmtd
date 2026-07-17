// The INITIATIVE BRAIN (S1 — read-only ledger + synthesized state). The initiative is the primary structure;
// emails, meetings, sent mail, commitments are EVENTS on it. This derives the per-initiative event ledger
// (who did what, when — from the atoms we already store) + a grounded synthesized state (where it stands ·
// momentum · whoOwes · stage). No next-move yet (S2), no surface (S4). Generic: nothing assumes a sales shape.

import type { SupabaseClient } from '@supabase/supabase-js';
import { coerceUnderstanding, normalizeInitiative } from '@/lib/inbox/item-understanding';
import { isAutomatedSender } from '@/lib/inbox/automated';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';

const emailOf = (s?: string | null): string | null =>
  String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
const domainOf = (s?: string | null): string | null => { const e = emailOf(s); return e ? e.split('@')[1] || null : null; };
const FREE = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com', 'zoho.com', 'pm.me']);
const personName = (s?: string | null): string => String(s || '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || (emailOf(s) || 'someone');

export type LedgerEvent = { kind: 'email_in' | 'email_out' | 'meeting' | 'commitment'; at: string; actor: string; counterparty: string | null; summary: string; ref: string };
export type InitiativeState = {
  summary: string;                                   // 1 line: where it stands
  momentum: 'active' | 'needs_you' | 'waiting' | 'gone_quiet' | 'stalled';
  whoOwes: { you: string[]; them: string[] };
  stage: string | null;                              // reasoned, in the initiative's OWN terms (no funnel)
  blocking: string | null;
};
// The single next move for the whole initiative. `kind` is reasoned (grounded in the ledger); owner + gate +
// entityRef are graded DETERMINISTICALLY. Execution (S5) reuses the prepare→approve→execute engine.
export type NextMove = {
  kind: 'reply' | 'send' | 'followup' | 'none';
  title: string;
  owner: 'you' | 'system' | 'coworker';   // AUGMTD (system) prepares comms; you approve/send
  irreversible: boolean;                   // culminates in a send → approval gate
  entityRef: string | null;                // the atom to act on (inbox:<id> / commit:<id>)
  reason: string;
};
// The cheap assembly (no AI) — ledger + people + sig.
export type LedgerAssembly = {
  key: string; label: string;
  people: { external: string[]; internal: string[] };
  ledger: LedgerEvent[];
  quietDays: number | null;
  sig: string;                 // atom signature (event count + freshest timestamp) — change-detection for S3
};
export type InitiativeBrain = LedgerAssembly & {
  state: InitiativeState | null;
  nextMove: NextMove | null;
};

async function corporateDomains(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const [{ data: prof }, { data: conns }] = await Promise.all([
    supabase.from('profiles').select('email').eq('id', userId).maybeSingle(),
    supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
  ]);
  const s = new Set<string>();
  const add = (a?: string | null) => { const d = domainOf(a); if (d && !FREE.has(d)) s.add(d); };
  add((prof as { email?: string } | null)?.email);
  for (const c of (conns ?? []) as Array<{ metadata: { email?: string } | null; provider_account_id?: string | null }>) add(c.metadata?.email || c.provider_account_id);
  return s;
}

const daysBetween = (a: string, b: number) => Math.floor((b - new Date(a).getTime()) / 86400000);

// The user's own name (cached) — so the synthesis refers to them as "you", never third-person by name.
const nameMemo = new Map<string, { at: number; name: string | null }>();
async function getUserName(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const c = nameMemo.get(userId);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.name;
  let name: string | null = null;
  try { const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(); name = (data as { full_name?: string } | null)?.full_name?.trim() || null; } catch { /* non-fatal */ }
  nameMemo.set(userId, { at: Date.now(), name });
  return name;
}

// The shared corpus — the user's initiative-bearing atoms fetched ONCE. A batch refresh fetches this once and
// assembles N initiatives from memory (vs N × the bulk fetch), so refreshing all active initiatives on a Home
// load is cheap. `sentByThread` indexes the user's sent mail so email_out events resolve without a per-item query.
export type BrainCorpus = {
  inbox: Array<Record<string, unknown>>;
  meetings: Array<Record<string, unknown>>;
  commits: Array<Record<string, unknown>>;
  sentByThread: Map<string, Array<Record<string, unknown>>>;
  corp: Set<string>;
};

export async function fetchBrainCorpus(supabase: SupabaseClient, userId: string): Promise<BrainCorpus> {
  const [{ data: inbox }, { data: mtgs }, { data: commits }, { data: sent }, corp] = await Promise.all([
    supabase.from('inbox_items').select('id, work_title, source_data, created_at').eq('user_id', userId).eq('source', 'email').not('source_data->understanding', 'is', null).order('created_at', { ascending: false }).limit(1000),
    supabase.from('meeting_transcripts').select('id, title, start_time, attendees, initiative').eq('user_id', userId).not('initiative', 'is', null).order('start_time', { ascending: false }).limit(400),
    supabase.from('commitments').select('id, description, counterparty, direction, due_date, initiative, created_at, status').eq('user_id', userId).not('initiative', 'is', null).limit(600),
    supabase.from('emails').select('id, subject, received_at, to_addresses, is_from_user, thread_id').eq('user_id', userId).eq('is_from_user', true).order('received_at', { ascending: false }).limit(1000),
    corporateDomains(supabase, userId),
  ]);
  const sentByThread = new Map<string, Array<Record<string, unknown>>>();
  for (const s of (sent ?? []) as Array<Record<string, unknown>>) { const t = s.thread_id as string; if (!t) continue; const arr = sentByThread.get(t) ?? []; arr.push(s); sentByThread.set(t, arr); }
  return { inbox: (inbox ?? []) as Array<Record<string, unknown>>, meetings: (mtgs ?? []) as Array<Record<string, unknown>>, commits: (commits ?? []) as Array<Record<string, unknown>>, sentByThread, corp };
}

// Assemble the initiative's ledger + people + sig — the CHEAP part (no AI). Pass a shared `corpus` for a batch
// (no per-initiative fetch); omit it for a one-off (fetches its own corpus). The store sig-checks this before
// spending an AI call on the synthesis.
export async function assembleInitiativeLedger(supabase: SupabaseClient, userId: string, initiativeKey: string, corpus?: BrainCorpus): Promise<LedgerAssembly | null> {
  const key = normalizeInitiative(initiativeKey)?.replace(/\s+/g, '') || initiativeKey.toLowerCase().replace(/\s+/g, '');
  const matches = (label: unknown): boolean => {
    const k = normalizeInitiative(label as string)?.replace(/\s+/g, '') || '';
    return !!k && k === key;
  };
  const c = corpus ?? await fetchBrainCorpus(supabase, userId);
  const corp = c.corp;

  // Filter atoms to this initiative.
  const items = c.inbox.filter((it) => matches(coerceUnderstanding((it.source_data as Record<string, unknown>)?.understanding)?.initiative));
  const meetings = c.meetings.filter((m) => matches((m as { initiative?: string }).initiative));
  const commitments = c.commits.filter((c) => matches((c as { initiative?: string }).initiative));
  if (!items.length && !meetings.length && !commitments.length) return null;

  const label = (coerceUnderstanding((items[0]?.source_data as Record<string, unknown>)?.understanding)?.initiative as string)
    || (meetings[0] as { initiative?: string })?.initiative || (commitments[0] as { initiative?: string })?.initiative || initiativeKey;

  // Sent mail on these threads (email_out — "you sent"): from the shared index, no query.
  const threadIds = [...new Set(items.map((it) => (it.source_data as Record<string, unknown>)?.thread_id as string).filter(Boolean))];
  const sent: Array<Record<string, unknown>> = threadIds.flatMap((t) => c.sentByThread.get(t) ?? []);

  // ── People graph (who's who) ──
  const external = new Set<string>(), internal = new Set<string>();
  const addPerson = (raw?: string | null, name?: string | null) => {
    // Skip automated/no-reply/notification addresses — a Notion/Canvas notifier is not a "person" on the deal.
    if (isAutomatedSender(emailOf(raw), name ?? null, null)) return;
    const nm = personName(name || raw); if (!nm || nm === 'someone') return;
    const d = domainOf(raw);
    if (d && corp.has(d)) internal.add(nm); else external.add(nm);
  };
  for (const it of items) { const sd = it.source_data as Record<string, unknown>; addPerson((sd.from_address as string) || (sd.from as string), sd.from_name as string); }
  for (const m of meetings) for (const a of ((m.attendees as Array<{ email?: string; name?: string } | string>) ?? [])) addPerson(typeof a === 'string' ? a : a?.email, typeof a === 'string' ? null : a?.name);
  for (const c of commitments) if (c.counterparty) addPerson(c.counterparty as string, c.counterparty as string);

  // ── The event LEDGER (who did what, when) ──
  const ledger: LedgerEvent[] = [];
  for (const it of items) {
    const sd = it.source_data as Record<string, unknown>;
    const who = personName((sd.from_name as string) || (sd.from_address as string));
    ledger.push({ kind: 'email_in', at: (sd.received_at as string) || (it.created_at as string), actor: who, counterparty: who, summary: String(it.work_title || sd.subject || 'Email'), ref: `inbox:${it.id}` });
  }
  for (const s of sent) ledger.push({ kind: 'email_out', at: (s.received_at as string) || '', actor: 'you', counterparty: personName(((s.to_addresses as string[]) ?? [])[0]), summary: String(s.subject || 'Reply'), ref: `email:${s.id}` });
  for (const m of meetings) ledger.push({ kind: 'meeting', at: (m.start_time as string) || '', actor: 'meeting', counterparty: null, summary: String(m.title || 'Meeting'), ref: `meeting:${m.id}` });
  for (const c of commitments) {
    const owes = String(c.direction || 'you_owe') === 'awaiting' ? 'they owe' : 'you owe';
    ledger.push({ kind: 'commitment', at: (c.created_at as string) || '', actor: owes === 'you owe' ? 'you' : personName(c.counterparty as string), counterparty: c.counterparty ? personName(c.counterparty as string) : null, summary: `${owes}: ${c.description}${c.due_date ? ` (due ${c.due_date})` : ''}`, ref: `commit:${c.id}` });
  }
  ledger.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());

  // quietDays = days since the last real touch (email/meeting, not a derived commitment row).
  const now = Date.now();
  const touches = ledger.filter((e) => e.kind !== 'commitment' && e.at).map((e) => e.at);
  const quietDays = touches.length ? Math.max(0, daysBetween(touches.sort().slice(-1)[0], now)) : null;

  const sig = `${ledger.length}:${ledger[0]?.at ?? ''}`;
  return { key, label, people: { external: [...external].slice(0, 12), internal: [...internal].slice(0, 12) }, ledger: ledger.slice(0, 40), quietDays, sig };
}

// The SYNTHESIS (the AI cost) — separated so the store can sig-check the cheap assembly first and skip this
// when nothing moved. Returns the state + the resolved next move.
export async function synthesizeBrain(supabase: SupabaseClient, userId: string, a: LedgerAssembly): Promise<{ state: InitiativeState | null; nextMove: NextMove | null }> {
  const synth = await synthesize(supabase, userId, a.label, a.ledger, a.people, a.quietDays).catch(() => null);
  const state = synth?.state ?? null;
  let nextMove: NextMove | null = null;
  const nm = synth?.nextMove;
  if (nm && nm.kind !== 'none' && nm.title) {
    const latestInbound = a.ledger.find((e) => e.kind === 'email_in')?.ref ?? null;
    const youOweCommit = a.ledger.find((e) => e.kind === 'commitment' && e.actor === 'you')?.ref ?? null;
    const entityRef = nm.kind === 'send' ? (youOweCommit ?? latestInbound) : latestInbound;
    nextMove = { kind: nm.kind, title: String(nm.title).slice(0, 120), owner: 'system', irreversible: true, entityRef, reason: String(nm.reason || '').slice(0, 140) };
  }
  return { state, nextMove };
}

// Full read-only brain = assemble (cheap) + synthesize (AI).
export async function buildInitiativeBrain(supabase: SupabaseClient, userId: string, initiativeKey: string): Promise<InitiativeBrain | null> {
  const a = await assembleInitiativeLedger(supabase, userId, initiativeKey);
  if (!a) return null;
  const { state, nextMove } = await synthesizeBrain(supabase, userId, a);
  return { ...a, state, nextMove };
}

// ONE grounded synthesis over the ledger → where it stands. Reasoned in the initiative's own terms; never a
// funnel; never invents facts not in the ledger. classification tier (cheap, reliable).
// Strip a ```json fence / prose wrapper → the outer JSON object. Bedrock-Haiku ignores response_format and
// fences its JSON; do this before parsing (same fix as name-bundles.ts).
function unfence(s: string): string {
  let t = (s || '').trim();
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (f) t = f[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

async function synthesize(supabase: SupabaseClient, userId: string, label: string, ledger: LedgerEvent[], people: { external: string[]; internal: string[] }, quietDays: number | null): Promise<{ state: InitiativeState | null; nextMove: { kind: NextMove['kind']; title: string; reason: string } | null }> {
  // MUST be the non-reasoning `classification` tier — the `summarization`/`planning` tiers on bedrock_optimised
  // are REASONING models (gpt-oss-120b / Kimi) that burn max_tokens in the reasoning channel on this rich
  // prompt → empty content → null (the documented item-plan / brief trap).
  const { client, model } = await getAIClient(userId, 'classification', supabase);
  const userName = await getUserName(supabase, userId);
  const recent = ledger.slice(0, 24).map((e) => `${(e.at || '').slice(0, 10)} · ${e.kind} · ${e.actor}${e.counterparty && e.counterparty !== e.actor ? `→${e.counterparty}` : ''}: ${e.summary}`).join('\n');
  const content =
    `You maintain the live STATE of an initiative for the user (its owner) and pick the single NEXT MOVE. An initiative is any bounded body of work — a client engagement, a hiring round, a launch, a migration, an internal program, a personal project. Do NOT assume a sales pipeline or fixed stages.\n\n` +
    (userName ? `The user (owner) is ${userName} — always refer to them as "you", NEVER by name; if the ledger names ${userName}, that is YOU.\n\n` : '') +
    `Initiative: ${label}\nExternal people: ${people.external.join(', ') || '(none)'}\nInternal team: ${people.internal.join(', ') || '(none)'}\n` +
    `Days since last real touch: ${quietDays ?? 'unknown'}\n\n` +
    `Event ledger (most recent first — this is ALL you know; do not invent beyond it):\n${recent || '(empty)'}\n\n` +
    `Return ONLY JSON, grounded strictly in the ledger:\n` +
    `{"summary":"<=15 words: where it stands right now, factual",` +
    `"momentum":"active|needs_you|waiting|gone_quiet|stalled",` +
    `"whoOwes":{"you":["short items the USER owes"],"them":["short items OTHERS owe the user"]},` +
    `"stage":"<=4 words in the initiative's OWN terms, or null",` +
    `"blocking":"<=12 words if something concrete is in the way, else null",` +
    `"next_move":{"kind":"reply|send|followup|none","title":"<=10 words, imperative — the single next thing the USER should do","reason":"<=15 words, why now"}}\n` +
    `momentum: needs_you = the user owes the next step; waiting = waiting on others; active = moving; gone_quiet = no touch in a while with something open; stalled = open + no path.\n` +
    `next_move — pick ONE, honestly: "reply" = the user owes a response on a live thread; "send" = the user owes a deliverable (doc/offer/info) to prepare + send; "followup" = the user is waiting on someone who's gone quiet, nudge them; "none" = nothing the user owes right now (awareness only — do NOT invent a move).`;
  const res = await aiCreate(client, { model, response_format: { type: 'json_object' as const }, max_tokens: 600, temperature: 0, messages: [{ role: 'user', content }] });
  const p = parseModelJSON<Partial<InitiativeState> & { next_move?: { kind?: string; title?: string; reason?: string } }>(unfence(res.choices?.[0]?.message?.content || ''), {});
  if (!p.summary) return { state: null, nextMove: null };
  const mo = ['active', 'needs_you', 'waiting', 'gone_quiet', 'stalled'].includes(p.momentum as string) ? (p.momentum as InitiativeState['momentum']) : 'active';
  const state: InitiativeState = {
    summary: String(p.summary).slice(0, 200), momentum: mo,
    whoOwes: { you: (p.whoOwes?.you ?? []).slice(0, 5).map(String), them: (p.whoOwes?.them ?? []).slice(0, 5).map(String) },
    stage: p.stage ? String(p.stage).slice(0, 40) : null,
    blocking: p.blocking ? String(p.blocking).slice(0, 120) : null,
  };
  const mk = p.next_move?.kind;
  const nextMove = mk && ['reply', 'send', 'followup', 'none'].includes(mk) && p.next_move?.title
    ? { kind: mk as NextMove['kind'], title: String(p.next_move.title), reason: String(p.next_move.reason || '') }
    : null;
  return { state, nextMove };
}
