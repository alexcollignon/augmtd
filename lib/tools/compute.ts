// ─── run_compute — sandboxed code execution over the user's own files/data ──────────────────────
// Arc 1 of docs/one-surface-plan.md (the deliverable ceiling): a model WRITES a script; the
// compute service (infra/compute) is the locked room that RUNS it — --network none, read-only
// declared inputs, hard cpu/mem/time caps, non-root. This is the lesson of every trust law
// (fulfillment · dated-source · excerpt honesty) generalized: claims verified BY CODE, artifacts
// produced BY CODE, never model-asserted arithmetic.
//
// THE SANDBOX LAWS the executor upholds (structural):
//   • Inputs are DECLARED — only the named knowledge files / inline data reach the job; the
//     manifest is logged with the result (the observation record).
//   • The job can never send anything (no network in the room) — sends stay behind the one
//     commit door. This capability is REVERSIBLE by construction.
//   • FAILURE HONESTY: an unconfigured service, a failed download, or a non-zero exit returns
//     an honest failure naming what happened — never a fabricated result, never a silent pass.
//   • Outputs land in `work-artifacts` storage and index into the knowledge base (background,
//     non-fatal) so downstream steps/attachments can use them.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export interface ComputeConfig {
  description?: string;   // one line: what this computes (for the log/narration)
  script?: string;        // Python source (the model's own code)
  file_ids?: string[];    // knowledge_files ids to mount read-only at /job/inputs/<filename>
  data?: string;          // small inline text input → /job/inputs/data.txt
  timeout_s?: number;
  /** The work this computes FOR — outputs stamp entity_id so they enter the project's world
   *  (the room's Files tab, the grounding, the resolver). Caller-supplied, never guessed. */
  entityId?: string | null;
}

export const runComputeDefinition = {
  name: 'run_compute',
  description:
    'Run a Python script in a locked sandbox over files the user already has (spreadsheets, PDFs, CSVs, documents) ' +
    'or inline data — to parse, reconcile, verify numbers, transform data, or produce a data file (xlsx/csv/docx). ' +
    'The sandbox has NO network and cannot send anything. Available libraries: pandas, numpy, openpyxl, xlsxwriter, ' +
    'pypdf, python-docx, chardet, dateutil. CONTRACT: read inputs from /job/inputs/<filename> (read-only), write ' +
    'every output file to /job/out/, print your checks and findings to stdout. Use this instead of doing arithmetic ' +
    'or data transformation in your head — computed numbers are trustworthy, asserted ones are not.',
  input_schema: {
    type: 'object' as const,
    properties: {
      description: { type: 'string', description: 'One line: what this computation does' },
      script: { type: 'string', description: 'The Python script (reads /job/inputs, writes /job/out, prints checks)' },
      file_ids: { type: 'array', items: { type: 'string' }, description: 'Knowledge-base file ids to mount as inputs (from search_knowledge_base / find_file results)' },
      data: { type: 'string', description: 'Small inline text/CSV data — mounted at /job/inputs/data.txt' },
      timeout_s: { type: 'number', description: 'Wall-clock budget in seconds (default 60, max 120)' },
    },
    required: ['script'],
  },
};

const BUCKETS = ['drive-uploads', 'work-artifacts'] as const; // where storage-backed KB files live

function admin(): SupabaseClient {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** A signed URL for a knowledge file's raw bytes — the row doesn't record its bucket, so probe
 *  the known ones (uploads first — the common case). Null = not storage-backed (drive-connector). */
async function signedUrlFor(adminClient: SupabaseClient, storagePath: string): Promise<string | null> {
  for (const bucket of BUCKETS) {
    const { data } = await adminClient.storage.from(bucket).createSignedUrl(storagePath, 3600);
    if (data?.signedUrl) return data.signedUrl;
  }
  return null;
}

// ── THE RAW JOB RUNNER (DH6, the document compiler) — same locked room, but the caller gets
// the OUTPUT BYTES back (to materialize thread artifacts) instead of the KB-persist flow.
// Self-contained on purpose: the classic executeRunCompute path stays byte-identical. ──
export async function runComputeForOutputs(
  config: { script: string; data?: string; extraFiles?: Array<{ name: string; content_b64: string }>; timeout_s?: number },
): Promise<{ ok: boolean; stdout: string; stderr: string; outputs: Array<{ name: string; bytes: Buffer; mime: string }> } | null> {
  const serviceUrl = process.env.COMPUTE_SERVICE_URL;
  const secret = process.env.COMPUTE_SECRET;
  if (!serviceUrl || !secret || !config.script.trim()) return null;
  const files: Array<{ name: string; content_b64: string }> = [];
  if (config.data?.trim()) files.push({ name: 'data.txt', content_b64: Buffer.from(config.data).toString('base64') });
  for (const f of config.extraFiles ?? []) files.push(f);
  const timeoutS = Math.min(Math.max(Math.round(config.timeout_s ?? 90), 5), 120);
  try {
    const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ job_id: crypto.randomUUID(), script: config.script, files, timeout_s: timeoutS }),
      signal: AbortSignal.timeout((timeoutS + 30) * 1000),
    });
    if (!res.ok) return null;
    const out = await res.json() as { ok?: boolean; stdout?: string; stderr?: string; outputs?: Array<{ name: string; b64: string; mime: string }> };
    return {
      ok: !!out.ok,
      stdout: (out.stdout ?? '').trim(),
      stderr: (out.stderr ?? '').trim(),
      outputs: (out.outputs ?? []).map((o) => ({ name: o.name, bytes: Buffer.from(o.b64, 'base64'), mime: o.mime || 'application/octet-stream' })),
    };
  } catch { return null; }
}

