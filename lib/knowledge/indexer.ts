import OpenAI from 'openai';
import { SupabaseClient } from '@supabase/supabase-js';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';
import { listDriveContents, readDriveFile, getDriveFilesForIds, DriveItem } from './google-drive';
import { listOneDriveContents, readOneDriveFile, getOneDriveFilesForIds, OneDriveItem } from './onedrive';

const MAX_FILES_PER_SYNC = 300;

const SKIP_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/gif', 'image/bmp', 'image/tiff', 'image/svg+xml',
  'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
]);

export interface KnowledgeFile {
  id: string;
  user_id: string;
  source_id: string;
  provider_file_id: string;
  filename: string;
  mime_type: string;
  extracted_text: string | null;
  size_bytes: number | null;
  last_modified_at: string | null;
  indexed_at: string;
  similarity?: number;
}

export async function embedText(text: string): Promise<number[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000), // stay within token limits
  });
  return res.data[0].embedding;
}

async function extractTextFromFile(
  content: Buffer | string | null,
  mimeType: string,
  filename: string
): Promise<string | null> {
  if (content === null) return null;

  // Google Docs / Sheets already come back as plain text/CSV strings
  if (typeof content === 'string') {
    return content.trim() || null;
  }

  // PDF, DOCX, TXT, XLSX — reuse existing extractor
  return extractTextFromAttachment(content, mimeType, filename);
}

function getModifiedAt(file: DriveItem | OneDriveItem): string | null {
  return 'modifiedTime' in file ? file.modifiedTime : (file as OneDriveItem).lastModifiedDateTime;
}

async function collectAllFiles(
  provider: 'google_drive' | 'onedrive',
  encryptedTokens: string,
  folderId: string,
  depth = 0
): Promise<(DriveItem | OneDriveItem)[]> {
  const MAX_DEPTH = 6;
  if (depth > MAX_DEPTH) return [];

  const items =
    provider === 'google_drive'
      ? await listDriveContents(encryptedTokens, folderId)
      : await listOneDriveContents(encryptedTokens, folderId);

  const files: (DriveItem | OneDriveItem)[] = [];
  const subFolderPromises: Promise<(DriveItem | OneDriveItem)[]>[] = [];

  for (const item of items) {
    if (item.type === 'folder') {
      subFolderPromises.push(collectAllFiles(provider, encryptedTokens, item.id, depth + 1));
    } else {
      files.push(item);
    }
  }

  const nested = await Promise.all(subFolderPromises);
  return files.concat(...nested);
}

