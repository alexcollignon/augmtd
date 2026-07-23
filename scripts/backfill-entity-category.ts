// ONE BRAIN — GROUNDED category (client|internal|personal|admin). The earlier name-only pass mislabeled
// (Soboplac client → admin, personal home services → client, external contacts → internal). Root cause:
// reasoned BLIND. This grounds the classifier in WHO is involved (the entity's real people, external vs
// internal by corporate domain) + the summary. Reuses the same identity signal recognition now uses.
// Usage: npx tsx scripts/backfill-entity-category.ts [--apply]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { aiCall } from '../lib/ai/call';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const CATS = ['client', 'internal', 'personal', 'admin'];
const FREE = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com', 'proton.me', 'protonmail.com', 'aol.com']);
const domainOf = (e: string) => (e.includes('@') ? e.split('@')[1].toLowerCase() : '');

(async () => {
  const { data: conns } = await sb.from('connections').select('user_id, provider_account_id, metadata');
  const users = [...new Set((conns ?? []).map((c: any) => c.user_id))];
  for (const uid of users) {
    // The user's OWN corporate domains (login + connected mailboxes, minus free providers) → "internal".
    const { data: prof } = await sb.from('profiles').select('email').eq('id', uid).maybeSingle();
    const ownDomains = new Set<string>();
    for (const c of (conns ?? []).filter((x: any) => x.user_id === uid)) { const d = domainOf(c.metadata?.email || c.provider_account_id || ''); if (d && !FREE.has(d)) ownDomains.add(d); }
    const pd = domainOf((prof as any)?.email || ''); if (pd && !FREE.has(pd)) ownDomains.add(pd);

    const { data: ents } = await sb.from('work_entities').select('id, name, state').eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active').not('state', 'is', null);
    // People + their domains per entity, from linked items.
    const { data: links } = await sb.from('entity_links').select('entity_id, item_kind, item_id').eq('user_id', uid).not('entity_id', 'is', null);
    const byEnt = new Map<string, { people: Set<string>; domains: Set<string> }>();
    const reg = (e: string) => byEnt.get(e) ?? byEnt.set(e, { people: new Set(), domains: new Set() }).get(e)!;
    const inboxL = (links ?? []).filter((l: any) => l.item_kind === 'inbox_item');
    for (let k = 0; k < inboxL.length; k += 300) { const chunk = inboxL.slice(k, k + 300); const { data } = await sb.from('inbox_items').select('id, source_data').in('id', chunk.map((l: any) => l.item_id)); const m = new Map((data ?? []).map((r: any) => [r.id, r.source_data])); for (const l of chunk as any[]) { const sd = m.get(l.item_id); if (sd?.from_name) reg(l.entity_id).people.add(sd.from_name); const d = domainOf(sd?.from_address || ''); if (d) reg(l.entity_id).domains.add(d); } }
    const commitL = (links ?? []).filter((l: any) => l.item_kind === 'commitment');
    for (let k = 0; k < commitL.length; k += 300) { const chunk = commitL.slice(k, k + 300); const { data } = await sb.from('commitments').select('id, counterparty').in('id', chunk.map((l: any) => l.item_id)); const m = new Map((data ?? []).map((r: any) => [r.id, r.counterparty])); for (const l of chunk as any[]) { const cp = m.get(l.item_id); if (cp) reg(l.entity_id).people.add(cp); } }

    let done = 0; const dist: Record<string, number> = {};
    for (const e of (ents ?? []) as any[]) {
      // HUMAN LOCK (R1): a user-set category outranks the grounded classifier, permanently.
      if (e.state?.categoryLocked === true) { dist[`${e.state?.category} (locked)`] = (dist[`${e.state?.category} (locked)`] ?? 0) + 1; continue; }
      const info = byEnt.get(e.id) ?? { people: new Set(), domains: new Set() };
      const people = [...info.people].slice(0, 8);
      const hasInternal = [...info.domains].some((d) => ownDomains.has(d));
      const hasExternal = [...info.domains].some((d) => d && !ownDomains.has(d) && !FREE.has(d));
      // FACT constrains JUDGMENT: an EXTERNAL-company person means this is NOT the owner's own internal
      // work — so "internal" is only ALLOWED when there are own-company colleagues and no external party.
      // The genuinely-semantic split (external client vs external personal service) stays the model's call.
      const allowed = hasExternal ? ['client', 'personal', 'admin']
        : hasInternal ? ['internal', 'admin', 'client']
        : ['personal', 'admin', 'internal'];
      let cat: string;
      if (allowed.length === 1) { cat = allowed[0]; }
      else {
        const res = await aiCall<{ category?: string }>({
          userId: uid, supabase: sb, shape: { output: 'json' }, temperature: 0, maxTokens: 40, source: 'brain_synthesis',
          prompt: `Classify this body of work into ONE category. Choose ONLY from: ${allowed.join(', ')}.\n` +
            `Name: ${e.name}\nWhere it stands: ${e.state?.summary ?? ''}\n` +
            `People involved: ${people.join(', ') || '(none identified)'}\n` +
            `Signal: ${hasInternal ? 'includes the users OWN-company colleagues. ' : ''}${hasExternal ? 'includes EXTERNAL-company people (so NOT internal). ' : ''}${!hasInternal && !hasExternal ? 'no clear company people (a service/vendor/personal account). ' : ''}\n\n` +
            `"client" = an EXTERNAL client/customer/deal/prospect — you do professional/business work FOR or WITH them.\n` +
            `"internal" = the owner's OWN organisation/team/hiring/operations (own-company colleagues only).\n` +
            `"personal" = personal life — a service YOU personally consume (home repair, classes, property, personal finance, education), EVEN if the provider is an external company.\n` +
            `"admin" = a vendor/tool/SaaS/subscription/automated account (no real human counterpart, a service you use).\n` +
            `JSON only: {"category":"${allowed.join('|')}"}`,
        });
        cat = allowed.includes(res.json?.category as string) ? res.json!.category! : allowed[0];
      }
      dist[cat] = (dist[cat] ?? 0) + 1;
      if (APPLY) await sb.from('work_entities').update({ state: { ...e.state, category: cat }, updated_at: new Date().toISOString() }).eq('id', e.id);
      done++;
    }
    console.log(`${uid.slice(0, 8)} — ${done} classified · ${Object.entries(dist).map(([k, n]) => `${k}:${n}`).join(' ')} · ownDomains:[${[...ownDomains].join(',')}]`);
  }
  if (!APPLY) console.log('\nDry-run. Re-run with --apply.');
})();
