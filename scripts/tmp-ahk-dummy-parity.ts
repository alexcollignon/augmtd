// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DUMMY PARITY REPLICATION (Sep 15 — owner's word: replicate Thorsten's 3 workflows onto the
// AHK demo account `de4e8824`).
//
// The dummy's tender radar has been at parity since Sep 11; its two BRIEFING rows were
// deliberately left v1 on the Sep 2 "Thorsten only" call. This script copies Thorsten's current
// fixture-proven `steps` arrays (novelty blocks + verify gate w/ 10 rules incl. the
// bare-market-note R9 + €500k floor + labeled selection steps) WHOLESALE onto the dummy's two
// briefing rows. Steps carry no account-specific data; trigger/output_config/agent_id (the
// dummy's own coworker + owner-email delivery) are NOT touched. The radar is hash-compared and
// reported, never written.
//
// Safety: the dummy's previous steps are backed up to scratchpad/dummy-briefings-backup.json
// BEFORE any write; --rollback restores from that file. Post-write, steps are sha1-verified
// byte-identical to Thorsten's (the Sep 2 hash-verification idiom).
//
// Run:  npx tsx --env-file=.env.local scripts/tmp-ahk-dummy-parity.ts [--dry] [--rollback]
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const THORSTEN = '9d3921b2-5a52-4b5b-9815-bc49d37ce0a7';
const DUMMY = 'de4e8824-9795-4876-995c-c0740b8f07ee';
const NAMES = ['AHK Executive Briefing', 'AHK Mercado Alemão'];
const BACKUP = 'scratchpad/dummy-briefings-backup.json';
const DRY = process.argv.includes('--dry');
const ROLLBACK = process.argv.includes('--rollback');

const sha = (v: unknown) => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  if (ROLLBACK) {
    if (!existsSync(BACKUP)) { console.log(`✗ no backup at ${BACKUP}`); process.exit(1); }
    const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Record<string, { id: string; steps: unknown }>;
    for (const name of NAMES) {
      const b = backup[name];
      if (!b) { console.log(`✗ ${name}: not in backup`); process.exitCode = 1; continue; }
      const { error } = await sb.from('workflows').update({ steps: b.steps }).eq('id', b.id).eq('user_id', DUMMY);
      console.log(error ? `✗ ${name}: ${error.message}` : `  ↩ ${name} [${b.id.slice(0, 8)}]: restored (steps hash ${sha(b.steps)})`);
    }
    return;
  }

  const backup: Record<string, { id: string; steps: unknown }> = {};
  for (const name of NAMES) {
    const { data: src } = await sb.from('workflows').select('id, steps').eq('user_id', THORSTEN).eq('name', name).single();
    const { data: dst } = await sb.from('workflows').select('id, steps, trigger, output_config, agent_id').eq('user_id', DUMMY).eq('name', name).single();
    if (!src || !dst) { console.log(`✗ ${name}: source or target row missing`); process.exitCode = 1; continue; }

    const srcHash = sha(src.steps);
    const dstHash = sha(dst.steps);
    console.log(`\n${name}: Thorsten [${src.id.slice(0, 8)}] steps=${(src.steps as unknown[]).length} hash=${srcHash}`);
    console.log(`${' '.repeat(name.length)}  Dummy    [${dst.id.slice(0, 8)}] steps=${(dst.steps as unknown[]).length} hash=${dstHash}${srcHash === dstHash ? ' — ALREADY AT PARITY' : ''}`);
    if (srcHash === dstHash) continue;

    backup[name] = { id: dst.id, steps: dst.steps };
    if (DRY) { console.log(`  ~ would replace dummy steps with Thorsten's (${srcHash})`); continue; }
    const { error } = await sb.from('workflows').update({ steps: src.steps }).eq('id', dst.id).eq('user_id', DUMMY);
    if (error) { console.log(`  ✗ UPDATE failed: ${error.message}`); process.exitCode = 1; continue; }
    const { data: back } = await sb.from('workflows').select('steps, trigger, output_config, agent_id').eq('id', dst.id).single();
    const ok = sha(back?.steps) === srcHash;
    const deliveryKept = JSON.stringify(back?.output_config) === JSON.stringify(dst.output_config)
      && JSON.stringify(back?.trigger) === JSON.stringify(dst.trigger) && back?.agent_id === dst.agent_id;
    console.log(`  ${ok ? '✓' : '✗'} steps now ${sha(back?.steps)} (byte-parity ${ok ? 'VERIFIED' : 'FAILED'}) · delivery/trigger/coworker untouched: ${deliveryKept ? '✓' : '✗ CHANGED'}`);
    if (!ok || !deliveryKept) process.exitCode = 1;
  }

  // The radar — compare only, never write.
  const { data: srcR } = await sb.from('workflows').select('id, steps').eq('user_id', THORSTEN).eq('name', 'AHK Tender Matching').single();
  const { data: dstR } = await sb.from('workflows').select('id, steps').eq('user_id', DUMMY).eq('name', 'AHK Tender Matching').single();
  if (srcR && dstR) {
    const same = sha(srcR.steps) === sha(dstR.steps);
    console.log(`\nAHK Tender Matching: Thorsten ${sha(srcR.steps)} vs Dummy ${sha(dstR.steps)} — ${same ? 'AT PARITY ✓' : 'DIVERGED ⚠️ (not written — inspect)'}`);
    if (!same) process.exitCode = 1;
  }

  if (!DRY && Object.keys(backup).length) {
    mkdirSync('scratchpad', { recursive: true });
    writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
    console.log(`\nbackup of the dummy's previous steps → ${BACKUP} (rollback: --rollback)`);
  }
}
main().then(() => process.exit(process.exitCode ?? 0)).catch(e => { console.error('FAILED:', e); process.exit(1); });