export async function executeRunCompute(
  config: ComputeConfig, userId: string, supabase: SupabaseClient,
): Promise<string> {
  const serviceUrl = process.env.COMPUTE_SERVICE_URL;
  const secret = process.env.COMPUTE_SECRET;
  if (!serviceUrl || !secret) {
    return 'Compute is not configured on this deployment (COMPUTE_SERVICE_URL/COMPUTE_SECRET missing) — nothing was run. Do NOT estimate the result by hand; tell the user this computation is unavailable.';
  }
  const script = (config.script ?? '').trim();
  if (!script) return 'No script provided — nothing was run.';

  const adminClient = admin();
  const jobId = crypto.randomUUID();
  const files: Array<{ name: string; url?: string; content_b64?: string }> = [];
  const manifest: string[] = [];

  // ── Resolve the DECLARED inputs (user-scoped, no silent drops). ──
  const ids = [...new Set((config.file_ids ?? []).map(String))].slice(0, 20);
  if (ids.length) {
    const { data: rows } = await supabase.from('knowledge_files')
      .select('id, filename, storage_path, mime_type')
      .in('id', ids).eq('user_id', userId);
    const found = new Map((rows ?? []).map((r) => [String(r.id), r]));
    for (const id of ids) {
      const row = found.get(id);
      if (!row) return `Input file ${id} was not found in the knowledge base — nothing was run. Check the file id (use find_file / search_knowledge_base).`;
      if (!row.storage_path) {
        return `Input "${row.filename}" lives in a connected drive (not our storage) and can't be mounted into the sandbox yet — nothing was run. Ask the user to upload it, or work from its indexed text instead.`;
      }
      const url = await signedUrlFor(adminClient, String(row.storage_path));
      if (!url) return `Input "${row.filename}" could not be retrieved from storage — nothing was run.`;
      files.push({ name: String(row.filename), url });
      manifest.push(String(row.filename));
    }
  }
  if (config.data?.trim()) {
    files.push({ name: 'data.txt', content_b64: Buffer.from(config.data).toString('base64') });
    manifest.push('data.txt (inline)');
  }

  // ── Run (synchronous; the service enforces the caps). ──
  const timeoutS = Math.min(Math.max(Math.round(config.timeout_s ?? 60), 5), 120);
  let res: Response;
  try {
    res = await fetch(`${serviceUrl.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ job_id: jobId, script, files, timeout_s: timeoutS }),
      signal: AbortSignal.timeout((timeoutS + 30) * 1000),
    });
  } catch (e) {
    return `The compute service was unreachable (${e instanceof Error ? e.message : 'network error'}) — nothing was run. Do NOT estimate the result; report the failure.`;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return `The compute service rejected the job (${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}) — nothing was run.`;
  }
  const out = await res.json().catch(() => null) as {
    ok?: boolean; exit_code?: number; stdout?: string; stderr?: string; duration_ms?: number;
    outputs?: Array<{ name: string; b64: string; mime: string; size: number }>;
  } | null;
  if (!out) return 'The compute service returned an unreadable response — treat this run as failed.';

  const stdout = (out.stdout ?? '').trim().slice(-2500);
  if (!out.ok) {
    const stderr = (out.stderr ?? '').trim().slice(-1200);
    return `The script FAILED (exit ${out.exit_code ?? '?'}). Nothing was produced — never present partial results as done.\n` +
      (stdout ? `stdout:\n${stdout}\n` : '') + (stderr ? `stderr:\n${stderr}` : '');
  }

  // ── Persist outputs → work-artifacts storage + background KB indexing (non-fatal). ──
  const saved: string[] = [];
  for (const o of (out.outputs ?? []).slice(0, 10)) {
    try {
      const path = `compute/${userId}/${jobId}/${o.name}`;
      const bytes = Buffer.from(o.b64, 'base64');
      const { error } = await adminClient.storage.from('work-artifacts')
        .upload(path, bytes, { contentType: o.mime || 'application/octet-stream', upsert: true });
      if (error) { saved.push(`${o.name} (STORE FAILED: ${error.message})`); continue; }
      saved.push(`${o.name} (${Math.round((o.size ?? bytes.length) / 1024)} KB)`);
      // Index into the KB so find_file / attachments / later steps can use it — and stamp the
      // entity (Arc 1 close-out: a compute artifact enters ITS PROJECT'S world — the room's
      // Files tab, the grounding, the resolver — not a loose orphan). Chained after the index
      // so the row exists; non-fatal throughout.
      import('@/lib/knowledge/indexer').then(({ indexArtifact }) =>
        indexArtifact({ artifactId: `compute::${jobId}::${o.name}`, storagePath: path, filename: o.name, mimeType: o.mime || 'application/octet-stream', userId }, adminClient)
          .then(() => config.entityId
            ? adminClient.from('knowledge_files').update({ entity_id: config.entityId })
                .eq('user_id', userId).eq('provider_file_id', `compute::${jobId}::${o.name}`).then(() => {})
            : undefined),
      ).catch(() => {});
    } catch { saved.push(`${o.name} (STORE FAILED)`); }
  }

  return [
    `Computed${config.description ? `: ${config.description}` : ''} (sandboxed, ${out.duration_ms ?? '?'}ms; inputs: ${manifest.length ? manifest.join(', ') : 'none'}).`,
    stdout ? `Script output:\n${stdout}` : null,
    saved.length ? `Files produced (saved to the knowledge base):\n${saved.map((s) => `- ${s}`).join('\n')}` : null,
  ].filter(Boolean).join('\n\n');
}
