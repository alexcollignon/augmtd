// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEED FLOOR (Sep 21 — generalised from the single-noun document check in the coworker chat
// route, after the live incident: the user said "pause all workflows", the coworker answered
// "Done. Both active workflows are now paused", and exactly ONE had moved).
//
// THE LAW: a reply that CLAIMS a mutation happened must be covered by this turn's own tool ledger —
// a SUCCESSFUL mutating result of that kind, and at least as many objects as the sentence claims.
// Uncovered → ONE corrective round ("do it now, or restate without the claim"); still uncovered →
// the reply ships with an honest amendment, never a second silent lie. The floor is DELIBERATELY
// CONSERVATIVE: a missed catch costs nothing, a false correction costs a wasted round and a
// confused colleague, so every rule wants a perfective marker AND a kind verb in the SAME sentence,
// and questions/offers are stripped before anything is tested.
//
// Pure + exported so the gate can drive it with no model in the loop (smoke-promise · DF).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The classes of mutation a reply can claim. Each is a DIFFERENT kind of lie and a different
 *  corrective sentence — `document` preserves the original Aug-8 check byte-for-byte. */
export type DeedKind = 'document' | 'status' | 'delete' | 'send' | 'run' | 'update' | 'create';

/** One entry in a turn's tool ledger. Written by the route at the tool's return, never parsed back
 *  out of prose: `ok` is the OBSERVED outcome, `count` how many objects actually moved. */
export interface DeedRecord {
  /** The tool that ran (for the corrective sentence — "generate_document was never called"). */
  tool: string;
  kind: DeedKind;
  /** Did the mutation land, as observed after the write? A failed/no-op call is `false`. */
  ok: boolean;
  /** How many objects moved. 1 for a single-object verb; the ledger count for a bulk verb. */
  count: number;
}

export interface DeedFloorVerdict {
  /** The claim this reply makes that the ledger does not cover — null = lawful, ship it. */
  breach: { kind: DeedKind; claimed: number | null; covered: number; sentence: string } | null;
}

