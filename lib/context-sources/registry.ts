import { SupabaseClient } from '@supabase/supabase-js'
import { getAIClient, aiCreate } from '@/lib/ai/factory'
import { ContextSource, ContextResult } from './types'
import { kbContextSource } from './kb'

// ─── Source registry ───────────────────────────────────────────────────────────
// Add new context sources here. Future: filter by user's active connections.

const ALL_SOURCES: ContextSource[] = [
  kbContextSource,
  // notionContextSource,
  // slackContextSource,
  // salesforceContextSource,
]

export function getContextSources(): ContextSource[] {
  return ALL_SOURCES
}

// ─── Enrichment ────────────────────────────────────────────────────────────────

/**
 * Enrich a plan with context from all registered sources.
 * Replaces enrichPlanWithKB — source-agnostic, same user validation flow.
 *
 * 1. Search all active sources in parallel (wide net, top 10 per source)
 * 2. Merge + deduplicate by ID and filename across sources
 * 3. GPT-4o-mini assigns each result to a named input slot or "context"
 * 4. Assigned → kbSuggestions on named input; unassigned → global context cards
 * Always non-fatal.
 */
export async function enrichPlanWithContext(
  userId: string,
  plan: any,
  globalQuery: string,
  adminClient: SupabaseClient,
  prevAcceptedKb: any[] = []
): Promise<void> {
  try {
    // Strip hallucinated kb-searcher steps
    plan.steps = (plan.steps ?? []).filter((s: any) => s.skill !== 'kb-searcher');
    plan.steps.forEach((s: any, i: number) => { s.number = i + 1; });

    // Re-add previously accepted KB inputs (model doesn't know about them)
    const newInputIds = new Set((plan.inputs ?? []).map((i: any) => i.id));
    for (const kb of prevAcceptedKb) {
      if (!newInputIds.has(kb.id)) plan.inputs = [...(plan.inputs ?? []), kb];
    }

    // Named input slots still needing a file
    const namedInputs = (plan.inputs ?? []).filter(
      (i: any) => !i.id?.startsWith('kb_') && !i.fromContext && i.status !== 'provided'
    );

    // Already accepted fileIds — never re-suggest
    const acceptedFileIds = new Set<string>(
      (plan.inputs ?? [])
        .filter((i: any) => i.kbFileId && i.status === 'provided')
        .map((i: any) => i.kbFileId as string)
    );

    // Step 1: multi-query retrieval — global query + one focused query per named input.
    // Per-input queries are short and direct (e.g. "invoice PDF") so they retrieve ALL
    // files of that type, not just the most semantically central one.
    const queries: string[] = [globalQuery];
    for (const input of namedInputs) {
      const descWords = (input.description ?? '').split(/\s+/).slice(0, 6).join(' ');
      const inputQuery = [input.name, descWords].filter(Boolean).join(' ').trim();
      if (inputQuery && inputQuery !== globalQuery) queries.push(inputQuery);
    }

    const sources = getContextSources();
    const SEARCH_LIMIT = 20;

    // multilingual-e5 (private_shared tier) produces lower cosine similarities than OpenAI —
    // use a lower threshold so semantically relevant files aren't filtered out.
    const { data: tierData } = await adminClient
      .from('tenant_configs').select('tier').eq('user_id', userId).maybeSingle();
    const SIMILARITY_THRESHOLD = (tierData?.tier ?? 'standard') === 'private_shared' ? 0.1 : 0.2;

    // Run all queries × all sources in parallel
    const allSearchResults = await Promise.all(
      queries.flatMap((query) =>
        sources.map((source) =>
          source.search(userId, query, SEARCH_LIMIT, adminClient).catch((err) => {
            console.error(`[enrichPlanWithContext] Source ${source.type} query "${query}" failed:`, err);
            return [] as ContextResult[];
          })
        )
      )
    );

    // Step 2: merge — track best similarity per file ID across all queries, then deduplicate by filename
    const bestByFileId = new Map<string, ContextResult>();
    for (const results of allSearchResults) {
      for (const r of results) {
        if (r.similarity < SIMILARITY_THRESHOLD || acceptedFileIds.has(r.id)) continue;
        const existing = bestByFileId.get(r.id);
        if (!existing || r.similarity > existing.similarity) bestByFileId.set(r.id, r);
      }
    }

    const seenFilenames = new Set<string>();
    const relevant: ContextResult[] = [];
    for (const r of [...bestByFileId.values()].sort((a, b) => b.similarity - a.similarity)) {
      const fname = r.filename.toLowerCase();
      if (seenFilenames.has(fname)) continue;
      seenFilenames.add(fname);
      relevant.push(r);
    }

    // Clear stale suggestions regardless of what we find
    for (const input of namedInputs) {
      delete input.kbSuggestion;
      if (!input.fromKB) input.source_type = 'user_upload';
    }
    plan.inputs = (plan.inputs ?? []).filter(
      (i: any) => !i.id?.startsWith('kb_global_') || i.status === 'provided'
    );

    if (relevant.length === 0) return;

    // Step 3: LLM assignment — only when there are named input slots
    const assignment: Record<string, string> = {}; // id → inputId | 'context'

    if (namedInputs.length > 0) {
      const inputList = namedInputs
        .map((inp: any, idx: number) => `${idx + 1}. "${inp.name}" — ${inp.description}`)
        .join('\n');

      const fileList = relevant
        .map((r, idx) => {
          const letter = String.fromCharCode(65 + idx);
          return `${letter}. [${r.sourceLabel}] ${r.filename}${r.snippet ? ` — "${r.snippet}"` : ''}`;
        })
        .join('\n');

      const prompt =
        `Assign knowledge files to workflow input slots based on file content.\n\n` +
        `Input slots:\n${inputList}\n\n` +
        `Files:\n${fileList}\n\n` +
        `Rules:\n` +
        `- Assign a file to a slot only if its content clearly matches what that slot requires.\n` +
        `- Multiple files can map to the same slot.\n` +
        `- If a file doesn't clearly belong to any specific slot, assign it "context".\n` +
        `Reply ONLY with a compact JSON object mapping each letter to a slot number or "context". Example: {"A":"1","B":"context","C":"2"}`;

      try {
        const { client, model } = await getAIClient(userId, 'assignment', adminClient);
        const res = await aiCreate(client, {
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 120,
        });

        const raw = (res.choices[0]?.message?.content ?? '{}')
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
          .trim();
        const parsed = JSON.parse(raw);

        for (let idx = 0; idx < relevant.length; idx++) {
          const letter = String.fromCharCode(65 + idx);
          const val = parsed[letter];
          const slotIndex = parseInt(val, 10);
          if (!isNaN(slotIndex) && namedInputs[slotIndex - 1]) {
            assignment[relevant[idx].id] = namedInputs[slotIndex - 1].id;
          } else {
            assignment[relevant[idx].id] = 'context';
          }
        }
      } catch (err) {
        console.error('[enrichPlanWithContext] LLM assignment failed, falling back to context:', err);
        for (const r of relevant) assignment[r.id] = 'context';
      }
    } else {
      for (const r of relevant) assignment[r.id] = 'context';
    }

    // Step 4: apply assignments — group by inputId
    const byInput: Record<string, ContextResult[]> = {};
    for (const r of relevant) {
      const target = assignment[r.id];
      if (target && target !== 'context') {
        byInput[target] = byInput[target] ?? [];
        byInput[target].push(r);
      }
    }

    const suggestedIds = new Set<string>();

    for (const [inputId, files] of Object.entries(byInput)) {
      const input = namedInputs.find((i: any) => i.id === inputId);
      if (!input) continue;
      const dismissed = new Set<string>(input.dismissedKbFileIds ?? []);
      const eligible = files
        .filter((f) => !dismissed.has(f.id))
        .sort((a, b) => b.similarity - a.similarity);
      if (eligible.length === 0) continue;
      input.kbSuggestions = eligible.map((f) => ({ fileId: f.id, filename: f.filename }));
      input.source_type = 'kb_found';
      eligible.forEach((f) => suggestedIds.add(f.id));
    }

    // Step 5: context files → global KB cards (max 3, not already surfaced as input suggestions)
    const contextFiles = relevant.filter((r) => !suggestedIds.has(r.id)).slice(0, 3);

    for (const r of contextFiles) {
      plan.inputs = [...(plan.inputs ?? []), {
        id: `kb_global_${r.id}`,
        name: r.filename,
        type: 'context',
        description: `From ${r.sourceLabel}`,
        required: false,
        status: 'pending',
        fromKB: true,
        kbFileId: r.id,
      }];
    }
  } catch (err) {
    console.error('[enrichPlanWithContext] Context enrichment failed:', err);
  }
}
