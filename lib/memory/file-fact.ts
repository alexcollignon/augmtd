// ═══ THE MEMORY LADDER — fileFact, THE ONE WRITER for durable learned facts (W2.4, Sep 22) ═══
//
// Invariant 6, ONE FACT ONE HOME, applied to memory: a fact the user states lands at ITS scope,
// once, and never "in whoever heard it". Three rungs, one home each:
//
//   'user'            — who the user is (role · team · market · constraints) → the context_profiles
//                       identity row (the ABOUT-YOU block every prompt reads). Reaches every thread.
//   'project'         — the work's facts (a client, a deal, a counterparty, a date, a decision) → the
//                       project's entity (work_entities.rules via the existing entity fact writer).
//                       Reaches that project's threads; elsewhere only explicit-and-cited.
//   'coworker_method' — HOW this coworker should work for the user ("always CC me", "keep it under
//                       200 words", "no emojis") → the coworker's memory_text. Reaches that coworker
//                       everywhere — which is exactly why a client fact must NEVER land here: it
//                       would leak into every other project's room by the identity law.
//
// Laws this module enforces, in code:
//   • THE SCOPE ROUTE (`routeFactScope`): a project fact files ONLY to a KNOWN entity (the thread's
//     recognized entity — never guessed); with no entity it DROPS, it never falls back to the coworker.
//   • DEDUPE (`normalizeFact`): a fact already present at its home is a no-op — no home ever holds
//     the same fact twice, and re-extraction never re-bills a write.
//   • THE HEAD-KEEP CAP (`capMemoryKeepHead`): a coworker memory over its cap keeps its HEAD (the
//     durable older facts) whole and compresses or drops from the TAIL — the old `.slice(0, MAX)`
//     was a head cut in disguise (it kept the oldest bytes but cut mid-line and discarded the
//     compression's newest output). Compression is the CALLER's AI (`compressTail`); this module
//     is zero-AI so a gate can exercise it.
//   • PROVENANCE: every real write logs one `memory_filed` activity row naming scope + home + source.
//
// THE POVERTY GATE (decided here, W2.4): the gate in intake-memory governs INTERVIEWING — spending
// an AI pass to ask/extract identity on a context-poor account — not FILING. A fact the user already
// stated, already extracted by a pass that ran anyway, files at user scope on every account: filing
// is a zero-AI merge-only write, and a warm mailbox account is exactly where a stated preference
// would otherwise be lost to a coworker's private memory.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = SupabaseClient<any, any, any>;

export type FactScope = 'user' | 'project' | 'coworker_method';
export type ProposedScope = FactScope | 'drop' | string;

/** The coworker memory cap (the same 2000 the runtimes have always read). */
export const MEMORY_TEXT_MAX = 2000;
/** The head that is never compressed and never dropped — the oldest, most-settled facts. */
export const MEMORY_HEAD_KEEP = 1000;
/** A single filed fact never exceeds this (the entity rule writer's own cap). */
export const FACT_MAX_CHARS = 200;

export type FileFactOpts = {
  scope: FactScope;
  /** Who is filing — 'agent_memory_extraction' · 'intake' · 'steer' … (rides the activity row). */
  source: string;
  /** Required for scope 'project' — the thread's RECOGNIZED entity; never guessed here. */
  entityId?: string | null;
  /** Required for scope 'coworker_method'. */
  agentId?: string | null;
  /** The caller's AI compressor for the memory TAIL when the coworker memory overflows. Zero-AI
   *  fallback (no compressor): the tail is cut at a line boundary — newest lines drop first, the
   *  head never. */
  compressTail?: (tail: string, maxChars: number) => Promise<string>;
};

export type FileFactResult = {
  scope: FactScope;
  /** Facts actually written (after dedupe). */
  filed: string[];
  /** Facts already present (or empty) — no write. */
  skipped: string[];
  /** The home the write landed in, for narration ('project:<name>' · 'user' · 'coworker:<id>'). */
  home: string | null;
  /** A stated reason when nothing could be filed (no entity, unknown agent …). */
  reason?: string;
};

// ── Pure helpers (gate-exercised) ──────────────────────────────────────────────────────────────

