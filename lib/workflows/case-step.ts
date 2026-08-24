// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CASE LAYER (THE RELAY CANVAS W4 — docs/relay-canvas-plan.md, spec addendum Aug 24).
//
// René's step 2: "Augmtd links application to job opening." Applications arrive over days through
// many doors; each run carries ONE; the comparison needs the OPENING'S ACCUMULATED candidates.
// Cross-run state — and it needs NO new store.
//
// THE DECIDING LAW: A CASE IS AN ENTITY. No second registry, no `cases` table, no migration. A job
// opening is a `work_entities` row, machine-founded and UNTRACKED (recognition already founds
// untracked entities from real work; THE PINNING LAW is untouched — tracking stays a human
// decision). Riding the one brain buys everything at once: the case has a ROOM, a ledger,
// recognition, portfolio visibility, and THE EXISTING ONE-GROUNDING MACHINERY BECOMES THE CASE'S
// MEMORY — the accumulation store already exists.
//
// ── THE RESOLVE LADDER (match-first; found only when nothing matched) ────────────────────────────
//   0. THE INDEX READ  — item_plans kind 'workflow_case', entity_id `${workflowId}:${entityId}`,
//      tasks {caseName, openedAt}. ONE read; the workflow's own case list (the house storeless
//      precedent). The index is PER-WORKFLOW; the ENTITY is global, so two workflows naming the
//      same opening converge through recognition naturally (spec: not-in-W4 is the SHARED index).
//   1. THE DETERMINISTIC PRE-PASS — distinctive-token overlap (the house idiom: GENERIC_WORK_WORDS
//      never count) between the event text and each indexed case name. EVERY distinctive token of
//      the case name must appear in the event, word-bounded — never a bare `includes` — and the hit
//      must be UNIQUE. A unique confident hit skips the AI entirely.
//   2. ONE CHEAP REASONED RESOLVE — classification tier, conservative by prompt: match only when
//      the event CLEARLY names the same case; otherwise report the case key IN THE EVENT'S OWN
//      WORDS; no key stated → null.
//   3. FOUND — a case key with no match founds the entity the way recognition founds one (kind
//      'initiative', untracked, embedded so the one brain can recall it) + its index row.
//   4. NO KEY → nothing is founded, nothing parks: the step outputs an honest line and the run
//      continues on the workflow's static scope.
//
// ── THE LINK ────────────────────────────────────────────────────────────────────────────────────
// Where the triggering event carried a REAL ATOM (mail → the inbox item, file → the knowledge
// file, meeting → the transcript), the atom joins the case through the EXISTING entity_links
// machinery (via 'workflow_case'), so the case's room fills through the same door every other atom
// uses. THE ATOM COMES FROM THE FIRE RECORD: `item_plans` kind 'reaction_fire' is keyed
// `${workflowId}:${sourceToken}:${eventId}` and queryable by `tasks->>runId` — that key IS the
// seam, and it is the only place a run can learn what arrived. NEVER AN OVERWRITE: entity_links'
// primary key is (user_id, item_kind, item_id), so an atom the one brain has already filed (or
// refused) keeps ITS link — the case layer only fills an empty slot. Manual material carries no
// atom; the card says so rather than implying a filing that never happened.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';
import { GENERIC_WORK_WORDS, entityEmbedText } from '@/lib/entities/recognize';
import { embedText } from '@/lib/knowledge/indexer';
import type { CaseStep } from './types';

export const CASE_INDEX_KIND = 'workflow_case';
/** The run's own resolution, stored so every runs surface can wear the case without re-reasoning. */
export const RUN_CASE_KIND = 'run_case';

export interface CaseResolved {
  none?: false;
  entityId: string;
  name: string;
  /** The case did not exist before this run. */
  founded: boolean;
  /** The triggering atom joined the case's room through entity_links. */
  linked: boolean;
  cardText: string;
}
export interface CaseNone { none: true; cardText: string }
export type CaseOutcome = CaseResolved | CaseNone;

export interface ResolveCaseArgs {
  userId: string;
  workflowId: string;
  workflowName: string;
  step: CaseStep;
  /** Everything this run knows arrived — the trigger context / first material, unclipped. */
  eventText: string;
  /** The run being resolved: the atom seam + the run_case row. Absent = neither is attempted. */
  runId?: string | null;
  /** TEST MODE: match against the existing index only — a simulation never populates the registry. */
  matchOnly?: boolean;
}

// ── The distinctive-token idiom (mirrors namesOverlap's law: a generic work word proves nothing) ──

