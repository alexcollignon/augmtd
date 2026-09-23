// ════════════════════════════════════════════════════════════════════════════════════════════════
// W10 THE RULE EXECUTOR — a user's standing rule ACTS on the mail it matches.
//
// THE RULES TRUTH AUDIT (Sep 23): before this module only `set_type` was ever read (render-time in
// classify-item.ts, sync-time via batch-match → rule_type). `archive`, `trash`, `mark_read`,
// `set_kind`, `auto_draft`, `escalate` and `forward_to` could all be authored — the bulk-deed tail
// even OFFERED "archive newsletters as they arrive" — and nothing executed any of them. A door the
// user can open that does nothing is a lie. Now:
//
//   EXECUTED HERE (on mail as it ARRIVES — a rule whose trigger is 'received'):
//     set_kind    → `source_data.kind_override` on the item (in-app: the kind floor + routing read it)
//     apply_label → the user's OWN mailbox label (Gmail label, created if missing; Outlook category)
//     mark_read   → read in the mailbox + in-app
//     archive     → out of the inbox (Gmail: INBOX removed; Outlook: moved to Archive); the in-app
//                   item goes to Handled (dismissed, `archived_at`), exactly like the archive button
//     trash       → to Trash / Deleted Items (reversible — never a permanent delete); supersedes archive
//   These are the user's own standing instructions on the user's own mailbox, like a Gmail filter:
//   reversible, LOGGED in activity (`rule_applied`), EXACTLY ONCE per (rule, message) through the
//   commit door's claim. They apply whatever `auto_label` says — that switch governs AUGMTD's own
//   posture labels only (label-name.ts). The rule's own `enabled` toggle is its switch.
//
//   NEVER EXECUTED: `forward_to` (an external send — the egress floor + human-in-the-loop keep it
//   unexecuted AND unauthorable), `auto_draft`, `escalate` (per-rule promises no code keeps; not
//   authorable, stripped on save). This file must never import a send path.
//
// Called from ONE site: lib/email-sync/sync-emails.ts, after the sync's tail has drained (so every
// source_data rebuild for the message is done and the kind override is not overwritten).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import type { InboxRule, RuleEmail } from './types';
import { evaluateDeterministic } from './evaluate';
import { validateUserLabelName } from './label-name';

export type RuleDeed = 'set_kind' | 'apply_label' | 'mark_read' | 'archive' | 'trash';

const KINDS = new Set(['receipt', 'newsletter', 'notification', 'calendar', 'cold_outreach', 'customer', 'team', 'personal']);

export type RuleDeedPlan = { deeds: RuleDeed[]; label: string | null; kind: string | null };

/** PURE — what a matched rule does to ONE arriving message, in execution order (label before any
 *  move; trash supersedes archive). A disabled rule, or a mailbox deed on a sent-mail rule, plans
 *  nothing. Keys outside the executed set (forward_to, auto_draft, escalate) are never planned. */
export function planRuleDeeds(rule: Pick<InboxRule, 'enabled' | 'trigger' | 'outcome'> | null | undefined): RuleDeedPlan {
  const plan: RuleDeedPlan = { deeds: [], label: null, kind: null };
  if (!rule || !rule.enabled) return plan;
  const o = rule.outcome ?? {};
  if (o.set_kind && KINDS.has(o.set_kind)) { plan.deeds.push('set_kind'); plan.kind = o.set_kind; }
  if (rule.trigger !== 'received') return plan; // mailbox deeds act on ARRIVING mail only
  if (o.apply_label) {
    const v = validateUserLabelName(o.apply_label);
    if (v.ok) { plan.deeds.push('apply_label'); plan.label = v.name; }
  }
  if (o.mark_read === true) plan.deeds.push('mark_read');
  if (o.trash === true) plan.deeds.push('trash');
  else if (o.archive === true) plan.deeds.push('archive');
  return plan;
}

