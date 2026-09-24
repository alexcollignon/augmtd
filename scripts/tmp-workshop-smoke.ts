// ─── TEMP SMOKE: THE WORKSHOP KIT, END TO END, ON THE PROBE HOST — never committed ───────────
// Real data (the participant pack's HR folder), the real seeding path (seed-kits bucket +
// settings.seed_kit manifest on a THROWAWAY company + seedKnowledgeForUser), the real indexer,
// the real read_kb_folder executor, and the REAL workshop prompt through generateWorkflowConfig.
// Additive only; --clean removes exactly what was seeded (company, storage, folder, files).
//
// Run:   npx tsx --env-file=.env.local scripts/tmp-workshop-smoke.ts
// Clean: npx tsx --env-file=.env.local scripts/tmp-workshop-smoke.ts --clean
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { resolveProbeUser } from './probe-user';

const PACK = '/Users/alexandrecollignon/Downloads/AUGMTD_Participant_Data_Pack/01_HR_CV_Screening';
const KIT_FOLDER = '01_HR_CV_Screening';
const CO_SLUG = 'tmp-workshop-smoke';

const WORKSHOP_PROMPT = `Use the Augmtd Knowledge Base folder "${KIT_FOLDER}" as the sole source of truth. The folder contains: 1 job description, 1 CV screening rubric, 10 individual candidate CVs with deliberately different levels of fit.
Create the following workflow:
1. Retrieve Job Requirements — Read the job description and extract the required skills, experience, education, domain knowledge, seniority, and other explicit requirements.
2. Retrieve Screening Rubric — Read the screening rubric and convert it into clear evaluation criteria, scoring rules, weights, and decision thresholds.
3. Human Approval: Confirm Screening Criteria — Present the extracted requirements, rubric, weights, and thresholds to an HR reviewer. The workflow may continue only after approval. If rejected, return the criteria for revision.
4. Review Candidate CVs — Process all 10 CVs individually. Extract only information explicitly contained in each CV that is relevant to the approved requirements and rubric.
5. Score Candidates — Score every candidate against each rubric criterion. Provide a concise evidence-based justification for every score. Do not introduce criteria that are not present in the job description or rubric.
6. Apply Guardrails — Do not infer or evaluate candidates based on protected or sensitive characteristics. Ignore age, gender, ethnicity, nationality, religion, marital status, photographs, or other characteristics unrelated to the stated selection criteria. Do not fabricate missing qualifications or evidence.
7. Rank & Recommend Candidates — Calculate the overall score for each candidate and rank all 10 candidates. Classify each as Shortlist, Review, or Do Not Shortlist.
8. Human Approval: Validate Shortlist — Present the proposed ranking, scores, evidence, and recommendations to an HR reviewer. Require explicit approval before finalizing the shortlist.
9. Generate Screening Report — Create a final structured output containing: Candidate | Overall Fit | Criterion Scores | Key Evidence | Strengths | Gaps | Recommendation. Conclude with a ranked overview of all candidates and why the top candidates best match the role.
The workflow must run end-to-end inside Augmtd.ai, automatically use the documents in the ${KIT_FOLDER} folder, process all 10 CVs, and produce the final screening report. Every score, conclusion, and recommendation must be traceable to evidence from the Knowledge Base.`;

function admin(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}
const packFiles = () => readdirSync(PACK).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();

async function clean(sb: SupabaseClient, uid: string) {
  const files = packFiles();
  const { data: folder } = await sb.from('drive_folders').select('id').eq('user_id', uid).ilike('name', KIT_FOLDER).maybeSingle();
  if (folder) {
    const { data: kf } = await sb.from('knowledge_files').select('id, storage_path').eq('user_id', uid).eq('folder_id', folder.id);
    for (const f of kf ?? []) {
      if (f.storage_path) await sb.storage.from('drive-uploads').remove([f.storage_path]).catch(() => {});
      await sb.from('knowledge_chunks').delete().eq('file_id', f.id);
    }
    await sb.from('knowledge_files').delete().eq('user_id', uid).eq('folder_id', folder.id);
    await sb.from('drive_folders').delete().eq('id', folder.id);
    console.log(`cleaned folder + ${(kf ?? []).length} files`);
  }
  const { data: co } = await sb.from('companies').select('id').eq('slug', CO_SLUG).maybeSingle();
  if (co) {
    await sb.storage.from('seed-kits').remove(files.map((f) => `${co.id}/${KIT_FOLDER}/${f}`)).catch(() => {});
    await sb.from('companies').delete().eq('id', co.id);
    console.log('cleaned throwaway company + kit storage');
  }
}

