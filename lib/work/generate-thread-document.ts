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

  // ── THE VERIFY LOOP ON CHAT DOCUMENTS (Aug 8, production-floor step 3): the arithmetic floor
  // runs on EVERY chat-produced document — computable claims recomputed BY CODE (the same
  // verify-claims channel the prepare pass uses). A mismatch never blocks delivery (the work
  // arrives) but is STAMPED on the artifact (qa_report, persisted with it) and SAID in the
  // summary the coworker speaks — flagged, never silent. Failure of the floor itself speaks no
  // verdict (an outage is not a pass). ──
  let qaNote = '';
  try {
    const { verifyComputableClaims } = await import('@/lib/prepare/verify-claims');
    const text = typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content ?? '');
    const mismatches = await verifyComputableClaims(adminClient, userId, text);
    if (mismatches.length) {
      artifact.qa_report = {
        issues: mismatches.map((m) => ({
          type: 'fabricated_data' as const, severity: 'error' as const,
          description: `Stated ${m.stated} but the document's own figures compute to ${m.expected} ("${m.quote.slice(0, 80)}")`,
        })),
        score: Math.max(0, 100 - 20 * mismatches.length),
        summary: `${mismatches.length} number(s) don't match what the document's own figures compute to.`,
      };
      await adminClient.from('work_threads')
        .update({ artifacts: updated, artifact, updated_at: new Date().toISOString() })
        .eq('id', threadId);
      qaNote = ` One check: ${mismatches.length === 1 ? 'a number' : `${mismatches.length} numbers`} in the document didn't verify against its own figures (stated ${mismatches[0].stated}, computes to ${mismatches[0].expected}) — worth a look before it goes anywhere.`;
    }
  } catch { /* the floor is an enhancement — no verdict on outage */ }

  return {
    artifact: artifact.id ? { id: artifact.id, type: artifact.type, title: artifact.title } : null,
    summary: `Created ${deliverableType}: ${artifact.title}.${qaNote}`,
  };
}
