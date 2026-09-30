// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — SEED → MORE CASES (`--expand`). Volume beats hand-grading: a strong model proposes VARIANTS of
// a surface's seed cases (new names, languages, edge classes) in the fixture DSL, and the engine
// VALIDATES every proposal (the world resolves, every truth label is in the surface's vocabulary,
// people are single generic first names on .test domains, bodies carry no literal dates). Proposals
// land in scratchpad/ for HUMAN REVIEW — the engine never reads them and never writes fixtures; a
// reviewer copies accepted cases into scripts/lib/eval/engine/fixtures/<surface>.ts.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { resolveWorld } from './world';
import { parseAnswerJSON } from './judge';
import { jsonObjects, lenientParse } from '../home-chat-harness';
import { EDGE_KINDS, type AnyAdapter, type EvalCase } from './types';

/** Fixture hygiene every case must pass (authored or proposed). Returns the problems. */
export function fixtureProblems(c: EvalCase, adapter: AnyAdapter, now = new Date()): string[] {
  const p: string[] = [];
  if (!c.id || !c.group || !c.title) p.push('id, group and title are required');
  try { resolveWorld(c.world ?? {}, now); } catch (e) { p.push(`world: ${(e as Error).message}`); }
  for (const person of c.world?.people ?? []) {
    if (!/^[\p{Lu}][\p{L}'-]{1,20}$/u.test(person.name) && !/\b(Ops|Team|Desk|Billing|Support|Newsletter|Notifications?|Accounts?)\b/.test(person.name)) {
      p.push(`person "${person.name}": use ONE generic first name (no surnames), or a role mailbox ("Acme Billing")`);
    }
    if (!/\.test$/i.test(person.email)) p.push(`person "${person.name}": email must be on a .test domain (${person.email})`);
  }
  const texts = [...(c.world?.threads ?? []).flatMap((t) => [t.subject, ...t.messages.map((m) => m.body)]), ...(c.world?.kb ?? []).map((d) => d.text)];
  for (const t of texts) {
    if (/\b20\d\d-\d\d-\d\d\b|\b(January|February|March|April|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d\d\b/.test(t)) {
      p.push(`a literal date in text ("${t.slice(0, 50)}…") — write {{+3d}} so it never rots`);
      break;
    }
  }
  if (adapter.scoring.kind === 'labelled') {
    for (const f of adapter.scoring.fields) {
      if (f.kind !== 'enum' || (f.when && !f.when(c.truth))) continue;
      const v = c.truth[f.name];
      if (v == null) { p.push(`truth.${f.name} is missing`); continue; }
      const open = Object.keys(f.labels).some((k) => /[<A-Z]{2,}|<|YYYY|HH:MM/.test(k));
      if (!open && !(String(v).toLowerCase() in f.labels) && !(String(v) in f.labels)) p.push(`truth.${f.name} = "${String(v)}" is not in the vocabulary (${Object.keys(f.labels).join(', ')})`);
    }
  } else if (!c.truthSheet && adapter.family !== 'conversation') {
    p.push('a judged case needs a truthSheet');
  }
  return p;
}

export function buildExpandPrompt(adapter: AnyAdapter, seeds: EvalCase[], n: number): string {
  const vocab = adapter.scoring.kind === 'labelled'
    ? adapter.scoring.fields.map((f) => (f.kind === 'enum' ? `- ${f.name}: ${Object.entries(f.labels).map(([k, g]) => `"${k}" (${g})`).join(' · ')}` : `- ${f.name}: ${f.gloss}`)).join('\n')
    : `judged — each case needs a "truthSheet" (must-address points, must-not-claim facts, whether silence is correct)`;
  return [
    `You write evaluation cases for "${adapter.title}" (${adapter.id}). Propose ${n} NEW cases that are VARIANTS of the seed cases below: different people, companies, languages (EN/FR/DE/PT), and at least one per edge class (${EDGE_KINDS.join(', ')}).`,
    'RULES:',
    '- Same JSON shape as the seeds: {id, group, title, world, params, truth}. ids are new and unique.',
    '- People: ONE generic first name each (no surnames), emails on .test domains (sam@acme.test). Companies: Acme, Globex, Initech, Northwind, Umbrella, Hooli-style generic fakes only.',
    '- NEVER write a literal date in text: use {{+3d}} (renders "Friday 2 October"), {{+3d|iso}}, {{+3d 14:00|time}}, {{-2d|weekday}}. Message times use "at": "-3d 09:30" / "-2h" / "+1d 14:00".',
    '- The truth is what a competent human colleague would answer — label it carefully; when two answers are both right, set truth.accept = { <field>: [..] }.',
    `LABEL VOCABULARY:\n${vocab}`,
    `PLANNED GROUPS (fill the thin ones):\n${adapter.planned.map((g) => `- ${g.group} (${g.count}): ${g.note}`).join('\n')}`,
    `SEED CASES:\n${JSON.stringify(seeds.map((s) => ({ id: s.id, group: s.group, title: s.title, world: s.world, params: s.params, truth: s.truth, truthSheet: s.truthSheet })), null, 1)}`,
    `Reply with ONLY a JSON object: {"cases": [ ...${n} cases... ]}`,
  ].join('\n\n');
}

export function parseProposals(text: string): EvalCase[] {
  const v = parseAnswerJSON(text);
  if (v && Array.isArray(v.cases)) return v.cases as EvalCase[];
  for (const o of jsonObjects(String(text ?? ''))) {
    try { const x = lenientParse(o) as { cases?: unknown }; if (Array.isArray(x.cases)) return x.cases as EvalCase[]; } catch { /* next */ }
  }
  return [];
}

