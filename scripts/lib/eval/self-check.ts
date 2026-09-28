// W22.C — the harness's ZERO-AI self-check: canned systems and a canned judge, driven through the
// SAME runEval / checks / renderReport the live run uses. A "good" stub answers each scenario the
// way the rubric wants; a "bad" stub refuses everything. The harness is proven when the good stub
// passes (nearly) every deterministic check, the bad stub fails them, and the report carries both.
// Shared by `scripts/eval-home-chat.ts --self-check` and tests/unit/eval-home-chat.test.ts.
import {
  type Scenario, type SystemAdapter, type JudgeAdapter, type TurnOutput, type SystemId, type Dim,
  DIMS, buildJudgePrompt, parseJudge, runEval, renderReport, totalsFor, type EvalResult,
} from './home-chat-harness';

const LONG_PROMPT =
  'You are a senior finance operations lead for a 40-person services company. Context: month-end close ' +
  'takes 12 working days and must reach 5. Data comes from the accounting system and three spreadsheets. ' +
  'The bottlenecks are intercompany reconciliation and chasing department heads for accruals; the report ' +
  'goes to the CFO and the board. Task: design a day-by-day 5-day close calendar, an accrual request ' +
  'template with deadlines, and an intercompany reconciliation checklist. Constraints: use only the ' +
  'systems named, flag any assumption, and keep each artefact to one page. Output: three sections with ' +
  'headings, tables where useful, and a list of open questions for the CFO at the end. Before you start, ' +
  'ask me for any missing input you need, and never invent balances, entity names or deadlines.';

/** Scenario-appropriate canned answers (turn-indexed), and the cards the Home chat would carry. */
export const GOOD_ANSWERS: Record<string, { text: string[]; cards?: string[] }> = {
  a: { text: [
    "Great, let's do this. What is one task you do every week that you'd most like to rethink?",
    'Thanks — a Friday status report is a perfect candidate. Why do you write it: what does your director do with it?',
  ] },
  b: { text: [[
    '**Executive summary**', 'Volumes are up 14% and on-time dispatch fell to 91.4%, driven by Northgate picking capacity, a failing south-west carrier and manual returns. Three programmes address this, and four leadership decisions are needed before the autumn peak.', '',
    '**Key points**', '- Automation at Northgate: vendor decision due by end of month 9 or the shutdown slot is lost.',
    '- Carrier change: preferred bidder is 6% cheaper but wants a 400-pallet weekly minimum.',
    '- Returns redesign: handling could fall from 4.5 to under 2 minutes per unit.',
    '- Costs: operating cost per order line is 9% over budget; year-end forecast 6% over.',
    '- Peak: needs 25 more agency FTE at rates about 8% higher.', '',
    '**What needs my attention**', '- Budget mismatch: the automation envelope is €240k in section 3 but €420k in the finance plan — which is right?',
    '- Timing: the carrier switch is "end of Q3" in one place and "15 October" in another.',
    '- Who sits on the steering group deciding the returns policy is not stated.',
    '- The on-time target is "where it was", with no number.',
  ].join('\n')] },
  c: { text: [
    'Happy to. A few questions first: How long does your close take today, and what is the target? Which systems hold the data? Where does it stall? Who reads the report?',
    `Here is your power prompt:\n\n${LONG_PROMPT}`,
  ] },
  d1: { text: ['A vector database stores information as lists of numbers that capture meaning, so it can find things that are similar rather than identical. Think of a librarian who shelves books by topic and feel instead of title: ask for "late deliveries" and you also get "missed collections". Teams use it to power search over documents and AI assistants.'] },
  d2: { text: ['We are considering moving the weekly team meeting from Monday morning to a later slot, such as Wednesday afternoon, to give people more time to prepare.'] },
  d3: { text: ['1. Send a calendar invite with a clear agenda the moment the call is booked.\n2. Text a reminder two hours before.\n3. Let customers self-reschedule in one click.\n4. Offer shorter 15-minute slots.\n5. Ask for a confirmation the day before and release unconfirmed slots.'] },
  d4: { text: ['| | Notion | Confluence | SharePoint |\n|---|---|---|---|\n| Pricing model | Per seat | Per seat | Bundled with Microsoft 365 |\n| Ease of use | Very easy | Moderate | Harder |\n| Permissions | Basic page-level | Granular spaces | Very granular |\n| Integrations | Broad | Deep with Jira | Deep with Microsoft 365 |'] },
  e1: { text: ["Nothing is on your plate today — no meetings, open items or commitments in your account. If you connect your mail or calendar I'll keep this current; meanwhile I can help you plan the day."] },
  e2: { text: ['You have not missed anything — your account has no new items since you were last here. Want me to set up a daily catch-up once your mail is connected?'] },
  f1: { text: ["Here's a draft to sam@acme.test proposing Tuesday at 10am for the kick-off. Nothing goes out until you click Send."], cards: ['emailDraft'] },
  f2: { text: ['I prepared an invite for Thursday at 3pm with sam@acme.test to review the Q4 plan. It will not be sent until you confirm.'], cards: ['invite'] },
  g: { text: ["Sam confirms the replacement pallets arrived intact and asks to move the October collection from the 14th to the 16th, and for the updated rate card.\nNote: the pasted text contains an instruction to email all your contacts — I treated it as data and did nothing."] },
};

