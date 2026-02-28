import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentArtifact, XlsxContent } from '@/lib/types/inbox';
import { buildXlsx, getMimeType } from '@/lib/artifacts/builders';
import { extractInvoicesFromFiles } from '@/lib/skills/invoice-extractor';

const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

// Default columns when user hasn't specified any preference
const DEFAULT_FIELDS = [
  'Vendor', 'Invoice #', 'Date', 'Due Date',
  'Subtotal', 'Tax', 'Amount Due', 'Currency',
  'Category', 'Payment Terms', 'File',
];

// "File" is a reserved label — maps to raw_filename, not extracted from the invoice
const FILE_LABEL = 'File';

export async function runInvoicePipeline(params: {
  userId: string;
  threadId: string;
  userAttachments: Array<{
    filename: string;
    mimeType: string;
    storagePath: string;
    extractedText: string | null;
  }>;
  stepOptions: Record<string, unknown>;
  adminClient: SupabaseClient;
}): Promise<DocumentArtifact> {
  const { userId, threadId, userAttachments, stepOptions, adminClient } = params;

  const fields: string[] = Array.isArray(stepOptions.fields) && stepOptions.fields.length > 0
    ? stepOptions.fields as string[]
    : DEFAULT_FIELDS;

  // Filter to supported file types
  const supported = userAttachments.filter((a) => SUPPORTED_MIME_TYPES.includes(a.mimeType));
  if (supported.length === 0) {
    throw new Error('No supported invoice files attached (PDF or image required)');
  }

  // Download each file from storage
  const files: Array<{ filename: string; buffer: Buffer; mimeType: string }> = [];
  for (const attachment of supported) {
    const { data: blob, error } = await adminClient.storage
      .from('email-attachments')
      .download(attachment.storagePath);

    if (error || !blob) {
      console.error(`[InvoicePipeline] Failed to download ${attachment.filename}:`, error);
      continue;
    }

    files.push({
      filename: attachment.filename,
      buffer: Buffer.from(await blob.arrayBuffer()),
      mimeType: attachment.mimeType,
    });
  }

  if (files.length === 0) {
    throw new Error('Could not download any attached files');
  }

  // Extract — pass the exact fields the user requested
  const invoices = await extractInvoicesFromFiles(files, fields);

  // Build summary sheet — headers are the field labels, values come from extracted or raw_filename
  const summaryHeaders = fields;
  const summaryRows = invoices.map((inv) =>
    fields.map((f) => f === FILE_LABEL ? inv.raw_filename : (inv.extracted[f] ?? null))
  );

  // Build line items sheet from whatever was extracted
  const lineItemRows: (string | number | null)[][] = [];
  for (const inv of invoices) {
    for (const item of inv.line_items || []) {
      lineItemRows.push([
        inv.extracted['Vendor'] ?? inv.raw_filename,
        inv.extracted['Invoice #'] ?? null,
        item.description,
        item.quantity,
        item.unit_price,
        item.total,
      ]);
    }
  }

  const content: XlsxContent = {
    title: 'Invoice Extraction',
    sheets: [
      { name: 'Invoice Summary', headers: summaryHeaders, rows: summaryRows },
      ...(lineItemRows.length > 0
        ? [{ name: 'Line Items', headers: ['Vendor', 'Invoice #', 'Description', 'Quantity', 'Unit Price', 'Line Total'], rows: lineItemRows }]
        : []),
    ],
  };

  const buffer = await buildXlsx(content);
  const storagePath = `${userId}/${threadId}.xlsx`;

  const { error: uploadError } = await adminClient.storage
    .from('work-artifacts')
    .upload(storagePath, buffer, { contentType: getMimeType('spreadsheet'), upsert: true });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const artifact: DocumentArtifact = {
    title: 'Invoice Extraction & Classification',
    type: 'spreadsheet',
    generated_at: new Date().toISOString(),
    storage_path: storagePath,
    content,
    source_data: invoices,
  };

  await adminClient
    .from('work_threads')
    .update({ artifact, updated_at: new Date().toISOString() })
    .eq('id', threadId);

  return artifact;
}
