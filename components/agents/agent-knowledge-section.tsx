'use client';

import { useState, useRef } from 'react';
import { DocumentTextIcon, TrashIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline';

export interface AgentKnowledgeFile {
  id: string;          // agent_knowledge_sources.id
  name: string;
  knowledge_file_id: string;
}

interface Props {
  sources: AgentKnowledgeFile[];
  agentId?: string;    // present when editing an existing agent
  onAdd: (source: AgentKnowledgeFile) => void;
  onRemove: (sourceId: string) => void;
}

const ALLOWED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

export function AgentKnowledgeSection({ sources, agentId, onAdd, onRemove }: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    setUploading(true);

    try {
      for (const file of Array.from(files)) {
        if (!ALLOWED.has(file.type)) {
          setUploadError(`Unsupported file type: ${file.name}`);
          continue;
        }
        if (file.size > 25 * 1024 * 1024) {
          setUploadError(`File too large (max 25 MB): ${file.name}`);
          continue;
        }

        // 1. Presign
        const presignRes = await fetch('/api/drive/upload/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [{ filename: file.name, mimeType: file.type, size: file.size }] }),
        });
        if (!presignRes.ok) throw new Error('Presign failed');
        const { uploads } = await presignRes.json();
        const { signedUrl, storagePath } = uploads[0];

        // 2. PUT to storage
        const putRes = await fetch(signedUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        });
        if (!putRes.ok) throw new Error('Upload failed');

        // 3. Confirm + index
        const confirmRes = await fetch('/api/drive/upload/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: storagePath, filename: file.name, mimeType: file.type, sizeBytes: file.size }),
        });
        if (!confirmRes.ok) throw new Error('Indexing failed');
        const kbFile = await confirmRes.json();

        // 4. If agent already exists, attach immediately; otherwise attach on save via onAdd
        if (agentId) {
          const attachRes = await fetch(`/api/agents/${agentId}/knowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ knowledge_file_id: kbFile.id, name: file.name }),
          });
          if (!attachRes.ok) throw new Error('Attach failed');
          const { source } = await attachRes.json();
          onAdd(source);
        } else {
          // Pending — will be attached after agent is created
          onAdd({ id: `pending-${kbFile.id}`, name: file.name, knowledge_file_id: kbFile.id });
        }
      }
    } catch (err) {
      setUploadError(String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-neutral-500 uppercase tracking-wide">Knowledge</span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] text-neutral-600 hover:bg-neutral-100 transition-colors disabled:opacity-50"
        >
          <ArrowUpTrayIcon className="w-3.5 h-3.5" />
          {uploading ? 'Uploading…' : 'Upload file'}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {uploadError && (
        <p className="text-[11.5px] text-red-500">{uploadError}</p>
      )}

      {sources.length === 0 ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full border border-dashed border-neutral-200 rounded-xl p-6 text-center hover:border-neutral-300 hover:bg-neutral-50 transition-colors group"
        >
          <ArrowUpTrayIcon className="w-5 h-5 text-neutral-300 group-hover:text-neutral-400 mx-auto mb-2" />
          <p className="text-[12px] text-neutral-400">Upload PDF, Word, Excel, PowerPoint, or text files</p>
          <p className="text-[11px] text-neutral-300 mt-0.5">Max 25 MB per file</p>
        </button>
      ) : (
        <div className="space-y-1.5">
          {sources.map((s) => (
            <div key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-50 group">
              <DocumentTextIcon className="w-4 h-4 text-neutral-400 flex-shrink-0" />
              <span className="flex-1 text-[12.5px] text-neutral-700 truncate">{s.name}</span>
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-neutral-200 transition-all"
              >
                <TrashIcon className="w-3.5 h-3.5 text-neutral-400" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50"
          >
            <ArrowUpTrayIcon className="w-3.5 h-3.5" />
            {uploading ? 'Uploading…' : 'Add more files'}
          </button>
        </div>
      )}
    </div>
  );
}
