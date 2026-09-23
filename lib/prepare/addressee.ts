// ════════════════════════════════════════════════════════════════════════════════════════════════
// TRUE ADDRESSEES (stabilization W7.3, Sep 23 — docs/laws-registry.md `true-addressees`).
//
// Found live (owner account, a meeting-born commitment): the pass pooled "Nudge — <the user's own
// first name>" — the drafter was handed the commitment's counterparty, which named the USER before
// the self-party repair — and the room served "Dear <user>…" with an empty To. Two defects, one law:
//
//   (a) WHO A DRAFT IS FOR is decided ONCE, by ONE ladder, and STAMPED on the draft at production:
//         counterparty → the email source's other party → the MEETING's attendees minus the user
//         → the linked entity's people.
//       Compose (`/api/compose/draft`), the pass's nudge / doc-send / paste-pack lanes and the
//       steer redraft all ask this module; none resolves a recipient of its own.
//       Nothing resolves ⇒ NO addressee — the card asks "who should this go to?" and offers the
//       candidates the ladder saw; it never ships a placeholder address as if it were addressed.
//       The entity rung ADDRESSES only when it reduces to ONE external person: a project's people
//       fingerprint accumulates everyone it ever touched, so several candidates are SUGGESTIONS.
//
//   (b) A DRAFT ADDRESSED TO THE WRONG PERSON IS NOT LIVE. THE ONE READER (lib/prepare/read.ts)
//       withdraws a draft whose addressee denotes the USER, or differs from the item's CURRENT
//       counterparty (a truth-floor twin of `falseClaim`) — and the existing re-prepare trip
//       replaces it. Legacy unstamped nudges carry their addressee in their title ("Nudge — X"),
//       which the writer derived from the same field — read as a name-only addressee.
//
// PURE HALF (the ladder + the withdrawal predicate) is exported for tests/unit and the gate; the
// async loader only gathers the rungs' facts (bounded SELECTs, zero AI).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { denotesUser, partyDisplay, type UserForms } from '@/lib/commitments/extraction-truth';
import { sameAttendee, nameTokens, emailLocalpart } from '@/lib/projects/identity';
import { parseWho, findPersonEntity, type PersonEntity } from '@/lib/entities/people';
import { isEmail, normalizeEmail, firstEmailIn } from '@/lib/core/email';

export type AddresseeVia = 'counterparty' | 'email_source' | 'meeting' | 'entity' | 'sender' | 'title';

/** Who a prepared message is FOR — stamped on the draft at production (`metadata.addressee` on a pool
 *  row, `addressee` on a source_data draft). Name-only is a real state (the card asks for the email). */
export type Addressee = { name: string | null; email: string | null; via: AddresseeVia };

export type AddresseeResolution = {
  /** The one person the words greet — null when nothing resolves (the card asks). */
  addressee: Addressee | null;
  /** Everyone the message goes To (a meeting follow-up addresses every other attendee). */
  recipients: Addressee[];
  /** Candidates the ladder SAW but may not claim (several people on a project) — offered, never sent. */
  suggestions: Addressee[];
};

export type AddresseeFacts = {
  counterparty: string | null;
  /** The email the commitment was born from: its sender + recipients, and whether the USER sent it. */
  emailSource: { fromAddress: string | null; fromName: string | null; to: string[]; isFromUser: boolean } | null;
  /** Raw attendee lists (meeting_transcripts.attendees + its calendar event's attendees). */
  meetingAttendees: unknown[];
  /** The linked entity's people fingerprint (work_entities.people) — flat strings. */
  entityPeople: string[];
  /** The person registry, for name ↔ address pairing (optional; pure over a loaded list). */
  registry?: PersonEntity[];
  /** The item's own words — ranks entity suggestions by an organisation it names. */
  title?: string | null;
  user: UserForms;
  /** The user's AUTHORITATIVE addresses (profile + connected mailboxes) — the colleague-domain
   *  exclusion reads these, never the self person entity's aliases (found live: a self entity had
   *  absorbed a CLIENT's alias, which would have filed a whole client domain as "colleagues").
   *  Absent → falls back to the address-shaped aliases. */
  userAddresses?: string[];
};

/** Public mail providers — a shared domain here says nothing about who is a colleague. */
const PUBLIC_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'gmx.de', 'mail.com']);

// Diacritics ("Léa" is "Lea") are folded by THE ONE shared normalizer now (lib/projects/identity
// foldAccents, W7.5) — the local fold this law carried in W7.3 retired into it.

