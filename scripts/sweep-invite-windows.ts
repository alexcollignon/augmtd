// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE INVITE-WINDOW SWEEP (stabilization W5a · invariant 14 TIME TRUTH). DETERMINISTIC — ZERO AI.
//
// Lists every STORED prepared invite (a commitment's pooled `metadata.invite`, an inbox row's
// `source_data.prepared_invite`) whose proposed start is OUTSIDE the window the item's own words
// state, or already in the PAST — the exact class found live on Sep 23 ("September 30 or October 1"
// carrying a Sep 23 proposal). It asks THE SAME predicates the ONE reader asks (`stampTruth` +
// `inviteExpired`), so the census and the served page can never disagree.
//
// Dry-run by default (prints every affected invite). --apply files the artifact into the version
// chain (pool: `metadata.version_of = 'superseded:outside-window'`; inbox: the unsent
// prepared_invite is removed) so the pass re-prepares INSIDE the window — nothing else is written.
// Owner-gated. --user <email> or --all is required.
//   npx tsx scripts/sweep-invite-windows.ts [--apply] [--user email] [--all]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { poolRowsToArtifacts, preparedFromSourceData, stampTruth, commitmentTruthFacts, inboxTruthFacts, inviteExpired } from '../lib/prepare/read';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

(async () => {
  if (!ALL && !userArg) { console.log('usage: --user <email> | --all  [--apply]'); process.exit(1); }
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === userArg);
  let invites = 0, outside = 0, past = 0, written = 0;

  for (const u of targets) {
    // ── commitments: pooled invites (the pass's task_id) on OPEN rows ──
    const { data: pool } = await sb.from('item_deliverables')
      .select('id, entity_id, task_id, type, title, content, metadata, created_at')
      .eq('user_id', u.id).eq('kind', 'commitment').not('metadata->invite', 'is', null)
      .order('created_at', { ascending: false }).limit(2000);
    const byCommit = new Map<string, Array<Record<string, unknown>>>();
    for (const r of (pool ?? []) as Array<Record<string, unknown>>) {
      const arr = byCommit.get(String(r.entity_id)) ?? []; arr.push(r); byCommit.set(String(r.entity_id), arr);
    }
    const ids = [...byCommit.keys()];
    const facts = new Map<string, ReturnType<typeof commitmentTruthFacts>>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: cs } = await sb.from('commitments').select('id, description, created_at, status, direction').eq('user_id', u.id).in('id', ids.slice(i, i + 200));
      for (const c of (cs ?? []) as Array<Record<string, unknown>>) facts.set(String(c.id), commitmentTruthFacts(c as never));
    }
    for (const [cid, rows] of byCommit) {
      const f = facts.get(cid);
      if (!f) continue;   // the commitment is gone — the pool row is an orphan, not this sweep's business
      const arts = stampTruth(poolRowsToArtifacts(rows, 'commitment'), f);
      for (const a of arts) {
        if (a.kind !== 'invite') continue;
        invites++;
        const isPast = inviteExpired(a);
        if (!a.outsideWindow && !isPast) continue;
        if (a.outsideWindow) outside++; if (isPast) past++;
        console.log(`  · ${u.email} · commitment "${String(f.text ?? '').slice(0, 60)}" → invite ${a.invite?.startISO ?? '(no time)'}${a.outsideWindow ? ' OUTSIDE the stated window' : ''}${isPast ? ' PAST' : ''}${a.invite?.proposed ? ` (proposed${a.invite?.proposedFrom ? ` from ${a.invite.proposedFrom}` : ''})` : ''}`);
        if (APPLY && a.payload?.store === 'pool' && a.payload.rowId) {
          const rowId = a.payload.rowId;
          const row = rows.find((r) => String(r.id) === rowId);
          const meta = (row?.metadata ?? {}) as Record<string, unknown>;
          const { error } = await sb.from('item_deliverables')
            .update({ metadata: { ...meta, version_of: a.outsideWindow ? 'superseded:outside-window' : 'superseded:past-slot' } })
            .eq('id', rowId).eq('user_id', u.id);
          if (error) console.log(`    ✗ write failed: ${error.message}`); else written++;
        }
      }
    }
    // ── inbox rows: source_data.prepared_invite on PENDING items ──
    const { data: items } = await sb.from('inbox_items').select('id, source_data')
      .eq('user_id', u.id).eq('status', 'pending').not('source_data->prepared_invite', 'is', null).limit(2000);
    for (const it of (items ?? []) as Array<Record<string, unknown>>) {
      const sd = (it.source_data ?? {}) as Record<string, unknown>;
      const arts = stampTruth(preparedFromSourceData(sd as never), inboxTruthFacts(sd));
      const a = arts.find((x) => x.kind === 'invite');
      if (!a) continue;
      invites++;
      const isPast = inviteExpired(a);
      if (!a.outsideWindow && !isPast) continue;
      if (a.outsideWindow) outside++; if (isPast) past++;
      console.log(`  · ${u.email} · inbox "${String(sd.subject ?? '').slice(0, 60)}" → invite ${a.invite?.startISO ?? '(no time)'}${a.outsideWindow ? ' OUTSIDE the stated window' : ''}${isPast ? ' PAST' : ''}`);
      if (APPLY) {
        const { prepared_invite: _drop, ...rest } = sd;
        const { error } = await sb.from('inbox_items').update({ source_data: rest }).eq('id', it.id).eq('user_id', u.id);
        if (error) console.log(`    ✗ write failed: ${error.message}`); else written++;
      }
    }
  }
  console.log(`\nstored invites=${invites} · outside the stated window=${outside} · past=${past} · written=${written}${APPLY ? '' : ' (dry-run — pass --apply)'}`);
})();
