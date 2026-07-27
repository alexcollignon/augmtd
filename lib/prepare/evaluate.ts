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

export type EvalVerdict = { verdict: 'pass' | 'revise' | 'flag'; objection: string | null };

export async function evaluateDeliverable(admin: SupabaseClient, userId: string, args: {
  content: string;
  task: string;                    // what this was prepared FOR
  recipient?: string | null;       // the intended counterparty (raw form)
  entityId?: string | null;        // the deal — its goals/rules constrain the review
  kind: 'reply' | 'nudge' | 'deliverable';
}): Promise<EvalVerdict> {
  try {
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

    const res = await aiCall<{ verdict?: string; objection?: string }>({
      userId, supabase: admin, shape: { output: 'json' }, temperature: 0, maxTokens: 200, source: 'task_preparation',
      prompt: `You are a chief of staff reviewing a colleague's prepared ${args.kind} before it reaches your principal's desk.\n\n` +
        `PREPARED FOR THE TASK: ${args.task.slice(0, 160)}\n` +
        (args.recipient ? `INTENDED RECIPIENT: ${args.recipient.slice(0, 120)}\n` : '') +
        (dealBlock ? `${dealBlock}` : '') +
        `\nTHE ARTIFACT:\n${args.content.slice(0, 2500)}\n\n` +
        `Judge it:\n` +
        `- "pass" — it serves the task, fits the recipient, respects the deal's rules. The BAR IS USEFUL, not perfect: style nits are a pass.\n` +
        `- "revise" — a fixable substantive problem (wrong recipient/framing, violates a stated rule, misses the task, invents a fact). State the ONE objection to fix.\n` +
        `- "revise" ALSO when the artifact is not a DELIVERABLE at all: deliberation, planning talk, meta-commentary about instructions, or "I need to…" process narration is the author thinking out loud, not the finished thing a colleague would hand over. A deliverable that opens with an honest one-line question to the principal ("I'm missing X — where is it?") IS acceptable; a monologue about how to approach the task is not.\n` +
        `- "flag" — you can't verify something material; the principal should see it with a caution. State what to check.\n\n` +
        `JSON only: {"verdict":"pass|revise|flag","objection":"<one sentence, or empty for pass>"}`,
    });
    const v = res.json?.verdict;
    if (v === 'revise' || v === 'flag') return { verdict: v, objection: (res.json?.objection || '').slice(0, 300) || null };
    return { verdict: 'pass', objection: null };
  } catch { return { verdict: 'pass', objection: null }; } // review is an enhancement — never blocks the work
}
