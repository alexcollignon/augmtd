import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

// POST /api/work/threads/[id]/attach
// Body: multipart form data — 'file' (File) + 'inputId' (string)
// Extracts text, stores in Supabase Storage, marks the plan input as "provided"
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
      .select('id, plan, user_attachments')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const inputId = formData.get('inputId') as string | null;

    if (!file || !inputId) {
      return NextResponse.json({ error: 'file and inputId are required' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported file type. Upload PDF, DOCX, or TXT.' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = await extractTextFromAttachment(buffer, file.type, file.name);
    const extractedText = extracted ? extracted.slice(0, 3000) : null;

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${user.id}/${threadId}/${inputId}-${safeFilename}`;

    await adminClient.storage
      .from('email-attachments')
      .upload(storagePath, buffer, { contentType: file.type, upsert: true });

    const newAttachment = {
      inputId,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      storagePath,
      extractedText,
    };

    // Replace existing attachment for this inputId (if any), then append
    const existing = ((thread as any).user_attachments || []) as Array<{ inputId: string }>;
    const updatedAttachments = [
      ...existing.filter((a) => a.inputId !== inputId),
      newAttachment,
    ];

    // Mark the corresponding plan input as "provided" and record the filename
    const plan = thread.plan as any;
    if (plan?.inputs) {
      plan.inputs = plan.inputs.map((input: { id: string }) =>
        input.id === inputId
          ? { ...input, status: 'provided', providedFilename: file.name }
          : input
      );
    }

    await adminClient
      .from('work_threads')
      .update({
        user_attachments: updatedAttachments,
        plan,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);

    return NextResponse.json({ attachment: newAttachment, plan });
  } catch (error) {
    console.error('[Attach] Error:', error);
    return NextResponse.json({ error: 'Failed to attach file' }, { status: 500 });
  }
}

// DELETE /api/work/threads/[id]/attach?inputId=xxx
// Removes the attachment, clears the plan input back to "pending"
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: threadId } = await params;
  const inputId = request.nextUrl.searchParams.get('inputId');

  if (!inputId) {
    return NextResponse.json({ error: 'inputId is required' }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: thread, error: threadError } = await supabase
      .from('work_threads')
      .select('id, plan, user_attachments')
      .eq('id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Find and delete the file from storage
    const existing = ((thread as any).user_attachments || []) as Array<{
      inputId: string;
      storagePath: string;
    }>;
    const toRemove = existing.find((a) => a.inputId === inputId);
    if (toRemove?.storagePath) {
      await adminClient.storage.from('email-attachments').remove([toRemove.storagePath]);
    }

    const updatedAttachments = existing.filter((a) => a.inputId !== inputId);

    // Reset the plan input to "pending"
    const plan = thread.plan as any;
    if (plan?.inputs) {
      plan.inputs = plan.inputs.map((input: { id: string }) =>
        input.id === inputId
          ? { ...input, status: 'pending', providedFilename: undefined }
          : input
      );
    }

    await adminClient
      .from('work_threads')
      .update({
        user_attachments: updatedAttachments,
        plan,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);

    return NextResponse.json({ plan });
  } catch (error) {
    console.error('[Attach] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to remove attachment' }, { status: 500 });
  }
}
