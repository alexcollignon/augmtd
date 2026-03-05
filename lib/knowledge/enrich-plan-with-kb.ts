import { SupabaseClient } from '@supabase/supabase-js';
import { searchKnowledge } from '@/lib/knowledge/indexer';

/**
 * Shared dual-pass KB enrichment utility.
 * Mutates `plan` in-place — adds kbSuggestion to named inputs and appends global KB cards.
 * Always non-fatal: swallows all errors so KB failure never breaks plan creation.
 *
 * @param prevAcceptedKb - Previously accepted KB inputs from prior plan (messages route only)
 */
export async function enrichPlanWithKB(
  userId: string,
  plan: any,
  globalQuery: string,
  adminClient: SupabaseClient,
  prevAcceptedKb: any[] = []
): Promise<void> {
  try {
    // Strip any hallucinated kb-searcher steps
    plan.steps = (plan.steps ?? []).filter((s: any) => s.skill !== 'kb-searcher');
    plan.steps.forEach((s: any, i: number) => { s.number = i + 1; });

    // Re-add previously accepted KB inputs (model doesn't know about them)
    const newInputIds = new Set((plan.inputs ?? []).map((i: any) => i.id));
    for (const kb of prevAcceptedKb) {
      if (!newInputIds.has(kb.id)) plan.inputs = [...(plan.inputs ?? []), kb];
    }

    // Pass 1: per-input targeted search (threshold 0.4, top 1)
    const nonKbInputs = (plan.inputs ?? []).filter((i: any) => !i.fromKB && i.status !== 'provided');
    await Promise.all(nonKbInputs.map(async (input: any) => {
      const results = await searchKnowledge(userId, `${input.name}: ${input.description}`, 3, adminClient);
      const top = results.find((r) => (r.similarity ?? 0) >= 0.4);
      if (top) input.kbSuggestion = { fileId: top.id, filename: top.filename };
      else delete input.kbSuggestion;
    }));

    // Pass 2: global context search (threshold 0.35, max 3)
    const globalResults = await searchKnowledge(userId, globalQuery, 8, adminClient);
    const alreadyIds = new Set([
      ...(plan.inputs ?? []).filter((i: any) => i.fromKB).map((i: any) => i.kbFileId),
      ...(plan.inputs ?? []).filter((i: any) => i.kbSuggestion).map((i: any) => i.kbSuggestion.fileId),
    ]);
    const relevant = globalResults
      .filter((r) => (r.similarity ?? 0) >= 0.35 && !alreadyIds.has(r.id))
      .slice(0, 3);
    for (const r of relevant) {
      plan.inputs = [...(plan.inputs ?? []), {
        id: `kb_global_${r.id}`,
        name: r.filename,
        type: 'context',
        description: 'From your knowledge base',
        required: false,
        status: 'pending',
        fromKB: true,
        kbFileId: r.id,
      }];
    }
  } catch (err) {
    console.error('[enrichPlanWithKB] KB search failed:', err);
    // Always non-fatal
  }
}
