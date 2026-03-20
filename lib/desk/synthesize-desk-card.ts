/**
 * On Your Desk — Card Synthesis
 *
 * For a given desk_item, loads all contributing inbox_items,
 * builds context, and calls the AI to produce a 2-3 sentence work brief.
 * Writes result to desk_items.synthesis.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { buildUserContextBlock } from '@/lib/context/build-user-context';

export async function synthesizeDeskCard(
  deskItemId: string,
  userId: string,
  adminClient: SupabaseClient,
  userSupabase: SupabaseClient
): Promise<void> {
  // 1. Load the desk item
  const { data: card, error: cardErr } = await adminClient
    .from('desk_items')
    .select('id, title, source_type, source_refs, thread_key')
    .eq('id', deskItemId)
    .single();

  if (cardErr || !card) {
    console.error('[Synthesize] Card not found:', deskItemId, cardErr?.message);
    return;
  }

  // 2. Load contributing inbox items
  const sourceRefs: Array<{ type: string; id: string }> = card.source_refs ?? [];
  const inboxIds = sourceRefs
    .filter((r: { type: string }) => r.type === 'email' || r.type === 'meeting_action')
    .map((r: { id: string }) => r.id);

  let contextLines: string[] = [];

  if (inboxIds.length > 0) {
    const { data: inboxItems } = await adminClient
      .from('inbox_items')
      .select('work_title, what_i_prepared, why_matters, source_data, item_type')
      .in('id', inboxIds)
      .order('created_at', { ascending: false });

    for (const item of inboxItems ?? []) {
      const from = item.source_data?.from_name || item.source_data?.from_address;
      if (from) contextLines.push(`From: ${from}`);
      if (item.source_data?.subject) contextLines.push(`Subject: ${item.source_data.subject}`);
      if (item.source_data?.summary) contextLines.push(`Summary: ${item.source_data.summary}`);
      if (item.why_matters) contextLines.push(`Why it matters: ${item.why_matters}`);
      if (item.what_i_prepared) contextLines.push(`AUGMTD prepared: ${item.what_i_prepared}`);
      contextLines.push('---');
    }
  }

  if (contextLines.length === 0) {
    // No useful context — write a minimal synthesis from the title
    await adminClient
      .from('desk_items')
      .update({ synthesis: card.title, synthesis_at: new Date().toISOString() })
      .eq('id', deskItemId);
    return;
  }

  // 3. Build prompt
  const userContext = await buildUserContextBlock(userId, userSupabase);
  const context = contextLines.join('\n');

  const systemPrompt = `You are a personal work assistant. Write a concise 2-3 sentence brief for this work item. Cover: what needs to be done, what has already been prepared (if anything), and why it matters. Be direct and specific. Maximum 80 words. No bullet points.${userContext ? `\n\n${userContext}` : ''}`;

  const userPrompt = `Work item: "${card.title}"\n\nContext:\n${context}`;

  // 4. AI call
  try {
    const ai = await getAIClient(userId, 'summarization', userSupabase);
    const completion = await aiCreate(ai.client, {
      model: ai.model,
      max_tokens: 200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const synthesis = completion.choices[0]?.message?.content?.trim() ?? '';

    await adminClient
      .from('desk_items')
      .update({
        synthesis: synthesis || null,
        synthesis_at: new Date().toISOString(),
      })
      .eq('id', deskItemId);

    console.log(`[Synthesize] Done: ${deskItemId.slice(0, 8)} — "${synthesis.slice(0, 60)}…"`);
  } catch (err) {
    console.error('[Synthesize] AI call failed:', err);
    // Mark synthesis_at so we don't retry immediately
    await adminClient
      .from('desk_items')
      .update({ synthesis_at: new Date().toISOString() })
      .eq('id', deskItemId);
  }
}
