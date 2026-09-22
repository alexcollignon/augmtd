// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ECHO FLOOR — LAW 5 of THE PROACTIVE REACH ARC (docs/proactive-reach-plan.md).
//
// "The machine recognizes the user's own outbound coming back."
//
// A user who runs outbound sequences mails the same subject shape to hundreds of strangers. The
// replies come back looking, to every classifier we own, like warm inbound business: a real human
// address, a direct ask, a first name. The Sep 13 census proved the cost — sequencer replies were
// judged `bulk:false, mailKind:'customer', relevance:'action', confidence:92`, became TOP deck
// whispers, FOUNDED an entity and MINTED a commitment for a lunch that never existed. Two of five
// Sunday whispers were the user's own sequencer echoing back.
//
// THE AGNOSTIC CLAUSE (owner, Sep 13): nothing here names a vendor, a token, a sender, a language
// or a provider. The signature is DERIVED AT RUNTIME from the user's OWN sent corpus. Another user
// on another sequencer in another language gets their own signature from the same code. A token
// written into this file would be a repair script masquerading as a law.
//
// THE SHAPE OF THE LAW:
//   • DERIVATION is deterministic and zero-AI (facts, not judgment — the house doctrine).
//   • The floor is a REFINER in the precedence chain (authoritative → refine → fallback), never an
//     unconditional demotion. A user's own correction or rule outranks it, always.
//   • An echo is POSTURED, NOT HIDDEN. It lands in the awareness lane, visible on demand — a real
//     prospect answering a sequence is still findable, in its place.
//   • It never founds an entity, never mints a commitment.
//   • FAIL-OPEN: with no signature in hand the floor is INERT. We demote on evidence or not at all.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { fetchAllRows } from '@/lib/utils/fetch-all';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

/** Bump when the derivation changes — the cached signature re-derives (the prompt-version lesson,
 *  applied to a deterministic derivation: a cached OLD-law signature must never outlive the law). */
export const CAMPAIGN_SIGNATURE_VERSION = 1;

// ── The tunable constants. Deliberately conservative: a false echo-demotion HIDES real work, so
// every bar is set where the evidence is unambiguous. Showing costs less than hiding.
/** How far back the user's own sent corpus is read. */
export const SENT_WINDOW_DAYS = 60;
/** A token must mark this many DISTINCT sent subjects before it counts as a campaign marker. */
export const MIN_TOKEN_SUBJECTS = 5;
/** A repeated subject template must have gone to this many DISTINCT recipient DOMAINS. A real
 *  engagement repeats a subject inside ONE company; a blast crosses many. That domain spread is the
 *  whole discriminator — no wording, no language, no vendor. */
export const MIN_TEMPLATE_DOMAINS = 8;
/** Bounded read (the fetchAllRows / 1000-cap lesson: page it, and cap the page count). */
export const MAX_SENT_ROWS = 5000;

export type CampaignSignature = {
  /** High-entropy uppercase markers the sequencer stamps into its subjects. */
  tokens: string[];
  /** Normalized subject templates blasted across many recipient domains. */
  templates: string[];
  /** How many sent rows the derivation read (honest accounting — an empty corpus is not proof). */
  sentRead: number;
  derivedAt: string;
  version: number;
};

export const EMPTY_SIGNATURE: CampaignSignature = {
  tokens: [], templates: [], sentRead: 0, derivedAt: '', version: CAMPAIGN_SIGNATURE_VERSION,
};

export function signatureIsEmpty(sig: CampaignSignature | null | undefined): boolean {
  return !sig || (sig.tokens.length === 0 && sig.templates.length === 0);
}

// ── THE SUBJECT NORMALIZER ───────────────────────────────────────────────────────────────────────
// Reply/forward prefixes across the languages the corpus actually carries are structural, not
// semantic — they are stripped so an inbound "Re: <template>" is recognised as its own outbound.
// Exported as THE ONE REPLY/FORWARD TABLE for anything that must strip these heads WITHOUT
// lowercasing (the entity naming floor reuses it — a second table would be a second language list).
export const REPLY_PREFIX = /^((re|res|rép|rep|fw|fwd|enc|aw|wg|tr|rif|antw|sv|vs)\s*(\[\d+\])?\s*:\s*)+/i;

export function normalizeSubject(subject: string | null | undefined): string {
  let s = String(subject ?? '').trim();
  let prev = '';
  while (s !== prev) { prev = s; s = s.replace(REPLY_PREFIX, '').trim(); }
  return s.replace(/\s+/g, ' ').toLowerCase();
}

// ── THE MARKER SHAPE ─────────────────────────────────────────────────────────────────────────────
// A sequencer's tracking stamp is a short, ALL-CAPS, MIXED alphanumeric run — it carries entropy
// because it is generated, not written. The mixed requirement (at least one letter AND at least one
// digit) is what separates a generated stamp from a shouted word: on the reference corpus it keeps
// the real marker and drops the user's own brand acronym and an industry word, with no list of
// either anywhere in this file.
const MARKER_CANDIDATE = /\b[A-Z0-9]{5,10}\b/g;

