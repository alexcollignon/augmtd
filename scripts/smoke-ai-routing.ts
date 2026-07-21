// AI ROUTING — the cross-surface smoke. Proves the ONE routing source end-to-end: every AI channel the
// product uses (shape router + legacy task enum — both resolve through lib/ai/factory's tenant tiers)
// returns a working model and a usable completion, per user tier. LIVE mini-calls (tiny max_tokens).
//
// Channel → surface map (what each proves):
//   aiCall{json}        → asks (cheap path), preparation-pass judgments, naming, reconcile, understanding-adjacent
//   aiCall{json,deep}   → asks (synthesis path), brief compose, entity-state synthesis
//   task 'classification' → inbox understanding, item plans, computeUnderstanding
//   task 'conversation'   → reply/nudge drafts, coworker chat (native), workflow reasoning steps
//   task 'summarization'  → workflow fast steps, meeting insights path
//   embeddings            → KB indexing, recognition recall, resolver
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { aiCall } from '../lib/ai/call';
import { getAIClient, aiCreate } from '../lib/ai/factory';
import { embedText } from '../lib/knowledge/indexer';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

const USERS = [
  { uid: '08fe4449-e5eb-431d-9156-02e9324e5903', label: 'bedrock user' },
  { uid: 'e009a499-41d4-4c44-ad53-53a0e851d143', label: 'user 2' },
];

async function taskChannel(uid: string, task: 'classification' | 'conversation' | 'summarization', wantJson: boolean): Promise<{ model: string; ok: boolean; out: string }> {
  const { client, model } = await getAIClient(uid, task, sb);
  const res = await aiCreate(client, {
    model, max_tokens: 60, temperature: 0,
    messages: [{ role: 'user', content: wantJson ? 'Return ONLY this JSON: {"ok":true}' : 'Reply with exactly: ok' }],
    ...(wantJson ? {} : {}),
  } as never);
  const text = (res as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '';
  const ok = wantJson ? /"ok"\s*:\s*true/.test(text) : /\bok\b/i.test(text);
  return { model, ok, out: text.slice(0, 40) };
}

(async () => {
  for (const { uid, label } of USERS) {
    const u = `${label} ${uid.slice(0, 6)}`;
    // ── The shape router (the ONE decision API going forward) ──
    try {
      const r1 = await aiCall<{ ok?: boolean }>({ userId: uid, supabase: sb, shape: { output: 'json' }, prompt: 'Return ONLY this JSON: {"ok":true}', maxTokens: 60, temperature: 0, source: 'brain_synthesis' });
      check(`${u} · aiCall{json} (asks-cheap / judgments)`, r1.json?.ok === true, r1.model);
    } catch (e) { check(`${u} · aiCall{json}`, false, String(e).slice(0, 60)); }
    try {
      const r2 = await aiCall<{ ok?: boolean }>({ userId: uid, supabase: sb, shape: { output: 'json', reasoning: 'deep' }, prompt: 'Return ONLY this JSON: {"ok":true}', maxTokens: 400, temperature: 0, source: 'brain_synthesis' });
      check(`${u} · aiCall{json,deep} (asks-deep / brief / state)`, r2.json?.ok === true, r2.model);
    } catch (e) { check(`${u} · aiCall{json,deep}`, false, String(e).slice(0, 60)); }
    // ── The legacy task channels (same factory underneath) ──
    for (const [task, wantJson, surfaces] of [
      ['classification', true, 'inbox understanding / item plans'],
      ['conversation', false, 'drafts / coworker chat / reasoning steps'],
      ['summarization', false, 'workflow fast steps / insights'],
    ] as const) {
      try {
        const r = await taskChannel(uid, task, wantJson);
        check(`${u} · task '${task}' (${surfaces})`, r.ok, r.model);
      } catch (e) { check(`${u} · task '${task}'`, false, String(e).slice(0, 60)); }
    }
    // ── Embeddings (KB / recognition / resolver) ──
    try {
      const v = await embedText('routing smoke probe', uid, sb);
      check(`${u} · embeddings (KB/recognition/resolver)`, Array.isArray(v) && v.length > 100, `${v.length} dims`);
    } catch (e) { check(`${u} · embeddings`, false, String(e).slice(0, 60)); }
  }

  console.log('\n════ AI ROUTING GATES (one factory, every channel) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