export async function indexSource(
  sourceId: string,
  adminClient: SupabaseClient
): Promise<{ indexed: number; errors: number }> {
  // Load source
  const { data: source, error: sourceError } = await adminClient
    .from('knowledge_sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (sourceError || !source) {
    console.error(`[Indexer] Source not found: ${sourceId}`);
    return { indexed: 0, errors: 1 };
  }

  // Load the specific connection stored on the source, or fall back to first active
  const providerMap: Record<string, string> = { google_drive: 'gmail', onedrive: 'outlook' };
  const connectionProvider = providerMap[source.provider];

  let connQuery = adminClient
    .from('connections')
    .select('metadata')
    .eq('user_id', source.user_id)
    .eq('provider', connectionProvider)
    .eq('status', 'active');

  if (source.connection_id) connQuery = connQuery.eq('id', source.connection_id);

  const { data: conns } = await connQuery.limit(1);
  const encryptedTokens = conns?.[0]?.metadata?.tokens;

  if (!encryptedTokens) {
    console.error(`[Indexer] No active ${connectionProvider} connection for user ${source.user_id}`);
    await adminClient
      .from('knowledge_sources')
      .update({ status: 'error', updated_at: new Date().toISOString() })
      .eq('id', sourceId);
    return { indexed: 0, errors: 1 };
  }

  // Mark as indexing
  await adminClient
    .from('knowledge_sources')
    .update({ status: 'indexing', updated_at: new Date().toISOString() })
    .eq('id', sourceId);

  let indexed = 0;
  let errors = 0;

  try {
    // 1. Collect files — specific IDs or entire folder tree
    let allFiles: (DriveItem | OneDriveItem)[];
    if (source.file_ids?.length) {
      allFiles = source.provider === 'google_drive'
        ? await getDriveFilesForIds(encryptedTokens, source.file_ids)
        : await getOneDriveFilesForIds(encryptedTokens, source.file_ids);
    } else {
      allFiles = await collectAllFiles(source.provider, encryptedTokens, source.folder_id);
    }

    // 2. Filter non-indexable MIME types
    const indexable = allFiles.filter((f) => !SKIP_MIME_TYPES.has(f.mimeType));

    // 3. Cap at MAX_FILES_PER_SYNC
    if (indexable.length > MAX_FILES_PER_SYNC) {
      console.warn(`[Indexer] Source ${sourceId} has ${indexable.length} files — truncating to ${MAX_FILES_PER_SYNC}`);
    }
    const files = indexable.slice(0, MAX_FILES_PER_SYNC);

    // 4. Load existing file map for incremental sync
    const { data: existing } = await adminClient
      .from('knowledge_files')
      .select('provider_file_id, last_modified_at')
      .eq('source_id', sourceId);
    const existingMap = new Map(existing?.map((f) => [f.provider_file_id, f.last_modified_at]) ?? []);

    for (const file of files) {
      try {
        // 5. Skip unchanged files
        const modifiedAt = getModifiedAt(file);
        if (modifiedAt && existingMap.get(file.id) === modifiedAt) {
          indexed++;
          continue;
        }

        // 6. Download → extract → embed → upsert
        let content: Buffer | string | null = null;
        if (source.provider === 'google_drive') {
          content = await readDriveFile(encryptedTokens, file.id, file.mimeType);
        } else {
          content = await readOneDriveFile(encryptedTokens, file.id);
        }

        const extractedText = await extractTextFromFile(content, file.mimeType, file.name);

        let embedding: number[] | null = null;
        if (extractedText && extractedText.length > 10) {
          embedding = await embedText(extractedText);
        }

        const { error: upsertError } = await adminClient
          .from('knowledge_files')
          .upsert(
            {
              user_id: source.user_id,
              source_id: sourceId,
              provider_file_id: file.id,
              filename: file.name,
              mime_type: file.mimeType,
              extracted_text: extractedText,
              embedding: embedding ? JSON.stringify(embedding) : null,
              size_bytes: file.size,
              last_modified_at: modifiedAt,
              indexed_at: new Date().toISOString(),
            },
            { onConflict: 'source_id,provider_file_id' }
          );

        if (upsertError) {
          console.error(`[Indexer] Upsert failed for ${file.name}:`, upsertError);
          errors++;
        } else {
          indexed++;
        }
      } catch (fileErr) {
        console.error(`[Indexer] Failed to index ${file.name}:`, fileErr);
        errors++;
      }
    }

    // Update source status
    await adminClient
      .from('knowledge_sources')
      .update({
        status: errors === files.length && files.length > 0 ? 'error' : 'ready',
        file_count: indexed,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourceId);
  } catch (err) {
    console.error(`[Indexer] indexSource failed for ${sourceId}:`, err);
    await adminClient
      .from('knowledge_sources')
      .update({ status: 'error', updated_at: new Date().toISOString() })
      .eq('id', sourceId);
    errors++;
  }

  return { indexed, errors };
}

export async function searchKnowledge(
  userId: string,
  query: string,
  limit: number,
  adminClient: SupabaseClient
): Promise<KnowledgeFile[]> {
  const queryEmbedding = await embedText(query);

  const { data, error } = await adminClient.rpc('search_knowledge_files', {
    p_user_id: userId,
    p_embedding: JSON.stringify(queryEmbedding),
    p_limit: limit,
  });

  if (error) {
    console.error('[Indexer] searchKnowledge error:', error);
    return [];
  }

  return data ?? [];
}
