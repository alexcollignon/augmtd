// ─── THE TWO-WAY OUTCOME LEDGER GATE (W3.2, Sep 22) ────────────────────────────────────────────
// THE LAW (LAW 7 · THE OUTCOME LOOP, bound by THE TRICHOTOMY — laws-registry precedence #7): every
// door that ends a prepared artifact writes its fate — accepted / edited / discarded / done_elsewhere
// / expired / superseded — and the facts fed to the judge and the drafter read that BALANCED ledger,
// speak "done elsewhere" as proof the work was real (never as a reason to prepare less), and stay
// quarantined (flag default OFF) until the owner reads the readiness report and flips it.
//
//   L1 DOORS    — source floors: every door names its class and its door tag; the strip doors
//                 capture BEFORE the write that deletes the drafts.
//   L2 THE ROW  — pure: the row shape, the fate ladder, the send verdict, the sender class.
//   L3 FACTS    — pure: done_elsewhere counts as a verdict, is never phrased against preparing;
//                 the header carries the trichotomy; pre-v2 rows are never read as verdicts.
//   L4 READY    — pure: the readiness report (balanced classes, min-N, span, backfill excluded).
//   L5 FLAG     — OUTCOME_FACTS_ENABLED is still OFF by default.
//
// Zero-AI, zero-DB. Run: npx tsx scripts/smoke-outcome-ledger.ts
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(p, 'utf8');
/** `a` appears before `b` (both present) — capture-before-strip ordering. */
const before = (s: string, a: string | RegExp, b: string | RegExp, from = 0): boolean => {
  const idx = (x: string | RegExp) => {
    if (typeof x === 'string') return s.indexOf(x, from);
    const m = new RegExp(x.source, x.flags.replace('g', '') + 'g'); m.lastIndex = from;
    const r = m.exec(s); return r ? r.index : -1;
  };
  const ia = idx(a), ib = idx(b);
  return ia >= 0 && ib >= 0 && ia < ib;
};

