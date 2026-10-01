// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28.7 · THE CLAIMS FLOOR — a specific the material does not supply never reaches the user as fact.
//
// Found by the W28 surfaces eval: narrative deliverables (LinkedIn posts, case-study stories) written by
// the conversation model kept adding specifics the user never gave — "a few weeks ago", "four months in",
// "chasing documents, waiting on approvals" — despite the conduct rule against it, and the same model
// with a plain prompt did the same. A rule the writer must remember is not a floor. This is:
//   1 · ONE model call NOMINATES: it lists every concrete claim in the draft (time phrases, numbers,
//       named events, anecdotes, before-states and causes stated as fact, quotes) with the exact span,
//       whether the material supports it, and a short placeholder for the ones it does not.
//   2 · CODE APPLIES: each unsupported span that occurs VERBATIM in the draft is replaced by its
//       [PLACEHOLDER] (the deliver-first rule's slot for what only the user knows). A span that is not
//       verbatim is ignored — the model never rewrites the draft, it only points.
// Fail-open: any error returns the draft unchanged (the floor is an enhancement, never a blocker).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { clipForPrompt, EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

export type ClaimVerdict = { quote: string; supported: boolean; placeholder?: string; /** remove = the text reads fine without it (a flourish); placeholder = the piece needs the fact */ action?: 'remove' | 'placeholder'; /** the material's own words for an overstated claim ("an admin" for "a dedicated admin") */ correction?: string };

/** A slot NAMES what it stands for ("THE DAY YOU CAN MEET"); a generic name ("DETAIL TO CONFIRM", "WHEN") is
 *  not a slot a reader can fill (W28 eval: "[DETAIL TO CONFIRM] — [WHEN]"). Pure. */
const GENERIC_SLOT = /^(detail( to confirm)?|details?|to confirm|tbd|tbc|n\/?a|none|unknown|when|what|why|how|who|date|time|x|placeholder|confirm|info|information|specifics?|your (detail|input)s?)\??$/i;
export function isGenericSlot(p: string | undefined): boolean {
  const t = String(p ?? '').replace(/[[\]]/g, '').trim();
  return !t || t.length > 40 || GENERIC_SLOT.test(t);
}
export function asPlaceholder(p: string | undefined, quote = ''): string {
  const t = String(p ?? '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (!isGenericSlot(t)) return `[${t.toUpperCase()}]`;
  // No usable name: the slot names the span it replaces.
  const q = String(quote ?? '').replace(/\s+/g, ' ').trim();
  // W36 (eval handoff.result: "[CONFIRM: Likely €18–€108/month depending on…" read as a broken cell) — a
  // span too long to quote whole is never quoted cut: the slot says only that it needs confirming.
  if (!q || q.length > 36) return '[TO CONFIRM]';
  return `[CONFIRM: ${q}]`;
}

/** A claim that states something checkable: a number, an amount, a date or time word, or a name (a capitalised
 *  word after the first). Pure. */
export function isConcreteClaim(quote: string): boolean {
  const q = String(quote ?? '').trim();
  if (/[\d€$£%]/.test(q)) return true;
  if (/\b(today|tomorrow|yesterday|tonight|ago|last|next|earlier|later|week|weeks|month|months|year|years|day|days|hour|hours|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|q[1-4])\b/i.test(q)) return true;
  return q.split(/\s+/).slice(1).some((w) => /^[A-Z][\p{L}'’-]+/u.test(w.replace(/^["'“‘(]/, '')));
}

