// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORK-CLAIMS NET — PURE, zero IO, zero AI (moved out of lib/prepare/claims-floor.ts in W43 so the ONE
// draft vet — lib/prepare/truth.ts `vetDraft` — can run it: truth.ts is the client-reachable leaf every
// reader and drafter imports, and claims-floor.ts carries the server-only nominate-and-apply AI pass).
// claims-floor.ts re-exports everything here, so every existing importer keeps its import.
// ════════════════════════════════════════════════════════════════════════════════════════════════
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
  // W43 · the French "getting on it" forms (eval: "Je m'y mets cette semaine" stated a start and a day nobody gave).
  /(?<![\p{L}])((?:je|nous) (?:m['’]y|nous y) (?:mets|mettons|attelle|attelons|suis|sommes)|(?:i['’]m|we['’]re) (?:on it|getting on it|getting started))(?![\p{L}])/iu,
];
/** deed: what the user has already done. */
const DEED: RegExp[] = [
  new RegExp(String.raw`\b(?:I|we)\s*(?:have|'ve|’ve)\s+(?:already\s+|just\s+)?(sent|chased|contacted|asked|spoken (?:to|with)|reached out(?: to)?|followed up(?: with)?|signed|approved|booked|scheduled|submitted|confirmed(?: with)?|escalated)\b`, 'iu'),
  /(?<![\p{L}])((?:ich habe|wir haben) (?:bereits |schon )?(?:nachgefragt|nachgehakt|geschickt|gesendet|freigegeben|gebucht|bestätigt)|(?:j'ai|j’ai|nous avons) (?:déjà )?(?:relancé|envoyé|validé|réservé|confirmé)|(?:já )?(?:enviei|enviámos|enviamos|confirmei|reservei|aprovei)|(?:ya )?(?:he|hemos) (?:enviado|confirmado|reservado|aprobado|contactado))(?![\p{L}])/iu,
  // W43 · INVENTED PROGRESS (owner walk, Oct 2 — a French follow-up on an open "identify the tasks to
  // automate" obligation read "j'ai identifié quelques tâches…" with nothing on record): the perfect of the
  // WORK verbs — found, analysed, listed, started — is a deed claim like "sent". Narrow on purpose (the floor
  // doctrine): first person, perfect tense, no "prepared/drafted" (a draft may truthfully carry its own text).
  new RegExp(String.raw`\b(?:I|we)\s*(?:have|'ve|’ve)\s+(?:already\s+|just\s+|now\s+)?(identified|analy[sz]ed|listed|mapped(?: out)?|started(?: on)?|begun|made (?:some |good )?progress(?: on)?|looked into|gone through|narrowed (?:it )?down)\b`, 'iu'),
  /(?<![\p{L}])((?:ich habe|wir haben) (?:bereits |schon )?(?:\S+ ){0,3}?(?:identifiziert|analysiert|begonnen|angefangen|zusammengestellt|herausgearbeitet)|(?:j'ai|j’ai|nous avons) (?:déjà )?(?:identifié|analysé|listé|commencé|avancé sur|repéré|cerné|étudié)|(?:já )?(?:identifiquei|identificámos|identificamos|analisei|comecei|listei|mapeei)|(?:ya )?(?:he|hemos) (?:identificado|analizado|empezado|comenzado|listado))(?![\p{L}])/iu,
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
  // W43 · one slot per thing: adjacent identical slots (two spans of one claim) collapse into one.
  out = out.replace(/(\[[^\]\n]+\])(\s*(?:,|or|and|et|ou|\/)?\s*\1)+/gi, '$1');
  return { text: out, replaced: merged.flatMap((m) => m.spans) };
}
