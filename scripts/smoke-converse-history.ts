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

  // TURN 4 — "please ask sofia to do it." (failed live: "I need to know what task")
  const t4 = await converse(admin as never, userId, { kind: 'global' }, 'please ask sofia to do it.', { history: history2 });
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

  process.exit(t2ok && t3ok && t4ok && t5ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
