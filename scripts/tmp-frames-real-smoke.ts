// TEMP — retry frames-from-run on the pilot's REAL failed case (the CV report run on the
// workshop account) through the FIXED lane, with diagnostics. Never committed.
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  const u = data?.users?.find(x => x.email === 'rene@enbd.com');
  if (!u) { console.log('no rene@enbd.com'); process.exit(1); }
  const { data: wf } = await sb.from('workflows').select('id, name').eq('user_id', u.id).ilike('name', '%CV Screening%').maybeSingle();
  const { data: run } = await sb.from('workflow_runs').select('id, status, completed_at')
    .eq('workflow_id', wf!.id).eq('status', 'succeeded').order('completed_at', { ascending: false }).limit(1).maybeSingle();
  console.log('workflow:', wf?.name, '| run:', run?.id?.slice(0, 8), run?.status);
  if (!run) { console.log('no succeeded run'); process.exit(1); }

  // compactSource sanity on the run's real final text (no AI).
  const { data: full } = await sb.from('workflow_runs').select('step_outputs').eq('id', run.id).maybeSingle();
  const outs = (full?.step_outputs ?? []) as Array<{ output?: unknown }>;
  const finalText = String(outs[outs.length - 1]?.output ?? '');
  const { compactSource } = await import('../lib/frames/generate-frame');
  const compacted = compactSource(finalText, 14000);
  const tableRows = (s: string) => (s.match(/^\|.*\|$/gm) ?? []).length;
  console.log(`report: ${finalText.length} chars, ${tableRows(finalText)} table rows → compacted: ${compacted.length} chars, ${tableRows(compacted)} table rows`);

  // The real lane, end to end (AI + validator + storage).
  const { createFrameFromRun } = await import('../lib/frames/from-run');
  const t0 = Date.now();
  const res = await createFrameFromRun(sb, sb, u.id, { workflowId: wf!.id, runId: run.id });
  console.log(`frames-from-run → ${JSON.stringify({ ...res, html: undefined }).slice(0, 300)} in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
