// ════════════════════════════════════════════════════════════════════════════════════════════════
// TRANSCRIPTION QUALITY (labelled, zero-judge) — short spoken samples with KNOWN text (macOS `say`,
// EN/PT/DE/FR, generic fake content with numbers, names and dates) go through the product's REAL
// in-person recording path, exactly as /api/meetings/recordings/confirm drives it:
//   upload to `meeting-recordings/<probe>/…` → pre-insert the meeting_transcripts row → POST
//   MEETING_BOT_SERVICE_URL/transcribe (the Hetzner transcription service → its local Whisper) →
//   poll the row until the transcript lands.
// Metrics (scripts/lib/eval/quality-metrics.ts): word error rate · numbers/dates/names kept ·
// latency (POST → transcript) and real-time factor. The box is READ-ONLY here — nothing on it changes.
//
// SIDE EFFECTS (probe account only): the service calls generate-insights on the deployed app, which
// may mint items for the probe. Teardown waits for that to settle, then removes every row the run
// created on the probe (by table, user, created_at ≥ run start) and the uploaded audio.
//
//   npx tsx scripts/eval-transcription.ts                 # EU probe #2 (default), all four languages
//   npx tsx scripts/eval-transcription.ts --tier std --only en,pt
//   flags: --probe k (pool account #k, default 2) · --keep (skip teardown) · --show (print transcripts)
//          --no-vocab (omit the name vocabulary — the A/B baseline; by default each sample sends the
//          vocabulary the product would: company + attendee + entity names, plus unrelated decoys)
// Requires macOS (`say`, `afconvert`) and MEETING_BOT_SERVICE_URL + MEETING_BOT_SECRET in .env.local.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never);
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { wordErrorRate, tokensKept, pct } from './lib/eval/quality-metrics';
import { adminClient } from './lib/eval/engine/live';
import { resolveProbePool } from './lib/eval/engine/probes';
import { SYMMETRY_TABLES } from './lib/eval/engine/world';

const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] ?? null : null; };

/** `keep`: what must survive — a string, or alternatives any one of which counts (a date may print
 *  as "14 March 2026" or "March 14, 2026"). */
type Sample = { lang: string; /** a macOS system voice id (`say -v '?'`) */ voice: string; text: string; keep: Array<string | string[]>; vocab: string[] };
/** Names a real user's vocabulary would also carry that the sample never says — the list must help
 *  without leaking decoys into the transcript. */
const DECOYS = ['Umbrella Partners', 'Northwind', 'Q3 Launch', 'Jordan Vale'];

// The reference IS what `say` reads; written the way a transcript would print it (digits, %, €-less).
const SAMPLES: Sample[] = [
  {
    lang: 'en', voice: 'Samantha',
    text: 'Good morning everyone. This is Sam from Acme. The quarterly review is on 14 March 2026 at 10:30. Revenue grew 18% to 1.42 million euros. Please send the signed contract to Lee before Friday, and call the Globex office about invoice 4417.',
    keep: ['Acme', ['14 March 2026', 'March 14, 2026'], '10:30', '18%', '1.42', 'Lee', 'Globex', '4417'],
    vocab: ['Acme', 'Sam', 'Lee', 'Globex'],
  },
  {
    lang: 'pt', voice: 'Joana',
    text: 'Bom dia a todos. Fala a Ana, da Acme. A reunião de orçamento é no dia 9 de fevereiro de 2026, às 15 horas. O orçamento aprovado é de 12600 euros. Por favor enviem a proposta ao Sam até sexta-feira.',
    keep: ['Acme', '9 de fevereiro de 2026', ['15 horas', '15h'], '12600', 'Sam', 'sexta-feira'],
    vocab: ['Acme', 'Ana', 'Sam'],
  },
  {
    lang: 'de', voice: 'Anna',
    text: 'Guten Tag zusammen. Hier spricht Lee von Acme. Das Projektmeeting findet am 3. Juni 2026 um 9 Uhr statt. Das Budget beträgt 48000 Euro. Bitte schicken Sie den Vertrag bis Freitag an Globex.',
    keep: ['Acme', '3. Juni 2026', '9 Uhr', '48000', 'Globex', 'Freitag'],
    vocab: ['Acme', 'Lee', 'Globex'],
  },
  {
    lang: 'fr', voice: 'Thomas',
    text: "Bonjour à tous. Ici Sam, de chez Acme. La réunion de lancement aura lieu le 12 mai 2026 à 14 heures. Le budget prévu est de 7500 euros. Merci d'envoyer le contrat signé à Initech avant vendredi.",
    keep: ['Acme', '12 mai 2026', ['14 heures', '14h'], '7500', 'Initech', 'vendredi'],
    vocab: ['Acme', 'Sam', 'Initech'],
  },
];