/** PURE — the ONE rule that governs an arriving message: the engine's deterministic order first
 *  (first match by priority), else the AI pass's match (same direction, enabled). */
export function governingRule(email: RuleEmail, rules: InboxRule[], aiMatched: InboxRule | null | undefined): InboxRule | null {
  const det = evaluateDeterministic(email, rules);
  if (det) return det;
  if (aiMatched && aiMatched.enabled && aiMatched.trigger === email.direction) return aiMatched;
  return null;
}

export type RuleDeedJob = {
  ruleId: string;
  ruleName: string;
  plan: RuleDeedPlan;
  emailId: string;
  /** The inbox item's thread key (thread_id || message_id) — how the item is found. */
  threadKey: string;
  gmailThreadId: string | null;
  gmailMessageId: string | null;
  outlookMessageId: string | null;
  subject: string;
};

/** PURE — the job for one stored inbound message, or null when no rule governs it / it does nothing. */
export function ruleDeedJobFor(args: {
  rules: InboxRule[];
  aiMatched?: InboxRule | null;
  email: RuleEmail;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stored: { id: string; thread_id?: string | null; message_id?: string | null; subject?: string | null; metadata?: any };
}): RuleDeedJob | null {
  const rule = governingRule(args.email, args.rules, args.aiMatched ?? null);
  if (!rule) return null;
  const plan = planRuleDeeds(rule);
  if (!plan.deeds.length) return null;
  const s = args.stored;
  return {
    ruleId: String(rule.id ?? rule.name),
    ruleName: rule.name,
    plan,
    emailId: s.id,
    threadKey: String(s.thread_id || s.message_id || ''),
    gmailThreadId: s.thread_id ?? null,
    gmailMessageId: (s.metadata?.gmail_id as string) ?? null,
    outlookMessageId: (s.metadata?.outlook_id as string) ?? null,
    subject: String(s.subject ?? ''),
  };
}

/** PURE — the RuleEmail the engine evaluates, from a parsed/stored message. */
export function ruleEmailOf(m: {
  from_address?: string | null; to_addresses?: string[] | null; cc_addresses?: string[] | null;
  subject?: string | null; body?: string | null; labels?: string[] | null; is_from_user?: boolean | null;
}): RuleEmail {
  return {
    direction: m.is_from_user ? 'sent' : 'received',
    from: String(m.from_address ?? '').toLowerCase(),
    to: m.to_addresses ?? [],
    cc: m.cc_addresses ?? [],
    subject: String(m.subject ?? ''),
    body: String(m.body ?? ''),
    labels: m.labels ?? [],
  };
}

const DEED_WORD: Record<RuleDeed, string> = {
  set_kind: 'treated it as', apply_label: 'labelled it', mark_read: 'marked it read', archive: 'archived it', trash: 'moved it to trash',
};

/** PURE — the activity line (what the user reads in /activity). */
export function ruleActivityTitle(job: RuleDeedJob, done: RuleDeed[]): string {
  const parts = done.map((d) => d === 'apply_label' ? `labelled it “${job.plan.label}”` : d === 'set_kind' ? `treated it as ${String(job.plan.kind).replace('_', ' ')}` : DEED_WORD[d]);
  const subj = job.subject ? `“${job.subject.slice(0, 120)}”` : 'a message';
  return `Your rule “${job.ruleName.slice(0, 80)}” ${parts.join(', ')} — ${subj}`;
}

export type RuleDeedReport = { jobs: number; executed: number; duplicates: number; failed: number; leftBehind: number; deeds: Partial<Record<RuleDeed, number>> };

type Conn = { id: string; provider: string; metadata?: { tokens?: string } | null };

/**
 * THE EXECUTOR. Runs each job's plan, bounded by `deadlineMs`; what the clock leaves is REPORTED.
 * Mailbox deeds pass the commit door's claim (key `rule:<ruleId>:<emailId>`) — a raced or re-run
 * sync never repeats them. NEVER throws.
 */
