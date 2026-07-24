// THE 80/20 TASK-SHAPE AUDIT (Prepared-Work arc) — read-only, cross-user. What do users' REAL tasks look
// like, and which shapes can we already PREPARE vs. not? Samples the live corpus (open commitments,
// needs-reply/action inbox items, [You]-graded plan steps), AI-classifies each into a fixed shape taxonomy
// (classification tier, batched), and reports the distribution + coverage against the CAPABILITY_MAP —
// the evidence for which 3-5 capabilities to build first.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { aiCall } from '../lib/ai/call';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// The taxonomy — task SHAPES (what doing it actually involves), with today's preparability verdict.
const SHAPES: Record<string, { label: string; prepared: 'covered' | 'partial' | 'gap'; how: string }> = {
  draft_reply:      { label: 'Draft/send a reply or message', prepared: 'covered', how: 'auto-draft + compose/send exist' },
  send_document:    { label: 'Send/share an existing doc or link', prepared: 'partial', how: 'forward_email + file resolution exist; attach-to-new-mail thin' },
  prepare_document: { label: 'Create a doc/deck/proposal/report/invoice/certificate', prepared: 'partial', how: 'generate_document exists; no templates/branding, no invoice/cert shapes' },
  schedule_meeting: { label: 'Schedule/propose times/send invite', prepared: 'covered', how: 'send_calendar_invite + prepare gate exist' },
  follow_up_nudge:  { label: 'Chase someone for a response/deliverable', prepared: 'covered', how: 'nudge draft + compose exist' },
  review_approve:   { label: 'Review/give feedback/approve/sign something', prepared: 'partial', how: 'can summarize+brief the thing; signing/approval is human' },
  pay_verify_admin: { label: 'Pay/verify identity/renew/fix account/fill form', prepared: 'gap', how: 'no capability — can only surface + link' },
  update_record:    { label: 'Update an external system (Notion/CRM/sheet/portal)', prepared: 'gap', how: 'no write tools beyond Slack' },
  coordinate_logistics: { label: 'Coordinate people/access/lists/logistics', prepared: 'partial', how: 'drafting the ask works; multi-step coordination manual' },
  research_analyze: { label: 'Research/analyze/summarize/monitor', prepared: 'covered', how: 'deep_research + ai + kb tools' },
  other:            { label: 'Other / unclear', prepared: 'gap', how: '—' },
};
const KEYS = Object.keys(SHAPES);

type Sample = { uid: string; src: string; text: string };

async function collect(): Promise<Sample[]> {
  const { data: ents } = await sb.from('work_entities').select('user_id').eq('kind', 'initiative').limit(5000);
  const users = [...new Set((ents ?? []).map((e: any) => e.user_id as string))];
  const out: Sample[] = [];
  for (const uid of users) {
    const [{ data: commits }, { data: items }, { data: plans }] = await Promise.all([
      sb.from('commitments').select('description, status').eq('user_id', uid).in('status', ['open', 'pending']).order('created_at', { ascending: false }).limit(40),
      sb.from('inbox_items').select('work_title, rule_type, status, source_data').eq('user_id', uid).eq('status', 'pending')
        .or('rule_type.in.(needs_reply,to_do),work_state.in.(action_required,decision_required)').order('created_at', { ascending: false }).limit(40),
      sb.from('item_plans').select('tasks').eq('user_id', uid).order('updated_at', { ascending: false }).limit(25),
    ]);
    for (const c of (commits ?? []) as any[]) if (c.description) out.push({ uid, src: 'commitment', text: String(c.description).slice(0, 140) });
    for (const it of (items ?? []) as any[]) {
      const ask = it.source_data?.understanding?.ask || it.work_title;
      if (ask) out.push({ uid, src: it.rule_type === 'needs_reply' ? 'reply' : 'action', text: String(ask).slice(0, 140) });
    }
    for (const p of (plans ?? []) as any[]) {
      const tasks = Array.isArray(p.tasks) ? p.tasks : [];
      for (const t of tasks) if (t?.text && t.owner !== 'system') out.push({ uid, src: 'plan_step', text: String(t.text).slice(0, 140) });
    }
  }
  return out;
}

