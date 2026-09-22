// Replay suite for the live pilot failures (the amnesia class + the production hand-off) on
// the probe user. Run on demand: npx tsx scripts/smoke-converse-history.ts
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import { converse } from '../lib/converse';

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const userId = await resolveProbeUser(admin);

  const priorAnswer =
    'Last week you signed the Acme Publicist engagement letter on Aug 7 and met with Fortway PR to hand off materials. ' +
    'You also received readiness reports from Sam at Northwind, and Jordan confirmed session details for the Beacon platform. ' +
    'This week the critical path runs through Aug 11: you have the Acme kick-off call where you owe availability confirmation, ' +
    'plus four items due to Sam for the Northwind Academy program including the updated proposal. ' +
    'Start by sending Jordan the amended assessment questions — you are already 4 days late.';

  const history1 = [
    { role: 'user' as const, text: 'please prepare my weekly meeting, what happened last week that was important to share with the team and what is relevant this week' },
    { role: 'assistant' as const, text: priorAnswer },
  ];

  // TURN 2 — the reformat request (failed live: "I don't have a structured weekly summary in that exact bullet format yet")
  const t2 = await converse(admin as never, userId, { kind: 'global' }, "I need it in bullet points like this: Last Week's Highlights ... --- This Week's Strategic Priorities ...", { history: history1 });
  // The promise: the reformat is DELIVERED — inline bullets OR a delegated deliverable whose
  // CONTENT carries both requested sections as bullets — never a can't-see-it refusal, never a
  // claim that the work is cut off, and never a chore handed back to the user.
  //
  // ⚠️ OUTCOME-STRICT SINCE Sep 21. The old check for the delegated lane was a word match on the
  // hand-back (`/acme|northwind|jordan|sam|weekly|bullet/`), and for days it passed an answer that
  // was CONSTANTLY WRONG: the coworker claimed its own deliverable "got cut off mid-sentence" and
  // asked the user to regenerate it, and the word "weekly" in that sentence carried the gate ~2
  // runs in 3. The flapping read as live-AI variance; the product defect underneath was constant
  // (the evaluator's truncation floor condemning a bullet list for ending like a list). A gate that
  // can be satisfied by a word in a refusal is not a gate. Phrasing stays free; the OUTCOME does not.
  const norm = (s: string) => s.replace(/[’‘`]/g, "'");
  const t2say = norm(t2.say);
  const t2refused = /exact bullet format yet|known body of work|lives on that project|don't have enough context/i.test(t2say);
  // THE HAND-BACK LAW: a claim of truncation, or an ask to regenerate/resend, is a FAIL outright.
  const t2disowns = /cut off|cuts off|truncat|got clipped|incomplete at the end/i.test(t2say)
    || /\b(can|could|would|will)\s+you\s+(please\s+)?(re-?generate|re-?run|re-?do|re-?send|re-?create|complete|finish)\b|\bplease\s+(re-?generate|re-?run|re-?send|re-?do)\b/i.test(t2say);
  const hasSections = (s: string) => /last week'?s?\s+highlights/i.test(s) && /this week'?s?\s+(strategic\s+)?priorities/i.test(s);
  const bulletCount = (s: string) => (s.match(/^\s*([-*•]|\d+[.)])\s+\S/gm) ?? []).length;
  // A finished document ends at a boundary: terminal punctuation, or a COMPLETE final line (a list
  // item with its emphasis closed). Asserted independently of the product's own floor.
  const endsWhole = (s: string) => {
    const t = s.trimEnd();
    const last = t.slice(t.lastIndexOf('\n') + 1).trim();
    return /[.!?…)"'\]]$/.test(t) || (/^([-*•]|\d+[.)]|#{1,6}|\|)/.test(last) && (last.split('**').length - 1) % 2 === 0 && !/[,\-–—]$/.test(last));
  };
  const t2inline = hasSections(t2say) && bulletCount(t2say) >= 4 && endsWhole(t2say);
  // The delegated lane is judged on the DELIVERED WORK, read back from the coworker's hand-off
  // thread (the deliverable of record whether or not it also materialized as a document).
  let t2delivered = '';
  if (t2.delegated) {
    const { data: th } = await admin.from('work_threads').select('id')
      .eq('user_id', userId).eq('title', `Handed to ${t2.delegated.agentName}`)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (th?.id) {
      const { data: msgs } = await admin.from('work_messages').select('content, role, created_at')
        .eq('thread_id', th.id).eq('role', 'assistant').order('created_at', { ascending: false }).limit(1);
      t2delivered = norm(String(msgs?.[0]?.content ?? ''));
    }
  }
  const t2handed = !!t2.delegated && hasSections(t2delivered) && bulletCount(t2delivered) >= 4 && endsWhole(t2delivered);
  const t2ok = !t2refused && !t2disowns && (t2inline || t2handed);
  console.log(`T2 reformat DELIVERED (no truncation claim, no regeneration ask): ${t2ok ? 'PASS' : 'FAIL'}` +
    ` [refused=${t2refused} disowns=${t2disowns} inline=${t2inline} handed=${t2handed} deliveredChars=${t2delivered.length}]` +
    `\n---\n${t2.say.slice(0, 700)}\n---\n${t2delivered ? `DELIVERED:\n${t2delivered.slice(0, 600)}\n---\n` : ''}`);

  // TURN 3 — "yes please" after an assistant offer (failed live: "I don't have enough context")
  const history2 = [...history1,
    { role: 'user' as const, text: 'I need it in bullet points' },
    { role: 'assistant' as const, text: "Would you like me to draft this week's highlights and strategic priorities as a bullet summary based on your meetings and active projects?" },
  ];
  const t3 = await converse(admin as never, userId, { kind: 'global' }, 'yes please', { history: history2 });
  const t3ok = !/don't have enough context|what you'?re saying yes to/i.test(t3.say);
  console.log(`T3 "yes please": ${t3ok ? 'PASS' : 'FAIL'}\n---\n${t3.say.slice(0, 700)}\n---\n`);

  // TURN 4 — "please ask max to do it." (the live failure was "ask sofia…" — Sofia retired
  // Aug 14; the class under test is a NAMED-coworker delegation resolving "it" from history,
  // and the name is incidental to it)
  const t4 = await converse(admin as never, userId, { kind: 'global' }, 'please ask max to do it.', { history: history2 });
  const t4ok = !/need to know what task|what would you like me to assign/i.test(t4.say);
  console.log(`T4 delegate "it": ${t4ok ? 'PASS' : 'FAIL'} delegated=${t4.delegated?.agentName ?? 'none'}\n---\n${t4.say.slice(0, 700)}\n---`);

  // TURN 5 — THE PRODUCTION HAND-OFF (failed live: a pasted questionnaire + "please fill this
  // in" returned the bare "I couldn't finish that one." while a competitor returned a finished
  // document). A long paste + a produce ask must land at a coworker and come back as work.
  const questionnaire =
    'You are my personal assistant. Please fill in this document to the best of your knowledge in bullet points ' +
    'and create a new doc so I can review and send later. I have to go to a meeting now. Please finish it.\n\n' +
    'Author Questionnaire — Contact details: Name: Book title: Publisher: Publication date: Website: ' +
    'Phone number for our use: Phone number for media use: Author address: LinkedIn: Instagram: ' +
    'About You: Can you share a brief bio and tell us about your work/career highlights? ' +
    'Do you have relevant academic or professional qualifications we should be aware of? ' +
    'Are you a member of any relevant professional associations? ' +
    'Previous Publicity: Have you been featured in any media or publications? ' +
    'Availability: Please list any commitments where you will be uncontactable. ' +
    'Broadcast: are you happy to be interviewed on radio/TV? Any media training? ' +
    'Writing: are you happy to write articles for the media if requested? Please list topics. ' +
    'About the book: Please provide a brief description including structure, themes, objectives. ' +
    'What is the key message? What were your motivations? What makes it special and different? ' +
    'Why is it relevant now? About the PR campaign: what would be your wish-list media outlets? ' +
    'Has any media coverage already been secured? Any publications or angles to avoid? ' +
    'Please list existing coverage of you or your topic, and any media contacts we should approach. '.repeat(3);
  const t5 = await converse(admin as never, userId, { kind: 'global' }, questionnaire, { history: [] });
  const t5ok = !/couldn't finish that one/i.test(t5.say) && (!!t5.delegated || /\[CONFIRM/i.test(t5.say));
  console.log(`T5 production hand-off: ${t5ok ? 'PASS' : 'FAIL'} delegated=${t5.delegated?.agentName ?? 'none'} artifact=${t5.artifact ? 'yes' : 'no'} len=${questionnaire.length}\n---\n${t5.say.slice(0, 700)}\n---`);

  // TURN 6 — THE ATTACHED MATERIAL: a file attached WITH the message rides the hand-off whole
  // (never a race against KB indexing). The distinctive token from the material must surface in
  // the produced work.
  const t6 = await converse(admin as never, userId, { kind: 'global' },
    'Please fill in this onboarding form for the vendor and prepare it for my review.',
    { history: [], attachments: [{ name: 'vendor-onboarding-form.docx', text:
      'VENDOR ONBOARDING FORM — Zephyrline Logistics BV\nCompany name:\nRegistration number:\nPrimary contact:\nBank details:\nInsurance certificate reference:\nQuality certifications held:\nDelivery lead time commitment:\n' }] });
  const t6ok = !!t6.delegated && !/couldn't finish/i.test(t6.say);
  console.log(`T6 attached material: ${t6ok ? 'PASS' : 'FAIL'} delegated=${t6.delegated?.agentName ?? 'none'} artifact=${t6.artifact ? 'yes' : 'no'}\n---\n${t6.say.slice(0, 500)}\n---`);

  // TURN 7 — TOKEN STREAMING, the loop's exact mechanics tested deterministically (which path
  // the classifier picks varies; the mechanism must not): the conversation client + tool defs
  // + stream:true yields content deltas. This is precisely what agentLoop runs per iteration;
  // the question path (one fast call + typewriter) stays non-streamed by design.
  let t7ok = false;
  try {
    const { getAIClient } = await import('../lib/ai/factory');
    const { findFileDefinition, readActionHistoryDefinition, toOpenAITool } = await import('../lib/tools');
    const { client: ai, model } = await getAIClient(userId, 'conversation', admin as never);
    const stream = await ai.chat.completions.create({
      model, max_tokens: 150, temperature: 0.2, stream: true,
      messages: [{ role: 'user', content: 'No tools needed — two sentences on what a calm workday looks like.' }],
      tools: [findFileDefinition, readActionHistoryDefinition].map(toOpenAITool),
    } as never);
    let content = '';
    for await (const chunk of stream as unknown as AsyncIterable<{ choices?: Array<{ delta?: { content?: string } }> }>) {
      const t = chunk.choices?.[0]?.delta?.content; if (t) content += t;
    }
    t7ok = content.length > 40;
    console.log(`T7 token streaming: ${t7ok ? 'PASS' : 'FAIL'} streamedChars=${content.length}`);
  } catch (e) { console.log(`T7 token streaming: FAIL threw=${String((e as Error).message).slice(0, 120)}`); }

  // TURN 8 — THE TRUNCATION-CONFABULATION REPLAY (Aug 17, found live): a long prior assistant
  // answer was hard-cut at 900 chars MID-WORD with no marker in the panel transcript; the
  // delegated coworker read OUR cut as a truncated instruction, CONFABULATED a quote of it, and
  // reported itself blocked while its finished agenda sat in its own thread. The user's "yes"
  // then re-delegated and the coworker anchored on its own prior complaint. The law under test:
  // every prompt-bound clip ends at a boundary, DECLARES itself, and the rule rides the header —
  // and no report ever claims a cut-off instruction or blocks while handing back finished work.
  const longPrior = (
    'Here is where your week stands. Last week you closed the amended assessment for Acme Group and sent Jordan the ' +
    'revised scope note, which unblocked the second phase. Riley is driving the workshop prep and has the facilitation ' +
    'deck at about eighty percent, with the exercises still to be written. Sam Miller came back on the pricing question ' +
    'and wants a decision before the board pack goes out. Devon flagged that the vendor review slipped a week because ' +
    'the security questionnaire is still open on their side. This week the critical path runs through Thursday: the ' +
    'meeting with Sam Miller on Thursday morning needs the pricing decision settled beforehand, the workshop dry run ' +
    'with Riley is Wednesday afternoon, and the Acme Group steering update is due Friday. You also owe Jordan the ' +
    'amended assessment questions, which are now four days late, and Devon is waiting on your sign-off for the vendor ' +
    'shortlist. Nothing else on the board is time-critical, though the hiring loop for the analyst role has two ' +
    'candidates sitting at the final stage and they will go cold if you leave them another week without a decision.'
  );
  const pilotMsg = 'Actually I need to prepare my weekly meeting with the team. I need to have the updates from last week in bullet points of max 5 words and what is coming this week, same format';
  const history8 = [
    { role: 'user' as const, text: 'could you please help me prepare my week?' },
    { role: 'assistant' as const, text: longPrior },
  ];
  const t8Start = new Date().toISOString();
  const { EXCERPT_MARK, EXCERPT_RULE } = await import('../lib/utils/clip-for-prompt');
  const normLen = longPrior.replace(/\s+/g, ' ').trim().length;

  let t8 = await converse(admin as never, userId, { kind: 'global' }, pilotMsg, { history: history8 });
  if (!t8.delegated) {
    // The router may answer inline; one clean retry (no nudge) before calling it a routing finding.
    t8 = await converse(admin as never, userId, { kind: 'global' }, pilotMsg, { history: history8 });
  }
  const t8delegated = !!t8.delegated?.agentName;

  // THE STORED DELEGATION PROMPT — the exact text the coworker read.
  const { data: probeThreads } = await admin.from('work_threads').select('id').eq('user_id', userId);
  const threadIds = (probeThreads ?? []).map((t) => t.id as string);
  const { data: promptRows } = await admin.from('work_messages')
    .select('id, thread_id, content, created_at')
    .in('thread_id', threadIds.length ? threadIds : ['00000000-0000-0000-0000-000000000000'])
    .eq('role', 'user')
    .gte('created_at', t8Start)
    .order('created_at', { ascending: false })
    .limit(20);
  const prompt8 = (promptRows ?? []).find((r) => String(r.content ?? '').includes('A colleague is handing you real work'));
  const ptext = String(prompt8?.content ?? '');
  const p1 = ptext.includes('max 5 words and what is coming this week, same format');
  const p2 = ptext.includes(EXCERPT_MARK);
  // Every clipped assistant line either fits the budget or declares its clip — a mid-word tail
  // with no marker is exactly the lie the coworker believed.
  const assistantLines = ptext.split('\n').filter((l) => l.trimStart().startsWith('[assistant]'));
  const p3 = assistantLines.length > 0 && assistantLines.every((l) => l.length < 900 || l.includes(EXCERPT_MARK));
  const headerLine = ptext.split('\n').find((l) => l.includes('THE CHAT SO FAR')) ?? '';
  const p4 = headerLine.includes(EXCERPT_RULE);
  const TRUNC_CLAIM = /cut ?-?off|truncat|incomplete instruction/i;
  const BLOCKED = /can'?t proceed|cannot proceed|not sure what the constraint/i;
  const r1clean = !TRUNC_CLAIM.test(t8.say);
  const t8aok = t8delegated && p1 && p2 && p3 && p4 && r1clean;
  const clippedTail = assistantLines[0] ? assistantLines[0].slice(-140) : '(no assistant line)';
  console.log(`T8a truncation-confabulation: ${t8aok ? 'PASS' : 'FAIL'} delegated=${t8.delegated?.agentName ?? 'none'} priorLen=${normLen} ` +
    `instructionVerbatim=${p1} marker=${p2} noBareMidWordCut=${p3} ruleInHeader=${p4} noTruncClaim=${r1clean}\n` +
    `  clipped tail: …${clippedTail}\n---\n${t8.say.slice(0, 700)}\n---`);

  // RUN 2 — the "yes" that re-delegated live and repeated the confabulated complaint.
  const history8b = [...history8,
    { role: 'user' as const, text: pilotMsg },
    { role: 'assistant' as const, text: t8.say },
  ];
  const t8b = await converse(admin as never, userId, { kind: 'global' }, 'yes', { history: history8b });
  const t8bok = !TRUNC_CLAIM.test(t8b.say) && !BLOCKED.test(t8b.say);
  console.log(`T8b "yes" re-delegation: ${t8bok ? 'PASS' : 'FAIL'} delegated=${t8b.delegated?.agentName ?? 'none'} ` +
    `noTruncClaim=${!TRUNC_CLAIM.test(t8b.say)} notBlocked=${!BLOCKED.test(t8b.say)}\n---\n${t8b.say.slice(0, 700)}\n---`);
  const t8ok = t8aok && t8bok;

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // T9-T13 — HANDS FOR THE SCOPE (Sep 21, the live pilot incident)
  //
  // The user pasted a contact's email, asked for a reply built around their free time, was offered
  // "would you like me to offer both options to them?", said "yes please", and got back "I can't
  // prepare a forward from this view" plus the same question again. Tolerant in wording, STRICT in
  // outcome: a draft is prepared, nothing is sent, and no turn answers an agreement with the
  // question that earned it.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const RE_ASK = /could you let me know|what would you like|how would you like|which (?:one )?would you|let me know how/i;
  const DEAD_END = /can'?t (?:prepare|do|help with) .{0,40}(?:from (?:this|that) view|here)|not available from this view/i;
  const hnStart = new Date().toISOString();
  const hnThreadId = `hn-thread-${Date.now()}`;
  const hnT0 = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const hnBody =
    'Thanks for the introduction earlier. We are putting together the press timetable for the launch and I would ' +
    'like to walk you through the embargo plan and the syndication list before we lock the schedule. Could you let ' +
    'me know which afternoons suit you over the next fortnight?';
  const { data: hnItem } = await admin.from('inbox_items').insert({
    user_id: userId, source: 'email', status: 'pending', rule_type: 'needs_reply',
    work_title: 'Press timetable — embargo plan and syndication list', work_state: 'work_prepared',
    source_data: {
      subject: 'Press timetable — embargo plan and syndication list', thread_id: hnThreadId,
      from: 'Rowan Ash <rowan@driftwood-example.com>', from_address: 'rowan@driftwood-example.com', from_name: 'Rowan Ash',
      body: hnBody, body_text: hnBody, received_at: hnT0,
    },
    last_activity_at: hnT0,
  }).select('id').single();

  const hnCleanup = async () => {
    if (!hnItem?.id) return;
    try {
      await admin.from('item_deliverables').delete().eq('user_id', userId).eq('entity_id', hnItem.id);
      await admin.from('item_plans').delete().eq('user_id', userId).in('entity_id', [`inbox:${hnItem.id}`, hnItem.id]);
      const { data: rts } = await admin.from('room_turns').select('id').eq('user_id', userId).like('room_key', `%${hnItem.id}%`);
      if (rts?.length) await admin.from('room_turns').delete().in('id', rts.map((t) => t.id as string));
      await admin.from('inbox_items').delete().eq('id', hnItem.id);
    } catch (e) { console.log(`T9-T13 cleanup warning: ${String((e as Error).message).slice(0, 120)}`); }
  };

  /** Did a real draft land on the fixture item? (The matched lane persists through the ONE redraft
   *  lane; the standalone lane lands on the card instead — RE-POINTED Sep 21: it used to hand back
   *  delimited plain text, which the owner rejected as a fourth rendering of an email.) */
  const draftOnFixture = async (): Promise<string> => {
    if (!hnItem?.id) return '';
    const { data } = await admin.from('inbox_items').select('source_data').eq('id', hnItem.id).maybeSingle();
    return String(((data?.source_data as Record<string, unknown> | undefined)?.draft as { body?: string } | undefined)?.body ?? '');
  };
  /** Nothing may leave: the probe's send ledger must be untouched by any of these turns. */
  const sentSince = async (): Promise<number> => {
    const { count } = await admin.from('email_sends').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', hnStart);
    return count ?? 0;
  };

  let t9ok = false, t10ok = false, t11ok = false, t12ok = false, t13ok = false, t14ok = false;
  try {
    // T9 — the incident's own opening move: a PASTED message plus a reply instruction must PREPARE
    // a draft (on the matched item, or standalone), and must not send.
    const pasted =
      `From: Rowan Ash <rowan@driftwood-example.com>\nSubject: Press timetable — embargo plan and syndication list\n\n${hnBody}`;
    const t9 = await converse(admin as never, userId, { kind: 'global' },
      `${pasted}\n\nPlease reply to this offering Tuesday afternoon or Thursday afternoon, whichever suits them.`,
      { history: [] });
    const t9draft = await draftOnFixture();
    const t9standalone = !!t9.emailDraft || !!t9.draft;
    t9ok = (t9draft.length > 60 || t9standalone) && !DEAD_END.test(t9.say) && (await sentSince()) === 0;
    console.log(`T9 pasted email → a reply is PREPARED: ${t9ok ? 'PASS' : 'FAIL'} ` +
      `draftOnItem=${t9draft.length} standalone=${t9standalone} sent=${await sentSince()}\n---\n${t9.say.slice(0, 500)}\n---`);

    // T10 — THE FORWARD-MOTION LAW: an agreement to the assistant's OWN offer must EXECUTE, and
    // must never come back as the same question.
    const offer = 'Your Tuesday and Thursday afternoons are both open. Would you like me to offer both options to Rowan Ash?';
    const hist10 = [
      { role: 'user' as const, text: 'When am I free to meet Rowan Ash about the press timetable?' },
      { role: 'assistant' as const, text: offer },
    ];
    const t10 = await converse(admin as never, userId, { kind: 'global' }, 'yes please', { history: hist10 });
    t10ok = !RE_ASK.test(t10.say) && !DEAD_END.test(t10.say) && (await sentSince()) === 0;
    console.log(`T10 offer → "yes please" EXECUTES, never re-asks: ${t10ok ? 'PASS' : 'FAIL'} sent=${await sentSince()}\n---\n${t10.say.slice(0, 500)}\n---`);

    // T11 — an action NO tool in this scope can perform: the answer says what it CAN do; it never
    // pretends the action ran and never loops on a clarifying question.
    const t11 = await converse(admin as never, userId, { kind: 'global' },
      'Publish this week\'s summary to our public status page right now.', { history: [] });
    const pretends = /(?:published|posted) (?:it|the summary)|has been published/i.test(t11.say);
    t11ok = !!t11.say.trim() && !pretends && !DEAD_END.test(t11.say);
    console.log(`T11 no tool in scope → honest, no pretending: ${t11ok ? 'PASS' : 'FAIL'} pretends=${pretends}\n---\n${t11.say.slice(0, 400)}\n---`);

    // T12 — a forward named from the HOME: it resolves to a stage, or lists candidates. What it may
    // never do is the incident's own sentence — a dead "can't from this view" with no alternative.
    const t12 = await converse(admin as never, userId, { kind: 'global' },
      'Forward the press timetable email from Rowan Ash to my operations lead.', { history: [] });
    const offersAnAlternative = /open it|tell me|I can|paste/i.test(t12.say);
    t12ok = !!t12.openStage || /which email|which one/i.test(t12.say)
      || (!DEAD_END.test(t12.say) && offersAnAlternative);
    console.log(`T12 forward from Home resolves or lists: ${t12ok ? 'PASS' : 'FAIL'} stage=${t12.openStage?.stage ?? 'none'}\n---\n${t12.say.slice(0, 400)}\n---`);

    // T13 — the same law in another language: an affirmation is an affirmation.
    const hist13 = [
      { role: 'user' as const, text: 'Quando estou livre para falar com o Rowan Ash sobre o calendário de imprensa?' },
      { role: 'assistant' as const, text: 'Terça e quinta à tarde estão livres. Quer que eu ofereça as duas opções ao Rowan Ash?' },
    ];
    const t13 = await converse(admin as never, userId, { kind: 'global' }, 'sim, por favor', { history: hist13 });
    const reAskPt = /o que gostaria|como gostaria|pode dizer-me como/i.test(t13.say);
    t13ok = !RE_ASK.test(t13.say) && !reAskPt && !DEAD_END.test(t13.say) && (await sentSince()) === 0;
    console.log(`T13 PT affirmation works the same: ${t13ok ? 'PASS' : 'FAIL'}\n---\n${t13.say.slice(0, 400)}\n---`);
    // T14 — THE STANDALONE LANE IS A CARD (Sep 21, the owner's convergence call). A pasted message
    // that matches NOTHING in the inbox must still come back sendable: the same email card, its
    // From resolved from the user's own mailboxes (or honestly the assistant's address), its To
    // prefilled from the sender the paste actually named — and nothing sent.
    const strangerBody =
      'Following the dockside survey we completed on the eastern jetty, the mooring cleats need replacing before the ' +
      'winter charter season and the harbourmaster wants the fendering specification confirmed. Could you let us know ' +
      'whether the marine plywood substitution is acceptable, and who signs off the berth reallocation?';
    const t14 = await converse(admin as never, userId, { kind: 'global' },
      `From: Wren Calloway <wren@tidegate-example.net>\nSubject: Jetty survey — mooring cleats and fendering\n\n${strangerBody}` +
      `\n\nPlease reply saying the plywood substitution is fine and that I'll confirm the berth sign-off this week.`,
      { history: [] });
    const card = t14.emailDraft;
    const cd = card?.draft as { to?: string[]; body?: string; subject?: string;
      from?: { options?: unknown[]; selectedId?: string | null; viaCoworker?: boolean } } | undefined;
    t14ok = !!card && !card.itemId && !!cd
      && (cd.to ?? []).includes('wren@tidegate-example.net')
      && String(cd.body ?? '').trim().length > 60
      && !!cd.from && (cd.from.viaCoworker === true || !!cd.from.selectedId)
      // the retired envelope must not come back
      && !/-----/.test(t14.say)
      && (await sentSince()) === 0;
    console.log(`T14 unmatched paste → the STANDALONE CARD: ${t14ok ? 'PASS' : 'FAIL'} ` +
      `card=${!!card} to=${JSON.stringify(cd?.to ?? [])} bodyLen=${String(cd?.body ?? '').length} ` +
      `from=${JSON.stringify(cd?.from ?? null)} sent=${await sentSince()}\n---\n${t14.say.slice(0, 300)}\n---`);
    if (card?.id) await admin.from('item_plans').delete().eq('user_id', userId).eq('kind', 'chat_email').eq('entity_id', card.id);
  } catch (e) {
    console.log(`T9-T13 threw: ${String((e as Error).message).slice(0, 200)}`);
  } finally {
    await hnCleanup();
  }
  const hnOk = t9ok && t10ok && t11ok && t12ok && t13ok && t14ok;

  // ── T15 / T16 — THE TASK VERBS HAVE A HOME DOOR (Sep 21, CLASS 2 + CLASS 1).
  // Live incident: the Home chat answered "I don't have a tool to pause workflows" while a coworker
  // DM had been pausing them for months; and when a coworker DID pause, it paused one of two and
  // said both. Both halves are replayed here on SEEDED FAKE workflows on the probe host — outcome
  // strict (the DB must actually move), wording tolerant. Nothing real is ever touched.
  let t15ok = false, t16ok = false, t17ok = false, t18ok = false;
  // WAVE 1 — the collection card's replays (T19-T22), declared out here so the exit code sees them.
  let t19ok = false, t20ok_ = false, t21ok_ = false, t22ok_ = false;
  const seeded: string[] = [];
  try {
    const mk = async (name: string, status: 'active' | 'paused') => {
      const { data } = await admin.from('workflows').insert({
        user_id: userId, name, status,
        trigger: { type: 'manual' },
        steps: [{ id: 's1', type: 'ai', label: 'Write it', prompt: 'Say hello.' }],
      }).select('id').single();
      if (data?.id) seeded.push(data.id as string);
      return data?.id as string | undefined;
    };
    await mk('Probe Weekly Digest', 'active');
    await mk('Probe Client Radar', 'active');
    await mk('Probe Dormant Sweep', 'paused');

    const statusOf = async (): Promise<Record<string, string>> => {
      const { data } = await admin.from('workflows').select('name, status').in('id', seeded);
      return Object.fromEntries(((data ?? []) as Array<{ name: string; status: string }>).map((w) => [w.name, w.status]));
    };

    // ── T17 / T18 — THE PRESENTATION LAW (Sep 22, WAVE 0). The incident (owner screenshot): "what
    // workflows do I have in place?" put the executor's model-facing listing in the bubble verbatim
    // — bracketed uuids and the line "Refer to tasks by NAME when speaking to the user" — and
    // persisted it. Read-only, so they run BEFORE T15 pauses the seeded set. Outcome-strict on what
    // must NEVER appear; wording free.
    const MODEL_FACING =
      /\[[0-9a-f]{8}-[0-9a-f]{4}-|Refer to tasks by NAME|^\s*Tasks \(\d+\):|\bid:[a-z0-9-]+\b|Steps \(\d+\):|\[tool\]|\[ai\]|===GATE_VERDICT===|\[\[(?:artifact|card|email_draft|workflow_draft):/im;

    const t17 = await converse(admin as never, userId, { kind: 'global' }, 'what workflows do I have in place?', { history: [] });
    // RE-POINTED Sep 22 (Wave 1, the collection card): the promise — "the user is TOLD what they
    // have, and nothing model-facing reaches them" — is unchanged; the half that names the
    // workflows moved from prose into the card's TYPED ROWS, which is stricter (a row is the
    // object, not a sentence about it). The answer is read AS SERVED: prose OR rows.
    const t17served = `${t17.say}\n${(t17.collection?.spec.rows ?? []).map((r) => r.title).join('\n')}`;
    const t17names = /Probe (?:Weekly Digest|Client Radar|Dormant Sweep)/i.test(t17served);
    const t17clean = !MODEL_FACING.test(t17served);
    t17ok = t17names && t17clean;
    console.log(`T17 "what workflows do I have?" → an ANSWER, never the listing: ${t17ok ? 'PASS' : 'FAIL'} names=${t17names} clean=${t17clean}\n---\n${t17.say.slice(0, 500)}\n---`);

    // T18 — the config read. Its executor dumps step ids, raw prompts and config JSON; none of that
    // is a person's to read.
    const t18 = await converse(admin as never, userId, { kind: 'global' }, "what's the status of the Probe Weekly Digest task?", { history: [] });
    const t18clean = !MODEL_FACING.test(t18.say) && !/"?prompt"?\s*:/i.test(t18.say);
    const t18answers = /weekly digest/i.test(t18.say);
    t18ok = t18clean && t18answers;
    console.log(`T18 "what's the status of <name>?" → no step ids / raw prompts / config JSON: ${t18ok ? 'PASS' : 'FAIL'} clean=${t18clean} answers=${t18answers}\n---\n${t18.say.slice(0, 500)}\n---`);

    // ── T19 / T20 / T21 — THE COLLECTION CARD (Sep 22, WAVE 1). The presentation law's payoff:
    // a pure LISTING ask is answered by the CARD — typed rows and a framing sentence composed by
    // code — with no model composition at all, while an ANALYTICAL ask keeps the agent loop.
    // Read-only, so they run before T15 pauses the seeded set.
    const t19 = await converse(admin as never, userId, { kind: 'global' }, 'what workflows do I have in place?', { history: [] });
    const t19spec = t19.collection?.spec;
    const t19rows = (t19spec?.rows ?? []).map((r) => r.title);
    // THE ROWS ARE THE SEEDED SET, the `say` IS the framing (not a word more), and nothing
    // model-facing is anywhere near it.
    t19ok = !!t19spec && t19spec.kind === 'workflows'
      && seeded.length === 3
      && ['Probe Weekly Digest', 'Probe Client Radar', 'Probe Dormant Sweep'].every((n) => t19rows.includes(n))
      && t19.say === t19spec.framing
      && /^You have \d+ workflows?/.test(t19.say)
      && !MODEL_FACING.test(t19.say)
      // THE RE-READ KEY rides the spec — a persisted card re-derives instead of freezing.
      && !!t19spec.params
      // …and no uuid is rendered anywhere a person reads.
      && !t19rows.some((t) => /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t));
    console.log(`T19 listing ask → THE CARD (say === framing, rows typed): ${t19ok ? 'PASS' : 'FAIL'} ` +
      `kind=${t19spec?.kind ?? 'none'} rows=${t19rows.length}\n---\n${t19.say.slice(0, 300)}\n---`);

    // T20 — THE CARD COSTS NO COMPOSITION. The fast path makes exactly ONE model call (the
    // router's classification); the loop path makes several and streams an answer. Timing is the
    // honest proxy available from here: a composed answer cannot come back in router-time alone.
    const t20start = Date.now();
    const t20 = await converse(admin as never, userId, { kind: 'global' }, 'show me my workflows', { history: [] });
    const t20ms = Date.now() - t20start;
    const t20ok = !!t20.collection && t20.say === t20.collection.spec.framing && t20ms < 6000;
    console.log(`T20 the listing ask is INSTANT again (no composition round): ${t20ok ? 'PASS' : 'FAIL'} ms=${t20ms} card=${!!t20.collection}`);

    // T21 — THE ANALYTICAL ASK KEEPS THE LOOP. A judgment over the data is not a list of it: the
    // turn names a presenting read (check_calendar), and the answer must still be COMPOSED prose —
    // never the card's framing line standing in for a verdict. A card may ride beside it; it may
    // never replace it.
    const t21 = await converse(admin as never, userId, { kind: 'global' },
      'check my calendar and tell me whether tomorrow afternoon is clear enough for a two-hour block', { history: [] });
    const t21ok = t21.say.trim().length > 60
      && t21.say.trim() !== (t21.collection?.spec.framing ?? '').trim()
      && !MODEL_FACING.test(t21.say);
    console.log(`T21 analytical ask → the LOOP answers (card may ride along, never replaces): ${t21ok ? 'PASS' : 'FAIL'} card=${!!t21.collection}\n---\n${t21.say.slice(0, 300)}\n---`);

    // T22 — THE CALENDAR ASK ON A CALENDAR-LESS ACCOUNT. The probe host has no calendar connected,
    // so the promise under test is the EMPTY-CALENDAR TRUTH surviving into the card lane: an
    // honest "no calendar", never a day of manufactured "free".
    const t22 = await converse(admin as never, userId, { kind: 'global' }, "what's on tomorrow", { history: [] });
    const t22says = `${t22.say} ${t22.collection?.spec.framing ?? ''}`;
    const t22ok = !MODEL_FACING.test(t22.say)
      && (/no calendar|isn'?t set up|not connected|nothing booked/i.test(t22says) || (t22.collection?.spec.rows.length ?? 0) > 0);
    console.log(`T22 "what's on tomorrow" on a calendar-less account → honest: ${t22ok ? 'PASS' : 'FAIL'} ` +
      `card=${t22.collection?.spec.kind ?? 'none'}\n---\n${t22.say.slice(0, 300)}\n---`);
    t20ok_ = t20ok; t21ok_ = t21ok; t22ok_ = t22ok;

    // T15 — "pause all my workflows" from the HOME. The promise: they are ACTUALLY paused in the
    // database, and the say names them. The old answer ("I don't have a tool for that") fails.
    const t15 = await converse(admin as never, userId, { kind: 'global' }, 'pause all my workflows', { history: [] });
    const after15 = await statusOf();
    const allPaused = Object.values(after15).length >= 3 && Object.values(after15).every((v) => v === 'paused');
    const noDenial = !/don'?t have a tool|can'?t pause|no way to pause|unable to pause/i.test(t15.say);
    const namesOne = /Probe (?:Weekly Digest|Client Radar|Dormant Sweep)/i.test(t15.say);
    t15ok = allPaused && noDenial && namesOne;
    console.log(`T15 Home "pause all my workflows": ${t15ok ? 'PASS' : 'FAIL'} db=${JSON.stringify(after15)} names=${namesOne} denial=${!noDenial}\n---\n${t15.say.slice(0, 400)}\n---`);

    // T16 — the mirror, BY NAME. Only the named one moves; the others stay put.
    const t16 = await converse(admin as never, userId, { kind: 'global' }, 'resume the Probe Client Radar task', { history: [] });
    const after16 = await statusOf();
    t16ok = after16['Probe Client Radar'] === 'active'
      && after16['Probe Weekly Digest'] === 'paused'
      && after16['Probe Dormant Sweep'] === 'paused';
    console.log(`T16 resume ONE by name (the others stay put): ${t16ok ? 'PASS' : 'FAIL'} db=${JSON.stringify(after16)}\n---\n${t16.say.slice(0, 400)}\n---`);
  } catch (e) {
    console.log(`T15-T22 threw: ${String((e as Error).message).slice(0, 200)}`);
  } finally {
    if (seeded.length) await admin.from('workflows').delete().in('id', seeded);
  }

  // CLEANUP — the hand-off threads are STANDING (one per worker, pre-existing), so only the
  // messages these runs wrote are removed; a thread left empty by that is removed too.
  try {
    const { data: mine } = await admin.from('work_messages').select('id, thread_id')
      .in('thread_id', threadIds.length ? threadIds : ['00000000-0000-0000-0000-000000000000'])
      .gte('created_at', t8Start);
    const touched = [...new Set((mine ?? []).map((m) => m.thread_id as string))];
    if (mine?.length) await admin.from('work_messages').delete().in('id', mine.map((m) => m.id as string));
    for (const tid of touched) {
      const { count } = await admin.from('work_messages').select('id', { count: 'exact', head: true }).eq('thread_id', tid);
      if (!count) await admin.from('work_threads').delete().eq('id', tid);
    }
  } catch (e) { console.log(`T8 cleanup warning: ${String((e as Error).message).slice(0, 120)}`); }

  process.exit(t2ok && t3ok && t4ok && t5ok && t6ok && t7ok && t8ok && hnOk && t15ok && t16ok && t17ok && t18ok
    && t19ok && t20ok_ && t21ok_ && t22ok_ ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
