// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LEAKED-MODEL-TEXT SWEEP (Sep 22, WAVE 0 — THE PRESENTATION LAW's repair half).
//
// The law stops NEW leaks (lib/converse/index.ts — a data read can no longer be served as the
// answer). This sweep deals with what already landed: assistant turns in `room_turns` whose text IS
// an executor's model-facing block — the `Tasks (N):` listing with bracketed uuids, the "Refer to
// tasks by NAME" instruction, a raw knowledge-base context block, a calendar block written for the
// model, a compute digest's instructions. They are ARCHIVED, never edited: a turn we cannot honestly
// rewrite as what the assistant meant to say should not stand as something it said.
//
// ⚠️ `room_turns` has NO `updated_at` column (the silent-column trap — a select naming it returns
// data:null). Every query here surfaces its `error`.
//
// Dry-run default; --apply archives. --all sweeps every user; --user <email> picks one.
//   npx tsx -r dotenv/config scripts/sweep-leaked-model-text.ts dotenv_config_path=.env.local [--apply] [--all] [--user email]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const userArg = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

/** The leaked SHAPES — each one is a block an executor writes for the model, and none of them is a
 *  sentence any of our voices would produce. Named so the report says WHICH class was found. */
const LEAK_SHAPES: Array<[string, RegExp]> = [
  ['list_tasks listing (uuids in brackets)', /^\s*Tasks \(\d+\):[\s\S]*\[[0-9a-f]{8}-[0-9a-f]{4}-/m],
  ['the "refer to tasks by NAME" instruction', /Refer to tasks by NAME when speaking to the user/i],
  ['get_task config dump (step ids / raw prompts)', /^\s*Steps \(\d+\):[\s\S]*\b(?:\[tool\]|\[ai\]|\[agent\]) id:/m],
  ['a knowledge-base context block', /RELEVANT KNOWLEDGE BASE \(from your indexed files/i],
  ['a calendar block written for the model', /^THE CALENDAR —/m],
  ['a compute digest addressed to the model', /Do NOT estimate the result by hand/i],
  ['a gate-verdict sentinel', /===GATE_VERDICT===/],
  ['a card marker in prose', /\[\[(?:artifact|card|email_draft|workflow_draft):/],
];

(async () => {
  const { data: users, error: uErr } = await sb.auth.admin.listUsers();
  if (uErr) { console.error('listUsers failed:', uErr); process.exit(1); }
  const targets = ALL ? users!.users : users!.users.filter((u) => u.email === (userArg ?? 'alextcollignon@gmail.com'));

  let scanned = 0, hits = 0, archived = 0;
  const byShape: Record<string, number> = {};

  for (const u of targets) {
    const { data: turns, error } = await sb.from('room_turns')
      .select('id, room_key, text, created_at, archived_at')
      // The assistant's own turns are stored with role 'system' (the one-narrator law — `role` is
      // 'user' | 'system' in lib/room/turns.ts); only the user's own words are excluded here.
      .eq('user_id', u.id).neq('role', 'user').is('archived_at', null)
      .order('created_at', { ascending: false }).limit(2000);
    if (error) { console.error(`  ${u.email}: read failed`, error); continue; }
    for (const t of (turns ?? []) as Array<{ id: string; room_key: string; text: string; created_at: string }>) {
      scanned++;
      const text = String(t.text ?? '');
      const shape = LEAK_SHAPES.find(([, re]) => re.test(text));
      if (!shape) continue;
      hits++;
      byShape[shape[0]] = (byShape[shape[0]] ?? 0) + 1;
      console.log(`  ${u.email} · ${t.created_at.slice(0, 10)} · room ${t.room_key.slice(0, 12)} · ${shape[0]}`);
      console.log(`      ↳ "${text.replace(/\s+/g, ' ').slice(0, 120)}"`);
      if (APPLY) {
        const { error: aErr } = await sb.from('room_turns')
          .update({ archived_at: new Date().toISOString() }).eq('id', t.id).eq('user_id', u.id);
        if (aErr) console.error('      ↳ archive failed', aErr); else archived++;
      }
    }
  }

  console.log(`\nusers=${targets.length} · assistant (system-role) turns scanned=${scanned} · leaked=${hits} · archived=${archived}`);
  for (const [k, n] of Object.entries(byShape)) console.log(`  · ${k}: ${n}`);
  if (!APPLY) console.log('(dry-run — pass --apply to archive)');
})();
