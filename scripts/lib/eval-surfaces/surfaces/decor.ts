// ════════════════════════════════════════════════════════════════════════════════════════════════
// W37 · THE DECORATION SURFACES — the small words the product writes around the work. Cheap (one short
// call each), measured mostly by DETERMINISTIC checks (language, length bounds, no invented facts, no
// preamble), with the blind judge beside them:
//   decoration.chat-title      lib/converse/chat-title.ts generateChatTitle (a chat names itself)
//   decoration.chat-starters   lib/agents/generate-starters.ts generateStartersForAgent (a coworker's starters)
//   decoration.bundle-names    lib/home/name-bundles.ts nameBundles (Home group names + grounded "why")
//   decoration.memory-render   lib/context/render-memory.ts renderProfile (the memory cards' sentences)
// Plain columns get the same ask with the same input (the producer's own instruction, rendered neutrally).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { makeSurface, DIM } from '../base';
import type { SurfaceCaseSpec } from '../common';
import type { EvalCase, SurfaceAdapter } from '../../eval/engine/types';

/** The producer's own slot (makeSurface defaults to 'conversation'): the same-model column resolves it. */
const onSlot = (a: SurfaceAdapter, slot: SurfaceAdapter['producer']['slot']): SurfaceAdapter => ({ ...a, producer: { ...a.producer, slot } });

const T = (s: unknown) => String(s ?? '').trim();
const P = <X>(c: EvalCase) => c.params?.decor as X;
/** No emoji, quotes, "Title:" prefix or trailing punctuation (the title contract). */
const TITLE_CLEAN = { kind: 'absent' as const, patterns: ['\\p{Extended_Pictographic}', '^["“«\']', '^(title|titre|título|titel)\\s*:', '[.!?:]$'], label: 'a clean title (no emoji, quotes, prefix, end punctuation)' };
const NO_PREAMBLE = { kind: 'absent' as const, patterns: ['^(here are|here is|sure|certainly|based on|this person)'], label: 'no preamble' };
const NOT_ENGLISH = (label: string) => ({ kind: 'absent' as const, patterns: ['\\b(the|and|with|your|for)\\b'], label });

const TITLE_ASK = 'Name this conversation. Reply with ONLY the title: 3 to 6 words, Title Case, naming the conversation\'s TOPIC, written in the same language the user wrote in. No quotes, no emoji, no trailing punctuation, no prefix like "Title:".';
const STARTERS_ASK = 'Generate exactly 4 short conversation starter prompts a user might send to this custom AI assistant: 6–10 words each, phrased as a direct user request, specific to its purpose, varied. One per line as a "- " list.';
const BUNDLE_ASK = 'Give this group of related work on my home dashboard a SHORT human title (≤5 words, a noun — not a task sentence) and, ONLY if a stated deadline, money at stake or a named decision supports it, one short clause on why it matters. Reply as "name — why" or just "name".';
const MEM_TURN = 'Turn this profile into the short description shown on my memory card.';

