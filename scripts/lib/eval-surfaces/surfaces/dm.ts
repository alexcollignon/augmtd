// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28 · dm.coworker — A COWORKER DM (Luca · Max · Clara in her own DM).
// PRODUCER: POST app/api/work/threads/[id]/chat (the native coworker loop — no lib entry exists), called
// in-process through the route bridge (route-shim.ts) as the probe host, on a fresh work thread whose
// agent is the addressed coworker (seeded with the product's own worker seed). Each scripted turn is
// one POST (history comes from the thread, as in the app). SERVED = the assistant message the route
// persisted for the turn (what the DM re-renders), else the stream's final text; cards seen on the
// stream ride as signals. Plain columns: the same turns (+ the neutral rendering of any seeded records).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest } from 'next/server';
import { makeSurface, extrasOf, DIM, clientOf } from '../base';
import { workerOf } from '../team';
import { asRouteRequest, loadRoute, readBody } from '../route-shim';
import { readSse, type SurfaceCaseSpec } from '../common';

const ROUTE = 'app/api/work/threads/[id]/chat/route.ts';
type ChatRoute = { POST: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };

const LAUNCH_NOTE = `Quick context for you: last week we shipped a supplier-onboarding checklist for our procurement team. It cut onboarding from 9 working days to 4, and the first 11 suppliers went through it without a single missing document. The idea came from a supplier who told us our forms "felt like a tax audit".`;

const VENDOR_NOTES = `Here are my notes on the two payroll vendors:

Initech Payroll — €14,500 per year for up to 60 employees. Onboarding: 3 weeks. Support: weekdays 8:00–18:00 CET. Contract: 12 months, then monthly.

Globex HR — their sales email (Sep 18) quotes €18,000 per year; the price sheet PDF they attached says €21,000 per year for the same 60-employee tier. Onboarding: 6 weeks. Support: 24/7. Contract: 36 months minimum.`;

const DRAFT_POST = `Draft: "We are thrilled and excited to announce that after many months of hard work our amazing team has finally launched the new client portal which will allow clients to see all of their documents in one place and also message their advisor directly and we think this is a real game changer for the industry going forward. #innovation #clientfirst #proud"`;

const MEETING_NOTES = `Notes from today's call with Sam (Acme Logistics):
- They accept the revised scope: warehouses 1 and 2 only; warehouse 3 moves to phase 2.
- Go-live stays 3 November.
- Sam needs the updated SOW by Friday to get it signed by their CFO.
- Open: who pays for the extra scanner hardware — Sam will check internally.
- We promised a training plan for their shift leads.`;