function synth(dir: string, s: Sample): { file: string; seconds: number } {
  const aiff = path.join(dir, `${s.lang}.aiff`), m4a = path.join(dir, `${s.lang}.m4a`);
  execFileSync('say', ['-v', s.voice, '-o', aiff, s.text]);
  // AAC 32 kbps mono — the same bitrate class as the product's Opus recordings.
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '32000', '-c', '1', aiff, m4a]);
  const info = execFileSync('afinfo', [m4a]).toString();
  const seconds = Number(/estimated duration: ([\d.]+)/.exec(info)?.[1] ?? 0);
  return { file: m4a, seconds };
}

async function transcribe(admin: SupabaseClient, userId: string, s: Sample, file: string, tag: string) {
  const storagePath = `${userId}/eval-transcription-${tag}-${s.lang}.m4a`;
  const up = await admin.storage.from('meeting-recordings').upload(storagePath, readFileSync(file), { contentType: 'audio/mp4', upsert: true });
  if (up.error) throw new Error(`upload ${s.lang}: ${up.error.message}`);
  const id = randomUUID();
  const now = new Date();
  // The same pending row /api/meetings/recordings/confirm inserts.
  const ins = await admin.from('meeting_transcripts').insert({
    id, user_id: userId, meeting_id: randomUUID(), calendar_event_id: null,
    title: `Eval transcription (${s.lang})`, start_time: now.toISOString(), end_time: new Date(now.getTime() + 60_000).toISOString(),
    duration_minutes: 0, source: 'upload', recording_storage_path: storagePath, transcript: '', transcript_segments: [],
    attendees: [], processed: false, bot_state: 'processing', notes_structured: null,
  });
  if (ins.error) throw new Error(`row ${s.lang}: ${ins.error.message}`);
  const t0 = Date.now();
  const res = await fetch(`${process.env.MEETING_BOT_SERVICE_URL}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MEETING_BOT_SECRET}` },
    body: JSON.stringify({ storagePath, transcriptId: id, userId, source: 'upload', ...(argv.includes('--no-vocab') ? {} : { vocabulary: [...s.vocab, ...DECOYS] }) }),
  });
  if (res.status !== 202) throw new Error(`/transcribe ${s.lang}: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const { data, error } = await admin.from('meeting_transcripts').select('transcript, transcript_segments, bot_state').eq('id', id).maybeSingle();
    if (error) throw new Error(`poll ${s.lang}: ${error.message}`);
    const segs = (data?.transcript_segments ?? []) as Array<{ text?: string }>;
    if (segs.length) return { id, storagePath, ms: Date.now() - t0, text: segs.map((x) => x.text ?? '').join(' ') };
    if (data?.bot_state === 'failed') return { id, storagePath, ms: Date.now() - t0, text: '', failed: true };
    if (Date.now() - t0 > 10 * 60_000) return { id, storagePath, ms: Date.now() - t0, text: '', failed: true };
  }
}

async function sweep(admin: SupabaseClient, userId: string, startIso: string): Promise<string[]> {
  const removed: string[] = [];
  // The transcript's KB copy upserts on a title-derived key, so it is matched by title too.
  const { data: files } = await admin.from('knowledge_files').select('id').eq('user_id', userId)
    .or(`indexed_at.gte.${startIso},filename.like.*Eval transcription (*`);
  const fileIds = (files ?? []).map((f) => f.id as string);
  if (fileIds.length) {
    await admin.from('knowledge_chunks').delete().in('file_id', fileIds);
    const { error } = await admin.from('knowledge_files').delete().in('id', fileIds);
    if (!error) removed.push(`knowledge_files ${fileIds.length}`);
  }
  // Rows born in the run window (person_state is a per-person singleton — never time-deleted).
  const born = [...SYMMETRY_TABLES.filter((x) => !['knowledge_chunks', 'knowledge_files', 'knowledge_sources', 'person_state'].includes(x)), 'meeting_transcripts'];
  for (const t of born) {
    const { count, error } = await admin.from(t).delete({ count: 'exact' }).eq('user_id', userId).gte('created_at', startIso);
    if (error) { console.warn(`  teardown ${t}: ${error.message.slice(0, 160)}`); continue; }
    if (count) removed.push(`${t} ${count}`);
  }
  // A knowledge source the run minted (the meeting-notes source), only when no file still uses it.
  const { data: srcs } = await admin.from('knowledge_sources').select('id').eq('user_id', userId).gte('created_at', startIso);
  for (const src of srcs ?? []) {
    const { count } = await admin.from('knowledge_files').select('id', { count: 'exact', head: true }).eq('source_id', src.id);
    if (!count) { const { error } = await admin.from('knowledge_sources').delete().eq('id', src.id); if (!error) removed.push('knowledge_sources 1'); }
  }
  return removed;
}

async function teardown(admin: SupabaseClient, userId: string, startIso: string, ids: string[], paths: string[]) {
  // Let generate-insights settle: the row leaves 'processing' / turns processed when it is done; its
  // follow-on writes (commitments, the transcript's KB file) can land a little later — so sweep, wait,
  // and sweep again.
  const until = Date.now() + 180_000;
  while (ids.length && Date.now() < until) {
    const { data } = await admin.from('meeting_transcripts').select('id, bot_state, processed').in('id', ids);
    if (!(data ?? []).some((r) => r.bot_state === 'processing' || !r.processed)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  await new Promise((r) => setTimeout(r, 15_000));
  const removed = await sweep(admin, userId, startIso);
  await new Promise((r) => setTimeout(r, 30_000));
  removed.push(...(await sweep(admin, userId, startIso)).map((x) => `${x} (late)`));
  // Every eval audio object under the probe's folder (also ones a crashed run left behind).
  const { data: objs } = await admin.storage.from('meeting-recordings').list(userId, { search: 'eval-transcription-', limit: 1000 });
  const all = [...new Set([...paths, ...(objs ?? []).map((o) => `${userId}/${o.name}`)])].filter((p) => p.includes('/eval-transcription-'));
  if (all.length) await admin.storage.from('meeting-recordings').remove(all);
  console.log(`teardown: ${removed.join(' · ') || 'no rows'} · ${all.length} audio object(s)`);
}

async function main() {
  if (!process.env.MEETING_BOT_SERVICE_URL || !process.env.MEETING_BOT_SECRET) throw new Error('MEETING_BOT_SERVICE_URL / MEETING_BOT_SECRET missing');
  const tier = (opt('tier') ?? 'eu') === 'std' ? 'standard' : 'eu';
  const k = Number(opt('probe') ?? '2');
  if (k < 2) throw new Error('pool account #1 is the tier reference — use --probe 2+');
  const only = opt('only')?.split(',') ?? null;
  const admin = adminClient();
  const pool = await resolveProbePool(admin, { spec: { [tier]: [k] }, create: false });
  if (!pool.accounts.length) throw new Error(`probe ${tier}#${k} missing: ${[...pool.problems, ...pool.missing].join('; ')}`);
  const { userId, label, email } = pool.accounts[0];
  console.log(`probe ${label} (${email}) → ${new URL(process.env.MEETING_BOT_SERVICE_URL).host}/transcribe · vocabulary ${argv.includes('--no-vocab') ? 'OFF' : 'ON'}`);
  const startIso = new Date(Date.now() - 1000).toISOString();
  const dir = mkdtempSync(path.join(tmpdir(), 'eval-transcription-'));
  const tag = Date.now().toString(36);
  const rows: string[] = [];
  const ids: string[] = [], paths: string[] = [];
  let fails = 0;
  try {
    for (const s of SAMPLES) {
      if (only && !only.includes(s.lang)) continue;
      const { file, seconds } = synth(dir, s);
      const r = await transcribe(admin, userId, s, file, tag);
      ids.push(r.id); paths.push(r.storagePath);
      if (argv.includes('--show')) console.log(`\n[${s.lang}] REF: ${s.text}\n[${s.lang}] HYP: ${r.text}`);
      const wer = wordErrorRate(s.text, r.text);
      const lost = s.keep.filter((k) => (Array.isArray(k) ? k : [k]).every((alt) => tokensKept([alt], r.text).lost.length));
      const kept = { kept: s.keep.filter((k) => !lost.includes(k)), lost: lost.map((k) => (Array.isArray(k) ? k[0] : k)) };
      const leaked = argv.includes('--no-vocab') ? [] : DECOYS.filter((d) => r.text.toLowerCase().includes(d.toLowerCase()));
      if (leaked.length) kept.lost.push(`decoy leaked: ${leaked.join('/')}`);
      const ok = !('failed' in r) && wer <= 0.15 && kept.lost.length === 0;
      if (!ok) fails++;
      rows.push(`| ${s.lang} | ${ok ? 'PASS' : 'FAIL'} | ${pct(wer)} | ${kept.kept.length}/${s.keep.length}${kept.lost.length ? ` lost: ${kept.lost.join(', ')}` : ''} | ${seconds.toFixed(1)}s | ${(r.ms / 1000).toFixed(1)}s | ${seconds ? (r.ms / 1000 / seconds).toFixed(2) : '—'} |`);
    }
  } finally {
    if (!argv.includes('--keep')) await teardown(admin, userId, startIso, ids, paths).catch((e) => console.error('teardown failed:', e));
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('\n| lang | verdict | WER | names/numbers/dates kept | audio | latency (POST → transcript) | RTF |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(r);
  console.log(`\n${fails ? `✗ ${fails} sample(s) below the bar` : '✓ every sample at the bar'} (bar: WER ≤ 15%, every name/number/date kept)`);
  process.exitCode = fails ? 1 : 0;
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(String((e as Error)?.message ?? e).slice(0, 400)); process.exit(1); });
