// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — THE PROBE SWEEP. Finds (dry run) and deletes (--apply) every row the engine's fixture worlds
// left on a probe host — a run killed mid-case, a crashed teardown — identified by the engine's OWN
// seeding markers, never by "everything the probe owns" (the standard probe also carries the standing
// state other suites and the Home-chat packs read: its own KB folders, a project, chat plans).
//
// The markers (world.ts seedWorld): emails message_id `<eval-w26…>` / thread_id `eval-w26…` (+ metadata
// eval_run) · inbox_items source_id `eval-w26…` (+ source_data.eval_run) · commitments source_id
// `eval:w26…` or thread_id `eval-w26…` (+ any minted from a swept mail/item) · calendar_events event_id
// `eval-w26…` · knowledge_sources folder `Eval fixtures w26…` · knowledge_files provider_file_id
// `eval-w26…` (+ their chunks) · entity_links reason 'eval fixture' or naming a swept id. Rows with no
// column to carry a tag are identified by the fixtures themselves: work_entities whose name is a
// fixture person/project name (only when linked to nothing outside the sweep) and person_state keyed
// by a fixture address. Derived rows keyed to a swept id (item_plans, item_deliverables, room_turns)
// go with them. REFUSES any user that is not a probe host, and never runs while a world is alive.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertProbeHost, liveWorldCount } from './world';
import type { AnyAdapter, EvalCase } from './types';

export const SWEEP_TABLES = [
  'knowledge_chunks', 'knowledge_files', 'knowledge_sources', 'item_plans', 'item_deliverables', 'room_turns', 'entity_links',
  'calendar_events', 'inbox_items', 'commitments', 'emails', 'work_entities', 'person_state',
] as const;
export type SweepTable = typeof SWEEP_TABLES[number];

export type SweepReport = {
  userId: string;
  host: 'standard' | 'eu';
  applied: boolean;
  /** Run tags found on leftover rows (one per interrupted world). */
  tags: string[];
  /** Rows found (dry run) or deleted (apply), per table. */
  counts: Record<SweepTable, number>;
  total: number;
  /** Fixture-named entities left alone because something outside the sweep links to them. */
  kept: string[];
  errors: string[];
};

/** The names + addresses every authored fixture world declares (the marker for untaggable rows). */
export function fixtureIdentity(adapters: AnyAdapter[]): { names: string[]; emails: string[] } {
  const names = new Set<string>(), emails = new Set<string>();
  for (const a of adapters) for (const c of a.cases() as EvalCase[]) {
    for (const p of c.world?.people ?? []) { if (p.name) names.add(p.name.toLowerCase()); if (p.email) emails.add(p.email.toLowerCase()); }
    for (const p of c.world?.projects ?? []) if (p.name) names.add(p.name.toLowerCase());
  }
  return { names: [...names].sort(), emails: [...emails].sort() };
}

type Sb = SupabaseClient;
type Row = Record<string, unknown>;

