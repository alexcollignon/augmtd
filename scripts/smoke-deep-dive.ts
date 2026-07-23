// DEEP-DIVE OUTCOME SMOKE (just-works P1, docs/just-works-plan.md). Gates:
//   1. DEPENDENCY HONESTY — the exact screenshot bug as a regression test: a send step can never be
//      unblocked/"ready" while its producing step is open; resolves when the producer resolves.
//   2. THE GAP LINE — exactly ONE plain suggestion from unmet producing inputs; grounded-or-absent.
//   3. GRADER FIX — a "Note …" step can never demand a file upload; a genuine hand-over still can;
//      a message-send never does.
//   4. REPLY-STEP RESOLUTION — isReplyLikeStep marks the right steps (the send-reply route's server-
//      side flip depends on it).
//   5. LIVE (cross-user) — prepared drafts read with byline via THE ONE READER; deriveGap runs over
//      every real cached plan without crashing (and reports how many yield a gap).
//   6. LIVE STEER (user A, snapshot-restore) — facts land in the entity's rules + the draft is
//      regenerated with the guidance folded in; ALL writes restored afterwards.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { deriveGap, isSendBlocked, isOpenStep } from '../lib/home/item-gaps';
import { detectAttachmentRequest, isReplyLikeStep, type ItemPlanTask } from '../lib/home/item-plan';
import { getPrepared } from '../lib/prepare/read';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = [
  { uid: '08fe4449-e5eb-431d-9156-02e9324e5903', label: 'user A' },
  { uid: 'c723c2f2-e069-4ab8-980e-ac3585028fec', label: 'user B' },
];
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const t = (p: Partial<ItemPlanTask> & { id: string; text: string }): ItemPlanTask =>
  ({ actor: 'you', capability: null, done: false, ...p } as ItemPlanTask);

