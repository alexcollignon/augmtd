// One-time REASONED backfill — converge fragmented initiative labels (the "Jean-Marie pilot" vs "Soboplac
// AI Agent System" split for one contact). NOT a deterministic dominant-relabel: for each contact with >1
// distinct label we make ONE classification-tier call that decides which labels name the SAME initiative
// (consolidate) vs a genuinely SEPARATE deal (keep) — the same judgment the forward grounding uses. Only
// ever merges labels WITHIN one contact (never across people → the Galp over-merge guard holds).
//
// Usage: npx tsx scripts/backfill-initiative-canonical.ts <userId|all> [--apply]
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '../lib/ai/factory';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

const emailOf = (s?: string | null) => String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
const nameKey = (s?: string | null) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s?: string | null) => new Set(nameKey(s).split(' ').filter((t) => t.length > 2));
const subset = (a: Set<string>, b: Set<string>) => { const [s, l] = a.size <= b.size ? [a, b] : [b, a]; return s.size > 0 && [...s].every((x) => l.has(x)); };

type Row = { kind: 'email' | 'commitment'; id: string; label: string; email: string | null; name: string | null };

async function backfillUser(uid: string) {
  const [inboxRes, comRes] = await Promise.all([
    sb.from('inbox_items').select('id, source_data').eq('user_id', uid).eq('source', 'email').not('source_data->understanding->>initiative', 'is', null).limit(2000),
    sb.from('commitments').select('id, initiative, counterparty').eq('user_id', uid).not('initiative', 'is', null).limit(1000),
  ]);
  const rows: Row[] = [];
  for (const it of (inboxRes.data ?? []) as any[]) { const sd = it.source_data ?? {}; rows.push({ kind: 'email', id: it.id, label: String(sd.understanding?.initiative || '').trim(), email: emailOf(sd.from_address || sd.from), name: sd.from_name || null }); }
  for (const c of (comRes.data ?? []) as any[]) rows.push({ kind: 'commitment', id: c.id, label: String(c.initiative || '').trim(), email: emailOf(c.counterparty), name: c.counterparty || null });
  const live = rows.filter((r) => r.label);
  if (!live.length) return { user: uid, contacts: 0, merged: 0 };

  // Cluster rows by contact (unify email + name forms).
  type Cluster = { emails: Set<string>; names: Set<string>[]; rows: Row[] };
  const clusters: Cluster[] = [];
  const find = (r: Row) => clusters.find((c) => (r.email && c.emails.has(r.email)) || (r.name && c.names.some((ns) => subset(ns, tokens(r.name)))));
  for (const r of live) {
    let cl = find(r);
    if (!cl) { cl = { emails: new Set(), names: [], rows: [] }; clusters.push(cl); }
    if (r.email) cl.emails.add(r.email);
    if (r.name && tokens(r.name).size) cl.names.push(tokens(r.name));
    cl.rows.push(r);
  }

  let merged = 0, contacts = 0;
  const { client, model } = await getAIClient(uid, 'classification', sb);
  for (const cl of clusters) {
    const labels = [...new Set(cl.rows.map((r) => r.label))];
    if (labels.length < 2) continue;
    contacts++;
    // Reasoned consolidation: which labels are the same initiative?
    let mapping: Record<string, string> = {};
    try {
      const prompt = `These initiative/deal labels all belong to ONE contact. Some may be different names for the SAME ongoing effort (e.g. a person's name vs their company/product), others may be genuinely SEPARATE deals. Group the ones that name the SAME initiative and give ONE canonical label per group (prefer the clearest, most specific — usually the company/product over a bare person name). Keep genuinely separate deals in separate groups.\nLabels: ${labels.map((l) => `"${l}"`).join(', ')}\nReturn ONLY JSON: {"groups":[{"canonical":"<label>","members":["<label>", ...]}, ...]}`;
      const res = await aiCreate(client, { model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 500, response_format: { type: 'json_object' } as any });
      let raw = (res.choices?.[0]?.message?.content || '{}').replace(/```(?:json)?/gi, '').trim();
      const s = raw.indexOf('{'), e = raw.lastIndexOf('}'); if (s >= 0 && e > s) raw = raw.slice(s, e + 1);
      const parsed = JSON.parse(raw) as { groups?: { canonical?: string; members?: string[] }[] };
      for (const g of parsed.groups ?? []) { const canon = (g.canonical || '').trim(); if (!canon) continue; for (const m of g.members ?? []) if (m && m.trim() && m.trim() !== canon) mapping[m.trim()] = canon; }
    } catch { /* skip this contact on failure */ }
    const changes = cl.rows.filter((r) => mapping[r.label] && mapping[r.label] !== r.label);
    if (!changes.length) continue;
    console.log(`  contact {${[...cl.emails][0] || [...cl.rows][0].name}}: ${JSON.stringify(mapping)} → ${changes.length} rows`);
    for (const r of changes) {
      const canon = mapping[r.label];
      merged++;
      if (!APPLY) continue;
      if (r.kind === 'commitment') { await sb.from('commitments').update({ initiative: canon }).eq('id', r.id); }
      else { const { data } = await sb.from('inbox_items').select('source_data').eq('id', r.id).single(); const sd = (data?.source_data as any) ?? {}; sd.understanding = { ...(sd.understanding ?? {}), initiative: canon }; await sb.from('inbox_items').update({ source_data: sd }).eq('id', r.id); }
    }
  }
  return { user: uid, contacts, merged };
}

async function main() {
  const arg = process.argv[2];
  let uids: string[];
  if (!arg || arg === 'all') { const { data } = await sb.from('inbox_items').select('user_id').eq('source', 'email').limit(5000); uids = [...new Set((data ?? []).map((r: any) => r.user_id))].filter(Boolean); }
  else uids = [arg];
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} over ${uids.length} user(s)\n`);
  for (const uid of uids) { const r = await backfillUser(uid); console.log(`user ${uid.slice(0, 8)}: ${r.contacts} multi-label contacts, ${r.merged} rows ${APPLY ? 'updated' : 'would update'}`); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