// ── 1 · CHAT TITLE ──────────────────────────────────────────────────────────────────────────────
type TitleP = { question: string; answer: string };
const titleSpecs: SurfaceCaseSpec[] = [
  { id: 'title-en-renewal', group: 'title', title: 'Title: an English chat about a supplier contract renewal', quick: true,
    params: { decor: { question: 'Can you help me reply to Globex about renewing the packaging supply contract? They want a 3-year term, I only want 1 year with an option to extend.', answer: 'Here is a reply that proposes a one-year renewal with an option to extend for two more years, and asks Globex to confirm pricing holds for the first year…' } satisfies TitleP },
    turns: [TITLE_ASK], truth: 'A 3–6 word Title Case topic name in English, e.g. "Globex Packaging Contract Renewal". No quotes, emoji, prefix or trailing punctuation. Names the topic, not the first words of the question.',
    checks: [{ kind: 'max_words', n: 6 }, { kind: 'min_words', n: 2 }, TITLE_CLEAN, { kind: 'mentions', groups: ['renew|contract|globex|packaging'], label: 'names the topic' }] },
  { id: 'title-pt-invoice', group: 'title', title: 'Title: a Portuguese chat about a late invoice', quick: true, edge: 'language',
    params: { decor: { question: 'Preciso de escrever ao cliente Northwind sobre a fatura de agosto que ainda não foi paga. Podes preparar um email educado mas firme?', answer: 'Claro — aqui está um email educado mas firme a lembrar a Northwind da fatura de agosto em atraso, com o valor e a data de vencimento…' } satisfies TitleP },
    turns: [TITLE_ASK], truth: 'A 3–6 word title IN PORTUGUESE naming the topic (e.g. "Fatura de Agosto da Northwind"). Not English. No quotes, emoji, prefix or trailing punctuation.',
    checks: [{ kind: 'max_words', n: 6 }, { kind: 'min_words', n: 2 }, TITLE_CLEAN, NOT_ENGLISH('written in Portuguese, not English'), { kind: 'mentions', groups: ['fatura|pagamento|cobrança|northwind'], label: 'Portuguese topic words' }] },
  { id: 'title-de-hiring', group: 'title', title: 'Title: a German chat about a job posting', edge: 'language',
    params: { decor: { question: 'Kannst du mir helfen, eine Stellenanzeige für eine Werkstudentin im Einkauf zu schreiben? 20 Stunden pro Woche, Start im November.', answer: 'Gern — hier ist ein Entwurf der Stellenanzeige für eine Werkstudentin im Einkauf (20 Std./Woche, Start November)…' } satisfies TitleP },
    turns: [TITLE_ASK], truth: 'A 3–6 word title IN GERMAN naming the topic (e.g. "Stellenanzeige Werkstudentin Einkauf"). No quotes, emoji, prefix or trailing punctuation; no invented details.',
    checks: [{ kind: 'max_words', n: 6 }, { kind: 'min_words', n: 1 }, TITLE_CLEAN, NOT_ENGLISH('written in German, not English'), { kind: 'mentions', groups: ['stellen|werkstudent|einkauf'], label: 'German topic words' }] },
];
export const chatTitleSurface = makeSurface({
  id: 'decoration.chat-title', title: 'Decoration — a chat names itself',
  producer: { file: 'lib/converse/chat-title.ts', fn: 'generateChatTitle' },
  dims: [DIM.task('Names the conversation\'s topic in 3–6 words, in the user\'s language.'), DIM.format('Title only: Title Case, no quotes, emoji, prefix or trailing punctuation.')],
  hard: [], specs: titleSpecs,
  plainPreamble: (c) => { const p = P<TitleP>(c); return `THE CONVERSATION:\nUSER:\n${p.question}\n\nASSISTANT:\n${p.answer}`; },
  extraSource: (c) => { const p = P<TitleP>(c); return `THE CONVERSATION TO NAME:\nUSER: ${p.question}\nASSISTANT: ${p.answer}`; },
  augmtdCost: () => ({ calls: 1, inTok: 400, outTok: 20 }), plainOut: 20,
  async produce(ctx, c) {
    const p = P<TitleP>(c);
    const { generateChatTitle } = await import('../../../../lib/converse/chat-title');
    return { turns: [T(await generateChatTitle(ctx.admin, ctx.userId, p)) || '(no title)'] };
  },
});

