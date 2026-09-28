/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — TIME TRUTH IN CACHED PROSE (stabilization W18.D · tier-1 #14 `time-truth`; owner walk
 * Sep 26).
 *
 * ZERO-AI, ZERO-DB, deterministic. The item page's one opening sentence is composed once and served
 * from cache for days: "<Contact> asked you nine days ago …" about an Aug 10 ask read on Sep 26, and
 * "<Vendor> sent an invoice yesterday." two days after composition.
 *   A · OUTCOME — stored sentences (EN + PT, plus DE/FR spot checks) served N days later come out
 *       TRUE (every relative word replaced by its date, the date right) or WITHHELD — never false;
 *       served the same day they stand byte-identical.
 *   B · OUTCOME — THE ONE READ of a stored brief (lib/room/brief readRoomResponse, over a fake store)
 *       serves the rewritten sentence, withholds a vague one, and keeps a same-day one.
 *   C · SOURCE — every composer of cached prose carries ABSOLUTE_DATES_RULE in its prompt, the
 *       compose-time belt (absolutizeTimeWords), and a bumped prompt version.
 *   D · SOURCE — every serve path of a cached sentence passes the floor (the room brief's one read and
 *       every door that serves it; the Home briefing + brief line; the item anchor's ask).
 * Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-time-words.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  serveTimeWords, absolutizeTimeWords, hasRelativeTime, findRelativeTime, addDays, localDayOf, ABSOLUTE_DATES_RULE,
} from '../lib/core/relative-time';
import { readRoomResponse, ROOM_BRIEF_VERSION } from '../lib/room/brief';
import { serveBriefingTime, BRIEFING_PROMPT_VERSION, type Briefing } from '../lib/briefing/compose';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const TZ = 'Europe/Lisbon';
const noonUtc = (day: string) => new Date(`${day}T11:00:00Z`);

