import { SupabaseClient } from '@supabase/supabase-js';
import { searchKnowledge } from '@/lib/knowledge/indexer';
import OpenAI from 'openai';

const SNIPPET_LENGTH = 400;

/**
 * KB enrichment with LLM-assisted file assignment.
 * 1. One global vector search (threshold 0.3, top 10) — cast wide net using full user message.
 * 2. GPT-4o-mini assigns each found file to the best matching named input slot, or "context".
 *    Assignment is based on filename + content snippet — not just vector distance.
 * 3. Assigned files → kbSuggestion on their named input (top match per slot).
 * 4. Unassigned files → standalone global KB cards in Additional Context.
 * Always non-fatal.
 */
export async function enrichPlanWithKB(
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

    // Step 1: global vector search — one wide-net query using the full user message
    const candidates = await searchKnowledge(userId, globalQuery, 10, adminClient);
    // Deduplicate by ID and filename (same file can be indexed in multiple KB sources → different IDs)
    const seenIds = new Set<string>();
    const seenFilenames = new Set<string>();
    const relevant = candidates.filter((r) => {
      const fname = r.filename.toLowerCase();
      if ((r.similarity ?? 0) < 0.3 || acceptedFileIds.has(r.id) || seenIds.has(r.id) || seenFilenames.has(fname)) return false;
      seenIds.add(r.id);
      seenFilenames.add(fname);
      return true;
    });

    // Clear stale suggestions regardless of what we find
    for (const input of namedInputs) {
      delete input.kbSuggestion;
      if (!input.fromKB) input.source_type = 'user_upload';
    }
    plan.inputs = (plan.inputs ?? []).filter(
      (i: any) => !i.id?.startsWith('kb_global_') || i.status === 'provided'
    );

    if (relevant.length === 0) return;

    // Step 2: LLM assignment — only when there are named input slots
    const assignment: Record<string, string> = {}; // fileId → inputId | 'context'

    if (namedInputs.length > 0) {
      const inputList = namedInputs
        .map((inp: any, idx: number) => `${idx + 1}. "${inp.name}" — ${inp.description}`)
        .join('\n');

      const fileList = relevant
        .map((r, idx) => {
          const letter = String.fromCharCode(65 + idx); // A, B, C…
          const snippet = (r.extracted_text ?? '').slice(0, SNIPPET_LENGTH).replace(/\n+/g, ' ').trim();
          return `${letter}. ${r.filename}${snippet ? ` — "${snippet}"` : ''}`;
        })
        .join('\n');

      const prompt =
        `Assign knowledge base files to workflow input slots based on file content.\n\n` +
        `Input slots:\n${inputList}\n\n` +
        `Files:\n${fileList}\n\n` +
        `Rules:\n` +
        `- Assign a file to a slot only if its content clearly matches what that slot requires.\n` +
        `- Multiple files can map to the same slot (e.g. several invoices → Invoices slot).\n` +
        `- If a file doesn't clearly belong to any specific slot, assign it "context".\n` +
        `Reply ONLY with a compact JSON object mapping each letter to a slot number or "context". Example: {"A":"1","B":"context","C":"2"}`;

      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const res = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 120,
          temperature: 0,
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
        console.error('[enrichPlanWithKB] LLM assignment failed, falling back to context:', err);
        for (const r of relevant) assignment[r.id] = 'context';
      }
    } else {
      for (const r of relevant) assignment[r.id] = 'context';
    }

    // Step 3: apply assignments — group by inputId, all eligible files become kbSuggestions[]
    const byInput: Record<string, typeof relevant> = {};
    for (const r of relevant) {
      const target = assignment[r.id];
      if (target && target !== 'context') {
        byInput[target] = byInput[target] ?? [];
        byInput[target].push(r);
      }
    }

    // Track which fileIds are surfaced as suggestions (so they don't also appear in context)
    const suggestedFileIds = new Set<string>();

    for (const [inputId, files] of Object.entries(byInput)) {
      const input = namedInputs.find((i: any) => i.id === inputId);
      if (!input) continue;
      const dismissed = new Set<string>(input.dismissedKbFileIds ?? []);
      const eligible = files
        .filter((f) => !dismissed.has(f.id))
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      if (eligible.length === 0) continue;
      input.kbSuggestions = eligible.map((f) => ({ fileId: f.id, filename: f.filename }));
      input.source_type = 'kb_found';
      eligible.forEach((f) => suggestedFileIds.add(f.id));
    }

    // Step 4: context files → global KB cards (max 3)
    // Only files not already surfaced as input suggestions
    const contextFiles = relevant
      .filter((r) => !suggestedFileIds.has(r.id))
      .slice(0, 3);

    for (const r of contextFiles) {
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
    console.error('[enrichPlanWithKB] KB enrichment failed:', err);
  }
}
