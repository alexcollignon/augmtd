// ── Context-grounded initiative labeling (the "reason once, but SEE the world" fix).
// The email `understanding` pass and the commitment extractor each labeled an item's initiative from ONE
// item's text, in isolation — so the same deal got two labels (a client's calendar thread → "Jean-Marie
// pilot", their pricing thread → "Soboplac AI Agent System"), and deterministic grouping (distinct labels
// never merge) can't reconcile them. This provider hands the labeler the initiatives THIS sender / thread
// is ALREADY associated with, so the model can REUSE an existing label instead of minting a synonym. The
// decision stays reasoned (reuse-or-mint is the model's call), it just isn't blind anymore.
//
// Over-merge guard (the Galp lesson): we ground on the item's OWN correspondents (their own history), and
// the model can still say "genuinely different deal" — we never force a merge. Bounded to the top few
// candidates so a chatty sender can't flood the prompt.

import type { SupabaseClient } from '@supabase/supabase-js';

// Per-process memo of the user's labeled corpus — a sync batch processes many items in one invocation, so
// this turns N per-item fetches into one. Short TTL; serverless tears the process down anyway.
const memo = new Map<string, { at: number; items: { init: string; from: string | null; fromName: string | null; thread: string | null }[]; commits: { init: string; cp: string | null }[] }>();
const TTL_MS = 60_000;

const emailOf = (s?: string | null): string | null =>
  (String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0]) || null;
const nameKey = (s?: string | null): string => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const domainOf = (raw?: string | null): string | null => { const e = emailOf(raw); return e ? (e.split('@')[1] || null) : null; };

// Free providers are NOT corporate domains — a personal gmail address is not an "internal colleague".
const FREE_EMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com', 'zoho.com', 'pm.me']);

// The user's CORPORATE domain(s) — non-free-provider domains of their login + connected mailboxes. A person
// on one of these is an INTERNAL colleague who's on EVERYTHING, so they must NEVER bridge an email to a deal
// (the documented "Galp swallowed 47 unrelated items via an internal colleague" over-merge). Cached per user.
const corpMemo = new Map<string, { at: number; domains: Set<string> }>();
async function corporateDomains(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const c = corpMemo.get(userId);
  if (c && Date.now() - c.at < TTL_MS) return c.domains;
  const [{ data: prof }, { data: conns }] = await Promise.all([
    supabase.from('profiles').select('email').eq('id', userId).maybeSingle(),
    supabase.from('connections').select('metadata, provider_account_id').eq('user_id', userId),
  ]);
  const domains = new Set<string>();
  const add = (a?: string | null) => { const d = domainOf(a); if (d && !FREE_EMAIL_DOMAINS.has(d)) domains.add(d); };
  add((prof as { email?: string } | null)?.email);
  for (const cn of (conns ?? []) as Array<{ metadata: { email?: string } | null; provider_account_id?: string | null }>) add(cn.metadata?.email || cn.provider_account_id);
  corpMemo.set(userId, { at: Date.now(), domains });
  return domains;
}

