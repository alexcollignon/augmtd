// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28 · handoff.result — A HAND-OFF'S DELIVERABLE, POSTED BACK INTO THE CHAT THAT ASKED.
// PRODUCER: the chat's hand-off door end to end — lib/converse converse(client, user, {kind:'global'},
// "Ask Max to …", { postRoomKey, defer }) exactly as POST /api/home/ask calls it: the router hands the
// task to the coworker, the deferred work runs runDelegation (lib/home/delegate.ts: the coworker's
// agent step → the evaluator → the report-back) and postHandOffResult writes the coworker's turn into
// the asking room. SERVED = that posted turn (+ the text of any document it carries as a card); when
// no hand-off happened, the chat's own answer is what the user got and is what is judged.
// Plain columns: the SAME work request without the routing preface ("Ask Max to") — the deliverable.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { makeSurface, extrasOf, DIM, clientOf } from '../base';
import { flattenDoc, type SurfaceCaseSpec } from '../common';

const CRM_NOTES = `My notes on three CRM options for our 12-person consultancy:
- Pipedrive-like "DealFlow": €15 per user/month, strong pipeline view, weak on project tracking, 2-week setup.
- "OneDesk Suite": €39 per user/month, CRM + project tracking + invoicing in one, 6-week setup, needs an admin.
- "LiteCRM": free up to 10 users, then €9 per user/month; basic contact management only, no integrations with our accounting tool.
We care most about: pipeline visibility, linking deals to projects, and low admin effort.`;

const CASE_STUDY = `Case study (approved for publication): Northwind Foods cut supplier onboarding from 9 working days to 4 with our checklist service. Their procurement lead said: "For the first time, suppliers thank us for the paperwork." 11 suppliers onboarded in the first month, zero missing documents.`;

/** Spec with an optional plain-column version of the request (the routing preface removed). */
type HoSpec = SurfaceCaseSpec & { plain: string };
const ho = (s: HoSpec): SurfaceCaseSpec => ({ ...s, params: { ...(s.params ?? {}), plain: s.plain, judgeTask: [s.plain] } });

const specs: SurfaceCaseSpec[] = [
  ho({
    id: 'ho-max-crm', group: 'max', title: 'Hand-off to Max: CRM comparison table + recommendation from pasted notes', quick: true,
    turns: [`Ask Max to compare these three CRM options in a table and recommend one for us.\n\n${CRM_NOTES}`],
    plain: `Compare these three CRM options in a table and recommend one for us.\n\n${CRM_NOTES}`,
    truth: 'The deliverable itself (not a note that work was done): a markdown table comparing DealFlow, OneDesk Suite and LiteCRM on price, pipeline view, project tracking, setup/admin effort and integrations using ONLY the notes; a clear recommendation tied to the stated priorities (pipeline visibility, linking deals to projects, low admin effort) — e.g. OneDesk if deal↔project linking is essential despite cost/admin, else DealFlow — with the trade-off named. LiteCRM\'s 10-user free tier does not cover 12 people. No invented features or prices.',
    checks: [{ kind: 'table' }, { kind: 'no_refusal' }, { kind: 'mentions', groups: ['dealflow', 'onedesk', 'litecrm'] }],
  }),
  ho({
    id: 'ho-luca-variants', group: 'luca', title: 'Hand-off to Luca: two LinkedIn variants from an approved case study', quick: true,
    turns: [`Ask Luca to turn this case study into two LinkedIn post variants.\n\n${CASE_STUDY}`],
    plain: `Turn this case study into two LinkedIn post variants.\n\n${CASE_STUDY}`,
    truth: 'Two distinct, ready-to-post variants built only from the case study: Northwind Foods, onboarding 9 → 4 working days, 11 suppliers in the first month with zero missing documents, the procurement lead\'s quote (verbatim if quoted). No invented numbers or extra quotes. Nothing claimed posted.',
    checks: [{ kind: 'no_refusal' }, { kind: 'no_send_claim' }, { kind: 'mentions', groups: ['northwind', '9|nine', '4|four'] }],
  }),
  ho({
    id: 'ho-max-missing', group: 'max', title: 'Hand-off to Max: competitor pricing table with no material given', edge: 'missing',
    turns: ['Ask Max to build the competitor pricing table for our renewal deck.'],
    plain: 'Build the competitor pricing table for our renewal deck.',
    truth: 'Nothing says who the competitors are, what product the renewal is for, or which prices matter; no material is attached. A good deliverable does not fabricate competitor prices as facts: it either asks for the missing inputs (competitor list, product/tier, currency) in one short list, or delivers a clearly-labelled template with [CONFIRM] placeholders and names what is missing. Any public price quoted must carry its source.',
    hard: ['The answer presents specific competitor names with specific prices as facts without a cited source.'],
    checks: [{ kind: 'no_refusal' }],
  }),
  ho({
    id: 'ho-luca-hooks', group: 'luca', title: 'Hand-off to Luca: exactly three hook lines, each under 15 words', edge: 'strict_format',
    turns: ['Ask Luca for exactly three hook lines for a post about our new remote-onboarding kit for new hires. Each under 15 words. Only the three lines.'],
    plain: 'Give me exactly three hook lines for a post about our new remote-onboarding kit for new hires. Each under 15 words. Only the three lines.',
    truth: 'Exactly three hook lines, each under 15 words, about a remote-onboarding kit for new hires, and nothing else (no preamble, no explanation, no extra options). No invented statistics.',
    checks: [{ kind: 'list_items', max: 3 }, { kind: 'max_words', n: 60 }],
  }),
];

