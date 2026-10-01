import { runFullPipeline } from '@/lib/work/generate-pipeline';
import { conductBlock } from '@/lib/ai/conduct';
import { buildToolRegistry } from '@/lib/mcp/registry';
import { indexArtifact } from '@/lib/knowledge/indexer';
import { getFileExt, getMimeType } from '@/lib/artifacts/builders';
import { clipLabel } from '@/lib/utils/clip-for-prompt';
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
  /** THE ONE PRODUCTION DOOR (plan AF): tabular material the document is over — the door's
   *  facts floor computes its statistics in the sandbox before anything ships. */
  csvText?: string | null;
  /** REVISION-IN-PLACE for DMs: the thread's current artifact to modify (bytes + ext). */
  revise?: { artifactId: string; bytes: Buffer; ext: 'docx' | 'pptx' | 'xlsx'; title?: string } | null;
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
  const isEmail = type === 'email';

  // ── EMAIL DRAFTS keep their own path (a draft card, not a document file). ──
  if (isEmail) {
    const plan = {
      deliverable_type: deliverableType,
      deliverable_description: instructions,
      inputs: [],
      outputs: [{ name: instructions.slice(0, 60), deliverableType }],
      steps: [{ number: 1, action: instructions, tool: TOOL_MAP.email, status: 'pending' }],
    };
    const toolRegistry = await buildToolRegistry(userId, adminClient);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipelineResult = await runFullPipeline({
      userId, threadId, plan: plan as any, emailAttachments: [], userAttachments: [],
      conversationContext: groundingContext ? `SOURCE MATERIAL:\n\n${groundingContext}\n\n---\n\nINSTRUCTIONS: ${instructions}` : instructions,
      userContext: userContext || '', adminClient, toolRegistry,
      maxGenerationTokens: MAX_TOKENS.email,
    } as any);
    const emailArtifacts = (pipelineResult.artifacts || []) as DocumentArtifact[];
    if (emailArtifacts.length === 0) return { artifact: null, summary: 'Generation failed' };
    const a = emailArtifacts[0];
    a.title = clipLabel(instructions, 60);
    const { data: t } = await adminClient.from('work_threads').select('artifacts').eq('id', threadId).single();
    const upd = [...(((t?.artifacts as DocumentArtifact[]) || []).filter((x) => x.type !== a.type)), a];
    await adminClient.from('work_threads').update({ artifacts: upd, artifact: a, updated_at: new Date().toISOString() }).eq('id', threadId);
    return { artifact: a.id ? { id: a.id, type: a.type, title: a.title } : null, summary: `Created email draft: ${a.title}.` };
  }

  // ── THE ONE PRODUCTION DOOR (plan AF): a DM-produced document goes through the SAME organs
  // the chief's delegations use — the author writes the content (with the typed protocol so a
  // real sheet/deck says so structurally), then materializeDocument owns every tier decision
  // (compiler for charts/revision/templates · typed · template renderers) and every floor
  // (facts-by-code, content-floor, the brand theme). The legacy generators pipeline is retired
  // for documents — a DM's report is byte-equal in capability to a delegated one. ──

  // 0 — AUTO-RESOLUTION from the thread (both routes get it free — callers stay thin):
  // a word ask on a thread that already holds a document REVISES it (the pre-door native
  // behaviour, kept: version-append with parent_id so the panel's version chain survives);
  // the latest tabular chat attachment rides as csvText for the door's facts floor.
  let revise = params.revise ?? null;
  let csvText = params.csvText ?? null;
  let currentDocText: string | null = null;
  if (!revise || !csvText) {
    try {
      const { data: th } = await adminClient.from('work_threads')
        .select('artifacts, user_attachments').eq('id', threadId).single();
      if (!revise && type === 'word') {
        const docs = ((th?.artifacts as DocumentArtifact[]) || []).filter((a) => a.type === 'document' && a.id);
        const lastDoc = docs.at(-1);
        if (lastDoc) {
          // The current text grounds the writer (full revised text out, nothing lost); the
          // bytes (when storage-backed, office ext) let the compiler revise IN PLACE.
          if (lastDoc.content) {
            try {
              const c = lastDoc.content as { title?: string; sections?: Array<{ heading?: string; paragraphs?: string[] }> };
              currentDocText = [c.title, ...(c.sections ?? []).flatMap((s) => [s.heading, ...(s.paragraphs ?? [])])]
                .filter(Boolean).join('\n').slice(0, 12000);
            } catch { /* text grounding is best-effort */ }
          }
          const ext = String(lastDoc.storage_path ?? '').split('.').pop()?.toLowerCase();
          if (lastDoc.storage_path && (ext === 'docx' || ext === 'pptx' || ext === 'xlsx')) {
            const { data: dl } = await adminClient.storage.from('work-artifacts').download(String(lastDoc.storage_path));
            if (dl) revise = { artifactId: String(lastDoc.id), bytes: Buffer.from(await dl.arrayBuffer()), ext, title: lastDoc.title };
          }
        }
      }
      if (!csvText) {
        const atts = ((th?.user_attachments as Array<{ filename?: string; extractedText?: string | null }>) || []);
        const tab = [...atts].reverse().find((a) => a.extractedText
          && (/\.(csv|xlsx)$/i.test(String(a.filename ?? '')) || /^[^,\n]{1,60}(,[^,\n]{1,60}){2,}\n/.test(String(a.extractedText))));
        if (tab?.extractedText) csvText = tab.extractedText;
      }
    } catch { /* auto-resolution is an enhancement */ }
  }

  // 0b — W38 · THE FACTS FLOOR REACHES THE AUTHOR (found by the file verifier: a DM deck over a 4×3
  // sales table stated every quarter total +5,000 and a 29,600 year total — true 13,600 — because the
  // author summed by hand; and a thread-attached CSV reached ONLY the compiler, never the author, whose
  // text the compiler is bound to as THE CONTENT). Tabular material — the thread's attachment or a
  // table inside the grounding — is (a) shown to the author and (b) aggregated IN CODE in the sandbox
  // first; the author states aggregates only from those computed lines. Fail-soft: no sandbox → the
  // author writes as before (and the verify loop below still flags mismatches).
  const { tabularBlock } = await import('@/lib/compute/tabular');
  const table = csvText ?? tabularBlock(groundingContext);
  let computedFacts: string | null = null;
  if (table && !revise) {
    try {
      const { computeDataFacts } = await import('@/lib/compute/data-facts');
      computedFacts = await computeDataFacts(adminClient, userId, { request: instructions, csvText: table });
    } catch { computedFacts = null; }
  }
  const { clipForPrompt, EXCERPT_MARK, EXCERPT_RULE } = await import('@/lib/utils/clip-for-prompt');
  const attachedData = csvText && !(groundingContext ?? '').includes(csvText.slice(0, 200)) ? clipForPrompt(csvText, 8000) : null;

  // 1 — the author writes the content (the coworker's task-tier model; typed rule attached).
  const { getAIClient, aiCreate } = await import('@/lib/ai/factory');
  const { TYPED_OUTPUT_RULE } = await import('@/lib/workflows/typed-output');
  const { client: ai, model } = await getAIClient(userId, 'generation', adminClient);
  const kindLine = type === 'excel' ? 'The deliverable is a SPREADSHEET — return it as the ```spreadsheet fence.'
    : type === 'pptx' ? 'The deliverable is a SLIDE DECK — return it as the ```slides fence.'
    : 'The deliverable is a written document.';
  const res = await aiCreate(ai, {
    model, max_tokens: MAX_TOKENS[type] ?? 3500, temperature: 0.3,
    messages: [{
      role: 'user',
      content: `Write the complete deliverable described below. Output the deliverable ITSELF — no meta-commentary, no preamble.\n` +
        `${kindLine}\n${TYPED_OUTPUT_RULE}\n` +
        // W28 — ONE CONDUCT (lib/ai/conduct.ts `document`): the requested structure is the contract and the
        // source material is cross-checked before it is trusted.
        `${conductBlock('document')}\n` +
        (userContext ? `\nCONTEXT ABOUT THE USER:\n${userContext.slice(0, 2000)}\n` : '') +
        (groundingContext ? `\nSOURCE MATERIAL (the primary source — ground every fact here):\n${groundingContext.slice(0, 14000)}\n` : '') +
        (attachedData ? `\nTHE ATTACHED DATA (the table the user attached — ground every figure here):\n${attachedData}\n${attachedData.includes(EXCERPT_MARK) ? `(${EXCERPT_RULE})\n` : ''}` : '') +
        (computedFacts ? `\nCOMPUTED FACTS (computed BY CODE over the full table — authoritative): every total, mean, ` +
          `difference or other aggregate you state comes from these lines verbatim; never compute an aggregate yourself. ` +
          `A figure that is neither a raw value of the table nor in these lines is left out.\n${computedFacts}\n` : '') +
        (revise ? `\nTHIS REVISES the existing document "${revise.title ?? 'the current version'}" — produce the FULL revised text: apply the requested changes, keep everything else.\n` +
          (currentDocText ? `THE CURRENT DOCUMENT:\n${currentDocText}\n` : '') : '') +
        `\nCharts named in the ask are drawn BY CODE from the data — never draw a chart, bar or rule with characters (#, █, =, *).\n` +
        `\nTHE DELIVERABLE: ${instructions}`,
    }],
  });
  let content = (res.choices?.[0]?.message?.content ?? '').trim();
  if (!content) return { artifact: null, summary: 'Generation failed' };
  // The author's own leading "# Title" names the document (and the served file) — otherwise the
  // title would be the ask itself; it is lifted out so the document does not print it twice.
  const h1 = /^#\s+(.+?)\s*#*\s*\n/.exec(`${content}\n`);
  const authoredTitle = h1 && !/^```/.test(content) ? clipLabel(h1[1].replace(/\*\*/g, ''), 120) : null;
  if (authoredTitle) content = content.slice(h1![0].length).trim() || content;

  // 2 — the door: tiers + floors + theme, one place for every actor.
  const { materializeDocument } = await import('@/lib/documents/materialize');
  // W38 — A TITLE IS A LABEL, NOT A SLICE: the title names the served file ("<title>.xlsx"), and a raw
  // `.slice(0, 60)` cut the ask mid-word ("…with a Total col.xlsx"). The author's own typed title wins;
  // else the ask, clipped at a word boundary (clipLabel — the one label clip).
  const docTitle = authoredTitle || clipLabel(instructions, 60) || 'Document';
  const m = await materializeDocument(adminClient, userId, {
    title: docTitle, content,
    request: instructions,
    csvText: csvText ?? table, // a table found in the grounding is tabular material too (charts, facts)
    computedFacts, // the door's compiler reuses the author's facts (one computation, one truth)
    revise: revise ? { bytes: revise.bytes, ext: revise.ext, title: revise.title } : null,
    forceType: deliverableType as import('@/lib/types/inbox').DeliverableType,
  });

  // 3 — storage + the thread's artifact list. A revision VERSION-APPENDS (new id, parent_id =
  // the prior version, inherited title — the panel's version chain, the pre-door native
  // behaviour); fresh work replaces the prior artifact of the same type (also pre-door).
  const { randomUUID } = await import('crypto');
  const artifactId = randomUUID();
  const storagePath = `${userId}/${threadId}/${artifactId}.${m.ext}`;
  const { error: upErr } = await adminClient.storage.from('work-artifacts')
    .upload(storagePath, m.bytes, { contentType: m.mime, upsert: true, cacheControl: '0' });
  if (upErr) return { artifact: null, summary: 'Generation failed' };
  const artifact: DocumentArtifact = {
    id: artifactId, type: m.type,
    title: revise?.title ?? (String((m.content as { title?: unknown })?.title ?? '').trim() || docTitle),
    ...(revise ? { parent_id: revise.artifactId } : {}),
    generated_at: new Date().toISOString(), storage_path: storagePath, content: m.content,
  } as DocumentArtifact;

  const { data: freshThread } = await adminClient
    .from('work_threads')
    .select('artifacts')
    .eq('id', threadId)
    .single();
  const existing = ((freshThread?.artifacts as DocumentArtifact[]) || []);
  const updated = revise
    ? [...existing, artifact]
    : [...existing.filter((a: DocumentArtifact) => a.type !== artifact.type), artifact];
  const newArtifacts: DocumentArtifact[] = [artifact];

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