const fold = (s: string): string =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** The tokens of a case name that can carry identity. Generic work words and 2-letter noise out. */
export function distinctiveTokens(name: string): string[] {
  return [...new Set(
    fold(String(name ?? '')).split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !GENERIC_WORK_WORDS.has(t) && !/^(ai|ia|ml)$/.test(t)),
  )];
}

/** Word-bounded containment — never a bare `includes` (a substring is not a name). */
function textHasToken(foldedText: string, token: string): boolean {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(foldedText);
}

/** THE PRE-PASS: a case name ALL of whose distinctive tokens the event states. Pure, gate-testable. */
export function deterministicCaseMatch(
  eventText: string, cases: Array<{ entityId: string; caseName: string }>,
): { entityId: string; caseName: string } | null {
  const hay = fold(String(eventText ?? ''));
  if (!hay.trim()) return null;
  const hits = cases.filter((c) => {
    const toks = distinctiveTokens(c.caseName);
    return toks.length > 0 && toks.every((t) => textHasToken(hay, t));
  });
  // A UNIQUE confident hit only — two indexed cases both stated means the event is ambiguous, and
  // ambiguity is exactly what the reasoned pass is for.
  return hits.length === 1 ? hits[0] : null;
}

// ── The index (the workflow's own case list) ─────────────────────────────────────────────────────

export interface IndexedCase { entityId: string; caseName: string; openedAt?: string }

export async function readCaseIndex(
  admin: SupabaseClient, userId: string, workflowId: string,
): Promise<IndexedCase[]> {
  try {
    const { data, error } = await admin.from('item_plans').select('entity_id, tasks')
      .eq('user_id', userId).eq('kind', CASE_INDEX_KIND)
      .like('entity_id', `${workflowId}:%`).limit(200);
    if (error) { console.error('[case] index read failed:', error.message); return []; }
    return ((data ?? []) as Array<{ entity_id: string; tasks: { caseName?: string; openedAt?: string } | null }>)
      .map((r) => ({
        entityId: String(r.entity_id).slice(workflowId.length + 1),
        caseName: String(r.tasks?.caseName ?? '').trim(),
        openedAt: r.tasks?.openedAt,
      }))
      .filter((c) => c.entityId && c.caseName);
  } catch (e) { console.error('[case] index read threw:', e); return []; }
}

// ── The reasoned resolve (ONE classification-tier call per run) ──────────────────────────────────

export async function judgeCase(
  admin: SupabaseClient, userId: string, instruction: string, eventText: string, cases: IndexedCase[],
): Promise<{ match: string | null; caseKey: string | null }> {
  try {
    const { client, model } = await getAIClient(userId, 'classification', admin);
    const head = clipForPrompt(String(eventText ?? '').trim(), 4000);
    const known = cases.length
      ? cases.map((c) => `- ${c.caseName}`).join('\n')
      : '(none yet — this workflow has opened no cases)';
    const res = await aiCreate(client, {
      model,
      messages: [
        {
          role: 'system',
          content:
            'You file one arriving item against a list of OPEN CASES. Be conservative: match ONLY when the ' +
            'item CLEARLY names the same case as one on the list — a maybe is not a match (a wrong file ' +
            'mixes two bodies of work; a missed one merely opens a duplicate the user can merge). When ' +
            'nothing on the list matches, report the case key THE ITEM ITSELF STATES, in the item\'s own ' +
            'words (never invented, never generalized). THE KEY MUST BE AN INSTANCE OF WHAT THE USER ' +
            'DESCRIBED as identifying a case — never an incidental token that happens to be present (a ' +
            'reference code, a date, a sender\'s name) unless that is exactly what they described. If the ' +
            'item names no such case at all, both fields are null. ' + EXCERPT_RULE + ' Respond with ONLY JSON: ' +
            '{"match":"<the exact case name from the list, or null>","caseKey":"<the case this item names, or null>"}',
        },
        {
          role: 'user',
          content:
            `WHAT IDENTIFIES A CASE HERE: ${String(instruction ?? '').slice(0, 300)}\n\n` +
            `OPEN CASES:\n${known}\n\nTHE ITEM THAT ARRIVED:\n${head}`,
        },
      ],
      max_tokens: 200,
      temperature: 0,
    });
    const p = parseModelJSON<{ match?: string | null; caseKey?: string | null }>(
      res.choices?.[0]?.message?.content ?? '', {},
    );
    const clean = (v: unknown): string | null => {
      const s = String(v ?? '').trim();
      return s && !/^(null|none|n\/a|unknown)$/i.test(s) ? s.slice(0, 80) : null;
    };
    return { match: clean(p.match), caseKey: clean(p.caseKey) };
  } catch (e) {
    // AI failure ≠ a case and ≠ a fabricated one: the step says so honestly and the run proceeds.
    console.error('[case] resolve failed:', e);
    return { match: null, caseKey: null };
  }
}

