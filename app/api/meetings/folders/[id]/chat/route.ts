import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';

/**
 * POST /api/meetings/folders/[id]/chat
 * Cross-meeting AI chat for a specific folder.
 * Fetches all transcripts in the folder, builds context from summaries/decisions/actions,
 * and streams a response.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: folderId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { query } = await req.json() as { query: string };
  if (!query?.trim()) return NextResponse.json({ error: 'query is required' }, { status: 400 });

  // Fetch folder info
  const { data: folder } = await supabase
    .from('drive_folders')
    .select('name')
    .eq('id', folderId)
    .eq('user_id', user.id)
    .single();

  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });

  // Fetch transcripts in this folder (summaries + decisions + action items, not full text)
  const { data: transcripts } = await supabase
    .from('meeting_transcripts')
    .select('title, start_time, summary, decisions, risks, suggested_next_step, work_items_generated')
    .eq('user_id', user.id)
    .eq('folder_id', folderId)
    .eq('processed', true)
    .order('start_time', { ascending: false })
    .limit(30);

  if (!transcripts || transcripts.length === 0) {
    return NextResponse.json({ error: 'No meetings found in this folder' }, { status: 404 });
  }

  // Fetch related action items
  const transcriptIds = transcripts.map((t: any) => t.id).filter(Boolean);
  const { data: actionItems } = transcriptIds.length > 0
    ? await supabase
        .from('inbox_items')
        .select('work_title, source_data, status')
        .eq('source', 'meeting')
        .in('source_meeting_transcript_id', transcriptIds)
    : { data: [] };

  // Build context block — keep it concise for token budget
  const meetingContext = transcripts.map((t: any) => {
    const date = new Date(t.start_time).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const decisions = (t.decisions ?? []).map((d: any) => `  - ${d.text}`).join('\n');
    const risks = (t.risks ?? []).map((r: any) => `  - [${r.severity}] ${r.text}`).join('\n');

    let block = `## ${t.title} (${date})`;
    if (t.summary) block += `\nSummary: ${t.summary}`;
    if (decisions) block += `\nDecisions:\n${decisions}`;
    if (risks) block += `\nRisks:\n${risks}`;
    if (t.suggested_next_step) block += `\nSuggested next step: ${t.suggested_next_step}`;
    return block;
  }).join('\n\n');

  const actionItemsContext = (actionItems ?? []).length > 0
    ? '\n\n## Open Action Items\n' + (actionItems ?? []).map((a: any) => {
        const status = a.status === 'completed' ? '✓' : '○';
        return `${status} ${a.work_title}${a.source_data?.assignee ? ` (${a.source_data.assignee})` : ''}`;
      }).join('\n')
    : '';

  const systemPrompt = `You are an AI assistant helping the user understand their meetings in the "${folder.name}" folder. Answer questions based on the meeting data provided. Be concise and specific. Reference specific meetings by name and date when relevant. If you don't have enough information to answer, say so.`;

  const userPrompt = `Here are the meetings in this folder:\n\n${meetingContext}${actionItemsContext}\n\nUser question: ${query}`;

  // Get AI client and stream response
  const { client: openai, model } = await getAIClient(user.id, 'conversation', supabase);

  const stream = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 1500,
    stream: true,
  });

  // Stream response as SSE
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (err) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