/** The dedupe key of a fact: bullet stripped, whitespace collapsed, case + trailing punctuation
 *  ignored. Two facts with the same key are the SAME fact. */
export function normalizeFact(s: string): string {
  return String(s ?? '')
    .replace(/^\s*[-*•·]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!;,]+$/g, '')
    .toLowerCase();
}

/** The stored form of a fact: one clean line, bullet stripped, capped. */
export function cleanFact(s: string): string {
  return String(s ?? '').replace(/^\s*[-*•·]\s*/, '').replace(/\s+/g, ' ').trim().slice(0, FACT_MAX_CHARS);
}

/** THE SCOPE ROUTE. A proposed scope (from the extractor) resolves against what the thread knows:
 *  a project fact needs a KNOWN entity or it drops (never the coworker, never a guessed entity);
 *  anything unrecognized drops. */
export function routeFactScope(
  proposed: ProposedScope,
  ctx: { entityId: string | null },
): FactScope | 'drop' {
  switch (proposed) {
    case 'project': return ctx.entityId ? 'project' : 'drop';
    case 'user': return 'user';
    case 'coworker_method': return 'coworker_method';
    default: return 'drop';
  }
}

/** Split a memory into the head that is never touched and the tail that may be compressed.
 *  The split lands on a line boundary at or before `headKeep`. */
export function splitMemoryHeadTail(text: string, headKeep = MEMORY_HEAD_KEEP): { head: string; tail: string } {
  const t = String(text ?? '');
  if (t.length <= headKeep) return { head: t, tail: '' };
  const cut = t.lastIndexOf('\n', headKeep);
  if (cut <= 0) return { head: '', tail: t }; // one giant line: nothing settled to keep
  return { head: t.slice(0, cut), tail: t.slice(cut + 1) };
}

/** THE HEAD-KEEP CAP: whole lines from the START are kept until the cap; the lines that do not
 *  fit — the NEWEST — are dropped. Never a mid-line cut, never the head. */
export function capMemoryKeepHead(text: string, max = MEMORY_TEXT_MAX): string {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  const kept: string[] = [];
  let len = 0;
  for (const line of t.split('\n')) {
    const add = line.length + (kept.length ? 1 : 0);
    if (len + add > max) break;
    kept.push(line);
    len += add;
  }
  return kept.join('\n');
}