async function main() {
  console.log('THE TWO-WAY OUTCOME LEDGER GATE\n');
  delete process.env.OUTCOME_FACTS_ENABLED; // assert the DEFAULT

  const O = await import('../lib/prepare/outcome');
  const F = await import('../lib/prepare/outcome-facts');

  // ── L1 · EVERY DOOR WRITES ITS CLASS ─────────────────────────────────────────────────────────
  console.log('L1 · every door writes its class');
  {
    const s = src('app/api/inbox/[id]/send-reply/route.ts');
    ok('send-reply logs accepted/edited through the one send verdict', /sendVerdict\(prepared, sentBody\)/.test(s) && /door: 'send_reply'/.test(s));
    ok('   …measured against the STORED unsent draft when the client sends no aiDraft (the stage-send gap)',
      /storedDraft/.test(s) && /!storedDraft\.sent_at/.test(s) && /aiDraft : storedBody/.test(s));
  }
  {
    const s = src('app/api/compose/send/route.ts');
    ok('compose/send logs accepted/edited against the seeded draft', /door: 'compose_send'/.test(s) && /sendVerdict\(seeded, bodyHTML\)/.test(s));
    ok('   …only after the send landed (the log sits after the commit record)', before(s, 'recordCommitResult', "door: 'compose_send'"));
  }
  {
    const s = src('app/api/items/execute/route.ts');
    ok('items/execute logs invite + forward (accepted vs edited against the pooled/source artifact)',
      (s.match(/door: 'items_execute'/g) ?? []).length >= 2 && /edited \? 'edited' : 'accepted'/.test(s));
  }
  {
    const s = src('app/api/invites/send/route.ts');
    ok('the chat-born invite door logs its fate', /door: 'invite_send'/.test(s) && /itemKind: 'chat'/.test(s));
    ok('   …compared against the payload read BEFORE the edits landed', /const before = stored\.invite/.test(s));
  }
  {
    const s = src('app/api/commitments/[id]/nudge/route.ts');
    ok('the nudge door logs its fate', /door: 'nudge_send'/.test(s) && /artifact: 'nudge_draft'/.test(s));
    ok('   …and stamps the pooled chase draft SPENT (the reader stops offering it)', /sent_at: new Date\(\)\.toISOString\(\)/.test(s));
  }
  {
    const s = src('lib/tools/item-actions.ts');
    ok('the inbox resolver splits the verdicts: mark-done = done_elsewhere, dismiss = discarded',
      /base: resolution === 'complete' \? 'done_elsewhere' : 'discarded'/.test(s) && /door: 'resolve_inbox'/.test(s));
    ok('   …captured before the flip', before(s, "capturePending(client, userId, { kind: 'inbox'", "client.from('inbox_items')\n    .update({ status"));
    ok('the commitment resolver (tool) splits them too',
      /base: args\.resolution === 'done' \? 'done_elsewhere' : 'discarded'/.test(s) && /door: 'resolve_commitment'/.test(s));
  }
  {
    const s = src('app/api/commitments/[id]/route.ts');
    ok('the commitment PATCH door splits them', /base: status === 'done' \? 'done_elsewhere' : 'discarded'/.test(s) && /door: 'resolve_commitment'/.test(s));
    ok('   …captured before the flip', before(s, 'capturePending(supabase, user.id', ".update({ status, resolved_at"));
  }
  {
    const s = src('lib/inbox/resolve-on-reply.ts');
    const n = (s.match(/door: 'reply_external'/g) ?? []).length;
    ok('the external reply (the most common fate) logs done_elsewhere on items AND commitments',
      n >= 2 && (s.match(/base: 'done_elsewhere'/g) ?? []).length >= 2);
    ok('   …the item captured before its flip', before(s, "capturePending(client, userId, { kind: 'inbox'", "resolved_reason: 'replied', resolved_at: resolvedAt"));
  }
  {
    const s = src('lib/work/evidence-settle.ts');
    ok('an evidence settle logs done_elsewhere (commitment + inbox)', (s.match(/door: 'evidence_settle'/g) ?? []).length >= 2);
    // ⟲ re-pointed W9.1b: the strip is THE ONE ENGINE STRIP (stripSourceArtifacts — the hand is filed, never deleted).
    ok('   …the inbox capture precedes the write that strips the drafts', before(s, "capturePending(client, userId, { kind: 'inbox'", 'stripSourceArtifacts('));
  }
  {
    const s = src('lib/work/apply-verdict.ts');
    ok('the judge resolution logs answered→done_elsewhere, expired→expired',
      /base: expired \? 'expired' : 'done_elsewhere'/.test(s) && (s.match(/door: 'judge_resolution'/g) ?? []).length >= 2);
    ok('   …capture precedes the draft strip', before(s, "capturePending(client, userId, { kind: 'inbox'", 'stripSourceArtifacts(')); // ⟲ W9.1b
  }
  {
    const s = src('lib/commitments/expiry.ts');
    ok('the expiry law logs expired', /base: 'expired'/.test(s) && /door: 'expiry'/.test(s));
  }
  {
    const s = src('lib/inbox/conversation-identity.ts');
    ok('the conversation cascade logs done_elsewhere, captured before its strip',
      /door: 'conversation_cascade'/.test(s) && before(s, 'capturePending(client, userId', 'stripSourceArtifacts(client, userId') /* ⟲ W9.1b */);
  }
  {
    const s = src('lib/prepare/pass.ts');
    const sites = (s.match(/narrateGroundMove\(admin, userId, w, currentGround, '/g) ?? []).length;
    ok('every ground-move re-prepare names its artifact (superseded is logged at the one narrator)', sites >= 8 && !/narrateGroundMove\(admin, userId, w, currentGround\)/.test(s), `sites=${sites}`);
    ok("   …the narrator writes 'superseded'", /outcome: 'superseded'/.test(s) && /door: 'ground_move'/.test(s));
    ok('the already-booked floor logs done_elsewhere for the invite it strips', /door: 'booked_floor'/.test(s));
  }
  {
    const s = src('lib/prepare/outcome.ts');
    ok('capture reads THE ONE PREPARED READER (no second definition of "pending")', /preparedState\(/.test(s) && /import\('@\/lib\/prepare\/read'\)/.test(s));
    ok('   …and the resolver never writes a raw learning_signals row itself', !/learning_signals/.test(src('lib/tools/item-actions.ts').split('THE OUTCOME LOG')[1] ?? ''));
  }

  // ── L2 · THE ROW ─────────────────────────────────────────────────────────────────────────────
  console.log('\nL2 · the row');
  {
    const now = Date.parse('2026-09-22T12:00:00Z');
    const row = O.outcomeSignalData({ outcome: 'done_elsewhere', artifact: 'reply_draft', itemKind: 'inbox', itemId: 'x1', door: 'reply_external', senderClass: 'human', preparedAt: '2026-09-21T12:00:00Z' }, now);
    ok('the row carries action · lane · door · sender class · age · ledger version',
      row.action === 'prepared_done_elsewhere' && row.lane === 'reply' && row.door === 'reply_external'
      && row.sender_class === 'human' && row.artifact_age_hours === 24 && row.ledger_v === O.OUTCOME_LEDGER_VERSION);
    ok('every artifact kind has a lane (nudge and paste_pack are their own)',
      O.LANE_OF_ARTIFACT.nudge_draft === 'nudge' && O.LANE_OF_ARTIFACT.paste_pack === 'paste_pack' && O.LANE_OF_ARTIFACT.deliverable === 'produce');
    ok('an unknown preparation time records no age (never a guessed one)', !('artifact_age_hours' in O.outcomeSignalData({ outcome: 'accepted', artifact: 'invite', itemKind: 'chat', itemId: 'c' })));
    ok('edit share is clamped and rounded', O.outcomeSignalData({ outcome: 'edited', artifact: 'reply_draft', itemKind: 'inbox', itemId: 'e', editShare: 1.7 }).edit_share === 1);

    ok('fate ladder: a past-time artifact EXPIRED whatever closed it', O.fateOf({ stale: false, expired: true }, 'done_elsewhere') === 'expired' && O.fateOf({ stale: false, expired: true }, 'discarded') === 'expired');
    ok('   …a superseded artifact handled elsewhere reads superseded', O.fateOf({ stale: true, expired: false }, 'done_elsewhere') === 'superseded');
    ok('   …a dismissal stays the user\'s no, stale or not', O.fateOf({ stale: true, expired: false }, 'discarded') === 'discarded');
    ok('   …a live artifact takes the base', O.fateOf({ stale: false, expired: false }, 'done_elsewhere') === 'done_elsewhere');

    ok('send verdict: identical text (HTML-tolerant) is accepted', O.sendVerdict('<p>Hi Sam,</p><p>Thanks — see you Thursday.</p>', 'Hi Sam, Thanks — see you Thursday.').outcome === 'accepted');
    const ed = O.sendVerdict('Hi Sam, thanks for the deck, I will review it by Friday.', 'Hi Sam, thanks — I reviewed the deck and have two comments.');
    ok('   …changed text is edited with a share in (0,1]', ed.outcome === 'edited' && typeof ed.editShare === 'number' && ed.editShare > 0 && ed.editShare <= 1);

    ok('sender class uses the existing structural predicate', O.senderClassOf({ from_address: 'no-reply@example.com', from_name: 'Acme Billing' }) === 'automated'
      && O.senderClassOf({ from_address: 'sam@acme.test', from_name: 'Sam Doe' }) === 'human' && O.senderClassOf(null) === 'unknown');
  }

  // ── L3 · THE FACTS READ THE TWO-WAY LEDGER ─────────────────────────────────────────────────
  console.log('\nL3 · the facts');
  {
    const base = { v: F.OUTCOME_FACTS_VERSION, day: '2026-09-22', windowDays: F.OUTCOME_WINDOW_DAYS, minN: F.OUTCOME_MIN_N, observed: 0 };
    type LS = import('../lib/prepare/outcome-facts').LaneStats;
    const facts = (rows: Array<Partial<LS>>) => ({ ...base, rows: rows.map((r) => ({ lane: 'reply', klass: 'any', accepted: 0, edited: 0, discarded: 0, n: 0, medianEditShare: null, ...r })) as LS[] });

    const elsewhere = facts([{ lane: 'reply', klass: 'any', doneElsewhere: 5, n: 5 }]);
    ok('done_elsewhere alone clears the floor (it is a verdict on the lane)', F.speakableRows(elsewhere).length === 1);
    const blk = F.outcomeHistoryFact(elsewhere, {});
    ok('   …and is spoken as proof the work was real', /handled 5 themselves outside our door/.test(blk) && /the work was real/.test(blk));
    const banned = /not worth preparing|prepare (it )?less\b(?! ?—)|stop preparing|do not prepare|never prepare|\bskip\b/i;
    const line = F.outcomeLine(elsewhere.rows[0]);
    ok('   …the LINE never phrases it against preparing', !banned.test(line), line);
    ok('   …the header binds the trichotomy (HOW, never WHETHER; prepared, asked or parked)',
      /never WHETHER real work lands/.test(blk) && /prepared, asked or parked/.test(blk));
    ok('   …and reads done-elsewhere as "earlier and closer", explicitly not "prepare less"',
      /earlier and closer to sendable, not as a reason to\s+prepare less/.test(F.OUTCOME_HISTORY_HEADER(90)));
    ok('the old one-sided phrase is gone everywhere', !/not worth preparing/.test(src('lib/prepare/outcome-facts.ts').replace(/\/\/.*$/gm, '')));
    ok('the header still declares FACTS, not a verdict', /FACTS, not a verdict/.test(blk) && /decide for yourself what they mean/.test(blk));

    const mixed = facts([{ lane: 'reply', klass: 'any', accepted: 2, edited: 1, discarded: 1, doneElsewhere: 3, expired: 1, superseded: 2, n: 7, medianEditShare: 0.3 }]);
    const ml = F.outcomeLine(mixed.rows[0]);
    ok('every class stated in counts', /sent 2 as written, edited 1, rewriting about 30%/.test(ml) && /handled 3 themselves/.test(ml) && /dismissed 1 without using it/.test(ml));
    ok('   …timing facts (expired + superseded) reported, never as a verdict', /3 more went stale before anyone acted/.test(ml));
    ok('the drafter fact counts the overtaken drafts', /3 were overtaken by the user answering on their own/.test(F.outcomeRegisterFact(mixed)));
    ok('the digest carries done-elsewhere only when present (stable sig otherwise)',
      F.outcomeDigest(mixed) === 'reply.any:2/1/1/3' && F.outcomeDigest(facts([{ lane: 'reply', klass: 'any', accepted: 1, edited: 1, discarded: 4, n: 6 }])) === 'reply.any:1/1/4');
    ok('under the floor: silence', F.outcomeHistoryFact(facts([{ lane: 'reply', klass: 'any', doneElsewhere: 2, n: 2 }]), {}) === '');

    // computeOutcomeFacts over a stub ledger: v1 rows are never verdicts, v2 rows are counted with
    // done_elsewhere in n and expired/superseded outside it.
    const rows = [
      { signal_data: { action: 'prepared_discarded', artifact: 'reply_draft', item_kind: 'inbox', item_id: 'a' } }, // v1 — ignored
      { signal_data: { action: 'prepared_discarded', artifact: 'reply_draft', item_kind: 'inbox', item_id: 'b' } }, // v1 — ignored
      ...['accepted', 'edited', 'done_elsewhere', 'done_elsewhere', 'discarded', 'superseded'].map((o, i) => ({
        signal_data: O.outcomeSignalData({ outcome: o as import('../lib/prepare/outcome').PreparedOutcome, artifact: 'reply_draft', itemKind: 'commitment', itemId: `c${i}` }),
      })),
    ];
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'order', 'in']) chain[m] = () => chain;
    chain.limit = () => Promise.resolve({ data: rows, error: null });
    const stub = { from: () => chain } as never;
    const computed = await F.computeOutcomeFacts(stub, 'u', { day: '2026-09-22' });
    const any = computed.rows.find((r) => r.lane === 'reply' && r.klass === 'any');
    ok('pre-v2 (one-sided) rows are never read as verdicts', computed.observed === 6 && !!any && any.discarded === 1);
    ok('   …done_elsewhere counts toward n; superseded does not', !!any && any.doneElsewhere === 2 && any.n === 5 && any.superseded === 1);
  }

  // ── L4 · THE READINESS REPORT ──────────────────────────────────────────────────────────────
  console.log('\nL4 · readiness');
  {
    const day = (d: number) => new Date(Date.parse('2026-09-01T09:00:00Z') + d * 86_400_000).toISOString();
    const row = (o: string, d: number, extra: Record<string, unknown> = {}) => ({
      created_at: day(d),
      signal_data: { ...O.outcomeSignalData({ outcome: o as import('../lib/prepare/outcome').PreparedOutcome, artifact: 'reply_draft', itemKind: 'inbox', itemId: `i${d}${o}` }), ...extra },
    });
    const legacyOnly = F.ledgerReadiness([{ created_at: day(0), signal_data: { action: 'prepared_discarded', artifact: 'reply_draft' } }]);
    ok('a one-sided (legacy) ledger is NOT ready', !legacyOnly.ready && legacyOnly.legacy === 1 && legacyOnly.observed === 0);
    const discardsOnly = F.ledgerReadiness([0, 3, 6, 9].map((d) => row('discarded', d)));
    ok('a v2 ledger that only hears "no" is NOT ready (both sides must be heard)', !discardsOnly.ready && discardsOnly.reasons.some((r) => /send doors/.test(r)));
    const balanced = F.ledgerReadiness([
      row('accepted', 0), row('edited', 2), row('accepted', 4),
      row('done_elsewhere', 1), row('done_elsewhere', 5), row('done_elsewhere', 8),
      row('discarded', 3), row('superseded', 6),
    ]);
    ok('a balanced ledger over 8 days IS ready', balanced.ready, balanced.reasons.join('; '));
    ok('   …with per-lane counts by class', balanced.lanes.reply?.accepted === 2 && balanced.lanes.reply?.done_elsewhere === 3 && balanced.lanes.reply?.superseded === 1 && balanced.lanes.reply?.n === 7);
    const backfilled = F.ledgerReadiness([
      row('accepted', 0), row('edited', 1), row('accepted', 2),
      ...[0, 4, 9].map((d) => row('done_elsewhere', d, { backfilled: true })),
    ]);
    ok('backfilled history never proves the doors write (excluded from readiness)', !backfilled.ready && backfilled.backfilled === 3);
    const short = F.ledgerReadiness([row('accepted', 0), row('edited', 0), row('accepted', 1), row('done_elsewhere', 1), row('done_elsewhere', 1), row('done_elsewhere', 2)]);
    ok('one afternoon is not a week (span floor)', !short.ready && short.reasons.some((r) => /spans/.test(r)));
  }

  // ── L5 · THE FLAG STAYS OFF ────────────────────────────────────────────────────────────────
  console.log('\nL5 · the flag');
  ok('OUTCOME_FACTS_ENABLED is still false by default (the owner flips it)', F.OUTCOME_FACTS_ENABLED === false);
  ok('   …and the readiness check is a report, never a switch', !/OUTCOME_FACTS_ENABLED\s*=(?!=)/.test(src('lib/prepare/outcome-facts.ts').split('THE READINESS CHECK')[1] ?? ''));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
