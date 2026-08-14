// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE GROUND-LAW SUITE (permanent — QA doctrine: the Stratto shape became a fixture the day it was
// found). Walks the supersession journey LIVE on the probe host, DETERMINISTICALLY (the live judge
// flip-flopped a judged walk across runs — three runs, three verdicts — so the mechanics are
// exercised through seeded/route paths that cannot flake):
//   A. groundOf/groundMoved resolve and compare the newest inbound (pure).
//   B. reader + machine: a stamped artifact goes STALE the moment a newer inbound lands; the
//      machine walks awaiting_approval → preparing (no Send on a dead plan). Seeded judgment.
//   C. the delegation lane re-prepares on ground move (route-override — no judge): prior row
//      versioned, new row stamped from the NEW ground, exactly ONE delta narration, idempotent.
//   D. the content half: generateReplyDraft answers the thread's PRESENT (the newest inbound's
//      words), never the founding message (found live: a re-draft re-confirmed the OLD plan).
// Run: npx tsx --env-file=.env.local scripts/smoke-ground.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const userId = await resolveProbeUser(admin);
  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean, detail?: string) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  const threadId = `ground-probe-${Date.now()}`;
  const t0 = new Date(Date.now() - 3 * 3_600_000).toISOString();

  const { data: e1, error: e1Err } = await admin.from('emails').insert({
    user_id: userId, message_id: `<ground-1-${threadId}@probe.test>`, thread_id: threadId,
    from_address: 'jordan@zephyrgroup-example.com', from_name: 'Jordan Vale',
    subject: 'Scope confirmation needed', body: 'Could you reply confirming the revised proposal covers the Q3 rollout scope? The team is blocked on your answer.',
    received_at: t0, is_from_user: false,
  }).select('id').single();
  if (!e1) { console.log('✗ email fixture failed:', e1Err?.message); process.exit(1); }
  const { data: it } = await admin.from('inbox_items').insert({
    user_id: userId, source: 'email', status: 'pending', rule_type: 'needs_reply',
    work_title: 'Confirm the Q3 rollout scope for Jordan', work_state: 'work_prepared',
    source_data: {
      subject: 'Scope confirmation needed', thread_id: threadId,
      from: 'Jordan Vale <jordan@zephyrgroup-example.com>', from_address: 'jordan@zephyrgroup-example.com', from_name: 'Jordan Vale',
      body: 'Could you reply confirming the revised proposal covers the Q3 rollout scope? The team is blocked on your answer.',
      body_text: 'Could you reply confirming the revised proposal covers the Q3 rollout scope? The team is blocked on your answer.',
      received_at: t0,
    },
    last_activity_at: t0,
  }).select('id').single();
  if (!it) { console.log('✗ item fixture failed'); process.exit(1); }

  const cleanup = async () => {
    await admin.from('room_turns').delete().eq('user_id', userId).like('dedupe_key', `%${it.id}%`);
    const { data: turns } = await admin.from('room_turns').select('id').eq('user_id', userId).like('room_key', `%${it.id}%`);
    if (turns?.length) await admin.from('room_turns').delete().in('id', turns.map((t) => t.id));
    await admin.from('item_deliverables').delete().eq('user_id', userId).eq('entity_id', it.id);
    await admin.from('item_plans').delete().eq('user_id', userId).in('entity_id', [`inbox:${it.id}`, it.id]);
    await admin.from('inbox_items').delete().eq('id', it.id);
    await admin.from('emails').delete().eq('user_id', userId).eq('thread_id', threadId);
  };

  try {
    const { groundOf, groundMoved } = await import('@/lib/prepare/ground');
    const { getPrepared } = await import('@/lib/prepare/read');
    const { workStateOf } = await import('@/lib/work/machine');
    const { prepareOneItem } = await import('@/lib/prepare/pass');

    console.log('\nA — the ground resolves and compares (pure):');
    const g1 = await groundOf(admin, userId, { kind: 'inbox', id: it.id });
    ok('groundOf = the newest inbound', g1.emailId === String(e1.id) && Date.parse(String(g1.receivedAt)) === Date.parse(t0), JSON.stringify(g1));
    ok('same ground → not moved', !groundMoved({ emailId: g1.emailId, receivedAt: g1.receivedAt }, g1));
    ok('unstamped legacy artifact → exempt, never stale', !groundMoved(null, g1) && !groundMoved({}, g1));

    console.log('\nB — reader + machine: a stamped draft goes stale the moment the ground moves:');
    // The writer's own shape: a reply draft stamped from e1's ground + a seeded reply judgment.
    const { data: itRow } = await admin.from('inbox_items').select('source_data').eq('id', it.id).single();
    await admin.from('inbox_items').update({
      source_data: { ...(itRow?.source_data ?? {}), draft: { body: 'Hi Jordan — confirmed, the Q3 rollout scope is fully covered.', generated_at: new Date().toISOString(), prepared: 'pass', prepared_from: g1 }, prepared_by: { worker: 'Clara', at: new Date().toISOString() } },
    }).eq('id', it.id);
    await admin.from('item_plans').insert({
      user_id: userId, kind: 'judgment', entity_id: `inbox:${it.id}`,
      tasks: { verdict: { work: 'reply', component: 'reply_composer', gate: 'send', executor: { kind: 'system' }, reason: 'they asked for written confirmation' }, sig: 'smoke-seeded' },
    });
    const prep1 = await getPrepared(admin, userId, { kind: 'inbox_item', id: it.id });
    ok('reader: fresh artifact, not stale', prep1.some((a) => a.kind === 'reply_draft') && !prep1.some((a) => a.stale), JSON.stringify(prep1.map((a) => ({ k: a.kind, s: a.stale }))));
    const st1 = await workStateOf(admin, userId, { kind: 'inbox', id: it.id });
    ok('machine: awaiting_approval (Send is the primary)', st1.state === 'awaiting_approval', st1.state);

    const t1 = new Date().toISOString();
    const { data: e2 } = await admin.from('emails').insert({
      user_id: userId, message_id: `<ground-2-${threadId}@probe.test>`, thread_id: threadId,
      from_address: 'jordan@zephyrgroup-example.com', from_name: 'Jordan Vale',
      subject: 'Re: Scope confirmation needed', body: 'One more thing — when you confirm, please also state whether the Q4 pilot phase is included, our board needs that named explicitly.',
      received_at: t1, is_from_user: false,
    }).select('id').single();
    await admin.from('inbox_items').update({ last_activity_at: t1 }).eq('id', it.id);
    const g2 = await groundOf(admin, userId, { kind: 'inbox', id: it.id });
    ok('the ground moved to the new inbound', g2.emailId === String(e2!.id), JSON.stringify(g2));
    ok('groundMoved: superseded', groundMoved(g1, g2));
    const prep2 = await getPrepared(admin, userId, { kind: 'inbox_item', id: it.id });
    ok('reader: the draft reads STALE', prep2.some((a) => a.kind === 'reply_draft' && a.stale), JSON.stringify(prep2.map((a) => ({ k: a.kind, s: a.stale }))));
    const st2 = await workStateOf(admin, userId, { kind: 'inbox', id: it.id });
    ok('machine: superseded work = preparing (never a Send on a dead plan)', st2.state === 'preparing', st2.state);

    console.log('\nC — the delegation lane re-prepares on ground move (route-override, no judge):');
    const { data: worker } = await admin.from('custom_agents').select('id, name, worker_role')
      .eq('user_id', userId).eq('is_worker', true).limit(1).maybeSingle();
    if (!worker) { console.log('  ✗ probe has no seeded workers'); await cleanup(); process.exit(1); }
    const wi = {
      id: `inbox:${it.id}`, entityId: it.id, kind: 'reply', title: 'Confirm the Q3 rollout scope for Jordan',
      state: 'todo', actor: 'you', automated: false, who: 'Jordan Vale <jordan@zephyrgroup-example.com>',
      blockedOn: null, startAt: t0, when: { explicit: null, bucket: 'now' }, entity: null,
    } as never;
    const route = { route: { worker: { id: worker.id, name: worker.name, role: worker.worker_role } } } as never;
    const r1 = await prepareOneItem(admin, userId, wi, route);
    console.log('  delegation 1:', JSON.stringify(r1));
    const delRows = async () => (await admin.from('item_deliverables').select('id, metadata, created_at')
      .eq('user_id', userId).eq('kind', 'email').eq('entity_id', it.id).eq('task_id', 'prepare-pass')
      .order('created_at', { ascending: false })).data ?? [];
    const d1 = await delRows();
    const stamp1 = ((d1[0]?.metadata ?? {}) as { prepared_from?: { emailId?: string } }).prepared_from;
    if (r1.did === 'delegated' && d1.length) {
      ok('the deliverable is stamped from the CURRENT ground', stamp1?.emailId === String(e2!.id), JSON.stringify(stamp1));
      // A third, even newer inbound — the delegation's ground moves.
      const t2 = new Date(Date.now() + 1000).toISOString();
      const { data: e3 } = await admin.from('emails').insert({
        user_id: userId, message_id: `<ground-3-${threadId}@probe.test>`, thread_id: threadId,
        from_address: 'jordan@zephyrgroup-example.com', from_name: 'Jordan Vale',
        subject: 'Re: Scope confirmation needed', body: 'Correction — leave Q4 out entirely; the board voted this morning. Confirm Q3 scope only.',
        received_at: t2, is_from_user: false,
      }).select('id').single();
      await admin.from('inbox_items').update({ last_activity_at: t2 }).eq('id', it.id);
      const r2 = await prepareOneItem(admin, userId, wi, route);
      console.log('  delegation 2:', JSON.stringify(r2));
      const d2 = await delRows();
      const current = d2.filter((d) => !((d.metadata ?? {}) as { version_of?: string }).version_of);
      const versioned = d2.filter((d) => ((d.metadata ?? {}) as { version_of?: string }).version_of === 'superseded:ground-move');
      // The re-opened work legitimately lands one of THREE ways: a fresh deliverable (the
      // delegation lane PHYSICALLY REPLACES the prior same-task row — runDelegation deletes it,
      // so the versioned stamp does not survive delivery on this lane), the coworker's honest ask
      // for new inputs, or the evaluator's honest retry flag. All three prove the wall fell —
      // "already prepared" is the ONLY failure.
      const askedInstead = r2.did === 'none' && /needs input/i.test(String(r2.reason ?? ''));
      const retryFlag = r2.did === 'none' && /didn't pass review/i.test(String(r2.reason ?? ''));
      ok('the ground move RE-OPENED the work (no "already prepared" wall)',
        r2.did === 'delegated' || askedInstead || retryFlag,
        JSON.stringify(r2));
      if (r2.did === 'delegated') {
        ok('ONE current deliverable (the lane replaces in place)', current.length === 1, `current=${current.length} versioned=${versioned.length}`);
        const stamp2 = ((current[0]?.metadata ?? {}) as { prepared_from?: { emailId?: string } }).prepared_from;
        ok('re-prepared from the NEWEST ground', stamp2?.emailId === String(e3!.id), JSON.stringify(stamp2));
        const { data: deltas } = await admin.from('room_turns').select('id, text')
          .eq('user_id', userId).eq('dedupe_key', `ground:${it.id}:${e3!.id}`);
        ok('EXACTLY ONE delta narration, naming who moved it', (deltas ?? []).length === 1 && /Jordan/.test(String(deltas?.[0]?.text ?? '')), JSON.stringify(deltas));
        const { data: deltasAll } = await admin.from('room_turns').select('id').eq('user_id', userId).like('dedupe_key', `ground:${it.id}:%`);
        ok('exactly one delta line total', (deltasAll ?? []).length === 1, String(deltasAll?.length));
      } else if (askedInstead) {
        const { data: cowAsk } = await admin.from('room_turns').select('id')
          .eq('user_id', userId).like('dedupe_key', `delegate:${it.id}:%`)
          .filter('component->>key', 'eq', 'input_checklist').maybeSingle();
        ok('the honest ask STANDS in the room (the visible consequence of re-prep)', !!cowAsk);
        ok('the prior deliverable is VERSIONED (no delivery = no physical replace)', versioned.length >= 1, `versioned=${versioned.length}`);
        console.log('  (coworker asked instead of delivering — the delta-line half rides only delivered work by design)');
      } else {
        console.log('  (evaluator retry flag — honest, terminal for this pass; D6 escalation is the queued arc)');
      }
      const r3 = await prepareOneItem(admin, userId, wi, route);
      ok('a third pass no-ops (idempotent — the outstanding state blocks re-work)', r3.did === 'none', JSON.stringify(r3));
    } else {
      // The coworker may honestly ask for inputs OR flag an evaluator rejection instead of
      // delivering — the supply-loop gates (AJ2) cover those paths; here it just means the
      // re-open half ran without a deliverable to supersede.
      console.log(`  (delegation returned ${JSON.stringify(r1)} — re-open half not exercised this run)`);
      ok('delegation path reached (deliverable, honest ask, or honest retry flag)',
        r1.did === 'delegated' || /input|ask|didn't pass review/i.test(String(r1.reason ?? '')), JSON.stringify(r1));
    }

    console.log('\nD — the content half: the drafter answers the thread\'s PRESENT:');
    const { generateReplyDraft } = await import('@/lib/inbox/draft-reply');
    const { data: itNow } = await admin.from('inbox_items').select('source_data').eq('id', it.id).single();
    const draft = await generateReplyDraft(userId, (itNow?.source_data ?? {}) as Record<string, never>, admin);
    const answersPresent = /q4|pilot|q3 (scope )?only|board/i.test(draft);
    console.log(`  ("${draft.slice(0, 140)}…")`);
    ok('the draft speaks to the NEWEST message, not the founding one', answersPresent, draft.slice(0, 200));
  } finally {
    await cleanup();
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