// ── The atom seam (what actually arrived on this run) ────────────────────────────────────────────

/** Mail's fire token is the HISTORICAL 'inbox' (pinned in reactions.ts); the rest are registry keys. */
const ITEM_KIND_BY_TOKEN: Record<string, string> = {
  inbox: 'inbox_item',
  meeting: 'meeting',
  file: 'knowledge_file',
};

/** THE ATOM THREADING SEAM: the run knows its trigger CONTEXT but not its event id — the fire
 *  record does. It is keyed `${workflowId}:${token}:${eventId}` and findable by `tasks->>runId`. */
export async function atomForRun(
  admin: SupabaseClient, userId: string, runId: string,
): Promise<{ itemKind: string; itemId: string } | null> {
  try {
    const { data } = await admin.from('item_plans').select('entity_id')
      .eq('user_id', userId).eq('kind', 'reaction_fire').eq('tasks->>runId', runId).limit(1);
    const key = (data ?? [])[0]?.entity_id as string | undefined;
    if (!key) return null;
    // workflowId is a uuid (no colons); token is the 2nd segment; the tail is the event id.
    const parts = String(key).split(':');
    if (parts.length < 3) return null;
    const token = parts[1];
    const itemId = parts.slice(2).join(':');
    const itemKind = ITEM_KIND_BY_TOKEN[token];
    // A `workflow` door's "atom" is another RUN — not a filable item. No link, said honestly.
    return itemKind && itemId ? { itemKind, itemId } : null;
  } catch { return null; }
}

// ── The one resolve every run calls ──────────────────────────────────────────────────────────────

export async function resolveCaseForRun(
  admin: SupabaseClient, args: ResolveCaseArgs,
): Promise<CaseOutcome> {
  const { userId, workflowId, workflowName, step, eventText, runId, matchOnly } = args;
  const instruction = String(step.case_instruction ?? '').trim();
  const noneCard = (why: string): CaseNone => ({ none: true, cardText: why });

  try {
    const index = await readCaseIndex(admin, userId, workflowId);

    // 1 + 2 — the ladder.
    let hit = deterministicCaseMatch(eventText, index);
    let path: 'deterministic' | 'reasoned' = 'deterministic';
    let caseKey: string | null = null;
    if (!hit) {
      path = 'reasoned';
      const verdict = await judgeCase(admin, userId, instruction, eventText, index);
      if (verdict.match) {
        const m = fold(verdict.match);
        hit = index.find((c) => fold(c.caseName) === m)
          ?? index.find((c) => fold(c.caseName).includes(m) || m.includes(fold(c.caseName)))
          ?? null;
      }
      caseKey = verdict.caseKey;
    }

    if (!hit && !caseKey) {
      return noneCard(
        matchOnly
          ? 'No case named in this material — continuing without one. [test mode — no case opened]'
          : 'No case named in this material — continuing without one.',
      );
    }

    // 3 — FOUND (never in test mode: a simulation must not populate the registry).
    let founded = false;
    let entityId: string;
    let name: string;
    if (hit) {
      entityId = hit.entityId; name = hit.caseName;
    } else {
      if (matchOnly) {
        return noneCard(`"${caseKey}" doesn't match an open case yet. [test mode — no case opened]`);
      }
      const created = await foundCase(admin, userId, workflowId, workflowName, caseKey!, eventText);
      if (!created) return noneCard('The case could not be opened — continuing without one.');
      entityId = created; name = caseKey!; founded = true;
    }

    // THE LINK — the atom joins the case's room through the door every other atom uses.
    let linked = false;
    let linkNote = '';
    if (!matchOnly && runId) {
      const atom = await atomForRun(admin, userId, runId);
      if (atom) {
        linked = await linkAtomToCase(admin, userId, entityId, atom, workflowName);
        if (!linked) linkNote = ' It was already filed elsewhere, so its own link stands.';
      } else {
        linkNote = ' This one arrived as material, so there is nothing to file.';
      }
    }

    // The run wears its case (one tiny durable row; the runs surfaces batch-read it).
    if (!matchOnly && runId) await stampRunCase(admin, userId, runId, entityId, name);

    const held = await countCaseItems(admin, userId, entityId);
    const arrival = firstLine(eventText);
    const cardText =
      `${founded ? 'Opened a new case: ' : ''}${name} — ${arrival}. ` +
      `The case now holds ${held} linked item${held === 1 ? '' : 's'}.${linkNote}` +
      (matchOnly ? ' [test mode — no case opened]' : '');
    console.log(`[case] ${founded ? 'founded' : 'matched'} "${name}" via the ${hit ? path : 'reasoned'} path`);
    return { entityId, name, founded, linked, cardText: cardText.slice(0, 600) };
  } catch (e) {
    console.error('[case] resolve threw:', e);
    return noneCard('The case step could not run — continuing without one.');
  }
}