export function isMarkerShaped(token: string): boolean {
  if (token.length < 5 || token.length > 10) return false;
  if (!/^[A-Z0-9]+$/.test(token)) return false;
  return /[A-Z]/.test(token) && /[0-9]/.test(token);
}

/** Every marker-shaped token in one subject line. Pure. */
export function markerTokensIn(subject: string | null | undefined): string[] {
  const raw = String(subject ?? '');
  const out = new Set<string>();
  for (const m of raw.match(MARKER_CANDIDATE) ?? []) if (isMarkerShaped(m)) out.add(m);
  return [...out];
}

// ── THE DERIVATION (PURE, ZERO-AI) ───────────────────────────────────────────────────────────────
export type SentRow = {
  subject?: string | null;
  thread_id?: string | null;
  id?: string | null;
  to_addresses?: string[] | null;
};

/**
 * Derive the user's outbound-campaign signature from their OWN sent mail. Pure and deterministic —
 * the same rows always yield the same signature, no AI, no network, no clock beyond the stamp.
 *
 * TWO markers, both evidence-bearing:
 *   1. TOKENS — a marker-shaped run appearing in ≥ MIN_TOKEN_SUBJECTS distinct sent subjects. One
 *      generated stamp reused across many outbound subjects IS a sequencer, in any language.
 *   2. TEMPLATES — a normalized subject sent to ≥ MIN_TEMPLATE_DOMAINS distinct recipient domains.
 *      A repeated subject inside one company is an engagement; across many companies it is a blast.
 */
export function deriveSignature(rows: SentRow[]): CampaignSignature {
  const tokenSubjects = new Map<string, Set<string>>();
  const templateDomains = new Map<string, Set<string>>();

  for (const r of rows) {
    const norm = normalizeSubject(r.subject);
    if (!norm) continue; // a subject-less send is no evidence of anything
    for (const t of markerTokensIn(r.subject)) {
      if (!tokenSubjects.has(t)) tokenSubjects.set(t, new Set());
      tokenSubjects.get(t)!.add(norm);
    }
    // A template must be substantial enough to identify a campaign: a two-word subject repeats by
    // coincidence ("invoice", "hello"), a written subject line does not.
    if (norm.length >= 12) {
      if (!templateDomains.has(norm)) templateDomains.set(norm, new Set());
      const set = templateDomains.get(norm)!;
      for (const a of r.to_addresses ?? []) {
        const d = String(a).toLowerCase().split('@')[1];
        if (d) set.add(d.replace(/^>+|[>,;\s]+$/g, ''));
      }
    }
  }

  const tokens = [...tokenSubjects.entries()]
    .filter(([, s]) => s.size >= MIN_TOKEN_SUBJECTS).map(([t]) => t).sort();
  const templates = [...templateDomains.entries()]
    .filter(([, s]) => s.size >= MIN_TEMPLATE_DOMAINS).map(([t]) => t).sort();

  return {
    tokens, templates, sentRead: rows.length,
    derivedAt: new Date().toISOString(), version: CAMPAIGN_SIGNATURE_VERSION,
  };
}

// ── THE MATCH (PURE) ─────────────────────────────────────────────────────────────────────────────
export type EchoMatch = { hit: boolean; marker: string | null; via: 'token' | 'template' | null };

export function matchSubject(subject: string | null | undefined, sig: CampaignSignature | null | undefined): EchoMatch {
  const miss: EchoMatch = { hit: false, marker: null, via: null };
  if (signatureIsEmpty(sig)) return miss; // FAIL-OPEN: no evidence, no demotion
  const raw = String(subject ?? '');
  if (!raw.trim()) return miss;
  const present = new Set(markerTokensIn(raw));
  for (const t of sig!.tokens) if (present.has(t)) return { hit: true, marker: t, via: 'token' };
  const norm = normalizeSubject(raw);
  for (const t of sig!.templates) if (norm === t) return { hit: true, marker: t, via: 'template' };
  return miss;
}

// ── THE PROCESS REGISTRY ─────────────────────────────────────────────────────────────────────────
// The classify seams (`classifyItem`, `isNeedsReply`) are PURE and synchronous by contract — they
// cannot read the database. The signature reaches them through two channels, and neither invents
// evidence:
//   • THE DURABLE STAMP — `source_data.campaign_echo === true`, written by the guarded sweep. This
//     is the channel that survives a cold process.
//   • THE PROCESS REGISTRY — primed by any async seam that already derived the signature for this
//     user in this process (recognition, the commitment extractor, the sweep).
// With neither present the floor is INERT, by design.
const REGISTRY = new Map<string, CampaignSignature>();

export function primeCampaignSignature(userId: string, sig: CampaignSignature): void {
  if (userId) REGISTRY.set(userId, sig);
}
export function peekCampaignSignature(userId: string | null | undefined): CampaignSignature | null {
  return (userId && REGISTRY.get(userId)) || null;
}
/** Test seam only — the registry is process-local state. */
export function clearCampaignRegistry(): void { REGISTRY.clear(); }

// ── THE ITEM-SHAPED FLOOR (PURE) ─────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EchoItem = { user_id?: string | null; work_title?: string | null; type_override?: string | null; source_data?: any };