/** Apply verdicts: every unsupported span found verbatim is replaced by its placeholder. Pure. */
export function applyClaimVerdicts(text: string, verdicts: ClaimVerdict[], material?: string): { text: string; replaced: string[] } {
  let out = String(text ?? '');
  const replaced: string[] = [];
  // Longest first, so a span inside a longer unsupported span is not replaced twice.
  const bad = verdicts.filter((v) => v && v.supported === false && typeof v.quote === 'string')
    .map((v) => ({ ...v, quote: v.quote.trim() }))
    .filter((v) => v.quote.length >= 3 && v.quote.length <= 240)
    .sort((a, b) => b.quote.length - a.quote.length);
  for (const v of bad) {
    if (!out.includes(v.quote)) continue;
    // A removal is for a whole sentence of prose. Inside a table row, or a fragment of a sentence, removing
    // leaves a broken cell or a broken sentence (eval round 11: "€ ()", "The isn't worth") — slot it instead.
    const inTable = out.split('\n').some((l) => l.trim().startsWith('|') && l.includes(v.quote));
    const wholeSentence = /[.!?]["'”’)]?$/.test(v.quote) && /^[A-Z0-9"'“‘(\[]/.test(v.quote);
    // …and a list item whose whole content is the span keeps a slot (eval: a "2." left empty in three hooks).
    // (any line — a list item or a standalone bold line — whose whole content is the span keeps a slot)
    const bare = (x: string) => x.replace(/^\s*(\d+[.)]|[-*•>])\s+/, '').replace(/[*_"“”#]/g, '').trim();
    const wholeItem = out.split('\n').some((l) => bare(l) !== '' && bare(l) === bare(v.quote));
    // …a TIME PHRASE inside a promise ("in the next few days", "by Thursday") is removable too: the promise stays, undated.
    const timePhrase = /^(by|before|on|within|in the next|over the next|end of|by end of)\b[^.!?\n]{0,40}$/i.test(v.quote.trim());
    const remove = v.action === 'remove' && !inTable && !wholeItem && (wholeSentence || timePhrase);
    // A correction is the MATERIAL'S OWN WORDS — anything else (the checker's commentary leaking into the draft,
    // found in the full eval: "calculation is correct … but material doesn't state the total") is not used.
    const corr = typeof v.correction === 'string' ? v.correction.trim() : '';
    const correction = corr && corr.length <= 80 && material != null && material.toLowerCase().includes(corr.toLowerCase()) ? corr : null;
    // Prefer removing over slotting whenever the span can go (a whole sentence, a time phrase): a slot is
    // for what the piece NEEDS, and a generic-named slot is never better than a clean removal.
    const removable = !inTable && !wholeItem && (wholeSentence || timePhrase);
    const useRemove = remove || (removable && (v.action !== 'placeholder' || isGenericSlot(v.placeholder)));
    // W36 · A SLOT IS FOR A CONCRETE FACT (eval handoff.result: posts came back with "[WHO FELT THIS REACTION]",
    // "[CONFIRM: What stuck with us was what their…]", "[N/A]" — slots where the writing was fine). A claim with
    // no number, date, time, name or amount in it (a reaction, a cause, a description) is never slotted: a
    // trailing clause set off by a comma or dash is cut, and anything else is left as written.
    if (!correction && !useRemove && !isConcreteClaim(v.quote)) {
      const esc = v.quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const trailing = new RegExp(`\\s*(?:,|—|–| -)\\s*${esc}(?=[.!?])`);
      if (!inTable && trailing.test(out)) { out = out.replace(trailing, ''); replaced.push(v.quote); }
      continue;
    }
    out = out.split(v.quote).join(correction ?? (useRemove ? '' : asPlaceholder(v.placeholder, v.quote)));
    replaced.push(v.quote);
  }
  // One slot per thing: identical slots joined by "or"/"and"/"," collapse into one.
  out = out.replace(/(\[[^\]\n]+\])(\s*(?:,|or|and|\/)\s*\1)+/gi, '$1');
  // Tidy what a removal leaves: doubled spaces, a space before punctuation, a line of only punctuation.
  out = out.split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').replace(/^\s*[,;:—–-]\s*/, '').trimEnd())
    .filter((l, i, a) => !(l.trim() === '' && (a[i - 1] ?? '').trim() === '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, replaced };
}

/** A sentence where the writer vouches for its own faithfulness ("I've kept the facts exactly as stated",
 *  "both stick to what you gave me") — the reader checks that; the claim is never evidence, and the eval
 *  found it standing beside the very additions it denied. */
const SELF_VOUCH = /\b(I'?ve|I have|I|both|all|each|they|these|this|it)\b[^.!?\n]{0,40}\b(kept|keep|keeps|stuck|stick|sticks|stay|stays|stayed)\b[^.!?\n]{0,40}\b(the facts|what you (gave|told|shared|provided)|as (stated|provided|given|approved)|exactly|approved facts|no embellish\w*|nothing (added|invented))/i;

/** Drop self-vouching sentences (pure; a line that becomes empty is dropped). */
export function stripSelfVouching(text: string): string {
  return String(text ?? '').split('\n').map((line) => {
    if (!SELF_VOUCH.test(line)) return line;
    const kept = line.split(/(?<=[.!?])\s+/).filter((sentence) => !SELF_VOUCH.test(sentence)).join(' ').trim();
    return kept === '' ? null : kept;
  }).filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The floor gutted the work: a list item left as nothing but a slot, or three or more slots. Pure. */
export function flooringGutted(r: { text: string; replaced: string[] }): boolean {
  if (!r.replaced.length) return false;
  const slots = (r.text.match(/\[[A-Z0-9][^\]\n]{0,40}\]/g) ?? []).length;
  // A line (list item or standalone) left as nothing but a slot.
  const emptyItem = r.text.split('\n').some((l) => /^\s*((\d+[.)]|[-*•])\s*)?[*_]*\[[^\]]+\][*_]*\s*[.!?]?\s*$/.test(l));
  return emptyItem || slots >= 3;
}

/** A drafted message that states availability or a dated commitment on the user's behalf — the one class
 *  of concrete claim a reply invents most (full eval: "Tuesday or Wednesday afternoon would work well for
 *  me" with no calendar; "I'll send the SOW by end of day Thursday"). Cheap precheck before the floor. Pure. */
const DAYISH = String.raw`(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|morning|afternoon|evening|\d{1,2}(:\d{2})?\s?(am|pm|h)|next week|end of)`;
const AVAILABLE = String.raw`(I'?m (free|available|open)|open (most|on|any|all)|works? (well |best )?for me|work best|would work|suits? me( best)?|am free|is free|available (on|at|from)|free (on|at))`;
const PROMISE_DATED = String.raw`(I'?ll|I will|we'?ll|we will)\b[^.!?\n]{0,80}\b(by|before|on|within|in the next|over the next|end of|tomorrow|today|this week|next week)\b`;
export const COMMITMENT_OR_AVAILABILITY = new RegExp(String.raw`\b${AVAILABLE}\b[^.!?\n]{0,80}\b${DAYISH}|\b${DAYISH}\b[^.!?\n]{0,60}\b${AVAILABLE}|\b${PROMISE_DATED}`, 'i');

/**
 * W36 · A MESSAGE CLAIMS ONLY THE WORK THE RECORD SHOWS (eval sent.compose + sidebar drafts, EU Sonnet 4.5:
 * "I'll have it to you by Friday" on an obligation due Thursday; "following up with the supplier today",
 * "everything is on track", "finalising the pricing now" — none of it on record). Deterministic nomination,
 * zero AI, multilingual (en · de · fr · pt · es): a drafted message's claims about the user's work are read
 * sentence by sentence (questions excepted) —
 *   · day      a promise names a day: a weekday, a day of a month, today / tomorrow / this week / end of day;
 *   · status   where the work stands: "on track", "in progress", "with finance", "out for signature",
 *              "almost done", "im Zeitplan", "en cours", "em andamento", "en curso"…;
 *   · progress what the user is doing now: "I'm finalising…", "we're following up…", "ich bin gerade dabei",
 *              "je suis en train de", "estou a finalizar", "estoy preparando"…;
 *   · deed     what the user has done: "I've chased them", "we have sent / approved / booked…".
 * Each is SUPPORTED when the material the writer had names it (the same day in any of the languages, an ISO
 * date, or the claim's own core phrase); the first unsupported claim is returned with its exact span and a
 * NAMED slot, so a caller can regenerate once with it named and, if the rewrite still claims it, serve the
 * draft with the span replaced by the slot (slotUnsupportedWork) — never the invented claim. Pure.
 */
export type WorkClaim = { kind: 'day' | 'status' | 'progress' | 'deed'; sentence: string; span: string; slot: string };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** Each weekday in the languages served (index 0 = Monday). */
const WEEKDAY_FORMS: string[][] = [
  ['monday', 'montag', 'lundi', 'segunda-feira', 'segunda', 'lunes'],
  ['tuesday', 'dienstag', 'mardi', 'terça-feira', 'terça', 'martes'],
  ['wednesday', 'mittwoch', 'mercredi', 'quarta-feira', 'quarta', 'miércoles', 'miercoles'],
  ['thursday', 'donnerstag', 'jeudi', 'quinta-feira', 'quinta', 'jueves'],
  ['friday', 'freitag', 'vendredi', 'sexta-feira', 'sexta', 'viernes'],
  ['saturday', 'samstag', 'samedi', 'sábado', 'sabado'],
  ['sunday', 'sonntag', 'dimanche', 'domingo'],
];
/** Relative days a claim can name — one group per meaning, every language in it. */
const RELATIVE_FORMS: string[][] = [
  ['today', 'heute', "aujourd'hui", 'aujourd’hui', 'hoje', 'hoy'],
  ['tonight', 'heute abend', 'heute abend', 'ce soir', 'esta noite', 'esta noche'],
  ['tomorrow', 'morgen', 'demain', 'amanhã', 'amanha', 'mañana', 'manana'],
  ['this week', 'diese woche', 'diesen woche', 'cette semaine', 'esta semana'],
  ['end of day', 'end of the day', 'eod', 'end of the week', 'end of week', 'eow', 'ende des tages', 'feierabend', 'fin de journée', 'fim do dia', 'final del día', 'final del dia'],
];
const L = String.raw`[\p{L}\p{N}'’-]`;
const word = (w: string) => new RegExp(String.raw`(?<!${L})${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}(?!${L})`, 'iu');
const FIRST_PERSON = /(?<![\p{L}'’])(i|i'm|i’m|i'll|i’ll|i've|i’ve|we|we'll|we’ll|we're|we’re|we've|we’ve|ich|wir|je|j'|j’|nous|eu|nós|nos|yo|nosotros|nosotras)(?![\p{L}])/iu;
const FUTURE = /\b(will|shall|going to|can have|expect to|plan to|aim to|should have)\b|'ll\b|’ll\b|\b(werde|werden|wird|schicke|sende|melde|vais|allons|enverrai|enverrons|reviendrai|vou|vamos|enviarei|enviaremos|voy|enviaré|enviaremos)\b/iu;
/** A claim's clause runs to the next punctuation or joining word (never swallows the next clause). */
const SPAN_END = String.raw`(?:(?![.,;:!?\n—–]|\s(?:and|but|so|und|aber|et|mais|e|mas|y|pero)\s)[\s\S])*`;
/** status: where the work stands (subject-free: "everything is on track", "está em andamento"). */
const STATUS: RegExp[] = [
  new RegExp(String.raw`\b(on track|on schedule|in progress|under ?way|almost (?:done|ready|finished|there)|nearly (?:done|ready|finished)|ready to go|(?<=(?:is|are|'s|’s|still|currently)\s)with (?:finance|legal|procurement|the (?:team|board|client|supplier|vendor))|out for (?:signature|review|approval)|being (?:prepared|processed|reviewed|finali[sz]ed|signed|checked))\b`, 'iu'),
  /(?<![\p{L}])(in bearbeitung|im zeitplan|nach plan|fast fertig|auf (?:einem )?guten weg|in prüfung|en cours|dans les temps|presque (?:prêt|prête|terminé|terminée|fini|finie)|en bonne voie|em andamento|dentro do prazo|quase (?:pronto|pronta|concluído|concluída)|no bom caminho|en curso|a tiempo|casi (?:listo|lista|terminado|terminada)|según lo previsto|bien encaminad[oa])(?![\p{L}])/iu,
];
/** progress: what the user is doing right now. */
const PROGRESS: RegExp[] = [
  new RegExp(String.raw`\b(?:I'?m|I’m|I am|we'?re|we’re|we are)\s+(?:currently\s+|now\s+|already\s+|still\s+|just\s+|actively\s+)?(working on|finali[sz]ing|preparing|drafting|following up|chasing|checking|reviewing|putting together|pulling together|sorting|wrapping up|finishing|completing|processing|updating|arranging|confirming|getting)\b`, 'iu'),
  /(?<![\p{L}])((?:ich bin|wir sind) (?:gerade |noch |schon )?dabei|(?:ich|wir) (?:arbeite|arbeiten|finalisiere|finalisieren|bereite|bereiten|kläre|klären|prüfe|prüfen) (?:gerade|derzeit|aktuell)|(?:je suis|nous sommes) en train de|(?:je|nous) (?:finalise|finalisons|prépare|préparons|relance|relançons|vérifie|vérifions)|(?:estou|estamos) (?:a (?:finalizar|preparar|tratar|verificar|rever)|finalizando|preparando|tratando|verificando|trabalhando)|(?:estoy|estamos) (?:finalizando|preparando|trabajando|revisando|verificando|gestionando))(?![\p{L}])/iu,
];
/** deed: what the user has already done. */
const DEED: RegExp[] = [
  new RegExp(String.raw`\b(?:I|we)\s*(?:have|'ve|’ve)\s+(?:already\s+|just\s+)?(sent|chased|contacted|asked|spoken (?:to|with)|reached out(?: to)?|followed up(?: with)?|signed|approved|booked|scheduled|submitted|confirmed(?: with)?|escalated)\b`, 'iu'),
  /(?<![\p{L}])((?:ich habe|wir haben) (?:bereits |schon )?(?:nachgefragt|nachgehakt|geschickt|gesendet|freigegeben|gebucht|bestätigt)|(?:j'ai|j’ai|nous avons) (?:déjà )?(?:relancé|envoyé|validé|réservé|confirmé)|(?:já )?(?:enviei|enviámos|enviamos|confirmei|reservei|aprovei)|(?:ya )?(?:he|hemos) (?:enviado|confirmado|reservado|aprobado|contactado))(?![\p{L}])/iu,
];
const SLOT: Record<WorkClaim['kind'], string> = { day: 'THE DAY YOU CAN COMMIT TO', status: 'WHERE IT STANDS', progress: 'WHAT YOU ARE DOING ON IT', deed: 'WHAT HAS BEEN DONE' };

/** Every unsupported claim about the user's work in `draft` against `material`, in order. Pure. */
export function unsupportedWorkClaims(draft: string, material: string): WorkClaim[] {
  const mat = String(material ?? '').toLowerCase();
  const isoDays = new Set([...mat.matchAll(/\b\d{4}-(\d{2})-(\d{2})\b/g)].map((m) => `${Number(m[1])}-${Number(m[2])}`));
  const claims: WorkClaim[] = [];
  const has = (forms: string[]) => forms.some((f) => word(f).test(mat));
  const push = (kind: WorkClaim['kind'], sentence: string, span: string) => {
    if (!claims.some((c) => c.span === span)) claims.push({ kind, sentence: sentence.trim(), span, slot: asPlaceholder(SLOT[kind]) });
  };
  const sentences = String(draft ?? '').split(/(?<=[.!?])\s+|\n+/).filter((x) => x.trim() && !/\?\s*$/.test(x.trim()));
  for (const sentence of sentences) {
    const promise = FIRST_PERSON.test(sentence) && FUTURE.test(sentence);
    // day — in a promise, or beside a status/progress claim ("following up with the supplier today")
    const statusLike = [...STATUS, ...PROGRESS].some((re) => re.test(sentence));
    if (promise || statusLike) {
      for (const forms of [...WEEKDAY_FORMS, ...RELATIVE_FORMS]) {
        for (const f of forms) {
          const m = new RegExp(String.raw`(?:(?:by|on|before|until|this|next|bis|am|vor|avant|d'ici|d’ici|até|antes de|hasta|para)\s+)?${word(f).source}`, 'iu').exec(sentence);
          if (m && !has(forms)) push('day', sentence, m[0]);
        }
      }
      const md = new RegExp(String.raw`(?:(?:by|on|before|until)\s+)?(?:\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTHS.join('|')})\b|\b(${MONTHS.join('|')})\s+(\d{1,2})(?:st|nd|rd|th)?\b)`, 'i').exec(sentence);
      if (promise && md) {
        const day = Number(md[1] ?? md[4]);
        const month = MONTHS.indexOf(String(md[2] ?? md[3]).toLowerCase()) + 1;
        const inWords = new RegExp(String.raw`\b${day}(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTHS[month - 1]}\b|\b${MONTHS[month - 1]}\s+${day}(?:st|nd|rd|th)?\b`, 'i').test(mat);
        if (!inWords && !isoDays.has(`${month}-${day}`)) push('day', sentence, md[0]);
      }
    }
    for (const [kind, res] of [['status', STATUS], ['progress', PROGRESS], ['deed', DEED]] as const) {
      for (const re of res) {
        for (const m of sentence.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
          const core = String(m[1] ?? m[0]).toLowerCase().replace(/\s+/g, ' ').trim();
          if (mat.includes(core)) continue;
          const clause = new RegExp(`${m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${SPAN_END}`, 'iu').exec(sentence);
          push(kind, sentence, (clause?.[0] ?? m[0]).trim());
        }
      }
    }
  }
  return claims;
}

/** The first unsupported claim's sentence, or null — the compose door's and the sidebar's trigger. Pure. */
export function unsupportedPromiseTiming(draft: string, material: string): string | null {
  return unsupportedWorkClaims(draft, material)[0]?.sentence ?? null;
}

/** The objection a one-shot rewrite is given for the claims found (one wording for every caller). Pure. */
export function workClaimObjection(claims: WorkClaim[]): string {
  const named = claims.slice(0, 3).map((c) => `"${c.span}" (${c.kind === 'day' ? 'a day' : c.kind === 'deed' ? 'something done' : 'where the work stands'})`).join('; ');
  return `The draft states ${named} — nothing on record shows it. Say only what the record or the user's own ` +
    `instruction gives: the due date on record, or that it follows as soon as it is ready; no status, progress ` +
    `or deed the record does not show.`;
}

/** THE LAST WORD IS A SLOT, NEVER THE INVENTION: each unsupported span replaced by its named slot
 *  (overlapping spans merge into one slot — the widest claim's). Pure. */
export function slotUnsupportedWork(draft: string, material: string): { text: string; replaced: string[] } {
  const text = String(draft ?? '');
  const ranges = unsupportedWorkClaims(text, material)
    .map((c) => ({ at: text.indexOf(c.span), end: text.indexOf(c.span) + c.span.length, c }))
    .filter((r) => r.at >= 0)
    .sort((a, b) => a.at - b.at || b.end - a.end);
  const merged: Array<{ at: number; end: number; slot: string; width: number; spans: string[] }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.at < last.end) {
      if (r.end - r.at > last.width) { last.slot = r.c.slot; last.width = r.end - r.at; }
      last.end = Math.max(last.end, r.end);
      last.spans.push(r.c.span);
    } else merged.push({ at: r.at, end: r.end, slot: r.c.slot, width: r.end - r.at, spans: [r.c.span] });
  }
  let out = text;
  for (const m of [...merged].reverse()) out = `${out.slice(0, m.at)}${m.slot}${out.slice(m.end)}`;
  return { text: out, replaced: merged.flatMap((m) => m.spans) };
}

/** Nominate (one call) + apply (code). `material` is everything the writer was given. */
export async function groundClaims(admin: SupabaseClient, userId: string, args: { draft: string; material: string; /** 'commitments' = check ONLY availability / dated commitments / progress stated for the user (a drafted message) */ focus?: 'all' | 'commitments' }): Promise<{ text: string; replaced: string[] }> {
  const draft = String(args.draft ?? '').trim();
  if (draft.length < 80 || !String(args.material ?? '').trim()) return { text: draft, replaced: [] };
  try {
    const res = await aiCall<{ claims?: ClaimVerdict[] }>({
      userId, supabase: admin, shape: { output: 'json', reasoning: 'deep' }, temperature: 0, maxTokens: 3000, source: 'task_preparation',
      prompt:
        `You check a draft against the material its writer was given. ${EXCERPT_RULE}\n\n` +
        `THE MATERIAL (everything the writer had):\n${clipForPrompt(args.material, 12000)}\n\n` +
        `THE DRAFT:\n${clipForPrompt(draft, 8000)}\n\n` +
        (args.focus === 'commitments'
          ? `THIS IS A MESSAGE THE USER WILL SEND. Check ONLY what it commits the user to: (a) a stated AVAILABILITY — ` +
            `a day, date or time the user is free or that "works" for them; (b) a DATED PROMISE of action — "I'll send ` +
            `it by Thursday", "in the next few days", "by end of day". A promise the user ALREADY made in the thread, or ` +
            `a deadline the other side set that the reply simply accepts ("before Friday" when they asked for it before ` +
            `Friday), is SUPPORTED — and so is restating a date or fact already in the thread (confirming a delivery ` +
            `date the user gave earlier): never touch those. Nothing else is a claim here. For an unsupported DATE in a promise, quote only the ` +
            `time phrase and "remove" it (the promise stays, undated); for an unsupported availability use a slot ` +
            `(placeholder "YOUR AVAILABILITY") unless the sentence reads fine without it.\n`
          : '') +
        `ONLY CONCRETE FACTS COUNT: numbers and quantities; dates, days and time phrases; named people, companies, ` +
        `products or events; quotes; results and outcomes; a specific before-state or cause; a commitment, a ` +
        `deadline or an availability stated on the user's behalf ("I'll send it Thursday", "Tuesday works for ` +
        `me"). A general line, a rhetorical question, an opinion or a benefit phrased generally ("remote hires ` +
        `shouldn't spend week one hunting for logins") is NOT a claim — never list it, even when no material ` +
        `was given.\n` +
        `Go through the draft SENTENCE BY SENTENCE. For every concrete fact a sentence states, decide whether the material ` +
        `gives it. Facts include: time phrases ("a few weeks ago", "in month one", "last week", "four months in"); ` +
        `numbers; how things were BEFORE or WHY ("chasing documents, waiting on approvals", ` +
        `"the process had grown"); what was done or built and how it works; reactions and feelings ("that stung", ` +
        `"I wasn't expecting"); results; named events; quotes and who said them. A rewording or reordering of what ` +
        `the material says is supported, and so is a figure computed from it (a total, a difference, a ` +
        `percentage) — never list those; opinion, rhythm and a general lesson are not facts.\n` +
        `Return ONLY the facts the material does NOT give, each as:\n` +
        `- "quote": the shortest EXACT span of the draft that states it (copied character for character — a clause, ` +
        `not the whole paragraph),\n` +
        `- "supported": false,\n` +
        `- "action": "remove" when the text reads fine without it (a flourish, an added detail — then quote the whole ` +
        `sentence or clause WITH its punctuation), or "placeholder" when the piece needs the fact to make sense,\n` +
        `- "placeholder": 2-6 words NAMING what the user must supply, e.g. "THE DAY YOU CAN MEET", "WHEN THE QUOTE ` +
        `WILL BE READY", "WHAT SLOWED ONBOARDING" — never a generic word like "DETAIL" or "WHEN".\n` +
        `Prefer "remove" for flourishes, but NEVER list anything the material gives (what was used or done, a ` +
        `stated result, a quote) — the point is to cut additions, not substance. A stronger word for what the ` +
        `material says ("a dedicated admin" for "an admin") is an addition: quote the phrase and give the material's ` +
        `own words as "correction" (e.g. "an admin") — a correction beats a placeholder whenever the material says it. ` +
        `A fact that cites a source link counts as given. JSON only: ` +
        `{"claims":[{"quote":"…","supported":false,"action":"remove|placeholder","placeholder":"…","correction":"… (optional)"}]}`,
    });
    const claims = Array.isArray(res.json?.claims) ? res.json!.claims! : [];
    return applyClaimVerdicts(draft, claims, String(args.material ?? ''));
  } catch {
    return { text: draft, replaced: [] };
  }
}
