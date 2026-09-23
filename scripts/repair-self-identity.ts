// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SELF-IDENTITY REPAIR (W7.5 IDENTITY HYGIENE). GUARDED; DRY-RUN BY DEFAULT.
//
// The self person entity is CODE-OWNED (lib/entities/self.ts): login + connected addresses + profile
// name (+ the display names of mail FROM those addresses). Before W7.5 three writers let foreign
// identity in — the derivation read every from-form on `is_from_user` mail (a FOLDER fact: a
// forwarded meeting request keeps its organizer in `from`), adoption took any row matching a derived
// form (a client's own row was adopted as self), and aliases accumulated forever.
//
// This census runs THE ONE PLAN (`planSelfRepair` — the same pure function ensureSelfEntity applies
// on every pass) over every user's person registry and reports:
//   · self rows carrying foreign aliases (stripped on --apply — the alias set becomes the derivation)
//   · foreign persons ADOPTED as self (restored on --apply: self flag dropped, the user's forms
//     stripped, their own name/address kept — lossless, the row always was theirs)
//   · duplicate self rows (minted by the old capped read) — reported; archived on --apply only when
//     they carry zero entity_links
//   · orphan foreign forms: a foreign form no non-self person row holds after the plan — MANUAL
//     REVIEW (nothing is invented; the person brain re-founds them live from their correspondence)
//
//   npx tsx scripts/repair-self-identity.ts [--user <email>] [--apply --yes]
//
// ZERO AI. Output is MASKED (forms print as shapes, never names/addresses).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { loadSelfIdentity, planSelfRepair, foreignAliasesOf } from '../lib/entities/self';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const argv = process.argv;
const APPLY = argv.includes('--apply');
const YES = argv.includes('--yes');
const userArg = argv.includes('--user') ? argv[argv.indexOf('--user') + 1] : null;

/** A form's SHAPE, never its content: "a***@d***.tld" / "Name(2 words)". */
const mask = (f: string): string => {
  if (f.includes('@')) { const [l, d] = f.split('@'); return `${l[0] ?? ''}***@${d?.[0] ?? ''}***.${d?.split('.').pop() ?? ''}`; }
  return `name(${f.split(/\s+/).length}w)`;
};

type Row = { id: string; name: string; aliases: unknown; state: Record<string, unknown> | null; created_at: string | null };

(async () => {
  if (APPLY && !YES) { console.error('--apply requires --yes (the repair rewrites work_entities person rows).'); process.exit(2); }
  const profiles = await fetchAllRows<{ id: string; email: string | null }>((from, to) =>
    sb.from('profiles').select('id, email').order('id', { ascending: true }).range(from, to));
  const users = userArg ? profiles.filter((p) => (p.email ?? '').toLowerCase() === userArg.toLowerCase()) : profiles;
  if (userArg && !users.length) { console.error(`no profile for ${userArg}`); process.exit(2); }

  const census = { users: 0, usersWithSelf: 0, selfRows: 0, selfRowsForeignAliases: 0, foreignForms: 0, shortForms: 0, adoptees: 0, duplicates: 0, duplicatesArchivable: 0, orphanForeign: 0, usersTouched: 0, applied: 0 };
  for (const u of users) {
    census.users++;
    const identity = await loadSelfIdentity(sb, u.id);
    if (!identity.aliases.length) continue;
    const rows = await fetchAllRows<Row>((from, to) => sb.from('work_entities')
      .select('id, name, aliases, state, created_at').eq('user_id', u.id).eq('kind', 'person').eq('status', 'active')
      .order('id', { ascending: true }).range(from, to));
    const selfRows = rows.filter((r) => (r.state as { self?: boolean } | null)?.self === true);
    if (!selfRows.length) continue;
    census.usersWithSelf++;
    census.selfRows += selfRows.length;
    const plan = planSelfRepair(rows, identity);
    const adoptees = plan.updates.filter((x) => x.reason === 'demote_adoptee');
    const aliasFixes = plan.updates.filter((x) => x.reason === 'self_aliases');
    // Duplicates are only archivable when nothing links to them (a person row with links is kept).
    const archivable: string[] = [];
    for (const d of plan.duplicateIds) {
      const { count } = await sb.from('entity_links').select('item_id', { count: 'exact', head: true }).eq('user_id', u.id).eq('entity_id', d);
      if (!count) archivable.push(d);
    }
    const foreignRows = selfRows.filter((r) => !adoptees.some((a) => a.id === r.id)
      && foreignAliasesOf(r, identity).some((f) => plan.foreignForms.includes(f)));
    census.selfRowsForeignAliases += foreignRows.length;
    census.foreignForms += plan.foreignForms.length;
    census.shortForms += plan.shortForms.length;
    census.adoptees += adoptees.length;
    census.duplicates += plan.duplicateIds.length;
    census.duplicatesArchivable += archivable.length;
    census.orphanForeign += plan.orphanForeign.length;
    const dirty = plan.updates.length > 0 || plan.duplicateIds.length > 0;
    if (!dirty) continue;
    census.usersTouched++;
    console.log(`\nuser ${u.id.slice(0, 8)}… · self rows ${selfRows.length} (keep ${plan.keepId?.slice(0, 8) ?? 'NONE'}) · owned forms ${identity.aliases.length}`);
    if (plan.shortForms.length) console.log(`  shortenings of the user's own name (benign, stripped — the name tokens still read them): ${plan.shortForms.map(mask).join(', ')}`);
    if (plan.foreignForms.length) console.log(`  foreign forms on self rows: ${plan.foreignForms.map(mask).join(', ')} (on ${foreignRows.length} row(s))`);
    for (const a of adoptees) console.log(`  ADOPTEE ${a.id.slice(0, 8)}… — a foreign person marked self → restore (keeps ${a.aliases.map(mask).join(', ')})`);
    if (plan.duplicateIds.length) console.log(`  duplicate self rows: ${plan.duplicateIds.length} (${archivable.length} with zero links → archivable)`);
    if (plan.orphanForeign.length) console.log(`  ⚠ MANUAL REVIEW — foreign forms held by no other person row: ${plan.orphanForeign.map(mask).join(', ')}`);
    console.log(`  plan: ${aliasFixes.length} alias rewrite(s) · ${adoptees.length} restore(s) · ${archivable.length} archive(s)`);

    if (!APPLY) continue;
    for (const x of plan.updates) {
      const { error } = await sb.from('work_entities').update({ aliases: x.aliases, state: x.state }).eq('id', x.id).eq('user_id', u.id);
      if (error) console.error(`  ✗ update ${x.id.slice(0, 8)}…: ${error.message}`); else census.applied++;
    }
    for (const d of archivable) {
      const { error } = await sb.from('work_entities').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', d).eq('user_id', u.id);
      if (error) console.error(`  ✗ archive ${d.slice(0, 8)}…: ${error.message}`); else census.applied++;
    }
  }
  console.log(`\nCENSUS${APPLY ? ' (APPLIED)' : ' (dry-run)'}:`, census);
})().catch((e) => { console.error(e); process.exit(1); });