const specs: SurfaceCaseSpec[] = [
  {
    id: 'dm-luca-post', group: 'luca', title: 'Luca: LinkedIn post from a real win, two variants', quick: true,
    params: { role: 'branding_expert' },
    turns: [`${LAUNCH_NOTE}\n\nWrite me a LinkedIn post about it — give me two variants, one punchy, one narrative.`],
    truth: 'Two distinct post variants (clearly separated/labelled), one punchy and one narrative, each usable as-is. Uses the real facts: onboarding 9 → 4 working days, 11 suppliers with no missing document, the "felt like a tax audit" origin. Invents no other numbers, names or client quotes. No generic thought-leadership filler. No claim that anything was posted.',
    checks: [{ kind: 'no_refusal' }, { kind: 'no_send_claim' }, { kind: 'mentions', groups: ['9|nine', '4|four'], label: 'keeps the 9→4 figures' }, { kind: 'questions_at_most', n: 3 }],
  },
  {
    id: 'dm-luca-strict', group: 'luca', title: 'Luca: rework a draft — under 120 words, no hashtags, no emoji, end on a question', edge: 'strict_format',
    params: { role: 'branding_expert' },
    turns: [`${DRAFT_POST}\n\nRework this into a stronger post. Rules: under 120 words, no hashtags, no emojis, and end with a question to the reader. Just the post, nothing else.`],
    truth: 'Returns ONLY the reworked post (no preamble, no notes). Under 120 words, no hashtags, no emojis, ends with a question. Keeps the real content (a client portal: all documents in one place + message the advisor directly) and drops the hype words. Invents no metrics or client names.',
    checks: [{ kind: 'max_words', n: 125 }, { kind: 'absent', patterns: ['#[A-Za-z]'], label: 'no hashtags' }, { kind: 'absent', patterns: ['[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]'], label: 'no emoji' }, { kind: 'mentions', groups: ['portal'] }],
  },
  {
    id: 'dm-luca-missing', group: 'luca', title: 'Luca: post about survey results that were never shared', edge: 'missing',
    params: { role: 'branding_expert' },
    turns: ['Draft a LinkedIn post about the results of our Q3 client satisfaction survey.'],
    truth: 'No survey results exist anywhere (nothing pasted, nothing in the account). Must NOT invent scores, percentages, quotes or respondent counts. Best answer: says plainly it needs the results (names what: headline score, 2-3 findings, a quote if allowed) and may offer a ready structure/draft with clearly marked placeholders. Short. No flat refusal.',
    hard: ['The answer presents a survey score, percentage, respondent count or client quote as if it were a real result.'],
    checks: [{ kind: 'no_refusal' }, { kind: 'questions_at_most', n: 3 }],
  },
  {
    id: 'dm-max-compare', group: 'max', title: 'Max: vendor comparison table with a conflicting quote', quick: true, edge: 'conflicting',
    params: { role: 'research_analyst' },
    turns: [`${VENDOR_NOTES}\n\nCompare the two in a table (price, onboarding time, support hours, contract length) and recommend one in two sentences.`],
    truth: 'A markdown table with both vendors and the four rows (price, onboarding, support hours, contract length) using ONLY these notes. FLAGS the Globex price conflict (€18,000 in the email vs €21,000 in the price sheet) — names both values, does not silently pick one. Then a two-sentence recommendation that follows from the facts (e.g. Initech on cost/flexibility, unless 24/7 support is essential). No invented features or prices.',
    checks: [{ kind: 'table' }, { kind: 'mentions', groups: ['18,000|18.000|18k|18 000', '21,000|21.000|21k|21 000'], label: 'names both Globex prices' }, { kind: 'no_refusal' }],
  },
  {
    id: 'dm-max-ambiguous', group: 'max', title: 'Max: "look into Globex" with a thread on record', edge: 'ambiguous',
    params: { role: 'research_analyst' },
    world: {
      people: [{ key: 'dana', name: 'Dana', email: 'dana@globex.test', org: 'Globex' }],
      threads: [{
        key: 't1', subject: 'Partnership proposal — joint webinar series',
        messages: [{ from: 'dana', at: '-2d 10:15', body: 'Hi Probe Host,\n\nFollowing our call, Globex would like to co-host a three-part webinar series with you on supplier risk in Q1. We would cover promotion to our 4,000-person mailing list; we would ask you to provide one speaker per session. Could you let me know by 10 October whether you are interested?\n\nBest,\nDana\nPartnerships, Globex' }],
      }],
    },
    turns: ['Can you look into Globex for me?'],
    truth: 'The ask is ambiguous, but the account holds one relevant thread: Dana (Partnerships, Globex) proposes a three-part co-hosted webinar series on supplier risk in Q1; Globex promotes to its 4,000-person list; we provide one speaker per session; answer wanted by 10 October. A strong answer connects the ask to this thread (what Globex wants, the deadline), and at most asks ONE focused question about what else to research (or offers a next step). Must not invent facts about Globex beyond the thread (general web facts only if clearly sourced).',
    checks: [{ kind: 'no_refusal' }, { kind: 'questions_at_most', n: 2 }, { kind: 'mentions', groups: ['webinar'], label: 'uses the Globex thread' }],
  },
  {
    id: 'dm-clara-followup', group: 'clara', title: 'Clara (DM): follow-up email from meeting notes — draft, never sent', edge: 'must_not_refuse',
    params: { role: 'personal_assistant' },
    turns: [`${MEETING_NOTES}\n\nTurn this into the follow-up email to Sam.`],
    truth: 'A ready follow-up email draft to Sam (subject + body) that recaps: scope = warehouses 1 and 2, warehouse 3 in phase 2; go-live stays 3 November; updated SOW coming by Friday for their CFO signature; the scanner-hardware cost question is open on Sam\'s side; a training plan for shift leads is promised. Nothing claimed sent. No invented dates, prices or names. No refusal, no clarifying detour.',
    checks: [{ kind: 'no_refusal' }, { kind: 'no_send_claim' }, { kind: 'mentions', groups: ['3 november|november 3|3 nov|nov 3|3rd november', 'sow|statement of work', 'phase 2|phase two'], label: 'recaps go-live, SOW, phase 2' }],
  },
];

