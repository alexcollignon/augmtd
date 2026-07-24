// UNIVERSAL RESOLVER (Phase B2) — cross-user smoke: the registry finds real files (incl. Phase-A
// attachments) by natural queries; entity affinity boosts same-deal files; a failing source never breaks.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { resolveFileUniversal } from '../lib/knowledge/resolve';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
(async () => {
  const { data: probes } = await sb.from('knowledge_files')
    .select('id, user_id, filename, entity_id, extracted_text').eq('origin->>kind', 'email_attachment')
    .not('extracted_text', 'is', null).limit(50);
  const byUser = new Map<string, any[]>();
  for (const p of (probes ?? []) as any[]) (byUser.get(p.user_id) ?? byUser.set(p.user_id, []).get(p.user_id)!).push(p);
  for (const [uid, files] of byUser) {
    const probe = files.find((f) => String(f.extracted_text).length > 400) ?? files[0];
    if (!probe) continue;
    const q = `${String(probe.filename).replace(/\.[a-z0-9]+$/i, '')} ${String(probe.extracted_text).split(/\s+/).slice(0, 10).join(' ')}`;
    const cands = await resolveFileUniversal(sb, { userId: uid, entityId: probe.entity_id }, q, 6);
    const hit = cands.some((c) => c.id === probe.id);
    check(`${uid.slice(0, 8)}: registry finds the attachment`, hit, `top="${cands[0]?.filename ?? 'none'}"`);
    if (probe.entity_id) {
      const sameDeal = cands.filter((c) => c.entityId === probe.entity_id);
      check(`${uid.slice(0, 8)}: entity affinity ranks same-deal file top-3`, sameDeal.length === 0 || cands.slice(0, 3).some((c) => c.entityId === probe.entity_id));
    }
    // Pool short-circuit: a pool candidate always outranks KB.
    const withPool = await resolveFileUniversal(sb, { userId: uid, poolCandidates: [{ source: 'pool', id: 'x', filename: 'in-context.pdf', snippet: 's', score: 1 }] }, q, 6);
    check(`${uid.slice(0, 8)}: pool outranks everything`, withPool[0]?.source === 'pool');
  }
  console.log('\n════ UNIVERSAL-RESOLVER GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  (${d})` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
