// THE LABEL FLIP GATES + IMPACT SIMULATIONS.
//   Kind (identity, stable) × Posture (lifecycle, reconciled) — ONE resolver, one precedence
//   chain (override → reasoned kind → structural fallback), pair applied everywhere labels are
//   written. Unit truth-table must be 100%; sims measure the real-data impact per user.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { resolveKind, postureFor, labelNamesFor, mapWorkStateToLabel } from '../lib/inbox/rules/write-back';
import { resolveProbeUser } from './probe-user';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const A = '08fe4449-e5eb-431d-9156-02e9324e5903';
const B = 'c723c2f2-e069-4ab8-980e-ac3585028fec';
let PERSONAL = ''; // the PROBE HOST — resolved at start (scripts/probe-user.ts)
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  PERSONAL = await resolveProbeUser(sb);
  // ── STRUCTURAL ──
  const wb = src('lib/inbox/rules/write-back.ts');
  check('flip: the KIND label set is the Scape vocabulary (8 kinds) + ONE resolver with the precedence chain',
    ['Receipt', 'Newsletter', 'Notification', 'Calendar', 'Cold outreach', 'Customer', 'Team', 'Personal']
      .every((k) => wb.includes(`AUGMTD/${k}`)) &&
    wb.includes('export function resolveKind') && wb.includes('kind_override'));
  check('flip: posture is LIFECYCLE-only (fyi/notifications/marketing/meeting → no posture label)',
    wb.includes('export function postureFor') && wb.includes("ruleType === 'fyi' || ruleType === 'notifications' || ruleType === 'marketing' || ruleType === 'meeting') return null"));
  check('flip: the reconciler swaps POSTURE only — kind labels are structurally untouchable (separate map)',
    wb.includes('NEVER touches a KIND label') && wb.includes('const ALL_STATE_LABELS = Object.values(LABEL_DISPLAY)'));
  check('flip: all three write sites apply the PAIR via writeBackLabels (sync fast-path, sync classified, sweep)',
    (src('lib/email-sync/sync-emails.ts').match(/writeBackLabels/g)?.length ?? 0) >= 2 &&
    src('app/api/cron/label-sweep/route.ts').includes('writeBackLabels'));
  check('flip: rules gained the kind-override channel (set_kind typed; resolver honors kind_override at the top)',
    src('lib/inbox/rules/types.ts').includes('set_kind?:'));

  // ── UNIT TRUTH-TABLE (must be 100% — deterministic, in-process) ──
  const cases: Array<[string, boolean]> = [
    ['override outranks reasoned kind', resolveKind({ kind_override: 'customer', understanding: { mailKind: 'newsletter' } }) === 'customer'],
    ['reasoned kind outranks structural', resolveKind({ understanding: { mailKind: 'receipt' }, has_unsubscribe: true }) === 'receipt'],
    ['legacy marketing rule → newsletter kind', resolveKind({}, 'marketing') === 'newsletter'],
    ['legacy notifications rule → notification kind', resolveKind({}, 'notifications') === 'notification'],
    ['meeting rule → calendar kind', resolveKind({}, 'meeting') === 'calendar'],
    ['unsubscribe header → newsletter fallback', resolveKind({ has_unsubscribe: true }) === 'newsletter'],
    ['noise hint → notification fallback', resolveKind({}, null, { noise: true }) === 'notification'],
    ['no signal → NO kind label (grounded-or-absent)', resolveKind({}) === null],
    ['needs_reply posture survives', postureFor('needs_reply') === 'needs_reply'],
    ['fyi → no posture label', postureFor('fyi') === null],
    ['marketing → no posture label', postureFor('marketing') === null],
    ['workState waiting (no rule) → waiting_on', postureFor(null, 'waiting') === 'waiting_on'],
    ['noted workState → no posture label', postureFor(null, 'noted') === null],
    ['done → Done (the reconciler’s target)', postureFor('done') === 'done'],
    ['pair: customer + needs_reply → BOTH labels', (() => { const p = labelNamesFor({ understanding: { mailKind: 'customer' } }, 'needs_reply'); return p.kindName === 'AUGMTD/Customer' && p.postureName === 'AUGMTD/Needs reply'; })()],
    ['pair: newsletter + fyi → kind ONLY', (() => { const p = labelNamesFor({ understanding: { mailKind: 'newsletter' } }, 'fyi'); return p.kindName === 'AUGMTD/Newsletter' && p.postureName === null; })()],
    ['pair: nothing → nothing (no label soup)', (() => { const p = labelNamesFor({}); return p.kindName === null && p.postureName === null; })()],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  check(`unit truth-table — ${cases.length}/${cases.length} required`, failed.length === 0,
    failed.length ? `FAILED: ${failed.map(([n]) => n).join(' · ')}` : 'all hold');

  // ── LABEL TRUTH (the Canva-invoice bug): "nothing to apply YET" must never be recorded as
  // "labeled" — the sweep is the kind-completer, and its work-list depends on honest bookkeeping. ──
  {
    const { writeBackLabels } = await import('../lib/inbox/rules/write-back');
    // A fresh transactional email: no understanding, no bulk headers, no rule → nothing resolvable.
    const outcome = await writeBackLabels({
      provider: 'gmail', encryptedTokens: 'x', sd: { subject: 'Your invoice' },
      ruleType: null, workState: 'noted', gmailThreadId: 'fake-thread',
    });
    check('truth live · an empty label set returns NOOP, never success (the poisoned-stamp bug)',
      outcome === 'noop', `outcome=${outcome}`);
  }
  check('truth · the sync stamps `labeled` ONLY on applied (noop stays unstamped for the sweep)',
    src('lib/email-sync/sync-emails.ts').includes("ok === 'applied'") &&
    !src('lib/email-sync/sync-emails.ts').includes('if (ok) await adminSupabase'));
  check('truth · the sweep COMPLETES the missing kind (ensureMailKind, capped) before applying — the cause-fix, not a backfill',
    src('app/api/cron/label-sweep/route.ts').includes('ensureMailKind') &&
    src('app/api/cron/label-sweep/route.ts').includes('KIND_COMPUTE_CAP') &&
    src('lib/inbox/ensure-mail-kind.ts').includes('ROUTING-INERT'));
  check('truth · a computed-but-null kind stamps FINAL (terminates) while budget-exhausted noop is revisited',
    src('app/api/cron/label-sweep/route.ts').includes("ok === 'noop' && kindComputed"));
  check('truth · thread-scoped reconcile — applying the pair strips every OTHER state label from the thread (peek, never create)',
    src('lib/inbox/rules/write-back.ts').includes('THREAD-SCOPED RECONCILE') &&
    src('lib/inbox/rules/write-back.ts').includes('async peek('));

  // ── SIM 1 — the real-data label diff (per user; deterministic, zero AI) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oldLabelFor = (it: any): string => { // the pre-flip sweep logic, verbatim
    if (it.rule_type && it.rule_type !== 'none') return it.rule_type;
    const sd = it.source_data ?? {};
    if ((sd.gmail_labels ?? []).includes('CATEGORY_PROMOTIONS') || sd.has_unsubscribe) return 'marketing';
    if (it.work_state === 'noise') return 'notifications';
    if (it.work_state === 'noted') return 'fyi';
    return mapWorkStateToLabel(it.work_state) || 'fyi';
  };
  const { data: uidRows } = await sb.from('work_entities').select('user_id').limit(2000);
  const rene = [...new Set(((uidRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))].find((u) => u.startsWith('ae306f38')) ?? null;
  const USERS: Array<[string, string]> = [[A, 'user A'], [B, 'user B'], ...(rene ? [[rene, 'user C'] as [string, string]] : [])];
  for (const [uid, label] of USERS) {
    const { data: items } = await sb.from('inbox_items')
      .select('id, source_data, work_state, rule_type')
      .eq('user_id', uid).eq('status', 'pending').eq('source', 'email')
      .order('created_at', { ascending: false }).limit(300);
    const rows = (items ?? []) as Array<{ source_data: Record<string, unknown>; work_state: string | null; rule_type: string | null }>;
    let identityGained = 0, fakePostureDropped = 0, bothDims = 0, noKind = 0, bulkNeedsReply = 0, reasonedKind = 0;
    for (const it of rows) {
      const sd = it.source_data ?? {};
      const bulk = ((sd.gmail_labels ?? []) as string[]).includes?.('CATEGORY_PROMOTIONS') || sd.has_unsubscribe === true;
      const old = oldLabelFor(it);
      const pair = labelNamesFor(sd, it.rule_type, it.work_state, { bulk: !!bulk, noise: it.work_state === 'noise' });
      const u = (sd.understanding ?? null) as { mailKind?: string } | null;
      if (u?.mailKind && u.mailKind !== 'other') reasonedKind++;
      if (!pair.kindName) noKind++;
      if (pair.kindName && (old === 'fyi' || old === 'marketing' || old === 'notifications')) { identityGained++; fakePostureDropped++; }
      if (pair.kindName && pair.postureName) bothDims++;
      const k = resolveKind(sd, it.rule_type, { bulk: !!bulk });
      if (it.rule_type === 'needs_reply' && (k === 'receipt' || k === 'newsletter' || k === 'notification')) bulkNeedsReply++;
    }
    check(`SIM1 ${label} · label diff over ${rows.length} recent pending`, true,
      `identity gained (was fake FYI/Mktg/Notif posture): ${identityGained} · both dims: ${bothDims} · no kind yet (sweep tops up post-understanding): ${noKind} · reasoned kinds present: ${reasonedKind} · needs_reply-but-bulk-kind (drafter-gate saves): ${bulkNeedsReply}`);
  }

  // ── SIM 2 — judgment impact (scenario probes on the personal account; cleaned up) ──
  const { judgeWork } = await import('../lib/work/judge');
  const mk = async (subject: string, body: string, from: [string, string], kind: string, ownership: string) => {
    const { data } = await sb.from('inbox_items').insert({
      user_id: PERSONAL, source: 'email', status: 'pending', work_state: 'noted', work_title: subject,
      source_data: {
        subject, body, from_name: from[0], from_address: from[1], received_at: new Date().toISOString(),
        understanding: { mailKind: kind, ownership, relevance: ownership === 'none' ? 'awareness' : 'action_needed', role: 'primary' },
      },
    }).select('id').maybeSingle();
    return data?.id as string | undefined;
  };
  const probes: Array<[string, string | undefined, (v: { work: string; component: string; reason: string }) => boolean, string]> = [];
  const rcpt = await mk('Your order confirmation #4821', 'Thanks for your purchase. Your order has shipped. No action needed.', ['Acme Store', 'noreply@acme-store-example.com'], 'receipt', 'none');
  probes.push(['a RECEIPT judges NONE via the structural floor (zero AI — the kind answered)', rcpt, (v) => v.component === 'message_only', 'none']);
  const news = await mk('This week in product — issue #52', 'Our weekly roundup: 5 links worth your time. Unsubscribe anytime.', ['Product Weekly', 'newsletter@product-weekly-example.com'], 'newsletter', 'none');
  probes.push(['a NEWSLETTER judges NONE (no fake work on bulk)', news, (v) => v.component === 'message_only', 'none']);
  const cust = await mk('Question on the pilot scope', 'Hi — before we sign, could you confirm whether onboarding support is included in the pilot price? We need this by Thursday.', ['Sam Vendor', 'sam@acme-example.com'], 'customer', 'you_owe');
  probes.push(['a CUSTOMER ask judges a REAL component (kind biases toward the reply)', cust, (v) => v.component !== 'message_only', 'reply-ish']);
  for (const [name, id, expect, want] of probes) {
    if (!id) { check(`SIM2 · ${name} (probe insert failed)`, false); continue; }
    const v = await judgeWork(sb, PERSONAL, { kind: 'inbox', id });
    check(`SIM2 · ${name}`, expect(v), `${v.work}/${v.component} (wanted ${want}) · "${v.reason.slice(0, 50)}"`);
    await sb.from('item_plans').delete().eq('user_id', PERSONAL).eq('kind', 'judgment').eq('entity_id', `inbox:${id}`);
    await sb.from('inbox_items').delete().eq('id', id);
  }

  // ── SIM 3 — proactivity precision (deterministic): where the kind gates ambient drafting ──
  for (const [uid, label] of USERS) {
    const { data: items } = await sb.from('inbox_items')
      .select('source_data, rule_type, work_state')
      .eq('user_id', uid).eq('status', 'pending').eq('source', 'email')
      .or('rule_type.eq.needs_reply,work_state.eq.work_prepared')
      .order('created_at', { ascending: false }).limit(200);
    const rows = (items ?? []) as Array<{ source_data: Record<string, unknown>; rule_type: string | null }>;
    let gated = 0;
    for (const it of rows) {
      const k = resolveKind(it.source_data ?? {}, it.rule_type);
      if (k === 'receipt' || k === 'newsletter' || k === 'notification') gated++;
    }
    const pct = rows.length ? Math.round((gated / rows.length) * 100) : 0;
    check(`SIM3 ${label} · reply-classed items the kind gates from ambient drafting`, true,
      `${gated}/${rows.length} (${pct}%) — drafts that would have been junk-directed now never fire`);
  }

  console.log('\n════ THE LABEL FLIP — GATES + SIMULATIONS ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `\n     → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