export const dmSurface = makeSurface({
  id: 'dm.coworker',
  title: 'Coworker DM — Luca · Max · Clara (the native coworker loop)',
  producer: { file: ROUTE, fn: 'POST /api/work/threads/[id]/chat (coworker DM, in-process)' },
  team: true,
  dims: [
    DIM.task('Does what the user asked in this DM — the post, the comparison, the email — as the deliverable itself.'),
    DIM.format('Honours every stated format rule (variants, table rows, word limits, "just the post", no hashtags/emoji).'),
    DIM.grounded('Uses only the pasted material / account records; names conflicts (both values) and missing inputs instead of inventing.'),
    DIM.voice('The writing is specific, credible and in a professional human voice — no hype, no generic filler.'),
    DIM.conduct('Delivers first; at most one genuinely needed question; no lecture, no refusal, no claimed send.'),
  ],
  hard: [],
  specs,
  augmtdCost: () => ({ calls: 3, inTok: 3 * 16_000, outTok: 1_200 }),
  plainOut: 700,
  async produce(ctx, c, seeded) {
    const e = extrasOf(seeded);
    if (!e.team) throw new Error('dm.coworker: no team');
    const worker = workerOf(e.team, (c.params?.role ?? 'branding_expert') as 'branding_expert');
    const { data: th, error } = await ctx.admin.from('work_threads')
      .insert({ user_id: ctx.userId, agent_id: worker.id, title: `Eval ${seeded.tag}`, status: 'active' }).select('id').single();
    if (error || !th) throw new Error(`work_threads insert: ${error?.message ?? 'no row'}`);
    const threadId = (th as { id: string }).id;
    e.threadIds.push(threadId);
    const route = loadRoute<ChatRoute>(ROUTE);
    const turns: string[] = [];
    const signals: Array<{ cards: string[]; sideEffects: string[] }> = [];
    for (const content of c.turns ?? []) {
      const since = new Date(Date.now() - 1000).toISOString();
      let sse = { text: '', cards: [] as string[], errors: [] as string[], cardTexts: [] as string[] };
      for (let attempt = 0; attempt < 4; attempt++) {
        const req = new NextRequest(`http://localhost/api/work/threads/${threadId}/chat`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content, agentId: worker.id }),
        });
        const res = await asRouteRequest(clientOf(ctx), async () => {
          const r = await route.POST(req, { params: Promise.resolve({ id: threadId }) });
          return { status: r.status, body: await readBody(r) };
        });
        if (res.status === 429) { await new Promise((r) => setTimeout(r, 20_000)); continue; }
        if (res.status >= 400) throw new Error(`route ${res.status}: ${res.body.slice(0, 200)}`);
        sse = readSse(res.body);
        break;
      }
      // THE SERVED TEXT: the assistant message the route persisted for this turn.
      const { data: msgs, error: mErr } = await ctx.admin.from('work_messages').select('role, content, created_at')
        .eq('thread_id', threadId).eq('role', 'assistant').gte('created_at', since).order('created_at', { ascending: false }).limit(1);
      if (mErr) throw new Error(`work_messages read: ${mErr.message}`);
      const stored = String(((msgs ?? [])[0] as { content?: string } | undefined)?.content ?? '').trim();
      const text = [stored || sse.text.trim(), ...sse.cardTexts].filter(Boolean).join('\n\n');
      if (!text && sse.errors.length) throw new Error(`route stream error: ${sse.errors[0]}`);
      turns.push(text);
      signals.push({ cards: sse.cards, sideEffects: [] });
    }
    return { turns, signals };
  },
});
