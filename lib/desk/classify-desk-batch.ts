/**
 * Desk column AI classifier — targeted at edge cases only.
 *
 * Only called for items that the rule engine (`desk-column-rules.ts`) could not
 * confidently classify. Each item gets rich context so the AI can make a
 * high-quality decision.
 *
 * Returns Map<tempId, DeskColumn>. Falls back to empty Map on any error
 * so callers always keep the rule-based pool default as a safe fallback.
 */

import { getAIClient } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { SupabaseClient } from '@supabase/supabase-js';
import type { DeskColumn } from '@/lib/types/desk';

export interface DeskClassifyRichInput {
  tempId: string;                 // threadKey | "meeting_action:id" | "update:deskItemId"
  sourceType: 'email' | 'meeting_action'; // process_step never reaches AI
  // Email context
  subject?: string;
  fromName?: string;
  snippet?: string;               // first ~150 chars of email body
  whyMatters?: string;            // AI-generated context, up to 300 chars
  workState?: string;             // decision_required | reply_needed | work_prepared | noted
  itemType?: string;              // reply | decision | meeting | review | fyi | notification
  isUserLastSender: boolean;
  threadSize?: number;
  // Meeting action context
  meetingTitle?: string;
}

const VALID_COLUMNS = new Set<string>(['pool', 'todo', 'in_progress', 'waiting', 'done']);

const SYSTEM_PROMPT = `You are deciding the correct kanban column for work items that automated rules could not confidently classify. These are genuinely ambiguous edge cases — rules already handled the obvious ones.

COLUMNS:
- todo: The user must act next (reply, decide, review, complete something)
- waiting: The user already acted or delegated; now waiting for someone else to respond or deliver
- pool: Genuinely unclear ownership — needs user triage

CONTEXT AVAILABLE PER ITEM: subject, fromName, snippet (email body preview), whyMatters (AI context), workState, itemType, isUserLastSender (did the user send the last email?), threadSize.

PATTERNS to look for:

→ todo:
- "Please review...", "Can you...", "Let me know your thoughts", "Your input needed"
- Single email received with a clear ask but no prior thread
- workState=noted but snippet shows a question or request directed at user
- itemType=meeting and there's a clear prep or follow-up ask

→ waiting:
- "I'll get back to you by...", "Will confirm next week", "Waiting on approval from..."
- isUserLastSender=true AND threadSize > 2 (user is engaged, sent last)
- whyMatters says "client is waiting", "pending their response", "you're waiting for"
- snippet shows the other party needs to do something before user can proceed

→ pool:
- Pure FYI: "Just to let you know", "For your awareness", "No action needed"
- Automated system notifications with no human sender
- News, newsletters, digests (if they slipped through)
- Completely ambiguous with no clear next actor

BIAS: Prefer todo over pool when in doubt. Use pool only when there is truly no clear next action for the user.

Output a JSON array only — no explanation, no markdown fences:
[{"id":"...","column":"todo"},{"id":"...","column":"waiting"},{"id":"...","column":"pool"}]
Include every id from the input.`;

async function classifyBatch(
  items: DeskClassifyRichInput[],
  userId: string,
  adminClient: SupabaseClient,
): Promise<Map<string, DeskColumn>> {
  const { client: ai, model } = await getAIClient(userId, 'classification', adminClient);

  const userContent = JSON.stringify(
    items.map((i) => ({
      id: i.tempId,
      sourceType: i.sourceType,
      ...(i.subject    && { subject: i.subject }),
      ...(i.fromName   && { fromName: i.fromName }),
      ...(i.snippet    && { snippet: i.snippet }),
      ...(i.whyMatters && { whyMatters: i.whyMatters }),
      ...(i.workState  !== undefined && { workState: i.workState }),
      ...(i.itemType   !== undefined && { itemType: i.itemType }),
      isUserLastSender: i.isUserLastSender,
      ...(i.threadSize !== undefined && { threadSize: i.threadSize }),
      ...(i.meetingTitle && { meetingTitle: i.meetingTitle }),
    })),
  );

  const maxTokens = Math.min(512, items.length * 30 + 50);

  const response = await ai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    max_tokens: maxTokens,
    temperature: 0,
  });

  const text = response.choices[0]?.message?.content || '';
  const parsed = parseModelJSON<Array<{ id: string; column: string }>>(text, []);

  const result = new Map<string, DeskColumn>();
  for (const entry of parsed) {
    if (entry.id && VALID_COLUMNS.has(entry.column)) {
      result.set(entry.id, entry.column as DeskColumn);
    }
  }
  return result;
}

export async function batchClassifyDeskItems(
  items: DeskClassifyRichInput[],
  userId: string,
  adminClient: SupabaseClient,
): Promise<Map<string, DeskColumn>> {
  if (items.length === 0) return new Map();

  try {
    let result: Map<string, DeskColumn>;

    if (items.length <= 20) {
      result = await classifyBatch(items, userId, adminClient);
    } else {
      // Parallel split for larger batches (should be rare with rule-first approach)
      const half = Math.ceil(items.length / 2);
      const [a, b] = await Promise.all([
        classifyBatch(items.slice(0, half), userId, adminClient),
        classifyBatch(items.slice(half), userId, adminClient),
      ]);
      result = new Map([...a, ...b]);
    }

    const counts = { todo: 0, waiting: 0, in_progress: 0, pool: 0, done: 0 };
    for (const col of result.values()) counts[col] = (counts[col] ?? 0) + 1;
    console.log(`[ClassifyDesk] AI pass: ${items.length} uncertain → todo:${counts.todo} waiting:${counts.waiting} pool:${counts.pool}`);

    return result;
  } catch (err) {
    console.error('[ClassifyDesk] AI pass failed, keeping pool defaults:', err);
    return new Map();
  }
}