// ── 2 · COWORKER CONVERSATION STARTERS ──────────────────────────────────────────────────────────
type StartP = { name: string; description: string; instructions: string };
const starterSpecs: SurfaceCaseSpec[] = [
  { id: 'starters-en-procurement', group: 'starters', title: 'Starters: an English procurement analyst', quick: true,
    params: { decor: { name: 'Supplier Scout', description: 'Finds and compares packaging suppliers for a food company.', instructions: 'Compare suppliers on price per unit, minimum order quantity, lead time and certifications. Always show a table.' } satisfies StartP },
    turns: [STARTERS_ASK], truth: 'Exactly 4 starters, each 6–10 words, phrased as a request a user would send, specific to comparing packaging suppliers (price, MOQ, lead time, certifications). No invented supplier names, figures or facts about the user.',
    checks: [{ kind: 'list_items', exactly: 4 }, { kind: 'max_words', n: 44 }, { kind: 'min_words', n: 20 }] },
  { id: 'starters-pt-hr', group: 'starters', title: 'Starters: a coworker configured in Portuguese', quick: true, edge: 'language',
    params: { decor: { name: 'Assistente de RH', description: 'Ajuda a equipa de recursos humanos com recrutamento e onboarding.', instructions: 'Escreve anúncios de emprego, prepara guiões de entrevista e checklists de onboarding. Responde sempre em português.' } satisfies StartP },
    turns: [STARTERS_ASK], truth: 'Exactly 4 starters IN PORTUGUESE (the coworker is configured in Portuguese and answers in Portuguese), each 6–10 words, about job ads, interview guides and onboarding checklists. No English, no invented facts.',
    checks: [{ kind: 'list_items', exactly: 4 }, { kind: 'max_words', n: 44 }, NOT_ENGLISH('written in Portuguese, not English')] },
  { id: 'starters-fr-minimal', group: 'starters', title: 'Starters: a French coworker with only a short description', edge: 'language',
    params: { decor: { name: 'Veille Marché', description: 'Surveille les appels d\'offres publics dans le secteur de la santé.', instructions: '' } satisfies StartP },
    turns: [STARTERS_ASK], truth: 'Exactly 4 starters IN FRENCH, each 6–10 words, about monitoring public health-sector tenders. No invented tender names, buyers, dates or figures.',
    checks: [{ kind: 'list_items', exactly: 4 }, { kind: 'max_words', n: 44 }, NOT_ENGLISH('written in French, not English'), { kind: 'absent', patterns: ['\\b20\\d\\d\\b', '€\\s?\\d'], label: 'no invented dates or amounts' }] },
];
export const startersSurface = makeSurface({
  id: 'decoration.chat-starters', title: 'Decoration — a coworker\'s conversation starters',
  producer: { file: 'lib/agents/generate-starters.ts', fn: 'generateStartersForAgent' },
  dims: [DIM.task('Four useful, specific first requests for THIS coworker, in the coworker\'s own language.'), DIM.format('Exactly four, each 6–10 words, phrased as a user request.'), DIM.grounded('No invented names, figures or facts.')],
  hard: [], specs: starterSpecs,
  plainPreamble: (c) => { const p = P<StartP>(c); return `THE ASSISTANT:\nAgent name: ${p.name}\nAgent description: ${p.description}${p.instructions ? `\nAgent instructions: ${p.instructions}` : ''}`; },
  extraSource: (c) => { const p = P<StartP>(c); return `THE COWORKER:\nname: ${p.name}\ndescription: ${p.description}\ninstructions: ${p.instructions || '(none)'}`; },
  augmtdCost: () => ({ calls: 1, inTok: 300, outTok: 120 }), plainOut: 120,
  async produce(ctx, c) {
    const p = P<StartP>(c);
    const { generateStartersForAgent } = await import('../../../../lib/agents/generate-starters');
    const s = await generateStartersForAgent({ ...p, userId: ctx.userId, supabase: ctx.admin });
    return { turns: [s?.length ? s.map((x) => `- ${x}`).join('\n') : '(no starters)'] };
  },
});

