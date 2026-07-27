// ONE-TIME reasoned RE-TITLE sweep — commitments extracted BEFORE the title law carry meeting-notes
// phrasing ("Identify specific repetitive task or team use case consuming significant weekly hours
// suitable for…"). This rewrites OPEN commitments' descriptions to the title law (short imperative,
// ≤~9 words, verb-first, names the deliverable) via one cheap reasoned batch per user — same meaning,
// tighter title; the model may answer keep:true when a title is already right (no churn). Steps and
// all other fields untouched. Dry-run by default; `--apply` writes.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { aiCall } from '../lib/ai/call';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

(async () => {
  const { data: uidRows } = await sb.from('work_entities').select('user_id').limit(2000);
  const users = [...new Set(((uidRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))];
  for (const uid of users) {
    const { data: rows } = await sb.from('commitments').select('id, description')
      .eq('user_id', uid).in('status', ['open', 'pending', 'in_progress']).limit(200);
    // Only titles that plausibly need work (long, or narration-shaped) go to the model — a short
    // imperative stays untouched without a call.
    const cands = ((rows ?? []) as Array<{ id: string; description: string }>)
      .filter((r) => (r.description ?? '').trim().split(/\s+/).length > 10);
    if (!cands.length) { console.log(uid.slice(0, 8), '— nothing to retitle'); continue; }
    let n = 0;
    // Chunked — a 100+ item batch truncates the JSON inside the token budget and silently yields 0.
    for (let off = 0; off < cands.length; off += 30) {
      const chunk = cands.slice(off, off + 30);
      const block = chunk.map((c, i) => `${i}. ${c.description.slice(0, 220)}`).join('\n');
      const res = await aiCall<{ titles?: Array<{ index?: number; keep?: boolean; title?: string }> }>({
        userId: uid, supabase: sb, shape: { output: 'json' }, temperature: 0, maxTokens: 1400, source: 'task_preparation',
        prompt: `Rewrite each task description below as a to-do-list TITLE: a short IMPERATIVE, at most ~9 words, starting with a verb, naming the deliverable — never meeting-notes narration ("Identify specific…suitable for…", "Discussed the need to…"). PRESERVE the meaning exactly; drop qualifiers, keep proper nouns. If a description is already a good short imperative, answer keep:true.\n\n${block}\n\nJSON only: {"titles":[{"index":<n>,"keep":true|false,"title":"<the rewritten title, empty when keep>"}]}`,
      }).catch(() => ({ json: undefined }));
      for (const t of res.json?.titles ?? []) {
        if (typeof t?.index !== 'number' || t.keep === true) continue;
        const cand = chunk[t.index];
        const title = String(t.title ?? '').trim();
        if (!cand || !title || title.split(/\s+/).length > 12) continue;
        console.log(`${APPLY ? 'RETITLE' : 'would retitle'} · ${uid.slice(0, 8)}\n  from: ${cand.description.slice(0, 110)}\n    to: ${title}`);
        if (APPLY) { await sb.from('commitments').update({ description: title }).eq('id', cand.id); n++; }
      }
    }
    if (APPLY && n) await sb.from('profiles').update({ home_brief: null }).eq('id', uid);
    console.log(uid.slice(0, 8), APPLY ? `retitled ${n}` : `${cands.length} candidates reviewed`);
  }
  console.log(APPLY ? 'done' : 'dry-run done (re-run with --apply)');
})();