async function loadLabeled(supabase: SupabaseClient, userId: string) {
  const cached = memo.get(userId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached;
  const [inboxRes, commitRes] = await Promise.all([
    supabase.from('inbox_items').select('source_data').eq('user_id', userId).eq('source', 'email')
      .not('source_data->understanding->>initiative', 'is', null).limit(600),
    supabase.from('commitments').select('initiative, counterparty').eq('user_id', userId)
      .not('initiative', 'is', null).limit(400),
  ]);
  const items = ((inboxRes.data ?? []) as Array<{ source_data: Record<string, unknown> }>).map((r) => {
    const sd = (r.source_data ?? {}) as Record<string, unknown>;
    const u = sd.understanding as { initiative?: string } | undefined;
    return { init: String(u?.initiative || '').trim(), from: (sd.from_address as string) || (sd.from as string) || null, fromName: (sd.from_name as string) || null, thread: (sd.thread_id as string) || null };
  }).filter((x) => x.init);
  const commits = ((commitRes.data ?? []) as Array<{ initiative: string | null; counterparty: string | null }>)
    .map((r) => ({ init: String(r.initiative || '').trim(), cp: r.counterparty || null })).filter((x) => x.init);
  const rec = { at: Date.now(), items, commits };
  memo.set(userId, rec);
  return rec;
}

/**
 * The initiative labels this thread / sender / counterparty is already associated with — the candidate set
 * the labeler grounds on. `threadLabel` (same thread) is the strongest signal; `candidates` are frequency-
 * ranked labels from the person's own history. Empty when the person/thread is new. Never throws.
 */
export async function getInitiativeCandidates(
  supabase: SupabaseClient,
  userId: string,
  opts: { threadId?: string | null; personEmails?: (string | null)[]; personNames?: (string | null)[] },
): Promise<{ canonical: string | null; candidates: string[] }> {
  try {
    const { items, commits } = await loadLabeled(supabase, userId);
    // INTERNAL-COLLEAGUE GUARD: an internal colleague (same corporate domain) is on everything, so they must
    // never bridge this email to a deal. Keep only EXTERNAL participant emails for the bridge. And if the
    // query HAD emails but they were ALL internal (an internal-only thread), don't let names bridge either —
    // otherwise the internal colleague's NAME re-introduces the over-merge. A name-only query (no emails, e.g.
    // a commitment counterparty) keeps its names.
    const corp = await corporateDomains(supabase, userId);
    const allEmails = (opts.personEmails ?? []).map(emailOf).filter(Boolean) as string[];
    const externalEmails = allEmails.filter((e) => { const d = e.split('@')[1]; return d && !corp.has(d); });
    const emails = new Set(externalEmails);
    const namesAllowed = allEmails.length === 0 || externalEmails.length > 0;
    const nameTokenSets = (namesAllowed ? (opts.personNames ?? []) : []).map(nameKey).filter((n) => n.length > 2).map((n) => new Set(n.split(' ').filter((t) => t.length > 2)));
    // Link a person across email + name forms: a commitment's counterparty "Jean-Marie" and an email's
    // sender "Jean-Marie LAMBERT" are the same person, so both draw from ONE candidate pool → ONE canonical.
    const nameMatches = (raw?: string | null): boolean => {
      const t = new Set(nameKey(raw).split(' ').filter((x) => x.length > 2));
      if (!t.size) return false;
      return nameTokenSets.some((q) => { const [s, l] = q.size <= t.size ? [q, t] : [t, q]; return s.size > 0 && [...s].every((x) => l.has(x)); });
    };
    let threadLabel: string | null = null;
    if (opts.threadId) { const t = items.find((i) => i.thread === opts.threadId); if (t) threadLabel = t.init; }
    const freq = new Map<string, number>();
    const bump = (init: string) => { if (init) freq.set(init, (freq.get(init) ?? 0) + 1); };
    for (const i of items) { const e = emailOf(i.from); if ((e && emails.has(e)) || nameMatches(i.fromName)) bump(i.init); }
    for (const c of commits) { const e = emailOf(c.cp); if ((e && emails.has(e)) || nameMatches(c.cp)) bump(c.init); }
    // Canonical = the sender's ESTABLISHED label: the thread's own label if any (a thread is one
    // initiative), else the most frequent — tie broken by the longer/more-descriptive label. This is the
    // one the labeler consolidates on so a deal stops fragmenting; the model may still split a genuinely
    // separate deal. candidates = the other variants (so the prompt can say "don't reuse those").
    const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([k]) => k);
    const canonical = threadLabel || ranked[0] || null;
    const candidates = ranked.filter((c) => c !== canonical).slice(0, 5);
    return { canonical, candidates };
  } catch {
    return { canonical: null, candidates: [] };
  }
}

/** Render the grounding clause — CONTENT-FIRST (chief-of-staff logic). Presents the sender's known areas of
 * work as a CANDIDATE SET the labeler reasons over by the email's actual content — never a most-frequent
 * default. A person can run several distinct areas at once; the content decides which one this is (or whether
 * it's a new one). Empty when the sender is new (label fresh). `canonical`+`otherVariants` are merged into the
 * candidate set (the parameter shape is kept for back-compat; there is no "preferred" one anymore). */
export function initiativeGroundingClause(canonical: string | null, otherVariants: string[]): string {
  const areas = [...new Set([canonical, ...otherVariants].filter(Boolean) as string[])];
  if (!areas.length) return '';
  return (
    `\n- AREAS OF WORK WITH THIS SENDER (decide by CONTENT, never by frequency): you already have these DISTINCT areas of work with this person — ${areas.map((a) => `"${a}"`).join(', ')}. ` +
    `A person is often involved in SEVERAL separate areas at once (e.g. a partnership, a product integration, a hiring intro — same person, different work). ` +
    `Read THIS email's actual subject/body and decide which ONE area it is about, then reuse that area's EXACT label so the same area stays consolidated. ` +
    `If the content is clearly about a DIFFERENT or NEW area than any listed, name that area freshly from the content — do NOT force it onto one of the above, and NEVER pick an area just because it is the most common one for this person. The email's content is the decider; the list is only context.\n`
  );
}