/** Append facts to a line-per-fact memory with dedupe against every existing line. */
export function mergeMemoryLines(existing: string, incoming: string[]): { text: string; added: string[]; skipped: string[] } {
  const lines = String(existing ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const seen = new Set(lines.map(normalizeFact).filter(Boolean));
  const added: string[] = []; const skipped: string[] = [];
  for (const raw of incoming) {
    const f = cleanFact(raw);
    const key = normalizeFact(f);
    if (!key) continue;
    if (seen.has(key)) { skipped.push(f); continue; }
    seen.add(key);
    lines.push(`- ${f}`);
    added.push(f);
  }
  return { text: lines.join('\n'), added, skipped };
}

// ── The user rung — the identity row (shared with intake-memory's interview) ───────────────────

export type IdentityData = {
  fullName?: string; role?: string; email?: string; department?: string;
  authority?: string; responsibilities?: string[];
  /** Free-form durable context lines ("markets credit data", "reports to the CRO"). */
  notes?: string[];
};

export const IDENTITY_CAPS = { responsibilities: { count: 8, len: 100 }, notes: { count: 12, len: 140 } } as const;

/** Dedupe-merge a list, keeping the NEWEST when over cap (recent context wins). */
export function uniqCap(existing: string[], incoming: string[], cap: number, maxLen: number): string[] {
  const seen = new Set(existing.map(normalizeFact));
  const out = [...existing];
  for (const raw of incoming) {
    const s = cleanFact(raw).slice(0, maxLen);
    const key = normalizeFact(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(-cap);
}

/** THE ONE IDENTITY-NOTES WRITER: merge-only into the context_profiles identity row — role
 *  fill-if-empty (an explicit intro/signup role outranks a chat mention), responsibilities and
 *  notes deduped + capped. Returns what actually landed. */
export async function mergeUserIdentity(
  client: DBClient, userId: string,
  patch: { role?: string | null; responsibilities?: string[]; notes?: string[] },
  opts: { source: string },
): Promise<{ changed: boolean; added: string[] }> {
  const { data: existing } = await client.from('context_profiles')
    .select('profile_data').eq('user_id', userId).eq('profile_type', 'identity').maybeSingle();
  const cur = ((existing?.profile_data ?? {}) as IdentityData);
  const responsibilities = uniqCap(cur.responsibilities ?? [], patch.responsibilities ?? [], IDENTITY_CAPS.responsibilities.count, IDENTITY_CAPS.responsibilities.len);
  const notes = uniqCap(cur.notes ?? [], patch.notes ?? [], IDENTITY_CAPS.notes.count, IDENTITY_CAPS.notes.len);
  const merged: IdentityData = {
    ...cur,
    ...(patch.role && !cur.role ? { role: String(patch.role).slice(0, 120) } : {}),
    responsibilities, notes,
  };
  const before = JSON.stringify({ ...cur, responsibilities: cur.responsibilities ?? [], notes: cur.notes ?? [] });
  if (JSON.stringify(merged) === before) return { changed: false, added: [] };
  const { error } = await client.from('context_profiles').upsert({
    user_id: userId, profile_type: 'identity', profile_data: merged,
  }, { onConflict: 'user_id,profile_type' });
  if (error) throw new Error(error.message);
  const added = [
    ...responsibilities.filter((r) => !(cur.responsibilities ?? []).includes(r)),
    ...notes.filter((n) => !(cur.notes ?? []).includes(n)),
    ...(merged.role && !cur.role ? [`role: ${merged.role}`] : []),
  ];
  void logFiled(client, userId, { scope: 'user', home: 'user', source: opts.source, facts: added });
  return { changed: true, added };
}

// ── Recognition — the thread's entity (never guessed) ──────────────────────────────────────────

/** The DM thread's entity by the SAME deterministic focus law the worker grounding uses
 *  (`findEntityFocus`: distinctive-token match, an all-generic name never matches). The addressed
 *  coworker's name is stripped first (the envelope, never the subject). Null = no known entity. */
export async function resolveThreadEntity(
  client: DBClient, userId: string, userTexts: string[], opts?: { excludeName?: string | null },
): Promise<{ id: string; name: string } | null> {
  try {
    let q = userTexts.map((t) => String(t ?? '').trim()).filter(Boolean).join('\n');
    if (q.length < 3) return null;
    const ex = opts?.excludeName?.trim().split(/\s+/)[0];
    if (ex && ex.length >= 3) q = q.replace(new RegExp(`\\b${ex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
    const { data: ents } = await client.from('work_entities').select('id, name, aliases')
      .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active')
      .order('last_event_at', { ascending: false }).limit(200);
    if (!ents?.length) return null;
    const { findEntityFocus } = await import('@/lib/home/ask');
    return findEntityFocus(q, ents as Array<{ id: string; name: string; aliases?: string[] | null }>);
  } catch { return null; }
}

// ── THE ONE WRITER ─────────────────────────────────────────────────────────────────────────────

async function logFiled(
  client: DBClient, userId: string,
  p: { scope: FactScope; home: string; source: string; facts: string[]; entityId?: string | null; agentId?: string | null },
): Promise<void> {
  if (!p.facts.length) return;
  try {
    const { logActivity } = await import('@/lib/activity/log');
    await logActivity(client, userId, {
      type: 'memory_filed',
      title: `Remembered (${p.scope === 'coworker_method' ? 'how to work' : p.scope}): ${p.facts[0]}${p.facts.length > 1 ? ` (+${p.facts.length - 1})` : ''}`,
      entityType: p.scope === 'project' ? 'entity' : p.scope === 'coworker_method' ? 'agent' : 'user',
      entityId: p.scope === 'project' ? (p.entityId ?? null) : p.scope === 'coworker_method' ? (p.agentId ?? null) : null,
      metadata: { scope: p.scope, home: p.home, source: p.source, facts: p.facts },
    });
  } catch { /* provenance is best-effort; the fact still landed */ }
}

/**
 * File one or more durable learned facts at ONE scope. Zero-AI (the optional `compressTail` is
 * the caller's). Never throws — a memory write must never break the conversation that produced it.
 */
export async function fileFact(
  client: DBClient, userId: string, fact: string | string[], opts: FileFactOpts,
): Promise<FileFactResult> {
  const facts = (Array.isArray(fact) ? fact : [fact]).map(cleanFact).filter(Boolean);
  const base: FileFactResult = { scope: opts.scope, filed: [], skipped: [], home: null };
  if (!facts.length) return { ...base, reason: 'empty' };
  try {
    switch (opts.scope) {
      case 'user': {
        const r = await mergeUserIdentity(client, userId, { notes: facts }, { source: opts.source });
        const filed = facts.filter((f) => r.added.some((a) => normalizeFact(a) === normalizeFact(f)));
        return { ...base, home: 'user', filed, skipped: facts.filter((f) => !filed.includes(f)) };
      }
      case 'project': {
        if (!opts.entityId) return { ...base, reason: 'no known entity — a project fact is never filed to a guess' };
        const { executeRememberFact } = await import('@/lib/tools/item-actions');
        const filed: string[] = []; const skipped: string[] = [];
        let name: string | null = null;
        for (const f of facts) {
          const r = await executeRememberFact({ client, userId }, { fact: f, entityId: opts.entityId });
          if (!r.ok) { skipped.push(f); continue; }
          name = r.entityName ?? name;
          if (r.wrote === false) skipped.push(f); else filed.push(f);
        }
        if (!name && !filed.length) return { ...base, reason: 'entity not found' };
        const home = `project:${name ?? opts.entityId}`;
        void logFiled(client, userId, { scope: 'project', home, source: opts.source, facts: filed, entityId: opts.entityId });
        return { ...base, home, filed, skipped };
      }
      case 'coworker_method': {
        if (!opts.agentId) return { ...base, reason: 'no coworker' };
        const { data: agent } = await client.from('custom_agents').select('id, user_id, memory_text').eq('id', opts.agentId).maybeSingle();
        if (!agent) return { ...base, reason: 'coworker not found' };
        const isOwner = String(agent.user_id) === userId;
        let existing = '';
        if (isOwner) existing = String(agent.memory_text ?? '');
        else {
          const { data: memRow } = await client.from('agent_memories').select('memory_text')
            .eq('agent_id', opts.agentId).eq('user_id', userId).maybeSingle();
          existing = String(memRow?.memory_text ?? '');
        }
        const merged = mergeMemoryLines(existing, facts);
        if (!merged.added.length) return { ...base, home: `coworker:${opts.agentId}`, skipped: merged.skipped };
        let text = merged.text;
        if (text.length > MEMORY_TEXT_MAX) {
          const { head, tail } = splitMemoryHeadTail(text);
          const room = MEMORY_TEXT_MAX - head.length - 1;
          if (opts.compressTail && room > 100) {
            try { text = `${head}\n${(await opts.compressTail(tail, room)).trim()}`.trim(); } catch { /* fall through to the line cap */ }
          }
          text = capMemoryKeepHead(text, MEMORY_TEXT_MAX);
        }
        if (isOwner) {
          const { error } = await client.from('custom_agents').update({ memory_text: text }).eq('id', opts.agentId);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await client.from('agent_memories').upsert({
            agent_id: opts.agentId, user_id: userId, memory_text: text, updated_at: new Date().toISOString(),
          }, { onConflict: 'agent_id,user_id' });
          if (error) throw new Error(error.message);
        }
        const home = `coworker:${opts.agentId}`;
        void logFiled(client, userId, { scope: 'coworker_method', home, source: opts.source, facts: merged.added, agentId: opts.agentId });
        return { ...base, home, filed: merged.added, skipped: merged.skipped };
      }
    }
  } catch (e) {
    return { ...base, reason: e instanceof Error ? e.message : 'write failed' };
  }
  return { ...base, reason: 'unknown scope' };
}
