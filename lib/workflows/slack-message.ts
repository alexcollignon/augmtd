// Compose a Slack message from an instruction + the pipeline's context, in the
// coworker's voice. Shared by the "Send a Slack message" step and the document →
// Slack notification, so both are instruction-driven (not rigid templates).

import type { OpenAI } from 'openai';
import { aiCreate } from '@/lib/ai/factory';
// W28 — ONE CONDUCT (lib/ai/conduct.ts `draft`): the instruction's structure/length is the contract.
import { conductBlock } from '@/lib/ai/conduct';

export async function composeSlackMessage(client: OpenAI, model: string, opts: {
  workerName: string;
  workerInstructions?: string | null;
  channel: string;
  instruction: string;
  context: string;
  fallback: string;
}): Promise<string> {
  const persona = opts.workerInstructions ? ` ${opts.workerInstructions.split('\n').slice(0, 4).join(' ')}` : '';
  const prompt = `You are ${opts.workerName}.${persona}
Write a Slack message to post in ${opts.channel}.

Instruction (what to say / who to tag): ${opts.instruction || 'Briefly announce what was just produced.'}

What was just produced (use only this — do not invent facts or links):
${opts.context || '(nothing produced this run)'}

${conductBlock('draft')}

Write ONLY the message text — concise and channel-appropriate. Slack mrkdwn (*bold*) ok. To @-mention someone write <@Their Name>; <!channel> / <!here> for the group. No preamble.`;
  try {
    const res = await aiCreate(client, { model, messages: [{ role: 'user', content: prompt }], max_tokens: 400, temperature: 0.6 });
    return (res.choices[0]?.message?.content ?? '').trim() || opts.fallback;
  } catch {
    return opts.fallback;
  }
}