// ── 3 · HOME BUNDLE NAMES ───────────────────────────────────────────────────────────────────────
type BundleP = { kind: 'initiative' | 'meeting' | 'thread'; label: string; members: string[] };
const bundleSpecs: SurfaceCaseSpec[] = [
  { id: 'bundle-thread-no-stakes', group: 'bundles', title: 'Bundle name: an email thread with no deadline or money — no "why"', quick: true, edge: 'missing',
    params: { decor: { kind: 'thread', label: 'Follow up: Share an update on the current completion status of the warehouse shelving install', members: ['Share an update on the shelving install status with Sam', 'Confirm whether the second shelving crew is booked', 'Reply to Sam\'s question about the loading-bay layout'] } satisfies BundleP },
    turns: [BUNDLE_ASK], truth: 'A short noun name (≤5 words) like "Warehouse Shelving Install" — not a task sentence. NO "why": nothing in the items states a deadline, money at stake or a decision, so no urgency may be invented.',
    checks: [{ kind: 'max_words', n: 6 }, { kind: 'absent', patterns: ['—', 'urgent', 'asap', 'deadline', 'critical', 'at risk', '€', '\\$'], label: 'no "why" and no invented urgency' }] },
  { id: 'bundle-deal-grounded', group: 'bundles', title: 'Bundle name: a deal with a stated deadline and amount — a grounded "why"', quick: true,
    params: { decor: { kind: 'initiative', label: 'Initech renewal', members: ['Initech asks for the renewal quote by Friday 9 October', 'Renewal value €48,000 per year', 'Lee wants the SLA terms unchanged'] } satisfies BundleP },
    turns: [BUNDLE_ASK], truth: 'Name ≈ "Initech Renewal" (≤5 words). A "why" grounded in the items: the quote is due Friday 9 October and/or €48,000 a year is at stake. No other figures or dates.',
    checks: [{ kind: 'mentions', groups: ['initech'], label: 'names the deal' }, { kind: 'mentions', groups: ['9 october|friday|48,000|48.000|48k|€48'], label: 'a grounded why' }, { kind: 'absent', patterns: ['\\b(?!48)\\d{2,3}[,.]?\\d{3}\\b'], label: 'no other amounts' }] },
  { id: 'bundle-pt-meeting', group: 'bundles', title: 'Bundle name: a Portuguese meeting\'s follow-ups', edge: 'language',
    params: { decor: { kind: 'meeting', label: 'Reunião de planeamento Q4', members: ['Enviar a ata da reunião de planeamento à equipa', 'Atualizar o orçamento de marketing para o Q4', 'Marcar a próxima reunião com a direção'] } satisfies BundleP },
    turns: [BUNDLE_ASK], truth: 'A short name in Portuguese (e.g. "Planeamento Q4") — the items are in Portuguese. No "why" (no deadline, money or decision is stated).',
    checks: [{ kind: 'max_words', n: 6 }, NOT_ENGLISH('written in Portuguese, not English'), { kind: 'absent', patterns: ['—', 'urgent', '€'], label: 'no invented why' }] },
];
const renderBundle = (p: BundleP) => `GROUP (${p.kind}) — fallback name: "${p.label}"\nitems:\n${p.members.map((m) => `- ${m}`).join('\n')}`;
export const bundleNamesSurface = makeSurface({
  id: 'decoration.bundle-names', title: 'Decoration — Home group names and their grounded "why"',
  producer: { file: 'lib/home/name-bundles.ts', fn: 'nameBundles' },
  dims: [DIM.task('A short human name for the group (≤5 words, a noun, not a task sentence), in the items\' language.'), DIM.grounded('A "why" only when a stated deadline, amount or decision supports it; never invented urgency.')],
  hard: [], specs: bundleSpecs,
  plainPreamble: (c) => renderBundle(P<BundleP>(c)),
  extraSource: (c) => renderBundle(P<BundleP>(c)),
  augmtdCost: () => ({ calls: 1, inTok: 500, outTok: 60 }), plainOut: 40,
  async produce(ctx, c) {
    const p = P<BundleP>(c);
    const { nameBundles } = await import('../../../../lib/home/name-bundles');
    const r = (await nameBundles(ctx.userId, ctx.admin, [{ key: 'b1', ...p }])).b1;
    return { turns: [r ? (r.why ? `${r.name} — ${r.why}` : r.name) : '(fallback label kept)'] };
  },
});