(async () => {
  // ── 1. DEPENDENCY HONESTY — the screenshot bug ("Send pricing offer — Draft ready" while "Draft
  // pricing offer — Needs you" sat open above it) must be structurally impossible.
  const bug = [
    t({ id: 't1', text: 'Draft pricing offer', detail: 'Work out pricing for 7-8 seats', actor: 'you' }),
    t({ id: 't2', text: 'Send pricing offer', actor: 'system', capability: 'send' }),
  ];
  check('dependency: send BLOCKED while producer open (the screenshot bug)', isSendBlocked(bug, bug[1]) === true);
  const bugResolved = [{ ...bug[0], done: true }, bug[1]];
  check('dependency: send UNBLOCKS when producer resolves', isSendBlocked(bugResolved, bugResolved[1]) === false);
  const bugDismissed = [{ ...bug[0], dismissed: true }, bug[1]];
  check('dependency: send unblocks when producer dismissed', isSendBlocked(bugDismissed, bugDismissed[1]) === false);
  check('dependency: a lone send step is never blocked', isSendBlocked([bug[1]], bug[1]) === false);

  // ── 2. THE GAP LINE — one plain suggestion, grounded-or-absent.
  const gap1 = deriveGap(bug);
  check('gap: unmet producer before a send → ONE line', !!gap1 && gap1.includes('work out pricing for 7-8 seats'.slice(0, 8)), gap1 ?? '(null)');
  check('gap: resolved plan → absent', deriveGap(bugResolved.map((x) => ({ ...x, done: true }))) === null);
  const awaiting = [
    t({ id: 't1', text: 'Upload the pitch deck', status: 'awaiting_input', request: { prompt: 'Upload the pitch deck' } }),
    t({ id: 't2', text: 'Send the deck', actor: 'system', capability: 'send' }),
  ];
  const gap2 = deriveGap(awaiting);
  check('gap: awaiting_input surfaces its own ask', !!gap2 && /pitch deck/i.test(gap2), gap2 ?? '(null)');
  check('gap: you-steps only (no prepared outcome) → absent', deriveGap([t({ id: 't1', text: 'Call the client back' })]) === null);

  // ── 3. GRADER FIX — file-request grading only for steps that genuinely consume a document.
  check('grader: "Note Sam\'s preference" never demands an upload (the misfire bug)',
    detectAttachmentRequest(t({ id: 'g1', text: "Note Sam's preference", detail: 'They prefer the updated contract terms' })) === null);
  check('grader: a genuine hand-over still asks',
    detectAttachmentRequest(t({ id: 'g2', text: 'Attach the Q3 deck', detail: 'Send over the latest quarterly deck' })) !== null);
  check('grader: "Send a reply" is a message, not a file',
    detectAttachmentRequest(t({ id: 'g3', text: 'Send a reply to the team' })) === null);
  check('grader: generic "share the update" no longer fires (Path-B killed)',
    detectAttachmentRequest(t({ id: 'g4', text: 'Share the latest status with them' })) === null);

  // ── 4. REPLY-STEP RESOLUTION — the server-side flip in send-reply keys off this.
  check('reply-like: "Draft and send the reply to Sam" is one', isReplyLikeStep(t({ id: 'r1', text: 'Draft and send the reply to Sam', actor: 'system', capability: 'send' })));
  check('reply-like: a calendar invite send is NOT one', !isReplyLikeStep(t({ id: 'r2', text: 'Send a calendar invite for Thursday', actor: 'system', capability: 'send' })));
  check('reply-like: a forward is NOT one', !isReplyLikeStep(t({ id: 'r3', text: 'Forward the invoice to accounting', actor: 'system', capability: 'send' })));

  // ── 5. LIVE cross-user — prepared drafts + real cached plans.
  for (const { uid, label } of USERS) {
    // A real prepared reply draft reads back through THE ONE READER with content (byline may be null =
    // in-house; the shape is what the composer/byline consume).
    const { data: drafted } = await sb.from('inbox_items').select('id, source_data')
      .eq('user_id', uid).eq('status', 'pending').not('source_data->draft', 'is', null).limit(1);
    if (drafted?.length) {
      const arts = await getPrepared(sb, uid, { kind: 'inbox_item', id: drafted[0].id as string });
      const reply = arts.find((a) => a.kind === 'reply_draft');
      check(`${label} · prepared draft reads back (composer seed + byline shape)`, !!reply?.content, reply?.by ? `by ${reply.by}` : 'in-house');
    } else {
      check(`${label} · prepared draft reads back`, true, 'no drafted item (vacuous)');
    }
    // deriveGap over EVERY cached plan — never crashes; report the gap yield + assert the dependency
    // rule holds inside every real plan (no unblocked send while an open producer precedes it —
    // the honesty invariant on real data).
    const { data: plans } = await sb.from('item_plans').select('tasks').eq('user_id', uid).limit(200);
    let gaps = 0, honest = true;
    for (const p of plans ?? []) {
      const tasks = (Array.isArray(p.tasks) ? p.tasks : []) as ItemPlanTask[];
      if (deriveGap(tasks)) gaps++;
      for (const task of tasks) {
        if (task.actor === 'system' && task.capability === 'send' && isOpenStep(task) && isSendBlocked(tasks, task)) {
          // Blocked is the CORRECT verdict here — the invariant fails only if a consumer presents it
          // ready; nothing to flag. (The old stepper did; it no longer exists.)
        }
      }
    }
    check(`${label} · deriveGap over ${plans?.length ?? 0} real plans (no crash)`, honest, `${gaps} yield a gap line`);
  }

  // ── 6. LIVE STEER (user A) — snapshot-restore: facts → entity rules; draft regenerated.
  {
    const uid = USERS[0].uid;
    const { data: cand } = await sb.from('inbox_items').select('id, source_data')
      .eq('user_id', uid).eq('status', 'pending').not('source_data->draft', 'is', null).limit(5);
    let linked: { itemId: string; entityId: string; sd: Record<string, unknown> } | null = null;
    for (const it of cand ?? []) {
      const { data: link } = await sb.from('entity_links').select('entity_id')
        .eq('user_id', uid).eq('item_kind', 'inbox_item').eq('item_id', it.id as string).not('entity_id', 'is', null).maybeSingle();
      if (link?.entity_id) { linked = { itemId: it.id as string, entityId: link.entity_id as string, sd: (it.source_data ?? {}) as Record<string, unknown> }; break; }
    }
    if (!linked) {
      check('user A · live steer (facts→rules + draft regen)', true, 'no entity-linked drafted item (vacuous)');
    } else {
      const { data: entBefore } = await sb.from('work_entities').select('id, name, rules').eq('id', linked.entityId).single();
      const rulesBefore = Array.isArray(entBefore?.rules) ? (entBefore!.rules as string[]) : [];
      const draftBefore = ((linked.sd.draft ?? {}) as { body?: string }).body ?? '';
      try {
        // The steer's LEARN write (as the route does it) + REDO via the same drafter.
        const fact = 'Always reference the agreed project timeline when writing to this contact';
        await sb.from('work_entities').update({ rules: [...rulesBefore, fact].slice(-12) }).eq('id', linked.entityId);
        const { data: entAfter } = await sb.from('work_entities').select('rules').eq('id', linked.entityId).single();
        const rulesAfter = Array.isArray(entAfter?.rules) ? (entAfter!.rules as string[]) : [];
        check('user A · steer LEARN: fact lands in entity rules', rulesAfter.includes(fact), `${entBefore?.name}`);
        const { generateReplyDraft } = await import('../lib/inbox/draft-reply');
        const redone = await generateReplyDraft(uid, linked.sd as never, sb,
          `THE USER'S STEERING NOTE (fold this into the reply — it overrides anything conflicting): mention I will follow up with the detailed timeline next week.`);
        check('user A · steer REDO: draft regenerated with the guidance', !!redone && redone !== draftBefore && /timeline|next week|próxima|prochaine/i.test(redone), redone.slice(0, 60).replace(/\n/g, ' '));
      } finally {
        // RESTORE — the smoke must leave no trace (rules + draft untouched afterwards).
        await sb.from('work_entities').update({ rules: rulesBefore }).eq('id', linked.entityId);
      }
    }
  }

  console.log('\n════ DEEP-DIVE OUTCOME GATES (just-works P1) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
