import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/company/is-super-admin';
import { getPlatformStatus, type PlatformStatus } from '@/lib/platform/status';

// GET /api/platform-admin/status — the one-page truth about the machine's dependencies.
// Live probes cost real (tiny) money and touch prod keys, so results are server-cached
// 5 minutes; ?refresh=1 forces a fresh probe pass (the page's "Probe now" button).
export const maxDuration = 60;

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { data: PlatformStatus; expiresAt: number } | null = null;
let inFlight: Promise<PlatformStatus> | null = null;

async function getAdminClient() {
  const { createClient: createSupabase } = await import('@supabase/supabase-js');
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!await isSuperAdmin(user.id, supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const force = req.nextUrl.searchParams.get('refresh') === '1';
  if (!force && cache && cache.expiresAt > Date.now()) {
    return NextResponse.json({ ...cache.data, cached: true });
  }
  // Single-flight: concurrent loads share one probe pass instead of stacking spend.
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const admin = await getAdminClient();
        const data = await getPlatformStatus(admin);
        cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
        return data;
      } finally {
        inFlight = null;
      }
    })();
  }
  const data = await inFlight;
  return NextResponse.json({ ...data, cached: false });
}
