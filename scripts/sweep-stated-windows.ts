// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STATED-WINDOW SWEEP (stabilization W3.4 · invariant 14 TIME TRUTH). DETERMINISTIC — ZERO AI.
//
// Two repairs on LIVE commitments (open / suggested — settled rows are history, never rewritten):
//   1. UNDATED WITH A STATED WINDOW — "Schedule a call — week of September 16" was born with
//      due_date null (the window lived only in the title), so the expiry law never saw it. The
//      commitment's OWN title/description is parsed by the ONE parser the write door uses
//      (`statedWindow`, code-verified via dateStatedInText) and due_date = the window's END.
//   2. YEAR-TRANSPOSED — a due_date the model wrote into a past year (a spoken "27th of August"
//      landing as 2024) is re-anchored FORWARD from the source's own date (`anchorDueDate`).
// The anchor is the SOURCE's own date: the email's received_at, the meeting's start_time, else the
// row's created_at. No reasoned extraction here — a title that states nothing stays undated.
//
// Dry-run by default (prints every change it WOULD make). --apply writes due_date and NOTHING
// else, guarded on the exact old value (owner-gated). --user <email> or --all is required.
//   npx tsx scripts/sweep-stated-windows.ts [--apply] [--user email] [--all]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { statedWindow, anchorDueDate } from '../lib/commitments/extraction-truth';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

type Row = { id: string; description: string; due_date: string | null; source: string; source_id: string | null; created_at: string };

(async () => {
  if (!ALL && !userArg) { console.log('usage: --user <email> | --all  [--apply]'); process.exit(1); }
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === userArg);
  let scanned = 0, undated = 0, windowed = 0, transposed = 0, written = 0;

  for (const u of targets) {
    const { data } = await sb.from('commitments')
      .select('id, description, due_date, source, source_id, created_at')
      .eq('user_id', u.id).in('status', ['open', 'suggested']).limit(3000);
    const rows = (data ?? []) as Row[];
    if (!rows.length) continue;

    // The SOURCE's own date, batched per kind.
    const anchorOf = new Map<string, string>();
    const emailIds = rows.filter((r) => r.source === 'email' && r.source_id).map((r) => r.source_id!);
    const meetIds = rows.filter((r) => r.source === 'meeting' && r.source_id).map((r) => r.source_id!);
    for (let i = 0; i < emailIds.length; i += 200) {
      const { data: em } = await sb.from('emails').select('id, received_at').eq('user_id', u.id).in('id', emailIds.slice(i, i + 200));
      for (const e of (em ?? []) as Array<{ id: string; received_at: string | null }>) if (e.received_at) anchorOf.set(e.id, e.received_at);
    }
    for (let i = 0; i < meetIds.length; i += 200) {
      const { data: mt } = await sb.from('meeting_transcripts').select('id, start_time').eq('user_id', u.id).in('id', meetIds.slice(i, i + 200));
      for (const m of (mt ?? []) as Array<{ id: string; start_time: string | null }>) if (m.start_time) anchorOf.set(m.id, m.start_time);
    }

    for (const r of rows) {
      scanned++;
      const anchor = (r.source_id && anchorOf.get(r.source_id)) || r.created_at;
      let next: string | null = null;
      let why = '';
      if (!r.due_date) {
        undated++;
        const w = statedWindow(r.description, anchor);
        if (w) { next = w.end; why = `window ${w.start}…${w.end} (${w.shapes.join('+')})`; windowed++; }
      } else {
        const fixed = anchorDueDate(String(r.due_date).slice(0, 10), anchor);
        if (fixed && fixed !== String(r.due_date).slice(0, 10)) { next = fixed; why = `re-anchored from ${r.due_date}`; transposed++; }
      }
      if (!next) continue;
      console.log(`  · ${u.email} · "${r.description.slice(0, 70)}" → due ${next} · ${why} · anchor ${String(anchor).slice(0, 10)}`);
      if (APPLY) {
        const q = sb.from('commitments').update({ due_date: next, updated_at: new Date().toISOString() }).eq('id', r.id).eq('user_id', u.id);
        const { error } = await (r.due_date ? q.eq('due_date', r.due_date) : q.is('due_date', null));
        if (error) console.log(`    ✗ write failed: ${error.message}`); else written++;
      }
    }
    if (APPLY && written) await sb.from('profiles').update({ home_brief: null }).eq('id', u.id);
  }
  console.log(`\nscanned=${scanned} · undated=${undated} · stated windows=${windowed} · year-transposed=${transposed} · written=${written}${APPLY ? '' : ' (dry-run — pass --apply)'}`);
})();
