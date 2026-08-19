// ─── THE TIER-ROUTING GATE (Aug 19) ──────────────────────────────────────────────────────────────
// THE LAW: a user's AI work runs on THEIR tier (company `ai_tier` first, tenant config second,
// platform default last) — on EVERY task, in EVERY code path that has a user in scope. The silent
// promise-breaker this gate exists for: `getSystemClient()` hard-codes the standard tier (OpenAI /
// Anthropic US); six user-scoped call sites used it for "background" work (Home brief synthesis,
// coworker + team briefings, memory rendering, strategy alignment) and a privacy-tier tenant's
// content left the perimeter through the back door.
//
//   T1 SOURCE — `getSystemClient(` appears ONLY in the allowlist (each with a reason); every other
//               file resolves through `getAIClient(userId, …)` / `aiCall({userId})`.
//   T2 LIVE   — for a real member of a `bedrock_optimised` company, EVERY task type resolves to
//               provider 'bedrock' (completions AND embeddings) — the company tier is honoured
//               end to end; the probe (standard) still resolves embeddings to bedrock (the
//               embeddings privacy law) and completions to the platform default.
//
// Run: npx tsx --env-file=.env.local scripts/smoke-tier-routing.ts

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { getAIClient } from '../lib/ai/factory';
import type { TaskType } from '../lib/ai/types';
import { resolveProbeUser } from './probe-user';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// Files that may call getSystemClient — each with the reason it has NO user in scope.
const ALLOWLIST: Record<string, string> = {
  'lib/ai/factory.ts': 'the definition',
  'lib/ai/call.ts': 'aiCall({ userId: null }) — the declared no-user branch (no live caller passes null today)',
  'lib/ai/recipient-detector.ts': 'fallback ONLY when analyzeRecipients is called without a user; the sync always passes connection.user_id',
  'lib/context/render-memory.ts': 'fallback ONLY when renderProfile has no logCtx; both callers pass {userId, supabase}',
  'lib/company/synthesize-alignment.ts': 'fallback ONLY when no logCtx; the route passes the admin',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const ALL_TASKS: TaskType[] = ['planning', 'generation', 'summarization', 'classification', 'embeddings', 'ocr', 'assignment', 'conversation'];

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log('\nT1 — SOURCE FLOOR (getSystemClient only where no user exists):');
  {
    const files = [...walk('lib'), ...walk('app')];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (!/getSystemClient\(/.test(src)) continue;
      if (!(f in ALLOWLIST)) offenders.push(f);
    }
    ok('every getSystemClient( caller is on the allowlist', offenders.length === 0, offenders.join(', '));
    for (const [f, why] of Object.entries(ALLOWLIST)) {
      const src = readFileSync(f, 'utf8');
      ok(`${f} still calls it (allowlist entry is live — ${why.slice(0, 48)}…)`, /getSystemClient\(/.test(src));
    }
    // The six sites that leaked — each now binds the user.
    const bound: Array<[string, RegExp]> = [
      ['app/api/home/brief/route.ts', /synthesizeBrief\(await getAIClient\(user\.id, 'summarization', supabase\)/],
      ['app/api/workers/team-briefing/route.ts', /await getAIClient\(user\.id, 'conversation', supabase\)/],
      ['app/api/workers/[id]/briefing/route.ts', /await getAIClient\(user\.id, 'conversation', supabase\)/],
      ['lib/context/render-memory.ts', /logCtx\s*\?\s*await getAIClient\(logCtx\.userId, 'summarization', logCtx\.supabase\)/],
      ['lib/company/synthesize-alignment.ts', /logCtx\s*\?\s*await getAIClient\(logCtx\.userId, 'summarization', logCtx\.supabase\)/],
      ['lib/ai/recipient-detector.ts', /userId && supabase\s*\?\s*await getAIClient\(userId, 'classification', supabase\)/],
    ];
    for (const [f, re] of bound) ok(`${f} binds the USER's tier`, re.test(readFileSync(f, 'utf8')));
    // The docstring carries the warning so the next reader doesn't reach for it.
    ok('getSystemClient docstring warns about THE TIER LEAK', /THE TIER LEAK/.test(readFileSync('lib/ai/factory.ts', 'utf8')));
  }

  console.log('\nT2 — LIVE ROUTING (a bedrock_optimised member resolves INSIDE the perimeter on every task):');
  {
    const { data: co } = await admin.from('companies').select('id, ai_tier').eq('ai_tier', 'bedrock_optimised').limit(5);
    let memberId: string | null = null;
    for (const c of co ?? []) {
      const { data: m } = await admin.from('company_members').select('user_id').eq('company_id', c.id).eq('status', 'active').limit(1).maybeSingle();
      if (m?.user_id) { memberId = m.user_id as string; break; }
    }
    ok('a live bedrock_optimised company with an active member exists', !!memberId);
    if (memberId) {
      const offTier: string[] = [];
      for (const t of ALL_TASKS) {
        const r = await getAIClient(memberId, t, admin);
        if (r.tier !== 'bedrock_optimised' || r.endpoint.provider !== 'bedrock') offTier.push(`${t}→${r.tier}/${r.endpoint.provider}`);
      }
      ok('EVERY task type resolves to provider bedrock on the company tier (completions + embeddings)', offTier.length === 0, offTier.join(' '));
    }
    const probeId = await resolveProbeUser(admin);
    const pe = await getAIClient(probeId, 'embeddings', admin);
    const pc = await getAIClient(probeId, 'conversation', admin);
    ok('probe (standard): embeddings → bedrock (the embeddings privacy law holds on the default tier)', pe.endpoint.provider === 'bedrock', pe.endpoint.provider);
    ok('probe (standard): conversation → the platform default (standard tier is standard by design)', pc.tier === 'standard', pc.tier);
  }

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
