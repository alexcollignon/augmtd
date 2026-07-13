import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { suggestProjects, type ProjectSuggestion } from '@/lib/projects/cluster';

export const maxDuration = 40;

// GET /api/projects/suggestions[?refresh=1] — AI-suggested project clusters from the user's unclustered
// work. Cached in-module for 30 min per user (an AI call; not a hot path). `?refresh=1` bypasses the
// cache and recomputes (the "Refresh suggestions" control), so clustering-logic changes reflect at once.
const cache = new Map<string, { at: number; data: ProjectSuggestion[] }>();
const TTL = 30 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const refresh = req.nextUrl.searchParams.get('refresh') === '1';
    const hit = cache.get(user.id);
    if (!refresh && hit && Date.now() - hit.at < TTL) return NextResponse.json({ suggestions: hit.data, cached: true });

    const suggestions = await suggestProjects(supabase, user.id, { fresh: refresh });
    cache.set(user.id, { at: Date.now(), data: suggestions });
    return NextResponse.json({ suggestions, cached: false });
  } catch (e) {
    console.error('[projects/suggestions] error:', e);
    return NextResponse.json({ suggestions: [] });
  }
}