/** One line describing what arrived — the event's own first real line, honestly clipped. */
function firstLine(eventText: string): string {
  const lines = String(eventText ?? '').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('[') && !l.startsWith('('));
  return clipForPrompt(lines[0] ?? 'new material arrived', 120);
}

/** FOUND — mirrors recognition's founding writer exactly: kind 'initiative', UNTRACKED (the column
 *  defaults false and is never set here — THE PINNING LAW), embedded so the one brain can recall
 *  it, `last_event_at` stamped. Plus the workflow's index row. */
async function foundCase(
  admin: SupabaseClient, userId: string, workflowId: string, workflowName: string,
  caseName: string, eventText: string,
): Promise<string | null> {
  const summary = `Case opened by the "${workflowName}" workflow — ${clipForPrompt(firstLine(eventText), 120)}`
    .slice(0, 200);
  let emb: number[] | null = null;
  try { emb = await embedText(entityEmbedText(caseName, summary, []), userId, admin); }
  catch { /* the case still exists without a recall vector */ }
  const { data: created, error } = await admin.from('work_entities').insert({
    user_id: userId, kind: 'initiative', name: caseName, summary,
    ...(emb ? { embedding: emb } : {}),
    last_event_at: new Date().toISOString(),
  }).select('id').single();
  if (error || !created) { console.error('[case] founding failed:', error?.message); return null; }
  const entityId = (created as { id: string }).id;
  const { error: idxErr } = await admin.from('item_plans').insert({
    user_id: userId, kind: CASE_INDEX_KIND, entity_id: `${workflowId}:${entityId}`,
    tasks: { caseName, openedAt: new Date().toISOString() },
  });
  if (idxErr) console.error('[case] index write failed:', idxErr.message);
  return entityId;
}

/** NEVER AN OVERWRITE: an atom the one brain already filed (or refused) keeps its own link. */
async function linkAtomToCase(
  admin: SupabaseClient, userId: string, entityId: string,
  atom: { itemKind: string; itemId: string }, workflowName: string,
): Promise<boolean> {
  try {
    const { data: existing } = await admin.from('entity_links').select('entity_id')
      .eq('user_id', userId).eq('item_kind', atom.itemKind).eq('item_id', atom.itemId).maybeSingle();
    if (existing) return (existing as { entity_id: string | null }).entity_id === entityId;
    const { error } = await admin.from('entity_links').insert({
      user_id: userId, entity_id: entityId, item_kind: atom.itemKind, item_id: atom.itemId,
      via: 'workflow_case', reason: `arrived through ${workflowName}`.slice(0, 140),
    });
    if (error) { console.error('[case] link failed:', error.message); return false; }
    // THE GROUNDING SEES WHAT THE FILING WROTE: the room grounding reads documents off
    // knowledge_files.entity_id (assembleRoomGrounding's entity_links read covers only
    // inbox items and commitments), so a filed file must ALSO wear the case's stamp or it
    // accumulates invisibly — the link exists but no later run's comparison can see it.
    // Fill-if-empty only (`.is('entity_id', null)`), the same idiom lib/knowledge/ingest.ts
    // uses at upload: a file the one brain already homed keeps its home. Non-fatal.
    if (atom.itemKind === 'knowledge_file') {
      await admin.from('knowledge_files').update({ entity_id: entityId })
        .eq('id', atom.itemId).eq('user_id', userId).is('entity_id', null)
        .then(() => {}, () => {});
    }
    return true;
  } catch { return false; }
}

async function stampRunCase(
  admin: SupabaseClient, userId: string, runId: string, entityId: string, name: string,
): Promise<void> {
  const { error } = await admin.from('item_plans').upsert({
    user_id: userId, kind: RUN_CASE_KIND, entity_id: runId,
    tasks: { entityId, name }, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' });
  if (error) console.error('[case] run stamp failed:', error.message);
}

async function countCaseItems(admin: SupabaseClient, userId: string, entityId: string): Promise<number> {
  try {
    const { count } = await admin.from('entity_links').select('item_id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('entity_id', entityId);
    return count ?? 0;
  } catch { return 0; }
}
