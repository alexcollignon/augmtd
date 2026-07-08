import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyWorkspace } from '@/lib/workspace/features';
import {
  getAIOperationsSummary, BLENDED_HOURLY_RATE_EUR, MIN_HOURLY_RATE_EUR, MAX_HOURLY_RATE_EUR, type Period,
} from '@/lib/company/ai-operations-metrics';

function resolveHourlyRate(settings: Record<string, unknown> | null | undefined): number {
  const raw = settings?.blended_hourly_rate_eur;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= MIN_HOURLY_RATE_EUR && raw <= MAX_HOURLY_RATE_EUR) {
    return raw;
  }
  return BLENDED_HOURLY_RATE_EUR;
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
  const hourlyRate = resolveHourlyRate(company.settings);

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const summary = await getAIOperationsSummary(adminClient, company.id, period, hourlyRate);
    return NextResponse.json({ period, summary });
  } catch (err) {
    console.error('[ai-operations] summary error:', err);
    return NextResponse.json({ error: 'Failed to load AI operations summary' }, { status: 500 });
  }
}

// PATCH — admin sets the blended €/hr rate used to translate hours saved into
// a € value estimate. Stored in companies.settings (free-form jsonb), merged
// so other keys already there aren't clobbered.
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
  const rate = body?.hourlyRateEur;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < MIN_HOURLY_RATE_EUR || rate > MAX_HOURLY_RATE_EUR) {
    return NextResponse.json({ error: `Rate must be between €${MIN_HOURLY_RATE_EUR} and €${MAX_HOURLY_RATE_EUR}` }, { status: 400 });
  }

  const adminClient = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await adminClient
    .from('companies')
    .update({ settings: { ...company.settings, blended_hourly_rate_eur: rate } })
    .eq('id', company.id);

  if (error) {
    console.error('[ai-operations] rate update error:', error);
    return NextResponse.json({ error: 'Failed to save rate' }, { status: 500 });
  }

  return NextResponse.json({ hourlyRateEur: rate });
}