export async function executeRuleDeeds(
  sb: SupabaseClient,
  args: { userId: string; connection: Conn; jobs: RuleDeedJob[]; deadlineMs?: number },
): Promise<RuleDeedReport> {
  const report: RuleDeedReport = { jobs: args.jobs.length, executed: 0, duplicates: 0, failed: 0, leftBehind: 0, deeds: {} };
  const deadline = Date.now() + (args.deadlineMs ?? 60_000);
  const tokens = args.connection.metadata?.tokens;
  const provider = args.connection.provider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let gmailCache: any = null;

  for (let i = 0; i < args.jobs.length; i++) {
    const job = args.jobs[i];
    if (Date.now() > deadline) { report.leftBehind += args.jobs.length - i; break; }
    try {
      const { data: item, error: itemErr } = await sb.from('inbox_items')
        .select('id, status, source_data')
        .eq('user_id', args.userId).eq('source', 'email').eq('source_data->>thread_id', job.threadKey)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (itemErr) console.warn('[rule-deeds] item read failed:', itemErr.message);
      const done: RuleDeed[] = [];
      let sdCur = ((item?.source_data ?? {}) as Record<string, unknown>);

      // ── set_kind — in-app only, idempotent (a fresh read + merge; no claim needed) ──
      if (job.plan.deeds.includes('set_kind') && item?.id && job.plan.kind) {
        if (sdCur.kind_override !== job.plan.kind) {
          const next = { ...sdCur, kind_override: job.plan.kind };
          const { error } = await sb.from('inbox_items').update({ source_data: next }).eq('id', item.id).eq('user_id', args.userId);
          if (!error) { done.push('set_kind'); sdCur = next; }
        }
      }

      // ── mailbox deeds — through the commit door's claim, exactly once per (rule, message) ──
      const mailbox = job.plan.deeds.filter((d) => d !== 'set_kind');
      if (mailbox.length && tokens) {
        const { claimCommit, recordCommitResult, releaseCommitClaim } = await import('@/lib/work/commit-door');
        const key = `rule:${job.ruleId}:${job.emailId}`;
        const claim = await claimCommit(sb, args.userId, {
          idempotencyKey: key, actionType: 'rule_deed',
          payload: { ruleId: job.ruleId, ruleName: job.ruleName, deeds: mailbox, label: job.plan.label, emailId: job.emailId, itemId: item?.id ?? null },
        });
        if (claim.status === 'duplicate') { report.duplicates++; }
        else {
          const onGmailRefresh = async (t: string) => {
            await sb.from('connections').update({ metadata: { ...(args.connection.metadata ?? {}), tokens: t } }).eq('id', args.connection.id);
          };
          const landed: RuleDeed[] = [];
          for (const d of mailbox) {
            if (await runMailboxDeed(d, { provider, tokens, job, onGmailRefresh, sb, connection: args.connection })) landed.push(d);
          }
          if (landed.length) {
            if (claim.status === 'claimed') await recordCommitResult(sb, args.userId, key, `done: ${landed.join(', ')}${landed.length < mailbox.length ? ` · failed: ${mailbox.filter((d) => !landed.includes(d)).join(', ')}` : ''}`);
            done.push(...landed);
            // The in-app mirror of the mailbox deed (a CONDITIONAL claim on the item's live state).
            if (item?.id) {
              const now = new Date().toISOString();
              if (landed.includes('archive') || landed.includes('trash')) {
                await sb.from('inbox_items').update({
                  status: 'dismissed',
                  source_data: { ...sdCur, [landed.includes('trash') ? 'trashed_at' : 'archived_at']: now, resolved_at: now, resolved_by_rule: job.ruleId },
                  updated_at: now,
                }).eq('id', item.id).eq('user_id', args.userId).eq('status', 'pending');
              }
              if (landed.includes('mark_read')) await sb.from('inbox_items').update({ is_read: true }).eq('id', item.id).eq('user_id', args.userId);
            }
          } else {
            report.failed++;
            if (claim.status === 'claimed') await releaseCommitClaim(sb, args.userId, key); // nothing happened — a retry may fire
          }
        }
      }

      if (done.length) {
        report.executed++;
        for (const d of done) report.deeds[d] = (report.deeds[d] ?? 0) + 1;
        const { logActivity } = await import('@/lib/activity/log');
        await logActivity(sb, args.userId, {
          type: 'rule_applied',
          title: ruleActivityTitle(job, done),
          entityType: item?.id ? 'inbox_item' : null,
          entityId: item?.id ?? null,
          metadata: {
            ruleId: job.ruleId, ruleName: job.ruleName, deeds: done, label: job.plan.label, kind: job.plan.kind,
            emailId: job.emailId, provider,
            undo: 'reversible — move it back to the Inbox / out of Trash, or remove the label, in your mailbox; switch the rule off in Settings → Email rules',
          },
        });
      }
    } catch (e) {
      report.failed++;
      console.warn('[rule-deeds] job failed (non-fatal):', e instanceof Error ? e.message : e);
    }
  }
  return report;

  // ── provider seams (message-level where the provider allows — the Gmail-filter semantics) ──
  async function runMailboxDeed(
    d: RuleDeed,
    c: {
      provider: string; tokens: string; job: RuleDeedJob; sb: SupabaseClient; connection: Conn;
      onGmailRefresh: (t: string) => Promise<void>;
    },
  ): Promise<boolean> {
    try {
      if (c.provider === 'gmail') {
        const { getGmailClient } = await import('@/lib/google/gmail');
        const gmail = await getGmailClient(c.tokens, c.onGmailRefresh);
        const msgId = c.job.gmailMessageId;
        const threadId = c.job.gmailThreadId;
        if (!msgId && !threadId) return false;
        const modify = async (body: { addLabelIds?: string[]; removeLabelIds?: string[] }) => {
          if (msgId) await gmail.users.messages.modify({ userId: 'me', id: msgId, requestBody: body });
          else await gmail.users.threads.modify({ userId: 'me', id: threadId!, requestBody: body });
        };
        if (d === 'apply_label') {
          if (!gmailCache) { const { GmailLabelCache } = await import('./write-back'); gmailCache = new GmailLabelCache(c.tokens); }
          const id = await gmailCache.ensure(c.job.plan.label!); // create-if-missing (parents first), cached per run
          if (!id) return false;
          await modify({ addLabelIds: [id] });
          return true;
        }
        if (d === 'mark_read') { await modify({ removeLabelIds: ['UNREAD'] }); return true; }
        if (d === 'archive') { await modify({ removeLabelIds: ['INBOX'] }); return true; }
        if (d === 'trash') {
          if (msgId) await gmail.users.messages.trash({ userId: 'me', id: msgId });
          else await gmail.users.threads.trash({ userId: 'me', id: threadId! });
          return true;
        }
        return false;
      }
      if (c.provider === 'outlook') {
        const id = c.job.outlookMessageId;
        if (!id) return false;
        const outlook = await import('@/lib/microsoft/outlook');
        const refresh = outlook.persistOutlookTokens(c.sb, c.connection as { id: string; metadata: { tokens: string } });
        if (d === 'apply_label') { await outlook.addOutlookCategory(c.tokens, id, c.job.plan.label!, refresh); return true; }
        if (d === 'mark_read') { const g = await outlook.getGraphClient(c.tokens, refresh); await g.api(`/me/messages/${id}`).patch({ isRead: true }); return true; }
        if (d === 'archive') { await outlook.archiveOutlookMessage(c.tokens, id, refresh); return true; }
        if (d === 'trash') { await outlook.trashOutlookMessage(c.tokens, id, refresh); return true; }
        return false;
      }
      return false;
    } catch (e) {
      console.warn(`[rule-deeds] ${d} failed:`, e instanceof Error ? e.message : e);
      return false;
    }
  }
}
