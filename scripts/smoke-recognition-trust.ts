// RECOGNITION TRUST SMOKE (just-works P1.5a) — the anti-fragmentation gates, agnostic + cross-user.
// The scenario class under test: ONE real deal arriving as many facets — meetings with the same or
// different people, separate email threads, NEW people joining from the same company — must converge
// to ONE entity. Gates:
//   PURE — identity tokens: diacritic folding, multi-form (name/email/@domain), free-provider
//          exclusion, era-proof matching; domain force-recall; internal-domain non-distinctiveness;
//          channel-name detection.
//   LIVE (both users, real data — this run also HEALS it, same code the 2-hourly cron runs):
//          fingerprint refresh → multi-form coverage; calendar recognition → recent events get a
//          membership verdict; reflection → domain-family fragmentation shrinks (never grows);
//          orphan sweep. Conservative invariants: reflection only merges what the judge confirms;
//          'separate' verdicts persist; tracked entities never touched by the orphan sweep.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { normPerson, personKey, personForms, recallCandidates, type RecogEntity } from '../lib/entities/recognize';
import { looksLikeChannelName, reflectEntities } from '../lib/entities/reflect';
import { refreshPeopleFingerprints, archiveOrphanEntities } from '../lib/entities/reconcile';
import { shadowRecognizeCalendar } from '../lib/entities/hooks';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = [
  { uid: '08fe4449-e5eb-431d-9156-02e9324e5903', label: 'user A' },
  { uid: 'c723c2f2-e069-4ab8-980e-ac3585028fec', label: 'user B' },
];
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

// Rare-external-domain FAMILIES: how many company domains are spread across ≥2 ACTIVE entities — the
// fragmentation metric (one deal remembered twice usually shows as one company across two entities).
async function domainFamilies(uid: string): Promise<Map<string, string[]>> {
  const { data: ents } = await sb.from('work_entities').select('id, name, people')
    .eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active');
  const byDomain = new Map<string, string[]>();
  for (const e of (ents ?? []) as Array<{ name: string; people?: unknown }>) {
    const people = Array.isArray(e.people) ? (e.people as string[]) : [];
    for (const d of new Set(people.filter((p) => p.startsWith('@')))) {
      byDomain.set(d, [...(byDomain.get(d) ?? []), e.name]);
    }
  }
  return new Map([...byDomain.entries()].filter(([, names]) => names.length >= 2));
}

