import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
} from 'docx';
import { DocumentArtifact, DocContent } from '@/lib/types/inbox';

const ARTIFACT_SEPARATOR = '---ARTIFACT_UPDATE---';

function buildDocx(content: DocContent): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: content.title, bold: true, size: 48, font: 'Arial' })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 240 },
    })
  );

  if (content.subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: content.subtitle, size: 28, color: '666666', font: 'Arial' })],
        spacing: { after: 480 },
      })
    );
  }

  for (const section of content.sections) {
    children.push(
      new Paragraph({
        text: section.heading,
        heading: section.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        spacing: { before: 360, after: 120 },
      })
    );
    for (const para of section.paragraphs) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: para, size: 24, font: 'Arial' })],
          spacing: { after: 160 },
        })
      );
    }
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, font: 'Arial', color: '1a1a1a' },
          paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Arial', color: '333333' },
          paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
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
    const contentJson = artifact.content ? JSON.stringify(artifact.content, null, 2) : null;

    const userAttachments = ((thread as any).user_attachments || []) as Array<{
      filename: string;
      extractedText: string | null;
    }>;
    const attachmentContext = userAttachments
      .filter((a) => a.extractedText)
      .map((a) => `--- Attached file: ${a.filename} ---\n${a.extractedText}`)
      .join('\n\n');

    const docContext = `${attachmentContext ? `REFERENCE FILES:\n${attachmentContext}\n\n` : ''}CURRENT DOCUMENT:\n${contentJson ?? `Title: ${artifact.title}\nType: ${artifact.type}`}`;

    const systemPrompt = isAskMode
      ? `You are a document assistant. Answer the user's question about the document or attached files in 2-4 sentences. Be specific and reference actual content when relevant.`
      : `You are a document editor. Apply the edit instruction to the document and respond in this exact format:

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

    const userPrompt = isAskMode
      ? `${docContext}\n\nQUESTION: ${instruction.trim()}`
      : `${docContext}\n\nEDIT INSTRUCTION: ${instruction.trim()}`;

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const completion = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: isAskMode ? 1024 : 8000,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
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
            // Don't bump updated_at for ask-mode queries — it would make the document
            // appear stale (updated_at > artifact.generated_at) on next load.
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
            const content = JSON.parse(rawContent.slice(firstBrace, lastBrace + 1)) as DocContent;

            const buffer = await buildDocx(content);

            const storagePath = artifact.storage_path;
            await adminClient.storage
              .from('work-artifacts')
              .upload(storagePath, buffer, {
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                upsert: true,
              });

            const updatedArtifact: DocumentArtifact = {
              ...artifact,
              generated_at: new Date().toISOString(),
              content,
            };

            // updated_at must equal generated_at — NOT new Date() — because generated_at
            // is captured before buildDocx() which takes seconds. Using new Date() here
            // would put updated_at > generated_at and trigger the stale-document banner.
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