// ── 4 · MEMORY CARDS ────────────────────────────────────────────────────────────────────────────
type MemP = { type: 'identity' | 'domain_knowledge' | 'meeting_behavior'; data: Record<string, unknown> };
const memorySpecs: SurfaceCaseSpec[] = [
  { id: 'memory-identity', group: 'memory', title: 'Memory card: identity from a sparse profile', quick: true, edge: 'missing',
    params: { decor: { type: 'identity', data: { role: 'Operations Manager', company: 'Acme Logistics', industry: 'logistics', responsibilities: ['warehouse rollouts', 'supplier contracts'] } } satisfies MemP },
    turns: [MEM_TURN], truth: '1–2 factual sentences: Operations Manager at Acme Logistics (logistics), handling warehouse rollouts and supplier contracts. No preamble. No invented seniority, years of experience, team size, location or name.',
    checks: [{ kind: 'max_words', n: 50 }, NO_PREAMBLE, { kind: 'mentions', groups: ['operations manager', 'acme'], label: 'role + company' }, { kind: 'absent', patterns: ['\\d+\\+? years', 'senior', 'team of', 'based in', 'seasoned', 'experienced'], label: 'no invented facts' }] },
  { id: 'memory-meetings', group: 'memory', title: 'Memory card: meeting behaviour (the calendar analyser\'s own shape)', quick: true,
    params: { decor: { type: 'meeting_behavior', data: { preferredTimes: ['09:00-11:00'], noMeetingDays: ['Friday'], avgMeetingLength: 30, organizerRate: 0.4 } } satisfies MemP },
    turns: [MEM_TURN], truth: '2 sentences: meetings average 30 minutes, usually in the 09:00–11:00 window, none on Fridays; organises about 40% of their meetings. No preamble, nothing invented (no stated motives, no acceptance rate, no other days).',
    checks: [{ kind: 'max_words', n: 55 }, NO_PREAMBLE, { kind: 'mentions', groups: ['30', 'friday', '9'], label: 'every stated fact' }, { kind: 'absent', patterns: ['at least 30', 'monday', 'wednesday', 'accept'], label: 'no invented facts' }] },
  { id: 'memory-domain', group: 'memory', title: 'Memory card: domain knowledge with jargon', edge: 'missing',
    params: { decor: { type: 'domain_knowledge', data: { domains: ['cold-chain logistics', 'food safety'], terms: ['HACCP', 'reefer', 'FEFO'] } } satisfies MemP },
    turns: [MEM_TURN], truth: '1–2 sentences: expertise in cold-chain logistics and food safety; uses terms like HACCP, reefer and FEFO. No preamble; no invented credentials or years.',
    checks: [{ kind: 'max_words', n: 50 }, NO_PREAMBLE, { kind: 'mentions', groups: ['cold-chain|cold chain', 'haccp'], label: 'the stated domains + terms' }, { kind: 'absent', patterns: ['\\d+\\+? years', 'certified', 'expert in'], label: 'no invented credentials' }] },
];
const MEM_ASK: Record<MemP['type'], string> = {
  identity: 'Convert this identity profile into 1-2 factual sentences describing who this person is professionally. Start directly — no preamble.',
  domain_knowledge: 'Convert this domain knowledge profile into 1-2 sentences describing the person\'s professional expertise and terminology. Start directly — no preamble.',
  meeting_behavior: 'Convert this meeting behavior profile into 2 sentences describing how this person handles meetings and scheduling. Start directly — no preamble.',
};
export const memoryRenderSurface = makeSurface({
  id: 'decoration.memory-render', title: 'Decoration — the memory cards\' sentences',
  producer: { file: 'lib/context/render-memory.ts', fn: 'renderProfile' },
  dims: [DIM.task('States the profile as 1–3 plain sentences a person recognises as themselves.'), DIM.grounded('Every fact from the profile data; nothing added (no seniority, years, location, praise).')],
  hard: [], specs: memorySpecs,
  plainPreamble: (c) => { const p = P<MemP>(c); return `${MEM_ASK[p.type]}\n\nTHE PROFILE:\n${JSON.stringify(p.data, null, 2)}`; },
  extraSource: (c) => `THE PROFILE DATA:\n${JSON.stringify(P<MemP>(c).data, null, 2)}`,
  augmtdCost: () => ({ calls: 1, inTok: 300, outTok: 80 }), plainOut: 80,
  async produce(ctx, c) {
    const p = P<MemP>(c);
    const { renderProfile } = await import('../../../../lib/context/render-memory');
    return { turns: [T(await renderProfile(p.type, p.data, 60, { userId: ctx.userId, supabase: ctx.admin })) || '(nothing rendered)'] };
  },
});

export const DECOR_SURFACES = [
  onSlot(chatTitleSurface, 'classification'), onSlot(startersSurface, 'summarization'),
  onSlot(bundleNamesSurface, 'classification'), onSlot(memoryRenderSurface, 'summarization'),
];
