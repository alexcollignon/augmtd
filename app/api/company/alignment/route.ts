import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyWorkspace } from '@/lib/workspace/features';
import { getAIOperationsSummary, type Period } from '@/lib/company/ai-operations-metrics';
import { synthesizeAlignment, ALIGNMENT_PROMPT_VERSION, type CompanyGoal, type AlignmentObservation } from '@/lib/company/synthesize-alignment';

// Cache lives in companies.settings.alignment_cache (same free-form jsonb column already
// used for blended_hourly_rate_eur) — no new table needed, only the goals themselves have
// their own lifecycle/table. TTL is longer than the personal Home brief's 3h (3 * 60 * 60_000)
// since this is a slower-moving admin view, not a per-user daily brief.
const TTL_MS = 12 * 60 * 60 * 1000;

interface GoalRow {
  id: string;
  kind: 'north_star' | 'goal';
  title: string;
  description: string | null;
  status: string;
  updated_at: string;
}

interface AlignmentCache {
  sig: string;
  observations: AlignmentObservation[];
  dismissedIndexes: number[];
  generated_at: string;
}

function buildSig(period: string, goals: GoalRow[], summary: { agentRuns: number; groundedRuns: number; insightRuns: number }): string {
  const goalsSig = goals.map(g => `${g.id}:${g.updated_at}`).join(',');
  const activitySig = `${summary.agentRuns}:${summary.groundedRuns}:${summary.insightRuns}`;
  return `v${ALIGNMENT_PROMPT_VERSION}|${period}|${goalsSig}|${activitySig}`;
}

async function getAdminClient() {
  const { createClient: createSupabase } = await import('@supabase/supabase-js');
  return createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyWorkspace(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No workspace' }, { status: 404 });
  if (company.role !== 'owner' && company.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const periodParam = request.nextUrl.searchParams.get('period');
  const period: Period = periodParam === 'week' || periodParam === 'quarter' ? periodParam : 'month';

  const { data: goals } = await supabase
    .from('company_goals')
    .select('id, kind, title, description, status, updated_at')
    .eq('company_id', company.id)
    .eq('status', 'active') as { data: GoalRow[] | null };

  const activeGoals = goals ?? [];
  if (activeGoals.length === 0) {
    return NextResponse.json({ observations: [], goals: [] });
  }

  const adminClient = await getAdminClient();
  const summary = await getAIOperationsSummary(adminClient, company.id, period);

  const sig = buildSig(period, activeGoals, summary);
  const cache = (company.settings?.alignment_cache ?? null) as AlignmentCache | null;
  const fresh = cache && cache.sig === sig && (Date.now() - new Date(cache.generated_at).getTime()) < TTL_MS;

  if (fresh && cache) {
    const dismissed = new Set(cache.dismissedIndexes);
    return NextResponse.json({
      observations: cache.observations.filter((_, i) => !dismissed.has(i)),
      goals: activeGoals,
    });
  }

  const goalInputs: CompanyGoal[] = activeGoals.map(g => ({ id: g.id, kind: g.kind, title: g.title, description: g.description }));
  const result = await synthesizeAlignment(goalInputs, summary, { userId: user.id, supabase: adminClient });

  const newCache: AlignmentCache = {
    sig,
    observations: result.observations,
    dismissedIndexes: [],
    generated_at: new Date().toISOString(),
  };

  await adminClient
    .from('companies')
    .update({ settings: { ...company.settings, alignment_cache: newCache } })
    .eq('id', company.id);

  return NextResponse.json({ observations: result.observations, goals: activeGoals });
}

// PATCH — dismiss one observation (by its index within the current cached generation).
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyWorkspace(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No workspace' }, { status: 404 });
  if (company.role !== 'owner' && company.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const index = body?.dismissIndex;
  if (typeof index !== 'number') return NextResponse.json({ error: 'dismissIndex required' }, { status: 400 });

  const cache = (company.settings?.alignment_cache ?? null) as AlignmentCache | null;
  if (!cache) return NextResponse.json({ error: 'No cached alignment to dismiss from' }, { status: 404 });

  const dismissedIndexes = Array.from(new Set([...cache.dismissedIndexes, index]));
  const adminClient = await getAdminClient();
  await adminClient
    .from('companies')
    .update({ settings: { ...company.settings, alignment_cache: { ...cache, dismissedIndexes } } })
    .eq('id', company.id);

  return NextResponse.json({ ok: true });
}
