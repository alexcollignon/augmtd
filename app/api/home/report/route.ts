// THE DAILY REPORT (Living-Home L3) — the Home's data: ONE ledger build (buildWorkItems, self-healing
// reconcile included) partitioned into the report's lanes. Every surface reads THIS — the report UI, the
// ring's counts, and (L4) the chat's turn-0. Serializable WorkItems ride through as-is.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkItems } from '@/lib/work-items/model';
import { partitionDailyReport } from '@/lib/work-items/report';

export const maxDuration = 30;

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const todayStr = new Date().toISOString().slice(0, 10);
    const items = await buildWorkItems(supabase, user.id, { todayStr, includeCalendar: true, includeOutbound: false });
    const report = partitionDailyReport(items, todayStr);
    return NextResponse.json({ todayStr, ...report });
  } catch (e) {
    console.error('[home/report]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
