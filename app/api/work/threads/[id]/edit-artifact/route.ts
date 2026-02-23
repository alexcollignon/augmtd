import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { DocumentArtifact, DeliverableType, ArtifactContent } from '@/lib/types/inbox';
import { buildArtifactFile, getMimeType } from '@/lib/artifacts/builders';

const ARTIFACT_SEPARATOR = '---ARTIFACT_UPDATE---';

function buildEditSystemPrompt(type: DeliverableType, isAskMode: boolean): string {
  if (isAskMode) {
    return `You are a document assistant. Answer the user's question about the document or attached files in 2-4 sentences. Be specific and reference actual content when relevant.`;
  }

  if (type === 'presentation') {
    return `You are a presentation editor. Apply the edit instruction to the slides and respond in this exact format:

[1 sentence describing what you changed]
---ARTIFACT_UPDATE---
[Complete updated PptxContent JSON]

RULES: Only change what was asked — preserve all other slides, content, and structure exactly.

JSON FORMAT:
{
  "title": "Presentation title",
  "subtitle": "Optional subtitle",
  "slides": [
    { "title": "Slide title", "layout": "title", "bullets": [], "notes": "optional" },
    { "title": "Slide title", "layout": "content", "bullets": ["Point 1", "Point 2"], "notes": "optional" }
  ]
}`;
  }

  if (type === 'spreadsheet') {
    return `You are a spreadsheet editor. Apply the edit instruction to the data and respond in this exact format:

[1 sentence describing what you changed]
---ARTIFACT_UPDATE---
[Complete updated XlsxContent JSON]

RULES: Only change what was asked — preserve all other sheets and data exactly.

JSON FORMAT:
{
  "title": "Spreadsheet title",
  "sheets": [
    {
      "name": "Sheet name",
      "headers": ["Col A", "Col B"],
      "rows": [["val", 100], ["val2", 200]],
      "summary": "optional"
    }
  ]
}`;
  }

  // default: docx/report/analysis/email
  return `You are a document editor. Apply the edit instruction to the document and respond in this exact format:

[1 sentence describing what you changed]
---ARTIFACT_UPDATE---
[Complete updated DocContent JSON]

RULES: Only change what was asked — preserve all other sections, tone, and content exactly.

JSON FORMAT:
{
  "title": "Document title",
  "subtitle": "Optional subtitle",
  "sections": [
    { "heading": "Section heading", "level": 1, "paragraphs": ["Prose paragraph..."] }
  ]
}

level 1 = major section, level 2 = subsection. Complete prose paragraphs only.`;
}

// POST /api/work/threads/[id]/edit-artifact — stream acknowledgment, regenerate doc with edit
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, title, plan, artifact, user_attachments')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    if (!thread.artifact) {
      return NextResponse.json({ error: 'No document to edit' }, { status: 400 });
    }

    const body = await request.json();
    const { instruction, mode = 'edit' } = body;

    if (!instruction || typeof instruction !== 'string') {
      return NextResponse.json({ error: 'Instruction is required' }, { status: 400 });
    }

    const isAskMode = mode === 'ask';
    const artifact = thread.artifact as DocumentArtifact;
    const type: DeliverableType = artifact.type;
    const contentJson = artifact.content ? JSON.stringify(artifact.content, null, 2) : null;

    const userAttachments = ((thread as any).user_attachments || []) as Array<{
      filename: string;
      extractedText: string | null;
    }>;
    const attachmentContext = userAttachments
      .filter((a) => a.extractedText)
      .map((a) => `--- Attached file: ${a.filename} ---\n${a.extractedText}`)
      .join('\n\n');

    const docContext = `${attachmentContext ? `REFERENCE FILES:\n${attachmentContext}\n\n` : ''}CURRENT DOCUMENT:\n${contentJson ?? `Title: ${artifact.title}\nType: ${type}`}`;

    // Load conversation history so the AI remembers previous questions/answers
    const { data: previousMessages } = await supabase
      .from('work_messages')
      .select('role, content')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });

    // docContext goes into the system prompt (always the latest document state)
    // so it doesn't bloat every message in the history
    const systemPrompt = `${buildEditSystemPrompt(type, isAskMode)}\n\n${docContext}`;

    const historyMessages = (previousMessages || []).map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    const anthropicMessages = [
      ...historyMessages,
      { role: 'user' as const, content: instruction.trim() },
    ];

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const completion = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: isAskMode ? 1024 : 8000,
            system: systemPrompt,
            messages: anthropicMessages,
          });

          const rawText = (completion.content[0] as { type: string; text: string })?.text ?? '';

          const adminClient = (await import('@supabase/supabase-js')).createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );

          if (isAskMode) {
            const conversationalText = rawText.trim();
            controller.enqueue(encoder.encode(conversationalText));

            await adminClient.from('work_messages').insert([
              { thread_id: threadId, role: 'user', content: instruction.trim() },
              { thread_id: threadId, role: 'assistant', content: conversationalText },
            ]);
            await adminClient
              .from('work_threads')
              .update({ updated_at: artifact.generated_at })
              .eq('id', threadId);

            controller.enqueue(encoder.encode(`\n${ARTIFACT_SEPARATOR}\nnull`));
          } else {
            const sepIdx = rawText.indexOf(ARTIFACT_SEPARATOR);
            const conversationalText = sepIdx !== -1 ? rawText.slice(0, sepIdx).trim() : rawText.trim();
            const rawContent = sepIdx !== -1 ? rawText.slice(sepIdx + ARTIFACT_SEPARATOR.length).trim() : null;

            controller.enqueue(encoder.encode(conversationalText));

            await adminClient.from('work_messages').insert([
              { thread_id: threadId, role: 'user', content: instruction.trim() },
              { thread_id: threadId, role: 'assistant', content: conversationalText },
            ]);

            if (!rawContent) throw new Error('No artifact content in edit response');

            const firstBrace = rawContent.indexOf('{');
            const lastBrace = rawContent.lastIndexOf('}');
            if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON object in Haiku response');
            const content = JSON.parse(rawContent.slice(firstBrace, lastBrace + 1)) as ArtifactContent;

            const buffer = await buildArtifactFile(type, content);

            const storagePath = artifact.storage_path;
            await adminClient.storage
              .from('work-artifacts')
              .upload(storagePath, buffer, {
                contentType: getMimeType(type),
                upsert: true,
              });

            const updatedArtifact: DocumentArtifact = {
              ...artifact,
              generated_at: new Date().toISOString(),
              content,
            };

            await adminClient
              .from('work_threads')
              .update({ artifact: updatedArtifact, updated_at: updatedArtifact.generated_at })
              .eq('id', threadId);

            controller.enqueue(
              encoder.encode(`\n${ARTIFACT_SEPARATOR}\n${JSON.stringify(updatedArtifact)}`)
            );
          }
        } catch (err) {
          console.error('[EditArtifact] Error:', err);
          controller.enqueue(encoder.encode('\n\nAn error occurred while editing the document.'));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[EditArtifact] Error:', error);
    return NextResponse.json({ error: 'Failed to edit document' }, { status: 500 });
  }
}
