// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE CoS EVALUATOR (orchestrated-loop O4) — nothing reaches the user's desk unreviewed. One cheap
// reasoned review of every prepared artifact WITH THE DEAL IN VIEW: the recipient's identity, the
// project's goals/rules, and sanity (does the content actually serve the task; no invented facts).
//
// Verdicts: pass · revise (the caller regenerates ONCE with the objection — evaluator-optimizer,
// capped) · flag (the artifact still surfaces, honestly annotated — we never silently discard work).
//
// Defense in depth, both layers reasoned: identity failures are caught STRUCTURALLY first (a draft
// addressed to the user themself can never pass — the registry answers that before any AI runs);
// the AI review judges what structure can't (fit, tone, rule violations). The verdict is stored ON
// the artifact (its cache) — an artifact is evaluated once, at birth.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { getPersonEntities, resolveIdentity } from '@/lib/entities/people';
import { claimsUndoneWork, completionObjection } from '@/lib/prepare/truth';

export type EvalVerdict = {
  verdict: 'pass' | 'revise' | 'flag' | 'needs_input';
  objection: string | null;
  /** needs_input only — the concrete things the author is asking the principal for. The caller
   *  routes these as an ASK (a room turn + checklist), never as a stored deliverable. */
  missing?: string[];
};

/** A trailing connector — a cut landing between a clause and what it was about to say. */
const DANGLING_END = /[,\-–—]$/;
/** Emphasis/code opened on the final line and never closed: a cut INSIDE a structural line. */
function unclosed(line: string): boolean {
  return (line.split('**').length - 1) % 2 === 1
    || (line.split('`').length - 1) % 2 === 1
    || (line.match(/\[/g) ?? []).length > (line.match(/\]/g) ?? []).length;
}

/**
 * THE MECHANICAL TRUNCATION FLOOR (W6, "the Gap: Cloud-native da" class) — a deliverable that ends
 * mid-word/mid-clause is machine-detectable, and a coworker must never hand the principal their own
 * truncation. Exported so a zero-AI gate can hold it: it is a HEURISTIC, and a heuristic that
 * decides whether finished work gets destroyed needs a floor of its own.
 *
 * THE STRUCTURED ENDING IS A BOUNDARY (Sep 21, found by the T2 replay — the defect this law caused).
 * The test read "no terminal punctuation" as "cut off", so a deliverable whose last line is a bullet,
 * a heading or a table row — the shape the user LITERALLY asked for ("I need it in bullet points") —
 * was condemned for ending like a list instead of like a paragraph. The better the coworker obeyed
 * the format, the more certainly the work was destroyed and the user asked to regenerate it. A list
 * item is a complete unit of writing; only PROSE owes a full stop. Inside a structural line the cut
 * signatures still fire (unclosed emphasis, a dangling connector), so a real mid-item cut is caught.
 *
 * The asymmetry is deliberate, and it is the repo's standing doctrine for machine floors: a missed
 * catch costs one honest flag downstream; a FALSE catch destroys a finished deliverable AND makes
 * the system lie to the user about its own work.
 */
