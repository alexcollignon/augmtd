import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, TableRow, TableCell, Table,
  WidthType, ShadingType,
} from 'docx';
import { DocumentArtifact, DocContent } from '@/lib/types/inbox';

function buildDocx(content: DocContent): Promise<Buffer> {
  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      children: [new TextRun({ text: content.title, bold: true, size: 48, font: 'Arial' })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 240 },
    })
  );

  // Subtitle
  if (content.subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: content.subtitle, size: 28, color: '666666', font: 'Arial' })],
        spacing: { after: 480 },
      })
    );
  }

  // Sections
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
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 36, bold: true, font: 'Arial', color: '1a1a1a' },
          paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
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

// POST /api/work/threads/[id]/generate
export async function POST(
  _request: NextRequest,
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
      .select('id, title, plan, user_attachments')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    if (!thread.plan) {
      return NextResponse.json({ error: 'Thread has no plan yet' }, { status: 400 });
    }

    const [{ data: recentMessages }, { data: linkedItem }] = await Promise.all([
      supabase
        .from('work_messages')
        .select('role, content')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('inbox_items')
        .select('source_data')
        .eq('work_thread_id', threadId)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    const { data: identityProfile } = await supabase
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', user.id)
      .eq('profile_type', 'identity')
      .single();

    const identity = identityProfile?.profile_data;
    const plan = thread.plan;

    const conversationContext = (recentMessages || [])
      .reverse()
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join('\n');

    // Inject full attachment text at generation time (only metadata was used during planning)
    // Merges email-originated attachments + user-uploaded attachments
    const emailAttachments = (linkedItem?.source_data?.attachments || []) as Array<{
      filename: string;
      extractedText: string | null;
    }>;
    const userAttachments = ((thread as any).user_attachments || []) as Array<{
      filename: string;
      extractedText: string | null;
    }>;
    const attachmentContext = [...emailAttachments, ...userAttachments]
      .filter((a) => a.extractedText)
      .map((a) => `--- ${a.filename} ---\n${a.extractedText}`)
      .join('\n\n');

    const deadlineLine = plan.deadline ? `\nDeadline: ${new Date(plan.deadline).toLocaleDateString()}` : '';
    const userContext = identity
      ? `${identity.jobRole || 'Professional'}${identity.department ? ` at ${identity.department}` : ''}`
      : 'Professional';

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
- Each paragraph should be a complete, well-written sentence or block of prose
- Be specific and detailed — this is a real professional document
- 6-12 sections appropriate for the deliverable type
- No bullet characters in paragraph text — write full prose`;

    const userPrompt = `Create content for a professional ${plan.deliverable_type} document.

DELIVERABLE: ${plan.deliverable_description}${deadlineLine}

PLAN SECTIONS:
${(plan.steps || []).map((s: { action: string }) => `- ${s.action}`).join('\n')}

EXPECTED OUTPUTS:
${(plan.outputs || []).map((o: { description: string }) => `- ${o.description}`).join('\n')}

CONVERSATION CONTEXT:
${conversationContext || '(none)'}
${attachmentContext ? `\nATTACHMENT CONTENT (use as source material when writing the document):\n${attachmentContext}\n` : ''}
AUTHOR CONTEXT: ${userContext}

Return the JSON document structure.`;

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

    if (!content.title || !Array.isArray(content.sections)) {
      console.error('[Generate] Invalid content shape:', raw.slice(0, 200));
      return NextResponse.json({ error: 'Document content generation failed' }, { status: 500 });
    }

    // Build the .docx buffer
    const buffer = await buildDocx(content);

    // Upload to Supabase Storage (path within bucket, no bucket prefix)
    const storagePath = `${user.id}/${threadId}.docx`;
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error: uploadError } = await adminClient.storage
      .from('work-artifacts')
      .upload(storagePath, buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });

    if (uploadError) {
      console.error('[Generate] Storage upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to store document' }, { status: 500 });
    }

    const artifact: DocumentArtifact = {
      title: thread.title,
      type: plan.deliverable_type,
      generated_at: new Date().toISOString(),
      storage_path: storagePath,
      content,
    };

    await adminClient
      .from('work_threads')
      .update({ artifact, updated_at: new Date().toISOString() })
      .eq('id', threadId);

    return NextResponse.json({ artifact });
  } catch (error) {
    console.error('[Generate] Error:', error);
    return NextResponse.json({ error: 'Failed to generate document' }, { status: 500 });
  }
}