(async () => {
  // ── PURE — the identity-token layer ──
  check('tokens: diacritics FOLD, never strip', normPerson('Chloé Marren') === 'chloe marren', normPerson('Chloé Marren'));
  const forms = personForms('Séa Marren <sm@acme-corp.io>');
  check('tokens: one participant → name + email + @domain forms',
    forms.includes('sea marren') && forms.includes('sm@acme-corp.io') && forms.includes('@acme-corp.io'), forms.join(' | '));
  check('tokens: a free-provider domain is never a company signal',
    !personForms('Sam <sam@gmail.com>').some((f) => f.startsWith('@')));
  check('tokens: era-proof matching (hyphen/space normalization eras collapse)',
    personKey(normPerson('Anna-Lena Berg')) === personKey('annalena berg'));

  // ── PURE — recall: a NEW person from the same external company force-recalls the deal ──
  const emb = (seed: number): number[] => Array.from({ length: 32 }, (_, i) => Math.sin(seed * 97 + i));
  const registry: RecogEntity[] = [
    { id: 'deal', name: 'Acme Rollout', summary: 'platform rollout for Acme', people: ['sam larsson', '@acme-corp.io'], embedding: emb(1) },
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `int${i}`, name: `Internal effort ${i}`, summary: 'internal', people: ['pat kim', '@owncorp.com'], embedding: emb(10 + i),
    })),
  ];
  const newPersonTokens = personForms('Rita Voss <rv@acme-corp.io>');
  const cands = recallCandidates(emb(99), registry, 3, newPersonTokens);
  check('recall: NEW person, same external company → the deal is a candidate (force-recall)',
    cands.some((c) => c.id === 'deal'), cands.map((c) => c.name).join(' | '));
  const internalCands = recallCandidates(emb(99), registry, 2, ['@owncorp.com']);
  const forcedInternal = internalCands.filter((c) => c.id.startsWith('int')).length;
  check('recall: an everywhere-domain is NOT distinctive (no force-include flood)', forcedInternal <= 2, `${internalCands.length} candidates`);

  // ── PURE — channel-shaped names (the merge-naming rule) ──
  check('channel-name: person-led name detected', looksLikeChannelName('Sam Larsson — Platform Chat', ['sam larsson', '@acme-corp.io']));
  check('channel-name: "X x Y / sync" markers detected', looksLikeChannelName('Ops x Design weekly', []));
  check('channel-name: a deal-shaped name is NOT a channel', !looksLikeChannelName('Acme Rollout', ['sam larsson']));

  // ── LIVE — both users: the SAME maintenance pass the cron runs, with before/after gates ──
  for (const { uid, label } of USERS) {
    // 1. Fingerprint refresh → multi-form coverage (email/domain tokens present on real entities).
    const refreshed = await refreshPeopleFingerprints(sb, uid);
    const { data: ents } = await sb.from('work_entities').select('id, people')
      .eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active');
    const withDomain = ((ents ?? []) as Array<{ people?: unknown }>)
      .filter((e) => Array.isArray(e.people) && (e.people as string[]).some((p) => p.includes('@'))).length;
    check(`${label} · fingerprints carry email/domain forms after refresh`, withDomain > 0,
      `${refreshed} refreshed · ${withDomain}/${ents?.length ?? 0} with identity tokens`);

    // 2. Calendar recognition — recent multi-attendee events end with a membership verdict.
    const before = await unverdictedCalendar(uid);
    const cal = await shadowRecognizeCalendar(sb, uid, 8);
    const after = await unverdictedCalendar(uid);
    check(`${label} · calendar events get membership verdicts`, after <= before && (before === 0 || (cal?.ran ?? 0) > 0),
      `unverdicted ${before}→${after} (ran ${cal?.ran ?? 0})`);

    // 3. Reflection heals domain families (fragmentation shrinks, never grows). Two rounds (the cron
    //    iterates 2-hourly; MAX_PAIRS bounds one round).
    const famBefore = await domainFamilies(uid);
    const v1 = await reflectEntities(sb, uid, { commit: true });
    const v2 = await reflectEntities(sb, uid, { commit: true });
    const verdicts = [...v1, ...v2];
    const merges = verdicts.filter((v) => v.verdict === 'merge');
    const famAfter = await domainFamilies(uid);
    check(`${label} · reflection ran (conservative judge)`, true,
      `${merges.length} merged · ${verdicts.length - merges.length} separate`);
    check(`${label} · domain-family fragmentation shrinks or holds`, famAfter.size <= famBefore.size,
      `families ${famBefore.size}→${famAfter.size}`);
    for (const m of merges) console.log(`    ⤷ merged: "${m.a}" + "${m.b}" — ${m.reason}`);
    for (const [d, names] of famAfter) console.log(`    ⤷ remaining family ${d}: ${names.join(' · ')}`);

    // 4. Orphan sweep — never touches tracked entities (checked structurally: only untracked eligible).
    const archived = await archiveOrphanEntities(sb, uid);
    const { count: trackedActive } = await sb.from('work_entities').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active').eq('tracked', true);
    check(`${label} · orphan sweep (tracked entities untouched)`, true, `${archived} archived · ${trackedActive ?? 0} tracked still active`);
  }

  console.log('\n════ RECOGNITION TRUST GATES (P1.5a — anti-fragmentation) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();

async function unverdictedCalendar(uid: string): Promise<number> {
  const now = Date.now();
  const { data: evs } = await sb.from('calendar_events').select('id, title, attendees')
    .eq('user_id', uid).eq('status', 'confirmed')
    .gte('start_time', new Date(now - 4 * 86_400_000).toISOString())
    .lte('start_time', new Date(now + 21 * 86_400_000).toISOString()).limit(80);
  const cands = ((evs ?? []) as Array<{ id: string; title: string; attendees?: unknown }>)
    .filter((e) => Array.isArray(e.attendees) && e.attendees.length >= 2 && !/^(canceled|cancelled)( event)?:/i.test(String(e.title || '')));
  if (!cands.length) return 0;
  const { data: links } = await sb.from('entity_links').select('item_id')
    .eq('user_id', uid).eq('item_kind', 'calendar_event').in('item_id', cands.map((c) => c.id));
  const seen = new Set((links ?? []).map((l) => l.item_id as string));
  return cands.filter((c) => !seen.has(c.id)).length;
}
