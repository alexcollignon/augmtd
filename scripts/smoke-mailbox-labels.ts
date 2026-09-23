// ════════════════════════════════════════════════════════════════════════════════════════════════
// SMOKE — W10 THE MAILBOX IS THE USER'S (docs/laws-registry.md `mailbox-is-the-users` ·
// `rule-outcomes-execute` · `label-truth`; docs/stabilization-plan.md PART VI W10).
//
//   M1 — AUGMTD's own labels are OFF unless explicitly chosen (unset → off; only `true` is on)
//   M2 — when on, AUGMTD writes POSTURE labels only (Needs reply · To do · Waiting on → Done)
//   M3 — no write path puts a KIND label (or a retired posture) into a mailbox
//   M4 — a user rule's own label (`apply_label`) applies regardless of the AUGMTD-labels default
//   M5 — the user-label name floor
//   M6 — every authorable rule outcome has an executor (no lying doors), exactly once, logged
//   M7 — forward_to is unexecuted AND unauthorable on every surface
//   M8 — the cleanup is guarded and removes only AUGMTD-created labels
//
// ZERO AI · ZERO DB · ZERO PROVIDER CALLS (an in-memory client stands in for Supabase; the provider
// seam is reached only with an unparseable token, which fails before any network). Run:
//   npx tsx scripts/smoke-mailbox-labels.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  augmtdLabelsOn, validateUserLabelName, sanitizeRuleOutcome,
  EXECUTED_OUTCOME_KEYS, UNEXECUTED_OUTCOME_KEYS, AUTHORABLE_RULE_OUTCOME_KEYS,
} from '../lib/inbox/rules/label-name';
import {
  mailboxLabelNamesFor, labelNamesFor, writeBackLabels, reconcileAugmtdLabel, writeBackLabel,
  AUGMTD_ALL_LABELS, AUGMTD_RETIRED_LABELS, AUGMTD_LIVE_POSTURE_LABELS,
} from '../lib/inbox/rules/write-back';
import { planRuleDeeds, governingRule, ruleDeedJobFor, ruleEmailOf, executeRuleDeeds, type RuleDeedJob } from '../lib/inbox/rules/execute';
import { planGmailRemoval, isAugmtdCreatedLabel, cleanupScopeFor, cleanupTargetNames } from '../lib/inbox/rules/mailbox-labels';
import { EMAIL_SETTINGS_DEFAULTS, getEmailSettings } from '../lib/inbox/email-settings';
import { POSTURE_VERBS, postureFromDeed } from '../lib/postures/from-deed';
import type { InboxRule } from '../lib/inbox/rules/types';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── an in-memory Supabase stand-in (records every write; zero network) ──────────────────────────
type Row = Record<string, unknown>;
function fakeDb(seed: Record<string, Row[]>, opts: { commitDuplicate?: boolean } = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const writes: Array<{ table: string; op: string; value?: unknown }> = [];
  const from = (table: string) => {
    tables[table] ??= [];
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
    let payload: Row | null = null;
    const getPath = (r: Row, col: string) => {
      const m = col.split(/->>|->/);
      let v: unknown = r;
      for (const k of m) v = v == null ? undefined : (v as Row)[k];
      return v;
    };
    const run = () => {
      const rows = tables[table].filter((r) => filters.every((f) => f(r)));
      if (op === 'update') { for (const r of rows) Object.assign(r, payload); writes.push({ table, op, value: payload }); return { data: rows, error: null }; }
      if (op === 'delete') { tables[table] = tables[table].filter((r) => !rows.includes(r)); writes.push({ table, op }); return { data: rows, error: null }; }
      return { data: rows, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters.push((r) => String(getPath(r, c)) === String(v)); return q; },
      is: (c: string, v: unknown) => { filters.push((r) => (getPath(r, c) ?? null) === v); return q; },
      order: () => q, limit: () => q, in: () => q, gte: () => q,
      update: (p: Row) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      insert: (p: Row) => {
        writes.push({ table, op: 'insert', value: p });
        if (table === 'action_commits' && opts.commitDuplicate) return Promise.resolve({ error: { code: '23505', message: 'dup' } });
        tables[table].push({ ...p, id: `${table}-${tables[table].length + 1}`, created_at: new Date().toISOString() });
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => { const r = run(); return Promise.resolve({ data: (r.data as Row[])[0] ?? (table === 'action_commits' && opts.commitDuplicate ? { result: 'done: archive', created_at: new Date().toISOString() } : null), error: null }); },
      single: () => q.maybeSingle,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { client: { from } as never, writes, tables };
}

(async () => {
  // ── M1 · OFF BY DEFAULT ──────────────────────────────────────────────────────────────────────
  console.log('M1 — AUGMTD labels are off unless explicitly chosen');
  ok('the default is OFF (EMAIL_SETTINGS_DEFAULTS.auto_label === false)', EMAIL_SETTINGS_DEFAULTS.auto_label === false);
  ok('the one reader: unset → off, false → off, only `true` → on (never truthy strings)',
    !augmtdLabelsOn({}) && !augmtdLabelsOn(null) && !augmtdLabelsOn({ auto_label: false }) && augmtdLabelsOn({ auto_label: true }) &&
    !augmtdLabelsOn({ auto_label: 'true' }) && !augmtdLabelsOn({ auto_label: 1 }));
  {
    const unset = fakeDb({ profiles: [{ id: 'u1', email_settings: { auto_draft: false } }] });
    const s = await getEmailSettings('u1', unset.client);
    ok('getEmailSettings on an account that never chose → auto_label false (the merge default speaks)', s.auto_label === false && s.auto_draft === false);
    const chose = fakeDb({ profiles: [{ id: 'u2', email_settings: { auto_label: true } }] });
    ok('an account that explicitly chose → auto_label true (kept)', (await getEmailSettings('u2', chose.client)).auto_label === true);
  }
  const route = read('app/api/inbox/email-settings/route.ts');
  ok('the settings route default is off', /^\s*auto_label: false,/m.test(route) && !/^\s*auto_label: true,/m.test(route));
  ok('the settings PUT stores only what the user chose (no default merged into the row)',
    !/\{ \.\.\.DEFAULTS, \.\.\.\(\(existing/.test(route) && /update\(\{ email_settings: stored \}\)/.test(route));
  const sweep = read('app/api/cron/label-sweep/route.ts');
  ok('the label-sweep gates mailbox writes on the one reader (augmtdLabelsOn), not on `=== false`',
    /augmtdLabelsOn\(/.test(sweep) && !/auto_label === false/.test(sweep));
  ok('the ops label scripts skip every account that did not choose (`!== true`)',
    /auto_label !== true\) continue/.test(read('scripts/run-label-backfill.ts')) && /auto_label !== true\) continue/.test(read('scripts/sweep-kind-upgrade.ts')));
  ok('the reconciler honours the same default (getEmailSettings → auto_label)', /if \(!settings\.auto_label\) return false/.test(read('lib/inbox/reconcile-item-label.ts')));

  // ── M2 · POSTURE ONLY ────────────────────────────────────────────────────────────────────────
  console.log('M2 — when on, AUGMTD writes posture labels only');
  ok('the live posture set is exactly Needs reply · To do · Waiting on · Done',
    JSON.stringify([...AUGMTD_LIVE_POSTURE_LABELS]) === JSON.stringify(['AUGMTD/Needs reply', 'AUGMTD/To do', 'AUGMTD/Waiting on', 'AUGMTD/Done']));
  ok('customer + needs_reply → the posture alone (the kind stays in-app)',
    JSON.stringify(mailboxLabelNamesFor({ understanding: { mailKind: 'customer' } }, 'needs_reply')) === '["AUGMTD/Needs reply"]' &&
    labelNamesFor({ understanding: { mailKind: 'customer' } }, 'needs_reply').kindName === 'AUGMTD/Customer');
  ok('newsletter + fyi → nothing in the mailbox', mailboxLabelNamesFor({ understanding: { mailKind: 'newsletter' } }, 'fyi').length === 0);
  ok('a receipt with no live posture → writeBackLabels NOOP (no kind label, no provider call)',
    (await writeBackLabels({ provider: 'gmail', encryptedTokens: 'x', sd: { understanding: { mailKind: 'receipt' } }, ruleType: null, workState: 'noted', gmailThreadId: 't' })) === 'noop');

  // ── M3 · NO KIND WRITE PATH ──────────────────────────────────────────────────────────────────
  console.log('M3 — no path writes a kind label or a retired posture into a mailbox');
  {
    const kinds = ['receipt', 'newsletter', 'notification', 'calendar', 'cold_outreach', 'customer', 'team', 'personal', undefined];
    const types = [null, 'needs_reply', 'to_do', 'waiting_on', 'meeting', 'fyi', 'notifications', 'marketing', 'done'];
    const states = [null, 'work_prepared', 'decision_required', 'action_required', 'waiting', 'noted', 'noise'];
    const retired = new Set(AUGMTD_RETIRED_LABELS);
    let bad = 0, total = 0;
    for (const k of kinds) for (const t of types) for (const w of states) for (const bulk of [false, true]) {
      total++;
      const names = mailboxLabelNamesFor({ understanding: k ? { mailKind: k } : undefined, has_unsubscribe: bulk }, t, w, { bulk, noise: w === 'noise' });
      if (names.some((n) => retired.has(n) || !AUGMTD_LIVE_POSTURE_LABELS.includes(n))) bad++;
    }
    ok(`the mailbox resolver never yields a kind/retired name (${total} combinations)`, bad === 0, `${bad} bad`);
  }
  ok('the reconciler never writes a retired posture (target fyi → nothing added, no call)',
    (await reconcileAugmtdLabel({ provider: 'none', encryptedTokens: 'x', targetLabel: 'fyi' })) === false &&
    (await writeBackLabel({ provider: 'gmail', encryptedTokens: 'x', label: 'marketing', gmailThreadId: 't' })) === false);
  {
    const wb = read('lib/inbox/rules/write-back.ts');
    const applier = wb.slice(wb.indexOf('export async function writeBackLabels'));
    ok('the applier reads mailboxLabelNamesFor and never a kind name', /mailboxLabelNamesFor\(/.test(applier) && !/kindName|KIND_DISPLAY/.test(applier));
    ok('reconcile removals PEEK (never ensure → never re-create a retired label)',
      /const id = await cache\.peek\(name\)/.test(wb) && !/cache\.ensure\(name\)\.catch/.test(wb));
    const offenders = ['lib', 'app', 'components'].flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => !f.endsWith('lib/inbox/rules/write-back.ts'))
      .filter((f) => /AUGMTD\/(Receipt|Newsletter|Notification|Calendar|Cold outreach|Customer|Team|Personal)\b/.test(readFileSync(f, 'utf8')));
    ok('no other module names a kind label', offenders.length === 0, offenders.join(', '));
  }

  // ── M4 · THE USER'S OWN LABEL ────────────────────────────────────────────────────────────────
  console.log("M4 — a user rule's own label applies regardless of the AUGMTD-labels default");
  const rule = (o: Partial<InboxRule>): InboxRule => ({ id: 'r1', name: 'Acme mail', enabled: true, priority: 5, trigger: 'received', match_mode: 'all', conditions: [{ field: 'from', value: '@acme.example' }], ai_match: null, outcome: {}, source: 'user', ...o });
  {
    const p = planRuleDeeds(rule({ outcome: { apply_label: ' Clients / Acme ' } }));
    ok('apply_label plans the label deed with the normalised name', p.deeds.includes('apply_label') && p.label === 'Clients/Acme');
    ok('a disabled rule plans nothing (its toggle is its switch)', planRuleDeeds(rule({ enabled: false, outcome: { apply_label: 'X', archive: true } })).deeds.length === 0);
    ok('a sent-mail rule plans no mailbox deed', planRuleDeeds(rule({ trigger: 'sent', outcome: { apply_label: 'X', archive: true, set_kind: 'customer' } })).deeds.join() === 'set_kind');
    const exec = read('lib/inbox/rules/execute.ts');
    ok('the executor never consults auto_label (the user rule is the instruction)', !/auto_label|augmtdLabelsOn|getEmailSettings/.test(exec.replace(/\/\/.*$/gm, '')));
    const sync = read('lib/email-sync/sync-emails.ts');
    const seam = sync.slice(sync.indexOf("W10 THE USER'S STANDING RULES ACT (lib/inbox/rules/execute.ts)"), sync.indexOf('_ruleDeeds.push(_job)'));
    ok('the sync queues rule deeds outside any auto_label gate', seam.length > 0 && !/emailSettings\.auto_label/.test(seam));
    ok('the sync executes them after the tail drains, bounded, remainder reported',
      sync.indexOf('executeRuleDeeds(') > sync.indexOf('const _drain = await _tail.drain();') && sync.indexOf('const _drain = await _tail.drain();') > 0 && /_rd\.leftBehind/.test(sync));
    const email = ruleEmailOf({ from_address: 'Sam@Acme.example', subject: 'Invoice', body: '', is_from_user: false });
    const aiRule = rule({ id: 'r2', name: 'AI', conditions: [], ai_match: 'anything', outcome: { archive: true } });
    ok('deterministic first, else the AI match', governingRule(email, [rule({ outcome: { apply_label: 'A' } })], aiRule)?.id === 'r1' &&
      governingRule(ruleEmailOf({ from_address: 'x@other.example' }), [rule({})], aiRule)?.id === 'r2');
    const job = ruleDeedJobFor({ rules: [rule({ outcome: { apply_label: 'Clients/Acme', archive: true } })], email, stored: { id: 'e1', thread_id: 'th1', subject: 'Invoice', metadata: { gmail_id: 'g1' } } });
    ok('a job carries the message ids the provider seam needs', !!job && job.gmailMessageId === 'g1' && job.threadKey === 'th1' && job.plan.deeds.join() === 'apply_label,archive');
    const bm = read('lib/inbox/rules/batch-match.ts');
    ok('the AI pass answers with the matched RULE (a rule with no set_type can match; the executor gets it)',
      /ruleById/.test(bm) && /opts\.matchedRules\?\.set\(id, rule\)/.test(bm) && /matchedRules: ruleMatchMap/.test(sync));
  }

  // ── M5 · THE NAME FLOOR ──────────────────────────────────────────────────────────────────────
  console.log('M5 — user label names are validated');
  const good = ['Clients/Acme', 'Finance', 'Projets/Été 2026', 'a'.repeat(100)];
  const badNames = ['', '   ', 'a'.repeat(101), 'bad\u0007name', 'tab\tname', '/lead', 'trail/', 'a//b', 'AUGMTD/Mine', 'augmtd', 'INBOX', 'Trash', 'CATEGORY_PROMOTIONS', 42 as unknown as string];
  ok('good names pass', good.every((n) => validateUserLabelName(n).ok), good.filter((n) => !validateUserLabelName(n).ok).join(' | '));
  ok('bad names refuse WITH a reason (empty, >100, control chars, empty segment, AUGMTD namespace, system labels, non-string)',
    badNames.every((n) => { const v = validateUserLabelName(n); return !v.ok && v.reason.length > 5; }),
    badNames.filter((n) => validateUserLabelName(n).ok).map(String).join(' | '));

  // ── M6 · EVERY AUTHORABLE OUTCOME HAS AN EXECUTOR ────────────────────────────────────────────
  console.log('M6 — every authorable outcome executes (no lying doors)');
  const { AUTHORABLE_OUTCOME_KEYS, validatePrimitives, renderPostureSentence } = await import('../lib/postures/registry');
  ok('the sentence door authors exactly the executed set', JSON.stringify([...AUTHORABLE_OUTCOME_KEYS]) === JSON.stringify([...EXECUTED_OUTCOME_KEYS]) && AUTHORABLE_RULE_OUTCOME_KEYS === EXECUTED_OUTCOME_KEYS);
  {
    const sample: Record<string, unknown> = { set_kind: 'customer', apply_label: 'X', mark_read: true, archive: true, trash: true };
    const missing = EXECUTED_OUTCOME_KEYS.filter((k) => k !== 'set_type').filter((k) => {
      const deeds = planRuleDeeds(rule({ outcome: { [k]: sample[k] } as InboxRule['outcome'] })).deeds as string[];
      return !deeds.includes(k);
    });
    ok('every executed key but set_type plans a deed', missing.length === 0, missing.join(', '));
    ok('set_type is executed by the classifier (render) and the AI pass (sync → rule_type)',
      /matched\?\.outcome\.set_type/.test(read('lib/inbox/classify-item.ts')) && /if \(rule\.outcome\.set_type\) result\.set\(id, rule\.outcome\.set_type\)/.test(read('lib/inbox/rules/batch-match.ts')));
    ok('the bulk-deed tail offers only verbs the executor performs', POSTURE_VERBS.every((v) => (EXECUTED_OUTCOME_KEYS as readonly string[]).includes(v)) &&
      (() => { const o = postureFromDeed({ verb: 'archive', classKey: 'bulk_mail' }); return o.ok && planRuleDeeds({ enabled: true, trigger: o.offer.primitives.trigger, outcome: o.offer.primitives.outcome }).deeds.join() === 'archive'; })());
    ok('the sentence door refuses auto_draft and escalate (nothing executes them)',
      !validatePrimitives({ conditions: [{ field: 'from', value: 'a@b.example' }], outcome: { auto_draft: { enabled: true } } }).ok &&
      !validatePrimitives({ conditions: [{ field: 'from', value: 'a@b.example' }], outcome: { escalate: { enabled: true } } }).ok);
    ok('the sentence door accepts a user label and refuses a bad one',
      (() => { const v = validatePrimitives({ conditions: [{ field: 'from', value: 'a@b.example' }], outcome: { apply_label: 'Clients/Acme' } }); return v.ok && v.value.outcome.apply_label === 'Clients/Acme'; })() &&
      !validatePrimitives({ conditions: [{ field: 'from', value: 'a@b.example' }], outcome: { apply_label: 'AUGMTD/Mine' } }).ok);
    ok('a sent-mail rule cannot author a mailbox deed', !validatePrimitives({ trigger: 'sent', conditions: [{ field: 'to', value: 'a@b.example' }], outcome: { archive: true } }).ok);
    const legacy = sanitizeRuleOutcome({ set_type: 'needs_reply', auto_draft: { enabled: true }, escalate: { enabled: true }, forward_to: 'x@y.example', archive: true }, 'received');
    ok('the advanced editor floor strips every unexecuted key on save', legacy.ok && JSON.stringify(legacy.outcome) === '{"set_type":"needs_reply","archive":true}');
    ok('the renderer speaks only executed verbs', (() => {
      const s = renderPostureSentence({ name: 'x', trigger: 'received', match_mode: 'all', conditions: [{ field: 'from', value: 'a@b.example' }], ai_match: null, outcome: { set_type: 'needs_reply', auto_draft: { enabled: true }, escalate: { enabled: true }, forward_to: 'x@y.example', apply_label: 'Clients/Acme' } });
      return /Clients\/Acme/.test(s) && !/[Ff]orward|[Dd]raft|[Ff]lag/.test(s);
    })());
    const es = read('components/settings/email-settings.tsx');
    const editor = es.slice(es.indexOf('function RuleEditor'));
    ok('the advanced editor offers no unexecuted outcome', !/forward_to|auto_draft|escalate|Forward to|Auto-draft|Escalate/.test(editor) && /apply_label/.test(editor));
    const rr = read('app/api/inbox/rules/route.ts') + read('app/api/inbox/rules/[id]/route.ts');
    ok('both rule-write routes run the outcome floor', (rr.match(/sanitizeRuleOutcome\(/g) ?? []).length >= 2);
    ok('the defaults carry no unexecuted promise', !/auto_draft|escalate|forward_to/.test(read('lib/inbox/rules/defaults.ts').replace(/\/\/.*$/gm, '')));
  }
  // The executor's own bookkeeping, on the in-memory client (no network: the token cannot parse).
  {
    const baseJob: RuleDeedJob = { ruleId: 'r1', ruleName: 'Acme mail', emailId: 'e1', threadKey: 'th1', gmailThreadId: 'th1', gmailMessageId: 'g1', outlookMessageId: null, subject: 'Invoice 42', plan: { deeds: ['set_kind', 'archive'], label: null, kind: 'customer' } };
    const seed = { inbox_items: [{ id: 'i1', user_id: 'u1', source: 'email', status: 'pending', source_data: { thread_id: 'th1', subject: 'Invoice 42' } }] };
    const db = fakeDb(seed);
    const r = await executeRuleDeeds(db.client, { userId: 'u1', connection: { id: 'c1', provider: 'gmail', metadata: { tokens: 'not-base64-json' } }, jobs: [baseJob], deadlineMs: 5_000 });
    const item = db.tables.inbox_items[0] as { status: string; source_data: Row };
    ok('set_kind lands as the item kind_override (in-app)', (item.source_data as Row).kind_override === 'customer');
    ok('a mailbox deed that fails is not claimed as done — the claim is RELEASED and the item stays pending',
      item.status === 'pending' && db.writes.some((w) => w.table === 'action_commits' && w.op === 'insert') && db.writes.some((w) => w.table === 'action_commits' && w.op === 'delete'));
    ok('what ran is logged in activity (rule_applied), naming only what landed',
      db.writes.some((w) => w.table === 'activity_events' && (w.value as Row).type === 'rule_applied' && /treated it as customer/.test(String((w.value as Row).title)) && !/archived/.test(String((w.value as Row).title))) &&
      r.executed === 1 && r.deeds.set_kind === 1 && !r.deeds.archive);
    const dup = fakeDb(seed, { commitDuplicate: true });
    const r2 = await executeRuleDeeds(dup.client, { userId: 'u1', connection: { id: 'c1', provider: 'gmail', metadata: { tokens: 'x' } }, jobs: [{ ...baseJob, plan: { deeds: ['archive'], label: null, kind: null } }] });
    ok('EXACTLY ONCE — a (rule, message) already claimed is never acted on again', r2.duplicates === 1 && r2.executed === 0 && !dup.writes.some((w) => w.table === 'activity_events'));
    const late = await executeRuleDeeds(fakeDb(seed).client, { userId: 'u1', connection: { id: 'c1', provider: 'gmail', metadata: { tokens: 'x' } }, jobs: [baseJob, baseJob], deadlineMs: -1 });
    ok('the clock is honest — jobs past the deadline are reported left behind', late.leftBehind === 2 && late.executed === 0);
    ok('mailbox deeds pass the commit door (claim + record/release)', /claimCommit\(/.test(read('lib/inbox/rules/execute.ts')) && /recordCommitResult\(/.test(read('lib/inbox/rules/execute.ts')) && /releaseCommitClaim\(/.test(read('lib/inbox/rules/execute.ts')));
  }

  // ── M7 · forward_to ──────────────────────────────────────────────────────────────────────────
  console.log('M7 — forward_to stays unexecuted and unauthorable');
  {
    ok('forward_to is in the unexecuted set and nowhere in the executed one', (UNEXECUTED_OUTCOME_KEYS as readonly string[]).includes('forward_to') && !(EXECUTED_OUTCOME_KEYS as readonly string[]).includes('forward_to'));
    ok('a rule carrying only forward_to plans no deed', planRuleDeeds(rule({ outcome: { forward_to: 'x@y.example' } })).deeds.length === 0);
    const exec = read('lib/inbox/rules/execute.ts').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    ok('the executor names no forward and imports no send path', !/forward_to|forward\(/.test(exec) && !/send-reply|sendGmail|sendOutlook|compose\/send|sendEmail/.test(exec));
    const eg = validatePrimitives({ conditions: [{ field: 'from', value: 'a@b.example' }], outcome: { forward_to: 'someone@else.example' } });
    ok('the sentence door refuses it with the reason', !eg.ok && /forward/i.test(eg.reason));
    ok('the advanced editor floor drops it', (() => { const c = sanitizeRuleOutcome({ forward_to: 'x@y.example', set_type: 'fyi' }, 'received'); return c.ok && !('forward_to' in c.outcome); })());
    ok('no surface offers it (settings UI + the rule-write routes)', !/Forward to|forward_to:\s*''/.test(read('components/settings/email-settings.tsx')));
  }

  // ── M8 · THE CLEANUP ─────────────────────────────────────────────────────────────────────────
  console.log('M8 — the cleanup is guarded and removes only AUGMTD-created labels');
  {
    const mailbox = [
      { id: 'p', name: 'AUGMTD' }, { id: 'k1', name: 'AUGMTD/Receipt' }, { id: 'k2', name: 'AUGMTD/Customer' },
      { id: 'f', name: 'AUGMTD/FYI' }, { id: 'n', name: 'AUGMTD/Needs reply' }, { id: 'd', name: 'AUGMTD/Done' },
      { id: 'u1', name: 'Clients/Acme' }, { id: 'u2', name: 'AUGMTD notes' }, { id: 'u3', name: 'Receipts' },
    ];
    const retired = planGmailRemoval(mailbox, 'retired');
    ok("labels ON → only the retired (kinds + FYI-era) go; live postures + the parent stay",
      retired.remove.map((l) => l.id).sort().join() === 'f,k1,k2' && retired.removeParent === null);
    const all = planGmailRemoval(mailbox, 'all');
    ok('labels OFF → every AUGMTD label goes, the parent last', all.remove.map((l) => l.id).sort().join() === 'd,f,k1,k2,n' && all.removeParent?.id === 'p');
    ok("never a user's own label (look-alikes included)", ![...retired.remove, ...all.remove, all.removeParent].some((l) => l && ['u1', 'u2', 'u3'].includes(l.id)) &&
      !isAugmtdCreatedLabel('Clients/Acme') && !isAugmtdCreatedLabel('AUGMTD notes') && isAugmtdCreatedLabel('augmtd/receipt'));
    ok('the parent stays while a non-AUGMTD-created child sits under it', planGmailRemoval([...mailbox, { id: 'x', name: 'AUGMTD/Something else' }], 'all').removeParent === null);
    ok('the scope follows the account: unset/false → all, explicit true → retired',
      cleanupScopeFor({}) === 'all' && cleanupScopeFor({ auto_label: false }) === 'all' && cleanupScopeFor({ auto_label: true }) === 'retired' &&
      cleanupTargetNames('all').length === AUGMTD_ALL_LABELS.length && cleanupTargetNames('retired').every((n) => !AUGMTD_LIVE_POSTURE_LABELS.includes(n)));
    const script = read('scripts/remove-augmtd-labels.ts');
    ok('the script is dry-run by default; --apply without --yes refuses; --apply names a scope',
      /const APPLY = has\('--apply'\)/.test(script) && /if \(APPLY && !YES\)/.test(script) && /process\.exit\(2\)/.test(script) && /if \(APPLY && !ALL && !USER\)/.test(script) && /apply: APPLY/.test(script));
    const cr = read('app/api/inbox/mailbox-labels/cleanup/route.ts');
    ok('the Settings route writes only on an explicit confirm, for the signed-in user only',
      /body\.confirm !== true/.test(cr) && /removeAugmtdLabels\(supabase, user\.id/.test(cr));
    ok('the Settings toggle offers the cleanup when turned off, behind a confirm', (() => {
      const es = read('components/settings/email-settings.tsx');
      return /setOfferCleanup\(!next\)/.test(es) && /confirm\('Remove the labels AUGMTD added/.test(es) && /mailbox-labels\/cleanup/.test(es);
    })());
    const ml = read('lib/inbox/rules/mailbox-labels.ts');
    ok('a dry run never persists a refreshed token (no DB write)', /const refresh = apply \? outlook\.persistOutlookTokens/.test(ml));
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(f)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
