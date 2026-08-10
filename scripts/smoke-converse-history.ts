// TEMP one-off (deleted after run) — replay of the live amnesia sequence on the probe user.
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
  // The promise: the reformat is DELIVERED (the requested structure appears), it is not a
  // refusal, and the honesty-floor pointer never rides a format exchange.
  const t2ok = /last week/i.test(t2.say) && /this week|priorit/i.test(t2.say) && /•|\n- /.test(t2.say)
    && !/exact bullet format yet|known body of work|lives on that project/i.test(t2.say);
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

  process.exit(t2ok && t3ok && t4ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