// ═══ A · STORED SENTENCES SERVED N DAYS LATER ═══
console.log('\nA · a stored sentence served N days later is true or withheld — never false');
{
  // Each fixture: the sentence as composed on `composed`, and the DAY its relative words denote
  // (null = vague: it must be withheld on any later day). `words` = the absolute date's rendering.
  type Fx = { text: string; composed: string; denotes: string | null; words?: string };
  const FX: Fx[] = [
    // The owner's two walk finds, generic-faked.
    { text: 'Sam asked you nine days ago to fix the label in the second tab.', composed: '2026-08-19', denotes: '2026-08-10', words: 'Aug 10' },
    { text: 'Acme Airports sent an invoice yesterday.', composed: '2026-09-25', denotes: '2026-09-24', words: 'Sep 24' },
    { text: 'Yesterday Sam confirmed the room.', composed: '2026-09-22', denotes: '2026-09-21', words: 'Sep 21' },
    { text: 'The draft goes to Sam tomorrow.', composed: '2026-09-20', denotes: '2026-09-21', words: 'Sep 21' },
    { text: 'Sam replied this morning; nothing is owed.', composed: '2026-09-23', denotes: '2026-09-23', words: 'Sep 23' },
    { text: 'Sam has waited since the day before yesterday.', composed: '2026-09-10', denotes: '2026-09-08', words: 'Sep 8' },
    // Portuguese — the product's second language.
    { text: 'A Acme enviou uma fatura ontem.', composed: '2026-09-25', denotes: '2026-09-24', words: '24 de setembro' },
    { text: 'O Sam pediu há nove dias para corrigir o rótulo.', composed: '2026-08-19', denotes: '2026-08-10', words: '10 de agosto' },
    { text: 'O Sam pediu há 3 dias a proposta.', composed: '2026-09-20', denotes: '2026-09-17', words: '17 de setembro' },
    { text: 'Hoje a Acme confirmou a reunião.', composed: '2026-09-15', denotes: '2026-09-15', words: '15 de setembro' },
    { text: 'O Sam envia o contrato amanhã.', composed: '2026-09-15', denotes: '2026-09-16', words: '16 de setembro' },
    { text: 'A Acme respondeu anteontem.', composed: '2026-09-15', denotes: '2026-09-13', words: '13 de setembro' },
    // German + French spot checks.
    { text: 'Acme hat gestern die Rechnung geschickt.', composed: '2026-09-25', denotes: '2026-09-24', words: '24. September' },
    { text: 'Acme a envoyé la facture hier et vous devez la payer.', composed: '2026-09-25', denotes: '2026-09-24', words: '24 septembre' },
    // Vague — no single date: withheld on any later day.
    { text: 'Sam replied last week about the report.', composed: '2026-09-20', denotes: null },
    { text: 'Sam wrote a few days ago.', composed: '2026-09-20', denotes: null },
    { text: 'Sam wrote on Thursday about the invoice.', composed: '2026-09-20', denotes: null },
    { text: 'A Acme respondeu na semana passada.', composed: '2026-09-20', denotes: null },
    { text: 'O Sam escreveu há alguns dias.', composed: '2026-09-20', denotes: null },
    { text: 'A Acme volta a escrever na próxima semana.', composed: '2026-09-20', denotes: null },
  ];
  let sweepOk = true; const bad: string[] = [];
  for (const f of FX) {
    for (let n = 1; n <= 40; n++) {
      const v = serveTimeWords(f.text, { composedAt: noonUtc(f.composed).toISOString(), now: noonUtc(addDays(f.composed, n)), tz: TZ });
      if (v.withheld) { if (f.denotes) { sweepOk = false; bad.push(`${f.text} +${n}: withheld an exact word`); } continue; }
      if (!f.denotes) { sweepOk = false; bad.push(`${f.text} +${n}: served a vague word`); continue; }
      if (hasRelativeTime(v.text)) { sweepOk = false; bad.push(`${f.text} +${n}: still relative → ${v.text}`); continue; }
      if (!v.text.includes(f.words!)) { sweepOk = false; bad.push(`${f.text} +${n}: wrong date → ${v.text}`); }
    }
  }
  gate(`A1 ${FX.length} stored sentences × 40 later days: every serve is TRUE (the right date, no relative word left) or WITHHELD (vague)`, sweepOk, bad.slice(0, 3).join(' | '));
  const sameDay = FX.every((f) => serveTimeWords(f.text, { composedAt: noonUtc(f.composed).toISOString(), now: new Date(`${f.composed}T20:00:00Z`), tz: TZ }).text === f.text);
  gate('A2 served the SAME local day they were composed, every fixture stands byte-identical (its words are true)', sameDay);
  const walk1 = serveTimeWords('Sam asked you nine days ago to fix the label.', { composedAt: '2026-08-19T09:00:00Z', now: new Date('2026-09-26T10:00:00Z'), tz: TZ });
  const walk2 = serveTimeWords('Acme Airports sent an invoice yesterday.', { composedAt: '2026-09-25T09:00:00Z', now: new Date('2026-09-26T10:00:00Z'), tz: TZ });
  gate('A3 the owner\'s walk sentences read true on Sep 26 ("on Aug 10" · "on Sep 24")',
    walk1.text === 'Sam asked you on Aug 10 to fix the label.' && walk2.text === 'Acme Airports sent an invoice on Sep 24.', `${walk1.text} | ${walk2.text}`);
  const noAnchor = serveTimeWords('Sam asked yesterday.', { composedAt: null, now: new Date('2026-09-26T10:00:00Z'), tz: TZ });
  gate('A4 an unknown composition time cannot prove a relative word true → withheld', noAnchor.withheld);
  const plain = 'Sam asked on Aug 10 to fix the label; nothing is drafted yet.';
  gate('A5 prose with no relative word is byte-identical at any age (the floor removes only what it can disprove)',
    serveTimeWords(plain, { composedAt: '2026-08-10T09:00:00Z', now: new Date('2026-09-26T10:00:00Z'), tz: TZ }).text === plain);
  gate('A6 a weekday beside its absolute date is a label; German "hier"/"Guten Morgen" are not time words',
    !hasRelativeTime('Sam wrote on Thursday, Sep 24.') && !hasRelativeTime('A reunião é na quinta-feira, 24 de setembro.')
    && !hasRelativeTime('Die Rechnung ist hier.') && !hasRelativeTime('Guten Morgen, Sam hat geschrieben.'));
  gate('A7 the local day decides (23:30 UTC Sep 25 is Sep 26 in Lisbon)', localDayOf('2026-09-25T23:30:00Z', TZ) === '2026-09-26');
  const belt = absolutizeTimeWords('Acme sent it yesterday; Sam replies today; last week was quiet.', { now: new Date('2026-09-26T10:00:00Z'), tz: TZ });
  gate('A8 the compose-time belt stores exact words as dates and leaves vague ones for the serve floor',
    belt.text === 'Acme sent it on Sep 25; Sam replies on Sep 26; last week was quiet.'
    && findRelativeTime(belt.text).every((s) => s.offset === 'vague'), belt.text);
}