/** Every row a filter matches, paged (no silent 1000-row cap), errors thrown. */
async function readAll(sb: Sb, table: string, cols: string, filter: (q: ReturnType<ReturnType<Sb['from']>['select']>) => unknown): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const q = filter(sb.from(table).select(cols)) as { order: (c: string) => { range: (a: number, b: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }> } };
    const { data, error } = await q.order(table === 'entity_links' ? 'item_id' : table === 'person_state' ? 'person_key' : 'id').range(from, from + 999);
    if (error) throw new Error(`sweep read ${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const chunks = <T>(xs: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o; };
const escLike = (s: string) => s.replace(/[%_\\]/g, (m) => `\\${m}`);

export async function sweepProbe(sb: Sb, userId: string, opts: { apply: boolean; fixture: { names: string[]; emails: string[] } }): Promise<SweepReport> {
  const host = await assertProbeHost(sb as never, userId);
  if (opts.apply && liveWorldCount(userId) > 0) throw new Error(`sweep: REFUSED — ${liveWorldCount(userId)} seeded row(s) of a live world on ${userId.slice(0, 8)} (sweep only between runs)`);
  const uid = userId;
  const errors: string[] = [];
  const tags = new Set<string>();
  const tagOf = (s: unknown) => { const m = /(w26[a-z0-9]+)/.exec(String(s ?? '')); if (m) tags.add(m[1].replace(/-.*$/, '')); };
  const ids = (rows: Row[], k = 'id') => rows.map((r) => String(r[k]));
  const uniqRows = (rows: Row[], k = 'id') => { const seen = new Set<string>(); return rows.filter((r) => { const v = String(r[k]); if (seen.has(v)) return false; seen.add(v); return true; }); };

  // 1 · tagged rows.
  const emails = uniqRows([
    ...await readAll(sb, 'emails', 'id, message_id, thread_id', (q) => q.eq('user_id', uid).like('message_id', '<eval-w26%')),
    ...await readAll(sb, 'emails', 'id, message_id, thread_id', (q) => q.eq('user_id', uid).like('thread_id', 'eval-w26%')),
  ]);
  emails.forEach((r) => tagOf(r.message_id));
  const items = await readAll(sb, 'inbox_items', 'id, source_id', (q) => q.eq('user_id', uid).like('source_id', 'eval-w26%'));
  items.forEach((r) => tagOf(r.source_id));
  const events = await readAll(sb, 'calendar_events', 'id, event_id', (q) => q.eq('user_id', uid).like('event_id', 'eval-w26%'));
  events.forEach((r) => tagOf(r.event_id));
  const sources = await readAll(sb, 'knowledge_sources', 'id, folder_name', (q) => q.eq('user_id', uid).like('folder_name', 'Eval fixtures w26%'));
  sources.forEach((r) => tagOf(r.folder_name));
  let files = await readAll(sb, 'knowledge_files', 'id, provider_file_id', (q) => q.eq('user_id', uid).like('provider_file_id', 'eval-w26%'));
  for (const ch of chunks(ids(sources), 50)) files.push(...await readAll(sb, 'knowledge_files', 'id, provider_file_id', (q) => q.eq('user_id', uid).in('source_id', ch)));
  files = uniqRows(files);
  files.forEach((r) => tagOf(r.provider_file_id));
  const kchunks: Row[] = [];
  for (const ch of chunks(ids(files), 50)) kchunks.push(...await readAll(sb, 'knowledge_chunks', 'id', (q) => q.eq('user_id', uid).in('file_id', ch)));
  const commitRows: Row[] = [
    ...await readAll(sb, 'commitments', 'id, source_id', (q) => q.eq('user_id', uid).like('source_id', 'eval:w26%')),
    ...await readAll(sb, 'commitments', 'id, source_id', (q) => q.eq('user_id', uid).like('thread_id', 'eval-w26%')),
  ];
  for (const ch of chunks([...ids(emails), ...ids(items)], 50)) commitRows.push(...await readAll(sb, 'commitments', 'id, source_id', (q) => q.eq('user_id', uid).in('source_id', ch)));
  const commits = uniqRows(commitRows);
  commits.forEach((r) => tagOf(r.source_id));

  const itemKeys = new Set<string>([...ids(emails), ...ids(items), ...ids(commits), ...ids(events), ...emails.map((r) => String(r.thread_id ?? '')).filter((x) => x.startsWith('eval-w26'))]);

  // 2 · links + entities (fixture links, links to swept items, fixture-named entities).
  const linkRows: Row[] = [...await readAll(sb, 'entity_links', 'entity_id, item_id, item_kind, reason', (q) => q.eq('user_id', uid).eq('reason', 'eval fixture'))];
  for (const ch of chunks([...itemKeys], 50)) linkRows.push(...await readAll(sb, 'entity_links', 'entity_id, item_id, item_kind, reason', (q) => q.eq('user_id', uid).in('item_id', ch)));
  const links = uniqRows(linkRows.map((r) => ({ ...r, _k: `${r.item_kind}|${r.item_id}` })), '_k');
  const entityIds = new Set<string>(links.filter((l) => l.reason === 'eval fixture').map((l) => String(l.entity_id)));
  // Probe hosts are small: read the host's entities once and match the fixture names here.
  const names = new Set(opts.fixture.names.map((n) => n.toLowerCase()));
  const fixtureNamed = (await readAll(sb, 'work_entities', 'id, name', (q) => q.eq('user_id', uid))).filter((e) => names.has(String(e.name ?? '').toLowerCase()));
  for (const e of fixtureNamed) entityIds.add(String(e.id));
  // An entity stays when anything outside the sweep links to it (a real/standing item).
  const kept: string[] = [];
  const entityLinks: Row[] = [];
  for (const ch of chunks([...entityIds], 50)) entityLinks.push(...await readAll(sb, 'entity_links', 'entity_id, item_id, item_kind, reason', (q) => q.eq('user_id', uid).in('entity_id', ch)));
  for (const l of entityLinks) {
    if (l.reason === 'eval fixture' || itemKeys.has(String(l.item_id))) continue;
    if (entityIds.delete(String(l.entity_id))) {
      const e = fixtureNamed.find((x) => x.id === l.entity_id);
      kept.push(`${String(l.entity_id).slice(0, 8)}${e ? ` "${e.name}"` : ''} (linked to ${l.item_kind} ${String(l.item_id).slice(0, 8)})`);
    }
  }
  const allLinks = uniqRows([...links, ...entityLinks.filter((l) => entityIds.has(String(l.entity_id))).map((r) => ({ ...r, _k: `${r.item_kind}|${r.item_id}` }))], '_k');

  // 3 · derived rows keyed to any swept id (plans, deliverables, room turns) + fixture person_state.
  const keyed = [...itemKeys, ...entityIds];
  const plans: Row[] = [], deliverables: Row[] = [], turns: Row[] = [];
  for (const k of keyed) {
    plans.push(...await readAll(sb, 'item_plans', 'entity_id, kind', (q) => q.eq('user_id', uid).like('entity_id', `%${escLike(k)}%`)));
    deliverables.push(...await readAll(sb, 'item_deliverables', 'id, entity_id', (q) => q.eq('user_id', uid).like('entity_id', `%${escLike(k)}%`)));
    turns.push(...await readAll(sb, 'room_turns', 'id, room_key', (q) => q.eq('user_id', uid).like('room_key', `%${escLike(k)}%`)));
  }
  const emailsLc = opts.fixture.emails.map((m) => m.toLowerCase());
  const persons = (await readAll(sb, 'person_state', 'person_key', (q) => q.eq('user_id', uid)))
    .filter((r) => { const k = String(r.person_key ?? '').toLowerCase(); return emailsLc.some((m) => k.includes(m)); });

  const found: Record<SweepTable, Row[]> = {
    knowledge_chunks: kchunks, knowledge_files: files, knowledge_sources: sources,
    item_plans: uniqRows(plans.map((r) => ({ ...r, _k: `${r.kind}|${r.entity_id}` })), '_k'),
    item_deliverables: uniqRows(deliverables), room_turns: uniqRows(turns), entity_links: allLinks,
    calendar_events: events, inbox_items: items, commitments: commits, emails,
    work_entities: [...entityIds].map((id) => ({ id })), person_state: uniqRows(persons, 'person_key'),
  };
  const counts = Object.fromEntries(SWEEP_TABLES.map((t) => [t, found[t].length])) as Record<SweepTable, number>;
  const report: SweepReport = { userId: uid, host, applied: opts.apply, tags: [...tags].sort(), counts, total: Object.values(counts).reduce((a, b) => a + b, 0), kept, errors };
  if (!opts.apply || report.total === 0) return report;

  // 4 · delete, children first; every delete scoped to the probe user; counts are what was deleted.
  const deleted = Object.fromEntries(SWEEP_TABLES.map((t) => [t, 0])) as Record<SweepTable, number>;
  const del = async (t: SweepTable, q: PromiseLike<{ error: { message: string } | null; count?: number | null }>) => {
    const r = await q;
    if (r.error) errors.push(`${t}: ${r.error.message}`); else deleted[t] += r.count ?? 0;
  };
  const byId = async (t: SweepTable, idList: string[]) => { for (const ch of chunks(idList, 50)) await del(t, sb.from(t).delete({ count: 'exact' }).eq('user_id', uid).in('id', ch)); };
  await byId('knowledge_chunks', ids(kchunks));
  await byId('knowledge_files', ids(files));
  await byId('knowledge_sources', ids(sources));
  for (const p of found.item_plans) await del('item_plans', sb.from('item_plans').delete({ count: 'exact' }).eq('user_id', uid).eq('kind', String(p.kind)).eq('entity_id', String(p.entity_id)));
  await byId('item_deliverables', ids(found.item_deliverables));
  await byId('room_turns', ids(found.room_turns));
  for (const l of allLinks) await del('entity_links', sb.from('entity_links').delete({ count: 'exact' }).eq('user_id', uid).eq('item_kind', String(l.item_kind)).eq('item_id', String(l.item_id)));
  await byId('calendar_events', ids(events));
  await byId('inbox_items', ids(items));
  await byId('commitments', ids(commits));
  await byId('emails', ids(emails));
  await byId('work_entities', [...entityIds]);
  for (const p of found.person_state) await del('person_state', sb.from('person_state').delete({ count: 'exact' }).eq('user_id', uid).eq('person_key', String(p.person_key)));
  report.counts = deleted;
  report.total = Object.values(deleted).reduce((a, b) => a + b, 0);
  return report;
}

export function describeSweep(r: SweepReport): string {
  const nz = SWEEP_TABLES.filter((t) => r.counts[t] > 0).map((t) => `${t} ${r.counts[t]}`);
  return `${r.host} ${r.userId.slice(0, 8)}: ${r.applied ? 'deleted' : 'found'} ${r.total} row(s)${nz.length ? ` — ${nz.join(' · ')}` : ''}${r.tags.length ? ` · run tags: ${r.tags.join(', ')}` : ''}${r.kept.length ? ` · kept (linked outside the sweep): ${r.kept.join('; ')}` : ''}${r.errors.length ? ` · ERRORS: ${r.errors.join('; ')}` : ''}`;
}
