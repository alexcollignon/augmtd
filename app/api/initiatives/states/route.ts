import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getInitiativeStates, refreshInitiativeStates } from '@/lib/initiatives/state-store';

export const maxDuration = 30;

// GET /api/initiatives/states — the Initiative Brain rollup for the Home "what's happening" surface (S4).
// Reads the durable initiative_state (instant); a background refresh keeps it live (sig-gated, so unchanged
// initiatives cost nothing). Ordered by attention: needs-you → waiting/quiet → active → awareness.
const MOMENTUM_RANK: Record<string, number> = { needs_you: 0, gone_quiet: 1, stalled: 1, waiting: 2, active: 3 };

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rows = await getInitiativeStates(supabase, user.id);
    const initiatives = rows
      .map((r) => {
        const state = (r.state ?? null) as { summary?: string; momentum?: string; whoOwes?: { you: string[]; them: string[] }; stage?: string | null; blocking?: string | null } | null;
        const nextMove = (r.next_move ?? null) as { kind?: string; title?: string; entityRef?: string | null; owner?: string; irreversible?: boolean; reason?: string } | null;
        return {
          key: r.initiative_key, label: r.label, projectId: r.project_id,
          momentum: state?.momentum ?? 'active',
          summary: state?.summary ?? null,
          stage: state?.stage ?? null,
          whoOwes: state?.whoOwes ?? { you: [], them: [] },
          quietDays: r.quiet_days,
          people: (r.people ?? { external: [], internal: [] }) as { external: string[]; internal: string[] },
          nextMove: nextMove && nextMove.title ? { kind: nextMove.kind ?? 'reply', title: nextMove.title, entityRef: nextMove.entityRef ?? null, owner: nextMove.owner ?? 'system', irreversible: !!nextMove.irreversible, reason: nextMove.reason ?? '' } : null,
        };
      })
      .filter((i) => i.summary) // only initiatives that have a synthesized state
      .sort((a, b) => (MOMENTUM_RANK[a.momentum] ?? 4) - (MOMENTUM_RANK[b.momentum] ?? 4) || (a.nextMove ? 0 : 1) - (b.nextMove ? 0 : 1));

    // Keep it live: refresh in the background (sig-gated). Non-fatal; the read above already returned.
    after(async () => {
      try { await refreshInitiativeStates(supabase, user.id, rows.map((r) => r.initiative_key)); } catch { /* non-fatal */ }
    });

    return NextResponse.json({ initiatives });
  } catch (e) {
    console.error('[initiatives/states] error:', e);
    return NextResponse.json({ initiatives: [] });
  }
}
