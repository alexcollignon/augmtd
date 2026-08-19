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
  // hand-back speaks the conversation's facts — never a can't-see-it refusal, and the
  // honesty-floor pointer never rides a format exchange.
  const t2refused = /exact bullet format yet|known body of work|lives on that project|don't have enough context/i.test(t2.say);
  const t2inline = /last week/i.test(t2.say) && /this week|priorit/i.test(t2.say) && /•|\n- /.test(t2.say);
  const t2handed = !!t2.delegated && /acme|northwind|jordan|sam|weekly|bullet/i.test(t2.say);
  const t2ok = !t2refused && (t2inline || t2handed);
  console.log(`T2 reformat: ${t2ok ? 'PASS' : 'FAIL'}\n---\n${t2.say.slice(0, 700)}\n---\n`);

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

  process.exit(t2ok && t3ok && t4ok && t5ok && t6ok && t7ok && t8ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
