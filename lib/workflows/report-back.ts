// ─── Coworker report-back ─────────────────────────────────────────────────────
// After a task run, the coworker proactively messages the user — like a DM from a
// colleague who just finished something: what they did, where it went, the link,
// and (when useful) a proactive next step. AI-written in the worker's voice and
// grounded strictly in the run facts, so it carries nuance without inventing.

import type { OpenAI } from 'openai';
import { aiCreate } from '@/lib/ai/factory';
import type { OutputHome } from './types';

export interface ReportFacts {
  worker: { name: string; description?: string | null; instructions?: string | null };
  firstName?: string;
  taskName: string;
  home: OutputHome;
  channel?: string;          // slack #channel, or email recipients summary
  docTitle?: string;
  link?: string;             // in-app link to the deliverable (document home)
  alsoNote?: string;         // e.g. "and dropped a link in #marketing"
  nextRun?: string;          // e.g. "tomorrow at 9am"
  deliverableGist?: string;  // a slice of the output, for context/nuance
  problem?: string;          // delivery failure to flag plainly
}

function didLine(f: ReportFacts): string {
  switch (f.home) {
    case 'document': return `created the document "${f.docTitle ?? f.taskName}"`;
    case 'slack':    return `posted it to ${f.channel ?? 'Slack'}`;
    case 'email':    return `emailed it${f.channel ? ` to ${f.channel}` : ''}`;
    default:         return `wrote you a message`;
  }
}

/** Plain factual fallback if the model call fails — never block a run on the report. */
export function fallbackReport(f: ReportFacts): string {
  const who = f.firstName ? `${f.firstName}, ` : '';
  if (f.problem) return `${who}I finished "${f.taskName}" but couldn't deliver it — ${f.problem}`;
  const where =
    f.home === 'document' ? `it's in your Documents${f.link ? ` (${f.link})` : ''}` :
    f.home === 'slack'    ? `posted to ${f.channel ?? 'Slack'}` :
    f.home === 'email'    ? `emailed${f.channel ? ` to ${f.channel}` : ''}` :
    `here it is`;
  return `${who}done with "${f.taskName}" — ${where}.${f.alsoNote ? ` ${f.alsoNote}.` : ''}`;
}

export async function generateReportBack(client: OpenAI, model: string, f: ReportFacts): Promise<string> {
  const persona = f.worker.instructions ? f.worker.instructions.split('\n').slice(0, 6).join('\n') : '';
  const prompt = `You are ${f.worker.name}. ${f.worker.description ?? ''}
${persona}

You just finished a task and you're sending ${f.firstName || 'the person you work with'} a quick message — like a DM from a colleague who just got something done.

FACTS (this is all you know — do not invent anything beyond it):
- Task: "${f.taskName}"
- What you did: ${didLine(f)}${f.link ? `\n- Link to it: ${f.link}` : ''}${f.alsoNote ? `\n- Also: ${f.alsoNote}` : ''}${f.nextRun ? `\n- Next run: ${f.nextRun}` : ''}${f.problem ? `\n- PROBLEM: ${f.problem}` : ''}${f.deliverableGist ? `\n- Gist of the output: ${f.deliverableGist.slice(0, 500)}` : ''}

Write 1–3 short sentences, first person, warm and human — a colleague's DM, not a status report.
- Say what you did and where it is (include the link naturally if there is one).
${f.problem ? '- Lead with the problem, plainly, and what would fix it.' : '- If a genuinely useful next step or question fits, offer it briefly. Don\'t force one.'}
${f.firstName ? `- You can address ${f.firstName} by name if it feels natural.` : ''}
- No "I noticed", no "I wanted to let you know", no corporate phrasing. Don't restate the whole output.`;

  try {
    const res = await aiCreate(client, {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    });
    const text = res.choices[0]?.message?.content?.trim();
    return text || fallbackReport(f);
  } catch {
    return fallbackReport(f);
  }
}