const domainOf = (email: string): string | null => /@([^@\s>]+)$/.exec(email.trim().toLowerCase())?.[1] ?? null;

/** Does this person form denote the user (name, alias or any of their addresses)? */
export function isUserForm(who: string | null | undefined, user: UserForms): boolean {
  const s = String(who ?? '').trim();
  if (!s) return false;
  const { email, name } = parseWho(s);
  return (!!email && denotesUser(email, user)) || (!!name && denotesUser(name, user));
}

/** The display name for an addressee (name, else the address). */
export function addresseeLabel(a: Pick<Addressee, 'name' | 'email'> | null | undefined): string | null {
  if (!a) return null;
  return (a.name && a.name.trim()) || (a.email && a.email.trim()) || null;
}

/** The greeting string the drafter is told ("Sam Rivera", "Sam and Kim", "Sam, Kim and 2 others"). */
export function recipientsLabel(list: Array<Pick<Addressee, 'name' | 'email'>>): string | null {
  const names = list.map(addresseeLabel).filter((x): x is string => !!x);
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 === 1 ? '' : 's'}`;
}

/** One raw attendee (string or {name,email,displayName}) → an addressee, or null. */
function attendeeOf(raw: unknown, via: AddresseeVia): Addressee | null {
  if (typeof raw === 'string') {
    const { email, name } = parseWho(raw);
    if (!email && !name) return null;
    return { name: name ?? null, email: email ? normalizeEmail(email) : null, via };
  }
  const o = (raw ?? {}) as { email?: unknown; name?: unknown; displayName?: unknown };
  const email = typeof o.email === 'string' && isEmail(o.email.trim()) ? normalizeEmail(o.email) : null;
  const name = String(o.name ?? o.displayName ?? '').trim() || null;
  if (!email && !name) return null;
  return { name, email, via };
}

/** Pair a bare address with the registry's name for it (and vice versa). Pure over a loaded list. */
function withRegistry(a: Addressee, registry: PersonEntity[] | undefined): Addressee {
  if (!registry?.length) return a;
  if (a.email && !a.name) {
    const p = findPersonEntity(registry, a.email, null);
    if (p?.name && !isEmail(p.name)) return { ...a, name: p.name };
  }
  if (a.name && !a.email) {
    const p = findPersonEntity(registry, null, a.name);
    const alias = p?.aliases.find((x) => isEmail(x));
    if (alias) return { ...a, email: normalizeEmail(alias) };
  }
  return a;
}

/** Is this addressee the user? (any form) */
export function addresseeIsUser(a: Pick<Addressee, 'name' | 'email'>, user: UserForms): boolean {
  return (!!a.email && denotesUser(a.email, user)) || (!!a.name && denotesUser(a.name, user));
}

/** Two person forms, same human? Address equality first, else the shared alias-aware matcher. */
function samePerson(a: Pick<Addressee, 'name' | 'email'>, b: Pick<Addressee, 'name' | 'email'>): boolean {
  if (a.email && b.email) return normalizeEmail(a.email) === normalizeEmail(b.email);
  const x = a.name || a.email, y = b.name || b.email;
  return !!x && !!y && sameAttendee(x, y);
}

const dedupe = (list: Addressee[]): Addressee[] => {
  const out: Addressee[] = [];
  for (const a of list) {
    const i = out.findIndex((b) => samePerson(a, b));
    if (i < 0) out.push(a);
    else if (!out[i].email && a.email) out[i] = { ...out[i], email: a.email };
    else if (!out[i].name && a.name) out[i] = { ...out[i], name: a.name };
  }
  return out;
};

/**
 * THE LADDER — pure. counterparty → email source's other party → meeting attendees minus the user →
 * the linked entity's people (addresses only when it reduces to ONE external person).
 */
export function resolveAddressee(f: AddresseeFacts): AddresseeResolution {
  const none: AddresseeResolution = { addressee: null, recipients: [], suggestions: [] };
  const reg = f.registry;
  const meeting = dedupe(f.meetingAttendees.map((r) => attendeeOf(r, 'meeting')).filter((a): a is Addressee => !!a)
    .filter((a) => !addresseeIsUser(a, f.user)));

  // 1 · THE COUNTERPARTY — the extraction's own named other party (never the user: the self-party law).
  const cp = String(f.counterparty ?? '').trim();
  if (cp && !isUserForm(cp, f.user)) {
    const { email, name } = parseWho(cp);
    let a: Addressee = { name: name ? (partyDisplay(cp) ?? name) : null, email: email ? normalizeEmail(email) : null, via: 'counterparty' };
    a = withRegistry(a, reg);
    // A name-only counterparty finds its address among the people the source itself names.
    if (!a.email && a.name) {
      const src = [
        ...meeting,
        ...(f.emailSource?.fromAddress ? [attendeeOf({ name: f.emailSource.fromName, email: f.emailSource.fromAddress }, 'email_source')] : []),
      ].filter((x): x is Addressee => !!x && !!x.email);
      const hit = src.filter((s) => samePerson({ name: a.name, email: null }, s) || (!!s.email && sameAttendee(s.email, a.name!)));
      if (hit.length === 1) a = { ...a, email: hit[0].email };
    }
    // …else among the project's own people: ONE address whose localpart carries every name token
    // (strict — a shared first name never pairs, and two candidates pair nothing).
    if (!a.email && a.name) {
      const toks = nameTokens(a.name).filter((x) => x.length >= 2);
      const hits = [...new Set(f.entityPeople.map((p) => String(p ?? '').trim().toLowerCase())
        .filter((p) => isEmail(p) && !p.startsWith('@') && !denotesUser(p, f.user)))]
        .filter((e) => { const local = emailLocalpart(e) ?? ''; return toks.length >= 2 ? toks.every((x) => local.includes(x)) : false; });
      if (hits.length === 1) a = { ...a, email: hits[0] };
    }
    return { addressee: a, recipients: [a], suggestions: [] };
  }

  // 2 · THE EMAIL SOURCE's other party — the sender when they wrote to the user; the first
  //     recipient who is not the user when the user wrote it.
  if (f.emailSource) {
    const es = f.emailSource;
    const raw = !es.isFromUser
      ? (es.fromName && es.fromAddress ? `${es.fromName} <${es.fromAddress}>` : es.fromAddress ?? es.fromName ?? '')
      : (es.to.find((t) => !isUserForm(t, f.user)) ?? '');
    const a = raw ? attendeeOf(raw, 'email_source') : null;
    if (a && !addresseeIsUser(a, f.user)) {
      const full = withRegistry(a, reg);
      return { addressee: full, recipients: [full], suggestions: [] };
    }
  }

  // 3 · THE MEETING's attendees minus the user — a follow-up to the meeting goes to the people in it.
  const reachable = meeting.map((a) => withRegistry(a, reg)).filter((a) => !!a.email);
  if (reachable.length) return { addressee: reachable[0], recipients: reachable.slice(0, 10), suggestions: [] };

  // 4 · THE LINKED ENTITY's people — addresses only when ONE external person stands.
  const userDomains = new Set((f.userAddresses ?? (f.user.aliases ?? []).map((x) => String(x ?? ''))).filter((x) => isEmail(x.trim()))
    .map((x) => domainOf(x)).filter((d): d is string => !!d && !PUBLIC_DOMAINS.has(d)));
  const emails = [...new Set(f.entityPeople.map((p) => String(p ?? '').trim().toLowerCase())
    .filter((p) => isEmail(p) && !p.startsWith('@')))]
    .filter((e) => !denotesUser(e, f.user) && !userDomains.has(domainOf(e) ?? ''));
  if (!emails.length) return none;
  const names = f.entityPeople.map((p) => String(p ?? '').trim()).filter((p) => p && !p.includes('@'));
  const people = dedupe(emails.map((e) => {
    // Pair the address with the fingerprint's own name for it (localpart ↔ name tokens), else the registry.
    // STRICT: every name token appears in the localpart (sameAttendee's any-token rule would pair
    // ahmed.samir@ with "Ahmed Rashad").
    const local = emailLocalpart(e) ?? '';
    const name = names.find((n) => { const t = nameTokens(n).filter((x) => x.length >= 2); return t.length >= 2 && t.every((x) => local.includes(x)); }) ?? null;
    return withRegistry({ name: name ? titleCase(name) : null, email: e, via: 'entity' }, reg);
  })).filter((a) => !addresseeIsUser(a, f.user));
  if (people.length === 1) return { addressee: people[0], recipients: people, suggestions: [] };
  // Several: suggestions, ranked by an organisation the item's own words name (its domain label).
  const titleToks = new Set(nameTokens(String(f.title ?? '')).filter((t) => t.length >= 3));
  const named = (a: Addressee) => {
    const label = (domainOf(a.email ?? '') ?? '').split('.')[0];
    return label && titleToks.has(label) ? 0 : 1;
  };
  const ranked = [...people].sort((a, b) => named(a) - named(b));
  const lead = ranked.filter((a) => named(a) === 0);
  return { ...none, suggestions: (lead.length ? lead : ranked).slice(0, 6) };
}

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

// ── THE WITHDRAWAL PREDICATE (b) — pure. ─────────────────────────────────────────────────────────
/**
 * Is this draft addressed to the wrong person? True when the addressee denotes the USER, or the item
 * has a (non-user) counterparty NOW and the addressee is not that person. An unaddressed draft (no
 * stamp, no title-derived name) is never withdrawn here — absence is not a wrong address.
 */
export function addresseeWithdrawn(
  a: Pick<Addressee, 'name' | 'email'> | null | undefined,
  facts: { counterparty: string | null | undefined; user: UserForms },
): boolean {
  if (!a || (!a.name && !a.email)) return false;
  if (addresseeIsUser(a, facts.user)) return true;
  const cp = String(facts.counterparty ?? '').trim();
  if (!cp || isUserForm(cp, facts.user)) return false;
  const { email, name } = parseWho(cp);
  const cur: Pick<Addressee, 'name' | 'email'> = { name: name ? (partyDisplay(cp) ?? name) : null, email: email ? normalizeEmail(email) : null };
  // A name-only side compares by name (an address the other side lacks is not a contradiction).
  if (a.email && cur.email) return normalizeEmail(a.email) !== cur.email;
  const x = a.name || a.email, y = cur.name || cur.email;
  if (!x || !y) return false;
  return !sameAttendee(x, y);
}

/** The addressee a LEGACY (unstamped) nudge carries in its own title — the writer composed
 *  `Nudge — <blockedOn>` from the same field. Name-only; generic fallbacks are no addressee. */
export function addresseeFromNudgeTitle(title: string | null | undefined): Addressee | null {
  const m = /^Nudge — (.+)$/.exec(String(title ?? '').trim());
  const who = m?.[1]?.trim() ?? '';
  if (!who || /^(follow-up|recipient to confirm)$/i.test(who)) return null;
  const { email, name } = parseWho(who);
  return { name: name ?? null, email: email ? normalizeEmail(email) : (firstEmailIn(who) ? normalizeEmail(firstEmailIn(who)!) : null), via: 'title' };
}

/** A stored addressee (any generation) → the shape, or null. */
export function addresseeOfStamp(raw: unknown): Addressee | null {
  const o = (raw ?? null) as { name?: unknown; email?: unknown; via?: unknown } | null;
  if (!o || typeof o !== 'object') return null;
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : null;
  const email = typeof o.email === 'string' && isEmail(o.email.trim()) ? normalizeEmail(o.email) : null;
  if (!name && !email) return null;
  return { name, email, via: (typeof o.via === 'string' ? o.via : 'counterparty') as AddresseeVia };
}

/** The stamp a writer persists: the addressee + the To list (null when nothing resolved — the card asks). */
export function addresseeStamp(r: AddresseeResolution): { addressee: Addressee | null; recipients: Addressee[] } {
  return { addressee: r.addressee, recipients: r.recipients };
}

// ── THE LOADERS (bounded SELECTs, zero AI) ──────────────────────────────────────────────────────

const formsMemo = new Map<string, { at: number; forms: UserForms; addresses: string[] }>();
const FORMS_TTL = 60_000;

/** Who the user IS — THE CODE-OWNED SELF IDENTITY (lib/entities/self deriveSelfIdentity, W7.5):
 *  profile name + login + connected addresses + the display names of mail FROM those addresses. */
export async function loadUserForms(client: SupabaseClient, userId: string): Promise<UserForms> {
  return (await loadUserIdentity(client, userId)).forms;
}

/** The forms + the AUTHORITATIVE addresses (profile + connections) — one read, memoized 60s.
 *  W7.5: read from THE ONE DERIVATION, never from the stored self row's aliases — a stored row is a
 *  cache of this law, and a polluted cache (found live: a client's name + address on the owner's self
 *  row) must not be able to make a client "the user" at any floor. */
export async function loadUserIdentity(client: SupabaseClient, userId: string): Promise<{ forms: UserForms; addresses: string[] }> {
  const hit = formsMemo.get(userId);
  if (hit && Date.now() - hit.at < FORMS_TTL) return { forms: hit.forms, addresses: hit.addresses };
  let forms: UserForms = { name: null, aliases: [] };
  let addresses: string[] = [];
  try {
    const { loadSelfIdentity } = await import('@/lib/entities/self');
    const id = await loadSelfIdentity(client, userId);
    const name = id.name && id.name !== 'You' && !isEmail(id.name) ? id.name : null;
    forms = { name, aliases: id.aliases };
    addresses = id.addresses;
  } catch { /* an unknown user matches nothing — the floors stay conservative */ }
  formsMemo.set(userId, { at: Date.now(), forms, addresses });
  return { forms, addresses };
}

type CommitRow = { id: string; description?: string | null; counterparty?: string | null; source?: string | null; source_id?: string | null; thread_id?: string | null };

/** Gather a commitment's rungs and resolve — THE ONE CALL every commitment drafter makes. */
export async function resolveCommitmentAddressee(
  client: SupabaseClient, userId: string, commitment: string | CommitRow,
): Promise<AddresseeResolution & { user: UserForms; row: CommitRow | null }> {
  let row: CommitRow | null = typeof commitment === 'string' ? null : commitment;
  if (!row || row.source === undefined) {
    const id = typeof commitment === 'string' ? commitment : commitment.id;
    const { data } = await client.from('commitments').select('id, description, counterparty, source, source_id, thread_id')
      .eq('id', id).eq('user_id', userId).maybeSingle();
    row = (data as CommitRow | null) ?? row;
  }
  const { forms: user, addresses: userAddresses } = await loadUserIdentity(client, userId);
  if (!row) return { addressee: null, recipients: [], suggestions: [], user, row: null };
  let emailSource: AddresseeFacts['emailSource'] = null;
  const meetingAttendees: unknown[] = [];
  let entityPeople: string[] = [];
  let registry: PersonEntity[] = [];
  try {
    const { getPersonEntities } = await import('@/lib/entities/people');
    const [reg, srcEmail, mt, link] = await Promise.all([
      getPersonEntities(client, userId).catch(() => [] as PersonEntity[]),
      row.source === 'email' && row.source_id
        ? client.from('emails').select('from_address, from_name, to_addresses, is_from_user').eq('id', row.source_id).eq('user_id', userId).maybeSingle()
        : Promise.resolve({ data: null }),
      row.source === 'meeting' && row.source_id
        ? client.from('meeting_transcripts').select('attendees, calendar_event_id').eq('id', row.source_id).eq('user_id', userId).maybeSingle()
        : Promise.resolve({ data: null }),
      client.from('entity_links').select('entity_id').eq('user_id', userId).eq('item_kind', 'commitment').eq('item_id', row.id)
        .not('entity_id', 'is', null).limit(1).maybeSingle(),
    ]);
    registry = reg;
    const e = srcEmail.data as { from_address?: string | null; from_name?: string | null; to_addresses?: string[] | null; is_from_user?: boolean | null } | null;
    if (e) emailSource = { fromAddress: e.from_address ?? null, fromName: e.from_name ?? null, to: (e.to_addresses ?? []).map(String), isFromUser: !!e.is_from_user };
    const m = mt.data as { attendees?: unknown; calendar_event_id?: string | null } | null;
    if (Array.isArray(m?.attendees)) meetingAttendees.push(...(m!.attendees as unknown[]));
    const [ev, ent] = await Promise.all([
      m?.calendar_event_id
        ? client.from('calendar_events').select('attendees').eq('id', m.calendar_event_id).eq('user_id', userId).maybeSingle()
        : Promise.resolve({ data: null }),
      link.data?.entity_id
        ? client.from('work_entities').select('people').eq('id', link.data.entity_id as string).eq('user_id', userId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const evAtt = (ev.data as { attendees?: unknown } | null)?.attendees;
    if (Array.isArray(evAtt)) meetingAttendees.push(...evAtt);
    const ppl = (ent.data as { people?: unknown } | null)?.people;
    if (Array.isArray(ppl)) entityPeople = ppl.map(String);
  } catch { /* a rung that cannot be read contributes nothing */ }
  const r = resolveAddressee({
    counterparty: row.counterparty ?? null, emailSource, meetingAttendees, entityPeople, registry,
    title: row.description ?? null, user, userAddresses,
  });
  return { ...r, user, row };
}
