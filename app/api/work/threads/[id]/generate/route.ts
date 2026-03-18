import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { DocumentArtifact, EmailContent } from '@/lib/types/inbox';
import { runFullPipeline } from '@/lib/work/generate-pipeline';
import { buildToolRegistry } from '@/lib/mcp/registry';
import { buildUserContextBlock } from '@/lib/context/build-user-context';
import { indexArtifact } from '@/lib/knowledge/indexer';
import { getMimeType, getFileExt } from '@/lib/artifacts/builders';

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

    const [{ data: recentMessages }, { data: linkedItem }, userContextBlock] = await Promise.all([
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
      buildUserContextBlock(user.id, supabase),
    ]);

    const plan = thread.plan;

    const conversationContext = (recentMessages || [])
      .reverse()
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join('\n');

    const emailAttachments = (linkedItem?.source_data?.attachments || []) as Array<{
      filename: string;
      mimeType: string;
      storagePath: string;
      extractedText: string | null;
    }>;
    const userAttachments = ((thread as any).user_attachments || []) as Array<{
      filename: string;
      mimeType: string;
      storagePath: string;
      extractedText: string | null;
    }>;

    const userContext = userContextBlock || 'Professional';

    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Mark thread as generating — persists across refreshes so the UI can show the state
    await adminClient.from('work_threads').update({ is_generating: true }).eq('id', threadId);

    // Inject accepted KB inputs as attachment context (fromKB covers named + global; fromContext covers manual adds)
    // Uses chunk-based injection (top 3 chunks per file, with citation headers) instead of full extracted_text.
    // Falls back to extracted_text for files not yet chunked (pre-Phase 36 index).
    const kbInputs = ((plan as any)?.inputs ?? []).filter((i: any) => (i.fromKB || i.fromContext) && i.status === 'provided');
    if (kbInputs.length > 0) {
      const kbFileIds: string[] = kbInputs.flatMap((i: any) =>
        i.kbAccepted?.length ? i.kbAccepted.map((a: any) => a.fileId) : [i.kbFileId].filter(Boolean)
      );

      // Fetch top 3 chunks per file (reading order) with citation headers
      const { data: chunks } = await adminClient
        .from('knowledge_chunks')
        .select('file_id, chunk_index, heading, content, knowledge_files(filename)')
        .in('file_id', kbFileIds)
        .order('chunk_index', { ascending: true });

      const chunksByFile = new Map<string, Array<{ chunk_index: number; heading: string | null; content: string; filename: string }>>();
      for (const c of (chunks ?? [])) {
        const filename = (c.knowledge_files as any)?.filename ?? c.file_id;
        const existing = chunksByFile.get(c.file_id) ?? [];
        if (existing.length < 3) {
          existing.push({ chunk_index: c.chunk_index, heading: c.heading, content: c.content, filename });
          chunksByFile.set(c.file_id, existing);
        }
      }

      const MAX_KB_CHARS = 10000;

      for (const fileId of kbFileIds) {
        const fileChunks = chunksByFile.get(fileId);

        if (fileChunks && fileChunks.length > 0) {
          // Chunk-based injection with citation headers
          const filename = fileChunks[0].filename;
          const contextText = fileChunks
            .map((c) => {
              const section = c.heading ?? `part ${c.chunk_index + 1}`;
              return `[${filename} § ${section}]\n${c.content}`;
            })
            .join('\n\n');
          userAttachments.push({ filename, mimeType: 'text/plain', storagePath: '', extractedText: contextText.slice(0, MAX_KB_CHARS) });
        } else {
          // Fallback: file not yet chunked — use full extracted_text
          const { data: kbFile } = await adminClient
            .from('knowledge_files')
            .select('filename, extracted_text')
            .eq('id', fileId)
            .single();
          if (kbFile?.extracted_text) {
            userAttachments.push({ filename: kbFile.filename, mimeType: 'text/plain', storagePath: '', extractedText: kbFile.extracted_text.slice(0, MAX_KB_CHARS) });
          }
        }
      }
    }

    // Build tool registry for this user (informs pipeline of available tools)
    const toolRegistry = await buildToolRegistry(user.id, supabase);

    // Run all steps — intermediate steps feed into each generator step sequentially
    const pipelineResult = await runFullPipeline({
      userId: user.id,
      threadId,
      plan,
      emailAttachments,
      userAttachments,
      conversationContext,
      userContext,
      adminClient,
      toolRegistry,
    });

    // If a step requires approval, pipeline paused — return early
    if (pipelineResult.paused) {
      return NextResponse.json({
        paused: true,
        stepNumber: pipelineResult.paused.stepNumber,
        approvalMessage: pipelineResult.paused.approvalMessage,
      });
    }

    const newArtifacts = pipelineResult.artifacts;

    // Title each artifact: use the matching plan output name if available,
    // fall back to plan.deliverable_description, then thread title.
    const planOutputs: Array<{ name?: string; deliverableType?: string }> = (plan as any)?.outputs ?? [];
    newArtifacts.forEach((a, i) => {
      // Match by position first, then by deliverableType if available
      const matchByType = planOutputs.find((o) => o.deliverableType === a.type);
      const matchByIndex = planOutputs[i];
      const output = matchByType ?? matchByIndex;
      a.title = output?.name ?? (plan as any)?.deliverable_description ?? thread.title;
    });

    // Merge: replace existing artifacts of the same type, keep the rest
    const { data: freshThread } = await adminClient
      .from('work_threads')
      .select('artifacts')
      .eq('id', threadId)
      .single();
    const existingArtifacts = (freshThread?.artifacts as DocumentArtifact[]) || [];
    const regeneratedTypes = new Set(newArtifacts.map((a) => a.type));
    const kept = existingArtifacts.filter((a) => !regeneratedTypes.has(a.type));
    const updatedArtifacts = [...kept, ...newArtifacts];
    const latestArtifact = updatedArtifacts[updatedArtifacts.length - 1];

    await adminClient
      .from('work_threads')
      .update({
        artifact: latestArtifact,
        artifacts: updatedArtifacts,
        is_generating: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);

    // Fire-and-forget: index each new artifact into the KB
    newArtifacts.forEach((artifact) => {
      if (!artifact.id) return;
      indexArtifact({
        artifactId: artifact.id,
        storagePath: artifact.storage_path ?? null,
        filename: `${artifact.title}.${getFileExt(artifact.type)}`,
        mimeType: getMimeType(artifact.type),
        userId: user.id,
        emailBody: artifact.type === 'email'
          ? (artifact.content as EmailContent)?.body
          : undefined,
      }, adminClient).catch(() => {});
    });

    return NextResponse.json({ artifacts: newArtifacts, artifact: newArtifacts[newArtifacts.length - 1] });
  } catch (error) {
    console.error('[Generate] Error:', error);
    // Best-effort: clear generating state so the user isn't stuck
    try {
      const { createClient: createAdmin } = await import('@supabase/supabase-js');
      const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      await adminClient.from('work_threads').update({ is_generating: false }).eq('id', threadId);
    } catch { /* ignore */ }
    return NextResponse.json({ error: 'Failed to generate document' }, { status: 500 });
  }
}