// ═══ B · THE ONE READ OF A STORED BRIEF ═══
console.log('\nB · readRoomResponse (the one read every door serves a stored brief through) passes the floor');
// A fake store: item_plans returns the stored brief; calendar_events gives the user's zone.
function fakeClient(tasks: Record<string, unknown>) {
  const rows: Record<string, unknown> = {
    item_plans: { id: 'p1', entity_id: 'inbox:x', tasks, created_at: null, updated_at: null },
    calendar_events: [{ timezone: TZ }],
  };
  return {
    from(table: string) {
      const data = rows[table] ?? null;
      const b: Record<string, unknown> = {};
      const self = () => b;
      for (const m of ['select', 'eq', 'not', 'in', 'order', 'limit', 'is']) b[m] = self;
      b.maybeSingle = async () => ({ data, error: null });
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res);
      return b;
    },
  } as never;
}
(async () => {
  const today = new Date();
  const yest = new Date(today.getTime() - 86_400_000 * 2).toISOString();
  const base = { v: ROOM_BRIEF_VERSION, sig: 's', move: null, offers: [] };
  const r1 = await readRoomResponse(fakeClient({ ...base, text: 'Acme sent an invoice yesterday.', at: yest }), 'u-time-1', 'inbox:x');
  const expectDay = new Date(Date.parse(`${localDayOf(yest, TZ)}T12:00:00Z`) - 86_400_000);
  const expectWords = expectDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  gate('B1 a stored "yesterday" two days old is served as its date', r1?.text === `Acme sent an invoice on ${expectWords}.`, String(r1?.text));
  const r2 = await readRoomResponse(fakeClient({ ...base, text: 'Sam replied last week about the report.', at: yest }), 'u-time-2', 'inbox:x');
  gate('B2 a stored vague expression past its day is WITHHELD (null → the door\'s fallback + the appended recompose)', r2 === null);
  const r3 = await readRoomResponse(fakeClient({ ...base, text: 'Sam replied this morning.', at: today.toISOString() }), 'u-time-3', 'inbox:x');
  gate('B3 a same-day brief stands byte-identical', r3?.text === 'Sam replied this morning.', String(r3?.text));
  const r4 = await readRoomResponse(fakeClient({ ...base, text: 'Sam asked yesterday.' }), 'u-time-4', 'inbox:x');
  gate('B4 a pre-timestamp brief (no `at`) with a relative word is withheld', r4 === null);
  // The Home briefing: segments floor against composedAt; a withheld spine withholds the briefing.
  const mk = (lead: string, action: string, pulse: string | null): Briefing => ({
    daySig: 'd', composedAt: '2026-09-25T09:00:00Z', lead: { text: lead, sig: 'a' }, action: { text: action, sig: 'b' },
    watchlist: null, pulse: pulse ? { text: pulse, sig: 'c' } : null, refs: [], tail: [],
  });
  const now = new Date('2026-09-26T10:00:00Z');
  const b1 = serveBriefingTime(mk('Your day is quiet today.', 'Start with {A1}.', 'Things moved last week.'), { tz: TZ, now });
  gate('B5 the Home briefing: an exact word in a segment is rewritten; a vague optional segment is dropped',
    b1?.lead.text === 'Your day is quiet on Sep 25.' && b1?.pulse === null && b1?.action.text === 'Start with {A1}.', JSON.stringify(b1));
  gate('B6 the Home briefing: a vague word in the lead/action withholds the whole briefing',
    serveBriefingTime(mk('Sam wrote a few days ago.', 'Start with {A1}.', null), { tz: TZ, now }) === null);

  // ═══ C · THE COMPOSERS CARRY THE RULE ═══
  console.log('\nC · every composer of cached prose carries the absolute-date rule and the belt');
  const brief = src('lib/room/brief.ts');
  const bcomp = src('lib/briefing/compose.ts');
  gate('C1 the rule is one copy in the client-safe leaf, naming the relative words in EN and PT (+DE/FR)',
    /WRITE DATES, NEVER DELTAS/.test(ABSOLUTE_DATES_RULE) && /yesterday/.test(ABSOLUTE_DATES_RULE) && /ontem/.test(ABSOLUTE_DATES_RULE)
    && /há N dias/.test(ABSOLUTE_DATES_RULE) && /gestern/.test(ABSOLUTE_DATES_RULE) && /hier/.test(ABSOLUTE_DATES_RULE));
  gate('C2 the room brief composer\'s prompt carries ABSOLUTE_DATES_RULE and the user\'s LOCAL day (not the server\'s UTC day)',
    /`- \$\{ABSOLUTE_DATES_RULE\}\\n` \+/.test(brief) && /const day = localNow\(tz\)\.pretty;/.test(brief) && /Today is \$\{day\}/.test(brief));
  gate('C3 the room brief composer stores exact words as dates (absolutizeTimeWords after the W12.1 net, before the store)',
    /const abs = absolutizeTimeWords\(verified, \{ tz \}\);/.test(brief)
    && brief.indexOf('absolutizeTimeWords(verified') < brief.indexOf("await upsertPlan(client, userId, 'room_brief'"));
  gate('C4 the Home briefing composer carries the rule and the belt', /`- \$\{ABSOLUTE_DATES_RULE\}`/.test(bcomp) && /absolutizeTimeWords\(/.test(bcomp));
  gate('C5 both prompt versions bumped (THE RULE: a prompt change re-authors every cached composition once)',
    ROOM_BRIEF_VERSION >= 20 && BRIEFING_PROMPT_VERSION >= 9);
  gate('C6 the brief sig keys on the USER\'S local day (a floor-withheld brief recomposes at the user\'s midnight)',
    (brief.match(/localDayOf\(new Date\(\), await userTimezone\(client, userId\)/g) ?? []).length === 2
    && /function sigOf\(g: RoomGrounding, extra = '', localDay: string \| null = null\)/.test(brief));

  // ═══ D · EVERY SERVE PATH PASSES THE FLOOR ═══
  console.log('\nD · every serve path of a cached sentence passes the floor');
  gate('D1 readRoomResponse floors the stored text against its own `at` in the user\'s zone before returning it',
    /const time = serveTimeWords\(t\.text, \{ composedAt: typeof t\.at === 'string' \? t\.at : null, tz \}\);/.test(brief)
    && /if \(time\.withheld\) \{/.test(brief) && /text: time\.text, move: t\.move/.test(brief));
  // THE ONE READ: nothing outside lib/room/brief.ts reads the room_brief store directly.
  const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    if (/node_modules|\.next/.test(p)) return [];
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
  const direct = ['app', 'lib', 'components'].flatMap(walk)
    .filter((p) => p !== join('lib', 'room', 'brief.ts') && p !== join('lib', 'store', 'item-plans.ts'))
    .filter((p) => /readPlans?\([^)]*'room_brief'/.test(src(p)));
  gate('D2 no door reads the room_brief store around the floor (THE ONE READ is readRoomResponse)', direct.length === 0, direct.join(', '));
  const view = src('app/api/items/view/route.ts');
  const ent = src('app/api/entities/[id]/room/route.ts');
  const rv = src('lib/entities/room-view.ts');
  gate('D3 the item door, the entity room door and the rail\'s room view all serve the brief through readRoomResponse',
    /readRoomResponse\(supabase, user\.id, looseKey/.test(view) && /readRoomResponse\(supabase, uid, id/.test(ent) && /readRoomResponse\(supabase, userId, entityId\)/.test(rv));
  gate('D4 the item door\'s late brief is the same door (a withheld brief is pending → the one re-check appends the recompose)',
    /const briefPending = !r \|\| !!r\.staleVersion \|\| serve\.withheld \|\| tripDue;/.test(view));
  const home = src('app/api/home/brief/route.ts');
  gate('D5 the Home briefing is served through serveBriefingTime and the brief line through serveTimeWords (never the raw cache)',
    /const servedBriefing = serveBriefingTime\(cachedBriefing, \{ tz: userTz, now \}\);/.test(home)
    && /briefing: servedBriefing,/.test(home) && !/briefing: cachedBriefing,/.test(home)
    && /serveTimeWords\(briefLine, \{ composedAt: cached\?\.generated_at/.test(home));
  const anchor = src('lib/room/item-anchor.ts');
  gate('D6 the item anchor\'s stored ask (the fallback sentence + the composer read it) passes THE SERVE GUARD (deixis)',
    /if \(anchor\.ask\) anchor\.ask = stripDeixis\(anchor\.ask\) \|\| null;/.test(anchor));
  const leaf = src('lib/core/relative-time.ts');
  gate('D7 the floor is a pure client-safe leaf (imports nothing)', !/^import /m.test(leaf));

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
