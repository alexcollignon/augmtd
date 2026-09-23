/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — IDENTITY HYGIENE (stabilization W7.5, Sep 23 — docs/laws-registry.md `identity-hygiene`).
 *
 * Found live on the owner's production account (W7.3's open finding): the user's SELF person entity
 * carried a CLIENT contact's name + address — so the addressee law withdrew drafts to that client as
 * "addressed to you" and the self-party law could re-read commitments owed to them. The chain:
 *   1 · the self derivation read every from-form on `is_from_user` mail — a FOLDER fact (a forwarded
 *       meeting request in Sent Items keeps its organizer in `from`);
 *   2 · adoption took any person row matching a derived form (the client's own row became self);
 *   3 · aliases accumulated forever (`prior ∪ derived`) and were copied into every duplicate self row.
 * Riders: the shared name matcher did not fold diacritics ("Zoé" ≠ "Zoe"); the held ledger read raw
 * source_data drafts, not the ONE READER's live verdict.
 *
 * ZERO-AI, deterministic: source floors for every clause + pure tests of the derivation, the plan,
 * the merge guard, the fold and the live reader. Exit 1 on any failure.
 *
 *   npx tsx scripts/smoke-identity.ts              (+ the read-only census when env exists)
 *   npx tsx scripts/smoke-identity.ts --no-census  (the board's form — never depends on data)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv'; config({ path: '.env.local' });
import { foldAccents, sameAttendee, nameTokens } from '../lib/projects/identity';
import { denotesUser } from '../lib/commitments/extraction-truth';
import { deriveSelfIdentity, planSelfRepair, pickSelfRow, refusesSelfMerge, loadSelfIdentity } from '../lib/entities/self';
import { liveFromSourceData } from '../lib/prepare/read';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

(async () => {
  const self = code('lib/entities/self.ts');
  const derive = self.slice(self.indexOf('export function deriveSelfIdentity'), self.indexOf('type PersonRow'));
  const ensure = self.slice(self.indexOf('export async function ensureSelfEntity'));

  // ═══ A · THE SELF ENTITY IS CODE-OWNED ═══
  console.log('A · the self entity is code-owned:');
  gate('A1 the derivation never learns an ADDRESS from mail (no addAddr over sent forms)',
    !/addAddr\(\s*e\.from_address/.test(derive) && /addAddr\(f\.profile\?\.email\)/.test(derive));
  gate('A2 a sent display name is read ONLY when its from-address is an owned address',
    /if \(e\.from_address && addresses\.has\(norm\(e\.from_address\)\)\) addName\(e\.from_name\)/.test(derive));
  gate('A3 ensure REPLACES the alias set via THE ONE PLAN — no accumulation (prior ∪ derived)',
    /planSelfRepair\(rows, identity\)/.test(ensure) && !/\.\.\.priorAliases/.test(ensure) && !/new Set\(\[\.\.\.prior/.test(ensure));
  gate('A4 adoption takes only a PURE self row; a foreign adoptee is never picked',
    /isSelfMarked\(r\) && !isForeignAdoptee\(r, id\)/.test(self) && /!isSelfMarked\(r\) && isPureSelfRow\(r, id\)/.test(self));
  // A5 — no other writer marks a row self (the code-owned row has ONE writer).
  const selfWriters = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))]
    .filter((p) => !p.endsWith('lib/entities/self.ts'))
    .filter((p) => /self:\s*true\s*[},]/.test(readFileSync(p, 'utf8').replace(/\/\/[^\n]*/g, '')) && /work_entities/.test(readFileSync(p, 'utf8')));
  gate('A5 no writer outside lib/entities/self.ts stamps `self: true` on a person entity', selfWriters.length === 0, selfWriters.map((p) => p.replace(ROOT + '/', '')).join(', '));
  gate('A6 the addressee law reads the user from THE ONE DERIVATION, never the stored self row',
    /loadSelfIdentity\(client, userId\)/.test(code('lib/prepare/addressee.ts')) && !/state->>self/.test(code('lib/prepare/addressee.ts')));
  gate('A7 the commitment writer reads the user from the one derivation (no self-row aliases)',
    /loadUserForms\(client as never, userId\)/.test(code('lib/commitments/extract.ts')) && !/selfP\?\.aliases/.test(code('lib/commitments/extract.ts')));

  // ═══ B · THE MERGE GUARD ═══
  console.log('B · no merge folds another person into self:');
  const reflect = code('lib/entities/reflect.ts');
  const absorb = reflect.slice(reflect.indexOf('export async function absorbEntity'), reflect.indexOf('export type ReflectionVerdict'));
  gate('B1 absorbEntity (every merge door: reflection · merge_projects · adopt · the PATCH merge) refuses a self merge before any write',
    /if \(refusesSelfMerge\(keep, lose\)\) return \{ ok: false, refused: 'self' \}/.test(absorb)
      && absorb.indexOf('refusesSelfMerge') < absorb.indexOf(".update("));
  const store = code('lib/people/state-store.ts');
  gate('B2 the person brain never writes the self row (no synthesis, no alias absorption)',
    /if \(entity\?\.state\?\.self === true\)/.test(store) && store.indexOf('entity?.state?.self === true') < store.indexOf('aliases = [...new Set'));
  gate('B3 pure: refusesSelfMerge both directions',
    refusesSelfMerge({ state: { self: true } }, { state: {} }) && refusesSelfMerge({ state: null }, { state: { self: true } }) && !refusesSelfMerge({ state: {} }, { state: {} }));

  // ═══ C · THE ONE ACCENT FOLD ═══
  console.log('C · the shared tokenizer folds accents:');
  gate('C1 norm (the one normalizer every identity helper runs through) folds diacritics',
    /export const norm = \(s: string\) => foldAccents\(s\)/.test(code('lib/projects/identity.ts')));
  gate('C2 the addressee law carries no local duplicate fold (retired into the shared one)',
    !/normalize\('NFD'\)/.test(code('lib/prepare/addressee.ts')));
  gate('C3 pure: "Zoé Martin" is "Zoe Martin"; "Léa" tokenizes whole',
    sameAttendee('Zoé Martin', 'Zoe Martin') && nameTokens('Léa Costa').join(' ') === 'lea costa' && foldAccents('Zoë') === 'Zoe');
  gate('C4 pure: the fold reaches denotesUser', denotesUser('Zoé Rivera', { name: 'Zoe Rivera', aliases: [] }));
  gate('C5 pure: different people stay different', !sameAttendee('Zoé Martin', 'Leo Martin'));

  // ═══ D · THE PURE LAW ═══
  console.log('D · the derivation + the plan:');
  const ID = deriveSelfIdentity({
    profile: { email: 'sam.rivera@gmail.com', full_name: 'Samuel Rivera' },
    connections: [{ metadata: { email: 'sam@acme.test' } }],
    sentForms: [{ from_name: 'Sam Rivera', from_address: 'sam@acme.test' }, { from_name: 'Jordan Blake', from_address: 'jordan@globex.test' }],
  });
  gate('D1 a forwarded invite\'s organizer never becomes the user', !ID.aliases.includes('jordan blake') && !ID.aliases.includes('jordan@globex.test') && ID.aliases.includes('sam rivera'));
  const real = { id: 'a', name: 'Samuel Rivera', aliases: [...ID.aliases, 'jordan blake', 'jordan@globex.test'], state: { self: true }, created_at: '2026-07-01' };
  const adoptee = { id: 'b', name: 'Jordan Blake', aliases: ['jordan blake', 'jordan@globex.test', ...ID.aliases], state: { self: true, summary: 's' }, created_at: '2026-06-01' };
  const plan = planSelfRepair([real, adoptee], ID);
  gate('D2 the absorbed client row is never the self row', pickSelfRow([adoptee, real], ID)?.id === 'a');
  gate('D3 the plan strips foreign aliases and restores the adoptee losslessly',
    plan.updates.some((u) => u.id === 'a' && !u.aliases.includes('jordan blake'))
      && plan.updates.some((u) => u.id === 'b' && u.reason === 'demote_adoptee' && u.aliases.includes('jordan@globex.test') && !('self' in u.state))
      && plan.orphanForeign.length === 0);

  // ═══ E · ONE READER — the held ledger / triage deck ═══
  console.log('E · attention reads through the one reader:');
  const att = code('lib/home/attention.ts');
  gate('E1 the held ledger reads the ONE READER\'s live verdict, never the raw source_data list',
    /liveFromSourceData\(/.test(att) && !/preparedFromSourceData/.test(att));
  gate('E2 the user\'s forms ride from the derivation into the pure ledger (held-members → held-cache → buildHeldLedger)',
    /loadUserForms\(client, userId\)/.test(code('lib/deeds/held-members.ts')) && /user: derived\.userForms/.test(code('lib/deeds/held-cache.ts')));
  const U = { name: 'Samuel Rivera', aliases: ['sam@acme.test'] };
  gate('E3 pure: a draft addressed to the user is not live on the ledger path',
    liveFromSourceData({ subject: 's', body: 'b', draft: { body: 'Hi Samuel', generated_at: '2026-09-20T00:00:00Z', addressee: { name: 'Samuel Rivera', email: 'sam@acme.test', via: 'email' } } }, { user: U }).length === 0
      && liveFromSourceData({ subject: 's', body: 'b', draft: { body: 'Hi Jordan', generated_at: '2026-09-20T00:00:00Z', addressee: { name: 'Jordan Blake', email: 'jordan@globex.test', via: 'email' } } }, { user: U }).length === 1);

  // ═══ F · CENSUS (read-only) ═══
  const census = !process.argv.includes('--no-census') && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (census) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const { fetchAllRows } = await import('../lib/utils/fetch-all');
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const selfRows = await fetchAllRows<{ id: string; user_id: string; name: string; aliases: unknown; state: Record<string, unknown> | null; created_at: string | null }>((from, to) =>
        sb.from('work_entities').select('id, user_id, name, aliases, state, created_at').eq('kind', 'person').eq('status', 'active')
          .eq('state->>self', 'true').order('id', { ascending: true }).range(from, to));
      const byUser = new Map<string, typeof selfRows>();
      for (const r of selfRows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
      let dirtyUsers = 0, foreign = 0, adoptees = 0, dups = 0, orphans = 0;
      for (const [uid, rows] of byUser) {
        const p = planSelfRepair(rows, await loadSelfIdentity(sb as never, uid));
        if (p.updates.length || p.duplicateIds.length) dirtyUsers++;
        foreign += p.foreignForms.length; adoptees += p.updates.filter((u) => u.reason === 'demote_adoptee').length;
        dups += p.duplicateIds.length; orphans += p.orphanForeign.length;
      }
      console.log(`\nF · census (read-only): users with a self row ${byUser.size} · self rows ${selfRows.length} · users needing repair ${dirtyUsers} · foreign forms on self rows ${foreign} · foreign persons adopted as self ${adoptees} · duplicate self rows ${dups} · orphan foreign forms (manual review) ${orphans}`);
      console.log('    (repair: npx tsx scripts/repair-self-identity.ts [--apply --yes]; ensureSelfEntity applies the same plan on the next pass)');
    } catch (e) { console.log(`\nF · census skipped: ${e instanceof Error ? e.message : String(e)}`); }
  } else {
    console.log('\nF · census skipped (--no-census or no env)');
  }
  console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — ${pass} passed · ${failures.length} failed${failures.length ? `\n  ${failures.join('\n  ')}` : ''}`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