(async () => {
  const all = await collect();
  // Stratified sample: cap per (user, source) so one heavy user doesn't dominate.
  const byKey = new Map<string, Sample[]>();
  for (const s of all) { const k = `${s.uid}:${s.src}`; (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(s); }
  const sample: Sample[] = [];
  for (const arr of byKey.values()) sample.push(...arr.slice(0, 25));
  console.log(`corpus ${all.length} → sample ${sample.length} across ${new Set(sample.map((s) => s.uid)).size} users`);

  // Batch-classify (classification tier, 40/call).
  const shapeOf = new Map<number, string>();
  const anyUid = sample[0]?.uid;
  for (let k = 0; k < sample.length; k += 40) {
    const chunk = sample.slice(k, k + 40);
    const list = chunk.map((s, i) => `${k + i}. [${s.src}] ${s.text}`).join('\n');
    const res = await aiCall<{ shapes?: Record<string, string> }>({
      userId: anyUid, supabase: sb, shape: { output: 'json' }, temperature: 0, maxTokens: 1400, source: 'brain_synthesis',
      prompt: `Classify each TASK below into ONE shape — what DOING it actually involves:\n` +
        KEYS.map((s) => `- ${s}: ${SHAPES[s].label}`).join('\n') +
        `\n\nTASKS:\n${list}\n\nReturn ONLY JSON: {"shapes":{"<index>":"<shape>", ...}} — every index, best-fit shape.`,
    });
    for (const [idx, sh] of Object.entries(res.json?.shapes ?? {})) {
      const key = KEYS.includes(String(sh)) ? String(sh) : 'other';
      shapeOf.set(Number(idx), key);
    }
  }

  // Aggregate — overall + per source + per user.
  const total = new Map<string, number>(); const bySrc = new Map<string, Map<string, number>>(); const byUser = new Map<string, Map<string, number>>();
  sample.forEach((s, i) => {
    const sh = shapeOf.get(i) ?? 'other';
    total.set(sh, (total.get(sh) ?? 0) + 1);
    (bySrc.get(s.src) ?? bySrc.set(s.src, new Map()).get(s.src)!).set(sh, ((bySrc.get(s.src)!.get(sh)) ?? 0) + 1);
    (byUser.get(s.uid) ?? byUser.set(s.uid, new Map()).get(s.uid)!).set(sh, ((byUser.get(s.uid)!.get(sh)) ?? 0) + 1);
  });
  const n = sample.length;
  const ranked = [...total.entries()].sort((a, b) => b[1] - a[1]);
  console.log('\n════ TASK SHAPES (all users) ════');
  let cum = 0;
  for (const [sh, c] of ranked) {
    cum += c;
    console.log(`  ${String(Math.round((c / n) * 100)).padStart(3)}%  ${SHAPES[sh].label.padEnd(52)} [${SHAPES[sh].prepared.toUpperCase()}]  cum ${Math.round((cum / n) * 100)}%`);
  }
  console.log('\n════ PREPARABILITY TODAY ════');
  for (const v of ['covered', 'partial', 'gap'] as const) {
    const c = ranked.filter(([sh]) => SHAPES[sh].prepared === v).reduce((s, [, x]) => s + x, 0);
    console.log(`  ${v.toUpperCase().padEnd(8)} ${Math.round((c / n) * 100)}%  — ${ranked.filter(([sh]) => SHAPES[sh].prepared === v).map(([sh]) => sh).join(', ')}`);
  }
  console.log('\n════ PER USER (top 3 shapes) ════');
  for (const [uid, m] of byUser) {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const un = [...m.values()].reduce((s, x) => s + x, 0);
    console.log(`  ${uid.slice(0, 8)}: ${top.map(([sh, c]) => `${sh} ${Math.round((c / un) * 100)}%`).join(' · ')}`);
  }
  console.log('\n════ PER SOURCE (top 3) ════');
  for (const [src, m] of bySrc) {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const sn = [...m.values()].reduce((s, x) => s + x, 0);
    console.log(`  ${src.padEnd(11)}: ${top.map(([sh, c]) => `${sh} ${Math.round((c / sn) * 100)}%`).join(' · ')}`);
  }
})();
