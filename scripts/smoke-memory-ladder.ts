// smoke-memory-ladder.ts — W2.4 THE MEMORY LADDER gate (invariant 6, ONE FACT ONE HOME).
//
// ZERO AI. Default run is ZERO DB (source floors + pure tests) so it sits on the board.
// `--live` adds a READ-ONLY census: coworker memory_text rows that look like they hold client/
// project facts (heuristic), and standing workflows whose worker_instructions sit at the old
// 4000-char tail cap (method at risk / already cut). Numbers only, no writes.
//
// Run: npx tsx scripts/smoke-memory-ladder.ts [--live]
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  normalizeFact, cleanFact, routeFactScope, capMemoryKeepHead, splitMemoryHeadTail, mergeMemoryLines, uniqCap,
  MEMORY_TEXT_MAX, MEMORY_HEAD_KEEP,
} from '../lib/memory/file-fact';
import {
  parseWorkerInstructions, renderWorkerInstructions, addStandingFeedback, foldFeedback,
  FEEDBACK_MAX_ENTRIES, FEEDBACK_MAX_AGE_DAYS,
} from '../lib/workflows/worker-instructions';
import { parseFacts } from '../lib/agents/extract-memory';

const ROOT = join(__dirname, '..');
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

function walk(dir: string, files: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return files; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, files);
    else if (/\.(ts|tsx)$/.test(e)) files.push(p);
  }
  return files;
}
const rel = (f: string) => f.replace(ROOT + '/', '');
const treeFiles = ['lib', 'app'].flatMap((d) => walk(join(ROOT, d))).map(rel);