export function looksMechanicallyTruncated(content: string): boolean {
  const t = String(content ?? '').trimEnd();
  if (t.length <= 400) return false;
  if (/[.!?…)"'\]\}»:;]$/.test(t)) return false;     // terminal punctuation/closure
  if (!/[a-z0-9,\-–—]$/i.test(t)) return false;      // ends inside a word/clause
  const last = t.slice(t.lastIndexOf('\n') + 1).trim();
  const structural = /^([-*+]\s|\d+[.)]\s|#{1,6}\s|>\s|\|)/.test(last);
  if (!structural) return true;
  return DANGLING_END.test(last) || unclosed(last);
}

export async function evaluateDeliverable(admin: SupabaseClient, userId: string, args: {
  content: string;
  task: string;                    // what this was prepared FOR
  recipient?: string | null;       // the intended counterparty (raw form)
  entityId?: string | null;        // the deal — its goals/rules constrain the review
  kind: 'reply' | 'nudge' | 'deliverable';
  /** THE RECEIPT OUTRANKS THE GUESS (Sep 21): the producer knows whether its own completion
   *  finished (finish_reason 'stop') — when it says so, the truncation HEURISTIC below is off,
   *  because a heuristic may never overrule a fact. Absent/undefined → no receipt, floor applies. */
  sourceComplete?: boolean;
  /** THE COMPLETION FLOOR's facts (W5a) — code's, never the model's. `obligationOpen`: the user
   *  still owes what these words are about; `staged`: a real attachment/deliverable rides with
   *  them. Absent → the floor is off (a heuristic never speaks without its facts). */
  obligationOpen?: boolean;
  staged?: boolean;
}): Promise<EvalVerdict> {
  try {
    // Structural, before the review; the caller's capped revision regenerates it complete (or it
    // surfaces honestly flagged).
    if (args.sourceComplete !== true && looksMechanicallyTruncated(args.content)) {
      return { verdict: 'revise', objection: 'The deliverable appears CUT OFF mid-sentence at the end — regenerate it complete; never hand over a truncated document.' };
    }
    // ── THE COMPLETION FLOOR (W5a — the fabricated-deed class, found live: "I've finished the
    // redistribution… everything is balanced now" on an open obligation nothing had touched). A
    // message about an OPEN obligation with nothing staged may not announce a deed. Deterministic,
    // narrow vocabulary (lib/prepare/truth), fail-safe: it speaks only with its facts in hand. ──
    if (args.kind !== 'deliverable' && args.obligationOpen === true) {
      const claim = claimsUndoneWork(args.content, { obligationOpen: true, staged: args.staged === true });
      if (claim) return { verdict: 'revise', objection: completionObjection(claim) };
    }
    // ── STRUCTURAL floor: an artifact addressed to the USER THEMSELF is wrong at birth (the
    // self-nudge class) — no AI needed, the registry answers. T3 adds the twin: an AUTOMATED /
    // no-reply recipient can never receive anything (a reply to a password-reset reaches no one). ──
    if (args.recipient) {
      const persons = await getPersonEntities(admin, userId);
      if (resolveIdentity(persons, args.recipient).isSelf) {
        return { verdict: 'revise', objection: 'This is addressed to the user themself — the counterparty is wrong. Address the real other party, or state that no message is needed.' };
      }
      const { parseWho } = await import('@/lib/entities/people');
      const { isAutomatedSender } = await import('@/lib/inbox/automated');
      const { email, name } = parseWho(args.recipient);
      if ((args.kind === 'reply' || args.kind === 'nudge') && isAutomatedSender(email, name, '')) {
        return { verdict: 'revise', objection: 'The recipient is an automated/no-reply address — a message to it reaches no one. No reply applies here.' };
      }
    }

    // ── THE ARITHMETIC FLOOR (Arc 1 — computed numbers, never asserted): claims the artifact
    // itself makes that code can recompute ARE recomputed (totals, % changes, date↔weekday).
    // Only a code-confirmed mismatch speaks — and it revises with the exact numbers, so the
    // regeneration knows precisely what to fix. Quote-law-guarded; outage speaks no verdict. ──
    {
      const { verifyComputableClaims } = await import('@/lib/prepare/verify-claims');
      const mismatches = await verifyComputableClaims(admin, userId, args.content);
      if (mismatches.length) {
        return {
          verdict: 'revise',
          objection: `The numbers don't check out — recompute and fix: ${mismatches
            .map((m) => `"${m.quote}" states ${m.stated} but the correct value is ${m.expected}`)
            .join('; ')}`.slice(0, 300),
        };
      }
    }

    // ── The deal's constraints (goals/rules) — the review judges against declared intent. ──
    let dealBlock = '';
    if (args.entityId) {
      const { data: ent } = await admin.from('work_entities').select('name, goals, rules')
        .eq('id', args.entityId).eq('user_id', userId).maybeSingle();
      if (ent) {
        const goals = Array.isArray(ent.goals) ? (ent.goals as string[]).filter(Boolean) : [];
        const rules = Array.isArray(ent.rules) ? (ent.rules as string[]).filter(Boolean) : [];
        if (goals.length || rules.length) {
          dealBlock = `THE DEAL (${ent.name}):\n${goals.length ? `Goals: ${goals.join(' · ')}\n` : ''}${rules.length ? `Rules that must be respected: ${rules.join(' · ')}\n` : ''}`;
        }
      }
    }

    const res = await aiCall<{ verdict?: string; objection?: string; missing?: unknown[] }>({
      userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 200, source: 'task_preparation',
      prompt: `You are a chief of staff reviewing a colleague's prepared ${args.kind} before it reaches your principal's desk.\n\n` +
        `PREPARED FOR THE TASK: ${args.task.slice(0, 160)}\n` +
        (args.recipient ? `INTENDED RECIPIENT: ${args.recipient.slice(0, 120)}\n` : '') +
        (dealBlock ? `${dealBlock}` : '') +
        `\nTHE ARTIFACT:\n${args.content.slice(0, 2500)}\n\n` +
        `Judge it:\n` +
        `- "pass" — it serves the task, fits the recipient, respects the deal's rules. The BAR IS USEFUL, not perfect: style nits are a pass.\n` +
        `- "revise" — a fixable substantive problem (wrong recipient/framing, violates a stated rule, misses the task, invents a fact). State the ONE objection to fix.\n` +
        `- "revise" ALSO when the artifact is not a DELIVERABLE at all: deliberation, planning talk, meta-commentary about instructions, or "I need to…" process narration is the author thinking out loud, not the finished thing a colleague would hand over. A monologue about how to approach the task is never a deliverable.\n` +
        `- "needs_input" — the artifact is fundamentally an ASK: the author cannot proceed AT ALL because the work is genuinely impossible or meaningless without concrete things only the principal can supply (a file, a decision, an approval, missing facts), and they are requesting them. This is not a flaw for the author to fix alone — it is a request to ROUTE to the principal. List each concrete missing thing as a short noun phrase. NOT needs_input: a real partial deliverable built from what was available with its gaps honestly noted — that is a "pass" (or "flag" if a gap is material); incompleteness with honest gaps is a deliverable, not an ask.\n` +
        `- "flag" — you can't verify something material; the principal should see it with a caution. State what to check.\n\n` +
        `JSON only: {"verdict":"pass|revise|flag|needs_input","objection":"<one sentence, or empty for pass>","missing":["<concrete thing needed>", ...] (needs_input only, else [])}`,
    });
    const v = res.json?.verdict;
    if (v === 'needs_input') {
      const missing = (Array.isArray(res.json?.missing) ? res.json!.missing! : [])
        .map((m) => String(m ?? '').trim().slice(0, 140)).filter(Boolean).slice(0, 6);
      const objection = (res.json?.objection || '').slice(0, 300) || null;
      // A needs_input with nothing named falls back to the objection as the one ask; with neither,
      // it degrades to a flag (the principal should still see it — we never silently discard).
      if (missing.length) return { verdict: 'needs_input', objection, missing };
      if (objection) return { verdict: 'needs_input', objection, missing: [objection] };
      return { verdict: 'flag', objection: 'The author appears to need something from you, but did not say what — check the output.' };
    }
    if (v === 'revise' || v === 'flag') return { verdict: v, objection: (res.json?.objection || '').slice(0, 300) || null };
    return { verdict: 'pass', objection: null };
  } catch {
    // FAILURE HONESTY (W2): a reviewer outage is not a pass — unreviewed work still surfaces
    // (never blocks), but wearing the honest caution instead of a silent green light.
    return { verdict: 'flag', objection: 'The reviewer was unavailable — this went out unreviewed; give it a once-over.' };
  }
}
