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
      .select('id, title, plan, artifact')
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
    const { instruction } = body;

    if (!instruction || typeof instruction !== 'string') {
      return NextResponse.json({ error: 'Instruction is required' }, { status: 400 });
    }

    const artifact = thread.artifact as DocumentArtifact;
    const plan = thread.plan;

    const systemPrompt = `You generate structured document content in JSON. Return ONLY valid JSON — no markdown, no explanation.

JSON format:
{
  "title": "Document title",
  "subtitle": "Optional subtitle or date",
  "sections": [
    {
      "heading": "Section heading",
      "level": 1,
      "paragraphs": ["Full paragraph text...", "Another paragraph..."]
    }
  ]
}

Rules:
- level 1 = major section, level 2 = subsection
- Each paragraph should be complete, well-written prose
- Be specific and detailed — this is a real professional document
- No bullet characters in paragraph text`;

    const userPrompt = `Regenerate this ${artifact.type} document with the following edit applied.

ORIGINAL DOCUMENT:
Title: ${artifact.title}
Type: ${artifact.type}

ORIGINAL PLAN:
${JSON.stringify(plan, null, 2)}

EDIT INSTRUCTION: ${instruction.trim()}

Apply the edit and return the complete updated document JSON. Keep everything else the same.`;

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          const ackText = `Updating the document — ${instruction.trim().slice(0, 80)}${instruction.length > 80 ? '...' : ''}`;
          controller.enqueue(encoder.encode(ackText));

          const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const completion = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 4000,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          });

          const rawText = (completion.content[0] as { type: string; text: string })?.text ?? '{}';
          const raw = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
          const content = JSON.parse(raw) as DocContent;

          const buffer = await buildDocx(content);

          const adminClient = (await import('@supabase/supabase-js')).createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );

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

          await adminClient
            .from('work_threads')
            .update({ artifact: updatedArtifact, updated_at: new Date().toISOString() })
            .eq('id', threadId);

          await adminClient.from('work_messages').insert([
            { thread_id: threadId, role: 'user', content: instruction.trim() },
            { thread_id: threadId, role: 'assistant', content: ackText },
          ]);

          controller.enqueue(
            encoder.encode(`\n${ARTIFACT_SEPARATOR}\n${JSON.stringify(updatedArtifact)}`)
          );
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
