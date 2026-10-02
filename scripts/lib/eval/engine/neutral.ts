// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — THE ONE NEUTRAL RENDERER. Every plain column (same-model · Sonnet 5.5 · GPT-5.6) sees a case
// through THIS function and nothing else: the RAW records of the fixture world — the way a user would
// paste them into a chat window (mail-client blocks, the calendar, the files they have) — and NEVER
// AUGMTD's derived state (understanding, verdicts, entity state, person brain, prepared pool).
// Deterministic, pure, no DB: the same world + clock renders the same text for every column.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { resolveWorld, localDate, localClock, type World, type ResolvedParty, type ResolvedWorld } from './world';

export type RenderScope = {
  /** Only these thread keys (default all). */
  threads?: string[];
  /** Drop messages after this message key within its thread (e.g. "what did you know at the time"). */
  upTo?: string;
  commitments?: boolean;
  calendar?: boolean;
  files?: boolean;
  voice?: boolean;
  projects?: boolean;
};

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue, 29 Sep 2026 09:30" in the world zone — the mail-client date line. */
export function mailDate(d: Date, tz: string): string {
  const ds = localDate(d, tz);
  const [y, m, day] = ds.split('-').map(Number);
  const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  return `${wd}, ${day} ${MONTH[m - 1]} ${y} ${localClock(d, tz)}`;
}

/** "Tuesday 29 September 2026" — the TODAY line. */
export function longDate(d: Date, tz: string): string {
  const ds = localDate(d, tz);
  const [y, m, day] = ds.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const mn = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `${wd} ${day} ${mn} ${y}`;
}

const who = (p: ResolvedParty) => (p.me ? `me <${p.email}>` : `${p.name}${p.org ? ` (${p.org})` : ''} <${p.email}>`);

/** Render a world for the plain columns. */
export function renderWorld(world: World, now: Date, scope: RenderScope = {}): string {
  const rw = resolveWorld(world, now);
  return renderResolved(rw, scope);
}

export function renderResolved(rw: ResolvedWorld, scope: RenderScope = {}): string {
  const L: string[] = [];
  L.push(`TODAY: ${longDate(rw.now, rw.tz)}, ${localClock(rw.now, rw.tz)} (time zone ${rw.tz})`);
  L.push(`ME: ${rw.me.name} <${rw.me.email}>`);
  const threads = rw.threads.filter((t) => !scope.threads || scope.threads.includes(t.key));
  if (threads.length) {
    L.push('', 'EMAILS (each thread oldest first)');
    for (const t of threads) {
      L.push('', `=== Thread: ${t.subject} ===`);
      let stop = false;
      for (const m of t.messages) {
        if (stop) break;
        L.push('', `From: ${who(m.from)}`, `To: ${m.to.map(who).join(', ') || '(none)'}`);
        if (m.cc.length) L.push(`Cc: ${m.cc.map(who).join(', ')}`);
        L.push(`Date: ${mailDate(m.at, rw.tz)}`, `Subject: ${m.subject}`);
        if (m.attachments.length) L.push(`Attachments: ${m.attachments.join(', ')}`);
        L.push('', m.body.trim());
        if (scope.upTo && m.key === scope.upTo) stop = true;
      }
      if (t.preparedInvite) {
        const pi = t.preparedInvite;
        L.push('', `[A calendar invite I have prepared on this thread but NOT sent yet: "${pi.title}" · ${mailDate(pi.start, rw.tz)}–${localClock(pi.end, rw.tz)} · to ${pi.attendees.map(who).join(', ')}]`);
      }
    }
  }
  if (scope.commitments !== false && rw.commitments.length) {
    L.push('', 'COMMITMENTS ON MY LIST (as recorded)');
    for (const c of rw.commitments) {
      const cp = c.counterparty ? ('free' in c.counterparty ? c.counterparty.name : who(c.counterparty as ResolvedParty)) : 'someone';
      const dir = c.direction === 'you_owe' ? `I owe ${cp}` : `${cp} owes me`;
      // W42 · the row's state and the user's deeds on it (a settled task, a task done then restored).
      const deeds = (c.history ?? []).map((h) => `${h.action === 'done' ? 'marked done' : 'restored (reopened)'} ${localDate(h.at, rw.tz)}`);
      const state = c.status === 'done' ? ' [DONE]' : deeds.length ? ' [OPEN]' : '';
      L.push(`- ${dir}: ${c.description}${c.due ? ` — due ${c.due}` : ''} (noted ${localDate(c.createdAt, rw.tz)})${state}${deeds.length ? ` — history: ${deeds.join(', then ')}` : ''}`);
    }
  }
  if (scope.calendar !== false && rw.events.length) {
    L.push('', 'MY CALENDAR');
    for (const e of [...rw.events].sort((a, b) => a.start.getTime() - b.start.getTime())) {
      L.push(`- ${e.title} · ${mailDate(e.start, rw.tz)}–${localClock(e.end, rw.tz)}${e.attendees.length ? ` · with ${e.attendees.map(who).join(', ')}` : ''}${e.location ? ` · ${e.location}` : ''}`);
      if (e.description) L.push(`  ${e.description.trim()}`);
    }
  }
  if (scope.projects !== false && rw.projects.length) {
    L.push('', 'MY PROJECTS');
    for (const p of rw.projects) L.push(`- ${p.name}${p.summary ? `: ${p.summary}` : ''}${p.goals?.length ? ` (goals: ${p.goals.join('; ')})` : ''}`);
  }
  if (scope.files !== false && rw.kb.length) {
    L.push('', 'FILES I HAVE');
    for (const d of rw.kb) L.push('', `--- file: ${d.filename} ---`, d.text.trim());
  }
  if (scope.voice !== false && rw.voiceSamples.length) {
    L.push('', 'EMAILS I WROTE RECENTLY (how I write)');
    rw.voiceSamples.forEach((v, i) => L.push('', `--- sent ${i + 1} ---`, v.trim()));
  }
  return L.join('\n');
}

/** The neutral answer schema for labelled surfaces: field names + one-line glosses, no product rules. */
export function answerSchema(fields: Array<{ name: string; labels?: Record<string, string>; gloss?: string }>): string {
  const L = ['Answer with ONLY a JSON object with these fields:'];
  for (const f of fields) {
    if (f.labels) {
      L.push(`- "${f.name}": one of ${Object.keys(f.labels).map((k) => `"${k}"`).join(', ')}`);
      for (const [k, g] of Object.entries(f.labels)) L.push(`    · "${k}" = ${g}`);
    } else if (f.gloss) L.push(`- "${f.name}": ${f.gloss}`);
  }
  return L.join('\n');
}
