// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FIRST LOOK — the one-time bootstrap chain that runs when a user's FIRST email sync completes,
// so the first real Home paint is the PREPARED PRODUCT (judged verdicts, drafts, entities, a seeded
// team), not a raw inbox. Everything it calls is the existing engine — this module only sequences:
//   1. ensureWorkers        — the team exists before anything wants to delegate or brief
//   2. bootstrapMemory ×N   — recognize the fresh corpus into entity memory (idempotent, capped)
//   3. runPreparationPass   — judge + prepare the top of the deck (the jaws-drop moment)
//   4. runCatchUp           — the attention lanes (judgment sweep + graduation), so a NEW account
//                             never accumulates the backlog the catch-up kick exists to drain
//   5. bust home_brief      — the next Home load serves the prepared state
//
// ONCE per connection, atomically claimed: the UPDATE only matches while metadata.first_look is
// absent, so concurrent syncs (the connect-page trigger + the callback's server-side sync racing)
// can't run the chain twice. Non-fatal throughout — a failed bootstrap never breaks the sync.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export async function runFirstLookBootstrap(
  admin: SupabaseClient, userId: string, connectionId: string,
): Promise<{ ran: boolean }> {
  try {
    // ── Atomic once-only claim (single UPDATE, filter on the flag's absence). ──
    const { data: conn } = await admin.from('connections').select('metadata').eq('id', connectionId).maybeSingle();
    const meta = (conn?.metadata ?? {}) as Record<string, unknown>;
    if (meta.first_look_at) return { ran: false };
    const { data: claimed } = await admin.from('connections')
      .update({ metadata: { ...meta, first_look_at: new Date().toISOString() } })
      .eq('id', connectionId).filter('metadata->>first_look_at', 'is', null)
      .select('id');
    if (!claimed?.length) return { ran: false };

    console.log(`[first-look] bootstrapping user ${userId.slice(0, 8)} after first sync`);

    // 1 — the team (idempotent; the unique index absorbs any race).
    try {
      const { ensureWorkers } = await import('@/lib/workers/seed');
      await ensureWorkers(admin, userId);
    } catch { /* non-fatal */ }

    // 2 — entity memory over the fresh corpus (the same incremental bootstrap the Home runs,
    // just not spread over days of visits — capped rounds, stops when converged).
    try {
      const { bootstrapMemory } = await import('@/lib/entities/hooks');
      for (let i = 0; i < 6; i++) {
        const r = await bootstrapMemory(admin, userId, 15);
        if (!r?.ran) break;
      }
    } catch { /* non-fatal */ }

    // 3 — judge + prepare the top of the deck (drafts, nudges, delegations, asks — the product).
    try {
      const { runPreparationPass } = await import('@/lib/prepare/pass');
      await runPreparationPass(admin, userId);
    } catch { /* non-fatal */ }

    // 4 — THE LANES, ONCE, HERE (instant catch-up, Sep 18): a new account must never ACCUMULATE the
    // backlog the catch-up kick exists to drain. The judgment sweep reaches every actionable item
    // the prep pass could not, the graduation lane files the quiet classes it already holds — both
    // through the ONE implementation (`runCatchUp`), which is the same code the kick and the manual
    // runner drive. Bounded and non-fatal: a bootstrap that runs out of clock leaves an account the
    // cron already knows how to keep clean.
    try {
      const { runCatchUp } = await import('@/lib/work/catch-up');
      const r = await runCatchUp(admin, userId, { budgetMs: 120_000 });
      console.log(`[first-look] lanes for ${userId.slice(0, 8)}: filed ${r.filed} · judged ${r.judged}`);
    } catch { /* non-fatal */ }

    // 5 — the next Home load composes fresh over the prepared state.
    await admin.from('profiles').update({ home_brief: null }).eq('id', userId).then(() => {}, () => {});
    console.log(`[first-look] done for user ${userId.slice(0, 8)}`);
    return { ran: true };
  } catch { return { ran: false }; }
}