const trim = (s: unknown) => String(s ?? '').trim();

async function postedResult(admin: SupabaseClient, userId: string, roomKey: string): Promise<{ text: string; cards: string[] } | null> {
  const { data, error } = await admin.from('room_turns').select('role, text, author, component, created_at')
    .eq('user_id', userId).eq('room_key', roomKey).order('created_at', { ascending: true });
  if (error) throw new Error(`room_turns read: ${error.message}`);
  const rows = (data ?? []) as Array<{ text: string; author: { kind?: string } | null; component: { key?: string; state?: { items?: Array<{ tid: string; artifactId: string }> } } | null }>;
  const turn = [...rows].reverse().find((r) => r.author?.kind === 'coworker') ?? null;
  if (!turn) {
    const sys = rows.filter((r) => trim(r.text)).map((r) => trim(r.text));
    return sys.length ? { text: sys.join('\n\n'), cards: [] } : null;
  }
  const parts = [trim(turn.text)];
  const cards: string[] = [];
  for (const it of turn.component?.key === 'worker_cards' ? turn.component.state?.items ?? [] : []) {
    const { data: th, error: tErr } = await admin.from('work_threads').select('artifacts').eq('user_id', userId).eq('id', it.tid).maybeSingle();
    if (tErr) throw new Error(`work_threads read: ${tErr.message}`);
    const art = ((th as { artifacts?: unknown[] } | null)?.artifacts ?? []).find((a) => (a as { id?: string }).id === it.artifactId) as { title?: string; content?: unknown; type?: string } | undefined;
    if (!art) continue;
    cards.push(`document card: ${art.title ?? 'untitled'} (${art.type ?? 'document'})`);
    parts.push(`[ATTACHED ${String(art.type ?? 'document').toUpperCase()} — "${art.title ?? ''}", opened from the card]\n${flattenDoc(art.content)}`);
  }
  return { text: parts.filter(Boolean).join('\n\n'), cards };
}

type LooseConverse = (client: SupabaseClient, userId: string, scope: { kind: 'global' }, text: string,
  opts: Record<string, unknown>) => Promise<Record<string, unknown>>;

export const handoffSurface = makeSurface({
  id: 'handoff.result',
  title: 'Hand-off result — the delegated deliverable posted back into the chat',
  producer: { file: 'lib/converse/index.ts → lib/home/delegate.ts', fn: 'converse hand-off → runDelegation → postHandOffResult' },
  team: true,
  dims: [
    DIM.task('The posted result IS the deliverable asked for (the table, the variants, the hooks) — never a note that work was done.'),
    DIM.format('Honours the requested shape (table, exact counts, word limits, "only the lines").'),
    DIM.grounded('Uses only the given material; missing inputs named (or marked [CONFIRM]); no fabricated facts or prices.'),
    DIM.voice('Specific, professional, ready to use.'),
  ],
  hard: ['The posted result says the work was done or attached but the deliverable itself is not in it.'],
  specs,
  augmtdCost: () => ({ calls: 6, inTok: 50_000, outTok: 3_000 }),
  plainOut: 800,
  // The plain columns see the work request without the routing preface.
  plainPreamble: undefined,
  async produce(ctx, c, seeded) {
    const e = extrasOf(seeded);
    const roomKey = `chat:${randomUUID()}`;
    e.roomKeys.push(roomKey);
    const { converse } = await import('../../../../lib/converse');
    const pending: Promise<void>[] = [];
    // THE HAND-OFF'S OWN CLOCK: the delegation runs 1-6 min live (agent step, evaluator retry, report,
    // document). The unit waits for it (15 min cap); teardown awaits anything still running.
    const q = trim((c.turns ?? [])[0]);
    const r = await (converse as unknown as LooseConverse)(clientOf(ctx), ctx.userId, { kind: 'global' }, q, {
      history: [], postRoomKey: roomKey, defer: (work: () => Promise<void>) => { const p = work(); pending.push(p); e.pending.push(p); },
    });
    const done = await Promise.race([Promise.allSettled(pending).then(() => true), new Promise<boolean>((res) => setTimeout(() => res(false), 900_000))]);
    if (!done) throw new Error('hand-off still running after 15 min — nothing posted to judge');
    const posted = await postedResult(ctx.admin, ctx.userId, roomKey);
    const say = trim(r?.say);
    const delegated = !!(r as { delegated?: unknown })?.delegated;
    const text = posted?.text || say;
    return { turns: [text], signals: [{ cards: posted?.cards ?? [], sideEffects: delegated ? ['handed to a coworker (background)'] : [] }] };
  },
});

// The plain turns drop the routing preface (the case's `plain` text) — same content, no coworker name.
const base = handoffSurface.conversation!.plainTurns;
handoffSurface.conversation!.plainTurns = (c) => {
  const plain = trim(c.params?.plain);
  return plain ? [plain] : base(c);
};
handoffSurface.plainPrompt = (c) => ({ user: trim(c.params?.plain) || trim((c.turns ?? [])[0]) });