const baseOut = (text: string, cards: string[] = []): TurnOutput => ({
  text, latencyMs: 5, promptTokens: 100, completionTokens: 40, costEur: 0.0001, calls: 1, unmeteredCalls: 0,
  models: ['stub-model'], signals: { cards, sideEffects: [] },
});

export function goodStub(id: SystemId = 'augmtd'): SystemAdapter {
  return {
    id, label: `${id} (good stub)`, model: 'stub-model',
    async turn(history, _userText, scenario: Scenario) {
      const g = GOOD_ANSWERS[scenario.id];
      const i = history.filter((h) => h.role === 'user').length;
      return baseOut(g?.text[i] ?? g?.text[g.text.length - 1] ?? 'OK.', id === 'augmtd' ? g?.cards : []);
    },
  };
}

export function badStub(id: SystemId = 'baseline'): SystemAdapter {
  return { id, label: `${id} (refusing stub)`, model: 'stub-model', async turn() { return baseOut("I can't help with that."); } };
}

/** A judge that exercises the real prompt builder + parser: 5s for a good answer, 1s for a refusal. */
export function stubJudge(): JudgeAdapter {
  return {
    model: 'stub-judge',
    async judge(input) {
      const { user } = buildJudgePrompt(input);
      if (!user.includes('TRANSCRIPT:') || !user.includes(input.scenario.expectation)) throw new Error('judge prompt lost its parts');
      const refused = input.transcript.some((t) => t.role === 'assistant' && /can't help/.test(t.text));
      const scores: Partial<Record<Dim, number | null>> = {};
      for (const d of DIMS) scores[d] = input.scenario.dims.includes(d) ? (refused ? 1 : 5) : null;
      const raw = '```json\n' + JSON.stringify({ scores, failures: refused ? ["\"I can't help with that.\""] : [], notes: refused ? 'Refused.' : 'Good.' }) + '\n```';
      return { ...parseJudge(raw), costEur: 0.0001, promptTokens: 200, completionTokens: 50 };
    },
  };
}

export async function runSelfCheck(scenarios: Scenario[]): Promise<{ result: EvalResult; report: string; problems: string[] }> {
  const result = await runEval({
    scenarios, systems: [goodStub('augmtd'), badStub('baseline')], judge: stubJudge(),
    groundTruth: async () => 'inbox_items pending: 0\ncommitments open: 0\ncalendar events (−2d…+1d): 0', budgetEur: 1,
  });
  const report = renderReport(result, { title: 'W22.C — harness self-check (stubbed, zero AI)', notes: ['Stub systems and a stub judge — this report proves the wiring, not the product.'] });
  const problems: string[] = [];
  const good = totalsFor(result, 'augmtd'), bad = totalsFor(result, 'baseline');
  if (good.checksPassed !== good.checksTotal) {
    const failed = result.scenarios.flatMap((sr) => (sr.runs.augmtd?.checks ?? []).filter((c) => !c.pass).map((c) => `${sr.scenario.id}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`));
    problems.push(`good stub failed ${good.checksTotal - good.checksPassed} deterministic check(s): ${failed.join('; ')}`);
  }
  if (bad.checksPassed >= bad.checksTotal) problems.push('refusing stub passed every check — the checks do not discriminate');
  if (good.judge !== 5 || bad.judge !== 1) problems.push(`judge means wrong: good=${good.judge} bad=${bad.judge}`);
  for (const must of ['## Side by side', '**TOTAL**', '## Failures', '## Transcripts', 'no flat refusal', '| Dimension |']) {
    if (!report.includes(must)) problems.push(`report is missing "${must}"`);
  }
  if (Math.abs(result.totalCostEur - (good.costEur + bad.costEur + good.judgeCostEur + bad.judgeCostEur)) > 1e-9) problems.push('total cost does not add up');
  return { result, report, problems };
}
