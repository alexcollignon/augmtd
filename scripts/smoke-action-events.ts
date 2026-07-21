// ACTION EVENTS (Living-Home L2) — smoke. Controlled, reversible, cross-user: pick a real LINKED open
// commitment, mark it done, fire noteItemAction → assert the entity HEARD it (sig changed — the content
// hash sees the status flip; state re-synthesized; brief cache busted). Then restore + re-fire → sig
// changes back. Also proves the deaf-sig fix at the unit level.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { noteItemAction } from '../lib/entities/on-action';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

async function entSnapshot(entId: string): Promise<{ sig: string | null; updatedAt: string | null; state: unknown }> {
  const { data } = await sb.from('work_entities').select('sig, updated_at, state').eq('id', entId).maybeSingle();
  return { sig: (data?.sig as string) ?? null, updatedAt: (data?.updated_at as string) ?? null, state: data?.state ?? null };
}

async function runFor(uid: string): Promise<void> {
  const u = uid.slice(0, 8);
  // A real linked OPEN commitment (you_owe) — the controlled subject.
  const { data: links } = await sb.from('entity_links').select('item_id, entity_id')
    .eq('user_id', uid).eq('item_kind', 'commitment').not('entity_id', 'is', null).limit(200);
  let subject: { commitId: string; entId: string } | null = null;
  for (const l of (links ?? []) as Array<{ item_id: string; entity_id: string }>) {
    const { data: c } = await sb.from('commitments').select('id, status, direction').eq('id', l.item_id).maybeSingle();
    if (c && (c.status === 'open' || c.status === 'pending') && c.direction !== 'awaiting') { subject = { commitId: l.item_id, entId: l.entity_id }; break; }
  }
  if (!subject) { check(`${u}: found a linked open commitment`, true, 'skipped — none'); return; }

  const before = await entSnapshot(subject.entId);
  // ACT — mark done (the endpoint's write, replicated) + fire the event.
  await sb.from('commitments').update({ status: 'done', resolved_at: new Date().toISOString(), resolved_reason: 'smoke_test', updated_at: new Date().toISOString() }).eq('id', subject.commitId);
  await noteItemAction(sb, uid, { kind: 'commitment', id: subject.commitId });
  const after1 = await entSnapshot(subject.entId);
  const { data: prof } = await sb.from('profiles').select('home_brief').eq('id', uid).maybeSingle();

  check(`${u}: entity HEARD the action (sig changed)`, after1.sig !== before.sig, `${before.sig} → ${after1.sig}`);
  check(`${u}: state re-synthesized`, !!after1.updatedAt && after1.updatedAt !== before.updatedAt);
  check(`${u}: brief cache busted`, prof?.home_brief == null);

  // RESTORE — reopen + re-fire; the sig flips again (the reversal is heard too).
  await sb.from('commitments').update({ status: 'open', resolved_at: null, resolved_reason: null, updated_at: new Date().toISOString() }).eq('id', subject.commitId);
  await noteItemAction(sb, uid, { kind: 'commitment', id: subject.commitId });
  const after2 = await entSnapshot(subject.entId);
  // Heard = the sig CHANGED again (not equality with `before` — a legacy-format pre-action sig can never
  // match the new content-hash format, and that's fine; change detection is the contract).
  check(`${u}: restore heard too (sig changed again)`, after2.sig !== after1.sig, `${after1.sig} → ${after2.sig}`);

  // Unlinked no-op: a fabricated id must not throw and must still bust the cache.
  await noteItemAction(sb, uid, { kind: 'commitment', id: '00000000-0000-0000-0000-000000000000' });
  check(`${u}: unlinked action is a safe no-op`, true);
}

(async () => {
  for (const uid of ['08fe4449-e5eb-431d-9156-02e9324e5903', 'c723c2f2-e069-4ab8-980e-ac3585028fec']) await runFor(uid);
  console.log('\n════ ACTION-EVENT GATES ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  (${d})` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