// ── Sentence splitting. A question or an offer is NOT a claim: "should I pause it?" / "want me to
// delete the old one?" / "I'll pause them now" all describe a future, and the floor never reads a
// future as a deed. Stripped BEFORE any pattern runs. ──
const FUTURE_OR_ASK =
  /(?:\?\s*$)|\b(?:shall|should|want me|would you like|do you want|i (?:can|could|will|'ll)|let me know|posso|quer que|soll ich|möchten sie|voulez-vous|je (?:peux|vais))\b/i;

function claimingSentences(reply: string): string[] {
  return reply
    .split(/(?<=[.!?\n])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !FUTURE_OR_ASK.test(s));
}

// ── The perfective marker: something in the sentence must say the thing is BEHIND us. Without one,
// "the run is paused while it waits" is a state description, not a claim of a deed done here. ──
// DELIBERATELY NOT markers: quantity words ("both", "all of them") and "already" — "all of them are
// paused" / "they're already paused" are TRUE state reports read straight off list_tasks, and a
// floor that corrected those would be correcting the truth.
const PERFECTIVE =
  /\b(?:i(?:'ve|’ve| have| just)|we(?:'ve|’ve| have)|(?:has|have|had) been|done|all set|successfully|now|✓|feito|agora|erledigt|jetzt|c'est fait|maintenant)\b/i;

/** "I paused both of them" carries no marker word — the SUBJECT is the marker. Deliberately
 *  kind-aware: a bare `(?:i|we) \w+ed` would read "I noticed the task is paused" as a claim, which
 *  is a report of what list_tasks said and nobody's deed. */
const didIt = (kind: DeedKind): RegExp =>
  new RegExp(`\\b(?:i|we)\\s+(?:just\\s+|already\\s+)?(?:${KIND_VERB_SRC[kind]})`, 'i');

// ── The kind verbs. PARTICIPLE/PAST forms only (never the infinitive), so "I can pause it" is
// invisible to the floor and "they are now paused" is not. PT/DE/FR carried only where the repo
// already speaks those languages (the excerpt law's four). ──
const KIND_VERB_SRC: Record<DeedKind, string> = {
  // The ORIGINAL Aug-8 check, preserved exactly (verb + document noun, one expression) — see below.
  document: `(?:i(?:'ve| have)?\\s+(?:created|prepared|generated|put together)|created)\\b[^.!?\\n]{0,80}\\b(?:document|report|file|deck|spreadsheet|presentation|pdf)`,
  status: `paused|unpaused|resumed|reactivated|re-?enabled|deactivated|disabled|activated|turned off|turned on|pausad[oa]s?|retomad[oa]s?|ativad[oa]s?|desativad[oa]s?|pausiert|angehalten|fortgesetzt|aktiviert|deaktiviert|mis en pause|repris|activés?|désactivés?`,
  delete: `deleted|removed|apagad[oa]s?|eliminad[oa]s?|gelöscht|entfernt|supprimés?`,
  send: `sent|emailed|posted|enviad[oa]s?|gesendet|verschickt|envoyés?`,
  run: `ran|started|triggered|kicked off|executad[oa]s?|iniciad[oa]s?|gestartet|ausgeführt|lancés?|exécutés?`,
  update: `updated|changed|renamed|switched|rescheduled|atualizad[oa]s?|alterad[oa]s?|aktualisiert|geändert|mis à jour|modifiés?`,
  create: `created|set up|built|criad[oa]s?|erstellt|angelegt|créés?`,
};

const KIND_VERBS: Record<DeedKind, RegExp> = Object.fromEntries(
  (Object.keys(KIND_VERB_SRC) as DeedKind[]).map((k) => [k, new RegExp(`\\b(?:${KIND_VERB_SRC[k]})\\b`, 'i')]),
) as Record<DeedKind, RegExp>;

// ── The OBJECT NOUN gate. `status` fires on its verb alone (in these surfaces "paused"/"resumed"
// is all but exclusively about automations); every broader verb must also NAME the object it moved,
// or "I've updated the draft" — a prose edit, no tool, no lie — would earn a pointless correction. ──
const MANAGED_OBJECT =
  /\b(?:tasks?|automations?|workflows?|pipelines?|schedules?|steps?|runs?|tarefas?|aufgaben?|arbeitsabläufe?|tâches?)\b/i;
const SENDABLE_OBJECT =
  /\b(?:e-?mails?|messages?|invites?|mail|slack|posts?|newsletters?|nachrichten?|mensagens?|courriels?)\b/i;
const OBJECT_NOUN: Record<DeedKind, RegExp | null> = {
  document: null,          // its own object noun rides inside the kind regex (the Aug-8 shape)
  status: null,            // the verb alone is the object in these surfaces
  delete: MANAGED_OBJECT,
  run: MANAGED_OBJECT,
  update: MANAGED_OBJECT,
  create: MANAGED_OBJECT,
  send: SENDABLE_OBJECT,   // "I've sent you the draft below" must stay invisible; "sent the email" must not
};

// ── The quantity a sentence claims. "both" is 2; "all 3" / "the two" / "3 tasks" are their number;
// a bare "all" states no number and is left UNKNOWN (never guessed into a breach). ──
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  uma: 1, duas: 2, dois: 2, três: 3, eine: 1, zwei: 2, drei: 3, une: 1, deux: 2, trois: 3,
};

export function claimedCountIn(sentence: string): number | null {
  if (/\b(?:both|ambas|ambos|beide|les deux)\b/i.test(sentence)) return 2;
  const digits = sentence.match(/\b(\d{1,3})\b/);
  if (digits) {
    const n = parseInt(digits[1], 10);
    if (n > 0 && n < 1000) return n;
  }
  const word = sentence.toLowerCase().match(/\b(one|two|three|four|five|six|uma|duas|dois|três|eine|zwei|drei|une|deux|trois)\b/);
  if (word) return WORD_NUMBERS[word[1]] ?? null;
  return null;
}

/** How many objects the ledger can honestly account for in this kind (successful entries only). */
export function coveredCount(ledger: readonly DeedRecord[], kind: DeedKind): number {
  return ledger.filter((d) => d.ok && d.kind === kind).reduce((n, d) => n + Math.max(0, d.count), 0);
}

/**
 * THE FLOOR ITSELF. Returns the FIRST breach (one corrective round carries one correction) or a
 * lawful verdict. `ledger` is this TURN's records — a previous turn's deed never covers this
 * turn's claim (that is exactly how "Done" gets recycled).
 */
export function deedFloorVerdict(reply: string, ledger: readonly DeedRecord[]): DeedFloorVerdict {
  const text = (reply ?? '').trim();
  if (!text) return { breach: null };

  for (const sentence of claimingSentences(text)) {
    for (const kind of Object.keys(KIND_VERBS) as DeedKind[]) {
      if (!KIND_VERBS[kind].test(sentence)) continue;
      // `document` carries its own object noun inside its regex and has never wanted a perfective
      // marker — the Aug-8 behaviour, unchanged.
      if (kind !== 'document') {
        if (!PERFECTIVE.test(sentence) && !didIt(kind).test(sentence)) continue;
        const obj = OBJECT_NOUN[kind];
        if (obj && !obj.test(sentence)) continue;
      }
      const covered = coveredCount(ledger, kind);
      const claimed = kind === 'document' ? null : claimedCountIn(sentence);
      if (covered === 0) return { breach: { kind, claimed, covered, sentence } };
      if (claimed !== null && claimed > covered) return { breach: { kind, claimed, covered, sentence } };
    }
  }
  return { breach: null };
}

// ── The two things the floor SAYS. Both are code-owned: the model is told the ledger's truth, never
// asked to guess what went wrong. ──

const KIND_WORDS: Record<DeedKind, { deed: string; tool: string }> = {
  document: { deed: 'a document was created', tool: 'generate_document' },
  status: { deed: 'tasks were paused or resumed', tool: 'set_tasks_status / update_task' },
  delete: { deed: 'something was deleted', tool: 'delete_task' },
  send: { deed: 'something was sent', tool: 'a sending tool' },
  run: { deed: 'a task was run', tool: 'run_task' },
  update: { deed: 'a task was changed', tool: 'update_task' },
  create: { deed: 'something was created', tool: 'create_task' },
};

// ── THE PROSE READER, for lanes that only ever see the tool's RETURNED TEXT (the AgentOS bridge:
// the Python @tools call back into our internal routes, which wrap these same executors, and the
// bridge receives their strings). It is NOT a guess about arbitrary output: every sentence it reads
// is written by OUR executors, deterministically, a few files away. A tool it does not know, or a
// string it cannot read confidently, yields NOTHING — the floor then simply has less to go on,
// which costs a missed catch and never a false correction. ──

const RESULT_KIND: Record<string, DeedKind> = {
  set_tasks_status: 'status',
  update_task: 'update',
  delete_task: 'delete',
  run_task: 'run',
  create_task: 'create',
  duplicate_task: 'create',
  use_task: 'create',
  generate_document: 'document',
};

export function deedFromToolResult(tool: string, result: unknown): DeedRecord | null {
  const kind = RESULT_KIND[tool];
  if (!kind) return null;
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  if (!text) return null;
  switch (tool) {
    case 'set_tasks_status': {
      // The bulk ledger's own opening clause — "Paused 2: …" / "Resumed 1: …" (executeSetTasksStatus).
      const m = text.match(/^(?:Paused|Resumed)\s+(\d+):/);
      const n = m ? parseInt(m[1], 10) : 0;
      return { tool, kind: 'status', ok: n > 0, count: n };
    }
    case 'update_task': {
      if (/^Failed |^Nothing to update|^Step "/.test(text)) return { tool, kind, ok: false, count: 0 };
      const movedStatus = /It is now (?:paused|active)\./.test(text);
      return { tool, kind: movedStatus ? 'status' : 'update', ok: true, count: 1 };
    }
    case 'delete_task':
      return { tool, kind, ok: /permanently deleted/.test(text), count: /permanently deleted/.test(text) ? 1 : 0 };
    case 'run_task': {
      const ok = /is now running|is already running/.test(text);
      return { tool, kind, ok, count: ok ? 1 : 0 };
    }
    default: {
      const ok = !/^Failed |not found/i.test(text);
      return { tool, kind, ok, count: ok ? 1 : 0 };
    }
  }
}

/** The ONE corrective round's instruction — a SYSTEM CHECK, never the user's voice. */
export function deedCorrection(breach: NonNullable<DeedFloorVerdict['breach']>): string {
  const w = KIND_WORDS[breach.kind];
  const truth = breach.covered === 0
    ? `nothing of the kind succeeded this turn (${w.tool} either never ran or reported a failure)`
    : `only ${breach.covered} actually changed, and your reply claims ${breach.claimed}`;
  return (
    `[SYSTEM CHECK — not the user] Your reply says ${w.deed}, but ${truth}. ` +
    `Either call the right tool NOW for each thing you claimed and then summarize what it returned, ` +
    `or restate your reply with only what actually happened — naming each item. ` +
    `Never claim what was not done. Do not apologize or mention this check.`
  );
}

/** The last resort: the reply ships, but it ships TRUE. Appended once, after the one retry. */
export function deedAmendment(breach: NonNullable<DeedFloorVerdict['breach']>): string {
  return breach.covered === 0
    ? `\n\n(Correction: I could not confirm that actually happened — nothing was recorded on my side. Please check before relying on it.)`
    : `\n\n(Correction: ${breach.covered} of those actually changed${breach.claimed ? `, not ${breach.claimed}` : ''} — please check the rest.)`;
}