(async () => {
  // ── SOURCE FLOORS ─────────────────────────────────────────────────────────────────────────────
  const ex = src('lib/agents/extract-memory.ts');
  check('ML1: extractAgentMemory never writes memory_text / agent_memories / context_profiles / work_entities itself — every write is fileFact',
    !/\.from\('custom_agents'\)[\s\S]{0,200}\.update\(/.test(ex) && !ex.includes(".from('agent_memories')\n      .upsert") && !/agent_memories'\)[\s\S]{0,120}upsert\(/.test(ex)
    && !ex.includes("from('context_profiles')") && !ex.includes("from('work_entities')") && /fileFact\(/.test(ex));
  check('ML2: the extraction asks for a SCOPE per fact (coworker_method · user · project) and names its contract (schema label; no cache keys on it)',
    ex.includes('"scope":"coworker_method|user|project"') && /export const MEMORY_EXTRACTION_SCHEMA = 'scoped-facts-v\d+'/.test(ex)
    && ex.includes('NEVER a fact about a client, a deal, a project or a person'));
  check('ML3: the home is decided by CODE (routeFactScope) with the thread\'s RECOGNIZED entity — a project fact without an entity drops, never the coworker',
    ex.includes('routeFactScope(f.scope, { entityId: entity?.id ?? null })') && ex.includes('resolveThreadEntity(') && ex.includes("if (scope === 'drop') { dropped++; continue; }"));
  check('ML4: no head-truncating slice on memory_text anywhere (the old `.slice(0, MAX_MEMORY_CHARS)` is dead)',
    !/memory_text:\s*[A-Za-z]+\.slice\(0,/.test(ex) && !/newMemory\.slice\(0/.test(ex));
  {
    const ff = src('lib/memory/file-fact.ts');
    check('ML5: fileFact is THE ONE WRITER — coworker memory goes through mergeMemoryLines + capMemoryKeepHead; the identity row through mergeUserIdentity; the entity through executeRememberFact',
      ff.includes('capMemoryKeepHead(text, MEMORY_TEXT_MAX)') && ff.includes('mergeMemoryLines(existing, facts)')
      && ff.includes('executeRememberFact({ client, userId }, { fact: f, entityId: opts.entityId })')
      && ff.includes("onConflict: 'user_id,profile_type'") && !/\.slice\(0,\s*MEMORY_TEXT_MAX\)/.test(ff));
    check('ML6: every real write logs provenance (memory_filed activity)',
      ff.includes("type: 'memory_filed'") && src('lib/activity/log.ts').includes("| 'memory_filed'"));
  }
  {
    const im = src('lib/context/intake-memory.ts');
    check('ML7: the intake lane (the interview) files through the ladder\'s identity merge — no private context_profiles upsert',
      im.includes('mergeUserIdentity(admin, userId') && !im.includes("from('context_profiles').upsert") && !/function uniqCap/.test(im));
  }
  {
    // Only the ladder (and the onboarding identity seeds) may upsert the identity row as a LEARNED-fact writer.
    const allowed = new Set(['lib/memory/file-fact.ts', 'lib/context/profile-loader.ts', 'lib/context/work-patterns-service.ts', 'app/api/settings/memory/route.ts']);
    const offenders = treeFiles.filter((f) => !allowed.has(f) && /profile_type:\s*'identity'[\s\S]{0,80}profile_data/.test(src(f)) && /upsert\(/.test(src(f)));
    check('ML8: no learned-fact writer outside the ladder upserts the identity row (onboarding seeds + the settings editor are the allowlist)',
      offenders.length === 0, offenders.join(', '));
  }
  {
    const stg = src('lib/workflows/standing.ts');
    check('ML9: steer_standing_task appends through addStandingFeedback — the tail cap `slice(-4000)` / `appended.length > 4000` is dead',
      stg.includes('addStandingFeedback(wf.worker_instructions') && !stg.includes('appended.length > 4000') && !/slice\(appended\.length/.test(stg));
    const offenders = treeFiles.filter((f) => /worker_instructions[\s\S]{0,160}\.slice\(-\d+\)|\.slice\(\w+\.length - 4000\)/.test(src(f)));
    check('ML10: no reader or writer tail-truncates worker_instructions', offenders.length === 0, offenders.join(', '));
    const wi = src('lib/workflows/worker-instructions.ts');
    check('ML11: the worker-instructions module never slices the method',
      !/\bmethod\.slice\(|method:\s*[^\n,]*\.slice\(|\.method\.slice\(/.test(wi) && wi.includes('STANDING FEEDBACK ('));
  }
  {
    // Both DM runtimes ride the one extraction path.
    check('ML12: both DM runtimes call the one extractor (native → /extract-memory route → extractAgentMemory; AgentOS bridge → extractAgentMemory)',
      src('lib/work/agentos-bridge.ts').includes('extractAgentMemory(agentId, userId, threadId, adminClient)')
      && src('app/api/agents/[id]/extract-memory/route.ts').includes('extractAgentMemory(agentId, user.id, threadId, adminClient, supabase)')
      && src('app/api/work/threads/[id]/chat/route.ts').includes('/extract-memory'));
  }

  // ── PURE TESTS ────────────────────────────────────────────────────────────────────────────────
  // Scope routing.
  check('MP1: project fact + linked thread → project', routeFactScope('project', { entityId: 'e1' }) === 'project');
  check('MP2: project fact + UNLINKED thread → drop (never the coworker, never a guess)', routeFactScope('project', { entityId: null }) === 'drop');
  check('MP3: user fact → user regardless of link', routeFactScope('user', { entityId: null }) === 'user' && routeFactScope('user', { entityId: 'e1' }) === 'user');
  check('MP4: coworker_method → coworker_method', routeFactScope('coworker_method', { entityId: null }) === 'coworker_method');
  check('MP5: an unknown/unscoped proposal drops', routeFactScope('client', { entityId: 'e1' }) === 'drop' && routeFactScope('', { entityId: 'e1' }) === 'drop');
  // The parser: a legacy bullet list (no scopes) yields nothing — the coworker is never the default home.
  check('MP6: parseFacts reads fenced JSON and refuses an unscoped legacy bullet list',
    parseFacts('```json\n{"facts":[{"fact":"Prefers short replies","scope":"coworker_method"}]}\n```').length === 1
    && parseFacts('- Client wants the deck by Friday\n- Prefers formal tone').length === 0);
  // Dedupe.
  check('MP7: normalizeFact — bullet/case/punctuation/whitespace-insensitive', normalizeFact('- Always CC me.') === normalizeFact('always  cc me') && cleanFact('•  keep it short ') === 'keep it short');
  {
    const m = mergeMemoryLines('- Always CC me\n- No emojis', ['always cc me.', 'Keep it under 200 words']);
    check('MP8: mergeMemoryLines dedupes against existing lines and appends the new', m.added.length === 1 && m.skipped.length === 1 && m.text.endsWith('- Keep it under 200 words'));
  }
  // The head-keep cap.
  {
    const lines = Array.from({ length: 60 }, (_, i) => `- fact number ${i} about how to work, padded to a realistic length here`);
    const text = lines.join('\n');
    const capped = capMemoryKeepHead(text, MEMORY_TEXT_MAX);
    check('MP9: capMemoryKeepHead keeps the HEAD whole (line 0 first, never mid-line) and drops the newest that do not fit',
      capped.length <= MEMORY_TEXT_MAX && capped.startsWith(lines[0]) && capped.split('\n').every((l) => lines.includes(l)) && !capped.includes(lines[59]));
    const { head, tail } = splitMemoryHeadTail(text);
    check('MP10: splitMemoryHeadTail cuts on a line boundary at or before the head watermark; head + tail = the whole',
      head.length <= MEMORY_HEAD_KEEP && !head.endsWith('\n') && `${head}\n${tail}` === text);
  }
  check('MP11: uniqCap keeps the NEWEST when over cap and never duplicates', (() => {
    const r = uniqCap(['a', 'b', 'c'], ['B', 'd', 'e'], 4, 50);
    return r.length === 4 && r[0] === 'b' && r[3] === 'e' && !r.includes('a');
  })());
  // Worker instructions: method + feedback[].
  {
    const method = 'Write as a sober analyst. Three sections: Facts, Relevance, Assessment. Never advise.';
    let raw: string | null = method;
    for (let i = 0; i < 30; i++) {
      const day = `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`;
      raw = addStandingFeedback(raw, `feedback number ${i}: `.padEnd(380, 'x'), day).rendered;
    }
    const parsed = parseWorkerInstructions(raw);
    check('MF1: after 30 feedback rounds the METHOD is byte-identical (never truncated)', parsed.method === method);
    check(`MF2: feedback is capped by count (≤ ${FEEDBACK_MAX_ENTRIES}) and the oldest folded into one summary line`,
      parsed.feedback.length <= FEEDBACK_MAX_ENTRIES && !!parsed.folded && parsed.folded.includes('feedback number'));
    check('MF3: the rendered string still carries the legacy STANDING FEEDBACK (day): grammar every reader consumes', /STANDING FEEDBACK \(\d{4}-\d{2}-\d{2}\): /.test(raw ?? ''));
    // Legacy-format round trip: the exact string the old door wrote parses as method + entries.
    const legacy = `${method}\n\nSTANDING FEEDBACK (2026-08-01): less macro, more tenders\n\nSTANDING FEEDBACK (2026-08-08): always name the source`;
    const p2 = parseWorkerInstructions(legacy);
    check('MF4: the legacy appended format parses (method + 2 dated entries) and re-renders identically',
      p2.method === method && p2.feedback.length === 2 && p2.feedback[1].text === 'always name the source' && renderWorkerInstructions(p2) === legacy);
    // Age fold.
    const aged = foldFeedback({ method, feedback: [{ day: '2025-01-01', text: 'old note' }, { day: '2026-09-20', text: 'fresh note' }], folded: null }, '2026-09-22');
    check(`MF5: feedback older than ${FEEDBACK_MAX_AGE_DAYS} days folds; fresh stays verbatim; method untouched`,
      aged.feedback.length === 1 && aged.feedback[0].text === 'fresh note' && (aged.folded ?? '').includes('old note') && aged.method === method);
    check('MF6: an empty/legacy-null column parses to an empty method and renders empty', parseWorkerInstructions(null).method === '' && renderWorkerInstructions(parseWorkerInstructions(null)) === '');
  }

  // ── REPORT ────────────────────────────────────────────────────────────────────────────────────
  let fails = 0;
  for (const [n, ok, d] of out) { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); }
  console.log(`\nsmoke-memory-ladder: ${out.length - fails}/${out.length}`);

  if (process.argv.includes('--live')) await census();
  process.exit(fails ? 1 : 0);
})();

async function census() {
  const { config } = await import('dotenv'); config({ path: '.env.local' });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.log('\n(census skipped — no env)'); return; }
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  console.log('\nCENSUS (read-only):');
  // Coworker memories that look like they hold client/project facts — heuristic: a line naming a
  // client/deal/project/contract/proposal/tender/invoice/deadline, or a capitalized org-shaped token
  // beside "wants/needs/asked/due/deadline".
  const CLIENTY = /\b(client|customer|deal|project|contract|proposal|tender|invoice|deadline|due (?:on|by)|counterparty|prospect|pilot|renewal|quote)\b/i;
  const { data: agents } = await sb.from('custom_agents').select('id, user_id, memory_text').eq('is_worker', true).not('memory_text', 'is', null).limit(2000);
  const rows = (agents ?? []).filter((a) => String(a.memory_text ?? '').trim());
  let clienty = 0, clientyLines = 0, atCap = 0;
  for (const a of rows) {
    const lines = String(a.memory_text).split('\n').filter((l) => l.trim());
    const hits = lines.filter((l) => CLIENTY.test(l)).length;
    if (hits) { clienty++; clientyLines += hits; }
    if (String(a.memory_text).length >= MEMORY_TEXT_MAX - 50) atCap++;
  }
  console.log(`  coworker memory_text rows (non-empty): ${rows.length}`);
  console.log(`  …with ≥1 client/project-looking line (heuristic): ${clienty} rows · ${clientyLines} lines`);
  console.log(`  …sitting at the 2000-char cap (head-cut risk under the old slice): ${atCap}`);
  const { data: mems } = await sb.from('agent_memories').select('agent_id, memory_text').not('memory_text', 'is', null).limit(2000);
  const memRows = (mems ?? []).filter((m) => String(m.memory_text ?? '').trim());
  console.log(`  agent_memories rows (non-owner): ${memRows.length} · client-looking: ${memRows.filter((m) => String(m.memory_text).split('\n').some((l) => CLIENTY.test(l))).length}`);
  // Standing workflows: worker_instructions with feedback, and those at/over the old 4000 tail cap.
  const { data: wfs } = await sb.from('workflows').select('id, status, trigger, worker_instructions').not('worker_instructions', 'is', null).limit(5000);
  const withWi = (wfs ?? []).filter((w) => String(w.worker_instructions ?? '').trim());
  const withFb = withWi.filter((w) => /STANDING FEEDBACK \(/.test(String(w.worker_instructions)));
  const atTail = withWi.filter((w) => String(w.worker_instructions).length >= 3900);
  const over = withWi.filter((w) => String(w.worker_instructions).length > 4000);
  const cutMethod = withFb.filter((w) => { const p = parseWorkerInstructions(String(w.worker_instructions)); return !p.method || /^[a-z]/.test(p.method); });
  console.log(`  workflows with worker_instructions: ${withWi.length} · with STANDING FEEDBACK entries: ${withFb.length}`);
  console.log(`  …at the old 4000 tail cap (≥3900 chars, method at risk): ${atTail.length} · over 4000 (impossible under the old cap): ${over.length}`);
  console.log(`  …with feedback whose parsed method is empty or starts mid-sentence (already cut): ${cutMethod.length}`);
}