/**
 * Is this inbound item the user's OWN outbound campaign coming back?
 *
 * THE PRECEDENCE CHAIN (authoritative → refine → fallback — never an AND, never unconditional):
 *   1. AUTHORITATIVE — the user's own `type_override`, or an explicit `campaign_echo: false`
 *      un-mark, wins outright. A human decision outranks the machine (the pinning law's spirit).
 *   2. REFINE — this floor, on derived evidence.
 *   3. FALLBACK — the ordinary chain, untouched.
 *
 * A deliberate note on the escape hatch: the notice law lets a reasoned `you_owe` protect an item
 * from its sender-shape demotion. That escape cannot be borrowed here, because the judgment it
 * would defer to is the SAME judgment this floor exists to correct — the census found these echoes
 * judged `bulk:false / customer / action / confidence 92`. So the escape is a HUMAN signal, not a
 * machine one. The floor is still a refiner: the user's override and any user RULE verdict are
 * evaluated ABOVE it in `classifyItem`'s chain and are returned untouched.
 */
export function isCampaignEcho(item: EchoItem, sig?: CampaignSignature | null): boolean {
  try {
    const sd = (item.source_data ?? {}) as Record<string, unknown>;
    // 1. AUTHORITATIVE — a human decision on this item ends the question.
    if (item.type_override) return false;
    if (sd.campaign_echo === false) return false;
    // The durable stamp (survives a cold process; written by the guarded sweep).
    if (sd.campaign_echo === true) return true;
    // 2. REFINE — derived evidence, from the caller's signature or this process's registry.
    const s = sig ?? peekCampaignSignature(item.user_id ?? null);
    if (signatureIsEmpty(s)) return false; // FAIL-OPEN
    const subject = String(sd.subject ?? item.work_title ?? '');
    return matchSubject(subject, s).hit;
  } catch {
    return false; // the floor never breaks a classification
  }
}

// ── THE ASYNC DOOR (derive + cache + prime) ──────────────────────────────────────────────────────
// Cached in `item_plans` (the house store — no migration), day-keyed like every other derived
// cache in the codebase: a signature self-maintains as the corpus moves, at most one derivation
// per user per day.
const CACHE_KIND = 'campaign_signature';
const cacheEntity = () => 'campaign:signature';
const daySig = (todayStr: string) => `${CAMPAIGN_SIGNATURE_VERSION}:${todayStr}`;

async function readSentSubjects(client: DBClient, userId: string): Promise<SentRow[]> {
  const since = new Date(Date.now() - SENT_WINDOW_DAYS * 86400_000).toISOString();
  return fetchAllRows<SentRow>(
    (from, to) => client.from('emails')
      .select('id, subject, thread_id, to_addresses')
      .eq('user_id', userId).eq('is_from_user', true).gte('received_at', since)
      .order('received_at', { ascending: false }).range(from, to),
    { pageSize: 1000, maxRows: MAX_SENT_ROWS },
  );
}

/**
 * The user's campaign signature — derived once a day, cached, primed into the process registry so
 * the pure classify seams can see it. Best-effort throughout: a failure yields the EMPTY signature
 * and the floor goes inert (never a fabricated demotion).
 */
export async function getCampaignSignature(
  client: DBClient, userId: string, opts: { force?: boolean } = {},
): Promise<CampaignSignature> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const sig = daySig(todayStr);
  if (!opts.force) {
    const memo = peekCampaignSignature(userId);
    if (memo && memo.derivedAt.slice(0, 10) === todayStr && memo.version === CAMPAIGN_SIGNATURE_VERSION) return memo;
    try {
      const { data } = await client.from('item_plans').select('tasks')
        .eq('user_id', userId).eq('kind', CACHE_KIND).eq('entity_id', cacheEntity()).maybeSingle();
      const t = (data?.tasks ?? null) as { sig?: string; signature?: CampaignSignature } | null;
      if (t?.sig === sig && t.signature && t.signature.version === CAMPAIGN_SIGNATURE_VERSION) {
        primeCampaignSignature(userId, t.signature);
        return t.signature;
      }
    } catch { /* cache is best-effort */ }
  }
  let derived = EMPTY_SIGNATURE;
  try {
    derived = deriveSignature(await readSentSubjects(client, userId));
  } catch {
    return EMPTY_SIGNATURE; // a read failure is not evidence of a campaign
  }
  primeCampaignSignature(userId, derived);
  try {
    await client.from('item_plans').upsert({
      user_id: userId, kind: CACHE_KIND, entity_id: cacheEntity(),
      tasks: { sig, signature: derived }, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,kind,entity_id' }).then(() => {}, () => {});
  } catch { /* best-effort */ }
  return derived;
}

/** Convenience for the async guards: "is this subject the user's own campaign coming back?" */
export async function subjectIsCampaignEcho(client: DBClient, userId: string, subject: string | null | undefined): Promise<boolean> {
  try {
    const sig = await getCampaignSignature(client, userId);
    return matchSubject(subject, sig).hit;
  } catch { return false; }
}
