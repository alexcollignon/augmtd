import { runFullPipeline } from '@/lib/work/generate-pipeline';
import { buildToolRegistry } from '@/lib/mcp/registry';
import { indexArtifact } from '@/lib/knowledge/indexer';
import { getFileExt, getMimeType } from '@/lib/artifacts/builders';
import type { DocumentArtifact } from '@/lib/types/inbox';

// ─── Shared document generation for a thread ──────────────────────────────────
// Mirrors the `generate_document` path in the native worker chat loop, factored
// out so the AgentOS internal route can produce artifacts identically. Kept as a
// fresh-generation function (no edit-existing-doc branch) — workers generating
// new deliverables. Produces the artifact, appends it to work_threads.artifacts,
// indexes it into the KB, and returns lightweight metadata for the chip.

const TOOL_MAP: Record<string, string> = {
  word: 'generators__word',
  excel: 'generators__xlsx',
  pptx: 'generators__pptx',
  email: 'generators__email_draft',
};
const TYPE_MAP: Record<string, string> = {
  word: 'document',
  excel: 'spreadsheet',
  pptx: 'presentation',
  email: 'email',
};
const MAX_TOKENS: Record<string, number> = { word: 5000, excel: 3000, pptx: 3000, email: 800 };

export interface GenerateThreadDocumentParams {
  userId: string;
  threadId: string;
  type: string; // word | excel | pptx | email
  instructions: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any;
  groundingContext?: string; // optional source material (e.g. KB content)
  userContext?: string;
  isTemporary?: boolean;
}

export interface GenerateThreadDocumentResult {
  artifact: { id: string; type: string; title: string } | null;
  summary: string;
}

export async function generateThreadDocument(
  params: GenerateThreadDocumentParams,
): Promise<GenerateThreadDocumentResult> {
  const { userId, threadId, type, instructions, adminClient, groundingContext, userContext, isTemporary } = params;

  const deliverableType = TYPE_MAP[type] || 'document';
  const generatorTool = TOOL_MAP[type] || 'generators__word';
  const isEmail = type === 'email';

  const steps = isEmail
    ? [{ number: 1, action: instructions, tool: generatorTool, status: 'pending' }]
    : [
        {
          number: 1,
          action: `Analyse the requirements and prepare a detailed content outline. List specific sections, key data points, arguments, and exact content to include. Requirements: ${instructions.slice(0, 300)}`,
          status: 'pending',
        },
        {
          number: 2,
          action: `Produce the complete ${deliverableType} based on the outline above`,
          tool: generatorTool,
          status: 'pending',
        },
      ];

  const plan = {
    deliverable_type: deliverableType,
    deliverable_description: instructions,
    inputs: [],
    outputs: [{ name: instructions.slice(0, 60), deliverableType }],
    steps,
  };

  const groundedContext = groundingContext
    ? `SOURCE MATERIAL (use as the primary source):\n\n${groundingContext}\n\n---\n\nINSTRUCTIONS: ${instructions}`
    : instructions;

  const toolRegistry = await buildToolRegistry(userId, adminClient);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipelineResult = await runFullPipeline({
    userId,
    threadId,
    plan: plan as any,
    emailAttachments: [],
    userAttachments: [],
    conversationContext: groundedContext,
    userContext: userContext || '',
    adminClient,
    toolRegistry,
    maxGenerationTokens: MAX_TOKENS[type] ?? 3500,
  } as any);

  const newArtifacts = (pipelineResult.artifacts || []) as DocumentArtifact[];
  if (newArtifacts.length === 0) {
    return { artifact: null, summary: 'Generation failed' };
  }

  const artifact = newArtifacts[0];
  artifact.title = instructions.slice(0, 60);

  // Append to the thread's artifacts (fresh generation: drop prior artifacts of
  // the same type, matching the native non-edit behaviour).
  const { data: freshThread } = await adminClient
    .from('work_threads')
    .select('artifacts')
    .eq('id', threadId)
    .single();
  const existing = ((freshThread?.artifacts as DocumentArtifact[]) || []);
  const newTypes = new Set(newArtifacts.map(n => n.type));
  const kept = existing.filter((a: DocumentArtifact) => !newTypes.has(a.type));
  const updated = [...kept, ...newArtifacts];

  await adminClient
    .from('work_threads')
    .update({ artifacts: updated, artifact, updated_at: new Date().toISOString() })
    .eq('id', threadId);

  if (!isTemporary) {
    newArtifacts.forEach((a: DocumentArtifact) => {
      if (!a.id) return;
      indexArtifact({
        artifactId: a.id,
        storagePath: a.storage_path ?? null,
        filename: `${a.title}.${getFileExt(a.type)}`,
        mimeType: getMimeType(a.type),
        userId,
        threadId,
        emailBody: a.type === 'email' ? (a.content as { body?: string })?.body : undefined,
      }, adminClient).catch(() => {});
    });
  }

  return {
    artifact: artifact.id ? { id: artifact.id, type: artifact.type, title: artifact.title } : null,
    summary: `Created ${deliverableType}: ${artifact.title}`,
  };
}