async function main() {
  const sb = admin();
  const uid = await resolveProbeUser(sb);
  if (process.argv.includes('--clean')) { await clean(sb, uid); return; }

  const files = packFiles();
  console.log(`pack: ${files.length} PDFs`);
  const fails: string[] = [];
  const ok = (cond: boolean, label: string) => { console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`); if (!cond) fails.push(label); };

  // ── 1. Throwaway company + kit upload (the REAL admin path's storage/manifest shape). ──
  await clean(sb, uid); // idempotent re-run
  const { data: co, error: coErr } = await sb.from('companies').insert({
    name: 'Tmp Workshop Smoke Co', slug: CO_SLUG, plan: 'starter', type: 'internal', status: 'active',
    join_code: `TMPSMK${Math.floor(Math.random() * 900 + 100)}`,
  }).select('id, settings').single();
  if (coErr || !co) { console.error('company insert failed:', coErr); process.exit(1); }
  await sb.storage.createBucket('seed-kits', { public: false }).catch(() => {});
  const manifestFiles: Array<{ name: string; path: string; mime: string; size: number }> = [];
  for (const f of files) {
    const buf = readFileSync(join(PACK, f));
    const path = `${co.id}/${KIT_FOLDER}/${f}`;
    const { error } = await sb.storage.from('seed-kits').upload(path, buf, { contentType: 'application/pdf', upsert: true });
    if (error) { console.error(`upload failed ${f}:`, error.message); process.exit(1); }
    manifestFiles.push({ name: f, path, mime: 'application/pdf', size: buf.length });
  }
  await sb.from('companies').update({
    settings: { ...(co.settings ?? {}), seed_kit: { folders: [{ name: KIT_FOLDER, files: manifestFiles }], updated_at: new Date().toISOString() } },
  }).eq('id', co.id);
  console.log(`kit staged: ${manifestFiles.length} files on throwaway company ${co.id}`);

  // ── 2. The clone (the join door's exact call) + indexing. ──
  const { seedKnowledgeForUser } = await import('../lib/workspace/seed-kb');
  const t0 = Date.now();
  const r1 = await seedKnowledgeForUser(sb, co.id, uid);
  console.log(`seed #1 → ${JSON.stringify(r1)} in ${Math.round((Date.now() - t0) / 1000)}s`);
  ok(r1.files === files.length && r1.failed === 0, `seed indexed all ${files.length} files, zero failures`);

  // ── 3. KB truth: folder exists, every file has real extracted text. ──
  const { data: folder } = await sb.from('drive_folders').select('id, name').eq('user_id', uid).ilike('name', KIT_FOLDER).maybeSingle();
  ok(!!folder, 'drive folder created');
  const { data: kf } = await sb.from('knowledge_files').select('id, filename').eq('user_id', uid).eq('folder_id', folder!.id);
  ok((kf ?? []).length === files.length, `knowledge_files rows: ${(kf ?? []).length}/${files.length}`);
  let chunkless = 0;
  for (const f of kf ?? []) {
    const { count } = await sb.from('knowledge_chunks').select('id', { count: 'exact', head: true }).eq('file_id', f.id);
    if (!count) { chunkless++; console.log(`    · no chunks: ${f.filename}`); }
  }
  ok(chunkless === 0, 'every file has extracted, chunked text');

  // ── 4. Idempotency: the second pass must skip everything. ──
  const r2 = await seedKnowledgeForUser(sb, co.id, uid);
  ok(r2.files === 0 && r2.skipped === files.length, `re-seed skips all (${JSON.stringify(r2)})`);

  // ── 5. read_kb_folder, the real executor. ──
  const { executeStep } = await import('../lib/workflows/execute-step');
  const out = await executeStep(
    { type: 'tool', id: 's1', label: 'Read the kit folder', tool: 'read_kb_folder', config: { folder: KIT_FOLDER } },
    { userId: uid, supabase: sb, previousOutputs: [], workflowName: 'tmp-workshop-smoke' },
  );
  const text = String(out.output ?? '');
  console.log(`  header: ${text.split('\n')[0]}`);
  const sections = (text.match(/=== FILE: /g) ?? []).length;
  ok(!out.error, `step ran without error${out.error ? ` (got: ${out.error})` : ''}`);
  ok(sections === files.length, `folder read has ${sections}/${files.length} file sections`);
  for (const f of files) if (!text.includes(`=== FILE: ${f} ===`)) ok(false, `missing section: ${f}`);
  ok(!text.includes('(not yet indexed)'), 'no unindexed sections');
  ok(text.includes('Job_Description') && /CV_10/.test(text), 'JD and CV_10 both present');

  // ── 6. The REAL workshop prompt through generate-config. ──
  const { generateWorkflowConfig } = await import('../lib/workflows/generate-config');
  const cfg = await generateWorkflowConfig(WORKSHOP_PROMPT, uid, sb);
  if (!cfg) { ok(false, 'generateWorkflowConfig returned null'); }
  else {
    const steps = (cfg.steps ?? []) as Array<{ type: string; tool?: string; label?: string; config?: Record<string, unknown> }>;
    console.log('  generated steps:');
    for (const s of steps) console.log(`    · [${s.type}${s.tool ? `:${s.tool}` : ''}] ${s.label ?? ''}${s.config?.folder ? ` (folder: ${String(s.config.folder)})` : ''}`);
    const folderSteps = steps.filter((s) => s.tool === 'read_kb_folder');
    const approvals = steps.filter((s) => s.type === 'approval');
    ok(folderSteps.length >= 1, `≥1 read_kb_folder step (got ${folderSteps.length})`);
    ok(folderSteps.every((s) => String(s.config?.folder ?? '').includes(KIT_FOLDER)), 'folder steps carry the right folder name');
    ok(approvals.length >= 2, `≥2 approval steps (got ${approvals.length})`);
    ok(steps.some((s) => s.type === 'verify') || approvals.length >= 2, 'a verify gate or both human gates present');
  }

  console.log(fails.length ? `\nRESULT: ${fails.length} FAILURE(S)` : '\nRESULT: ALL GREEN');
  console.log('(seeded data left in place for eyeballing — clean with --clean)');
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
