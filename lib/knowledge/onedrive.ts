import { getGraphClient } from '@/lib/microsoft/outlook';

export interface OneDriveFolder {
  id: string;
  name: string;
}

export interface OneDriveFile {
  id: string;
  name: string;
  mimeType: string;
  lastModifiedDateTime: string | null;
  size: number | null;
}

export interface OneDriveItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  mimeType: string;
  size: number | null;
  lastModifiedDateTime: string | null;
}

// Returns mixed folder + file contents for any folder (or root if folderId omitted)
// Folders come first, then files, both sorted by name
export async function listOneDriveContents(encryptedTokens: string, folderId?: string): Promise<OneDriveItem[]> {
  const graphClient = await getGraphClient(encryptedTokens);

  const endpoint = folderId && folderId !== 'root'
    ? `/me/drive/items/${folderId}/children`
    : `/me/drive/root/children`;

  const res = await graphClient
    .api(endpoint)
    .select('id,name,folder,file,lastModifiedDateTime,size')
    .top(200)
    .get();

  const items: OneDriveItem[] = (res.value ?? []).map((f: any) => ({
    id: f.id,
    name: f.name,
    type: f.folder ? 'folder' : 'file',
    mimeType: f.file?.mimeType ?? 'application/octet-stream',
    size: f.size ?? null,
    lastModifiedDateTime: f.lastModifiedDateTime ?? null,
  }));

  // Folders first, then files — both alphabetical
  return items.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'folder' ? -1 : 1;
  });
}

export async function listOneDriveFolders(encryptedTokens: string): Promise<OneDriveFolder[]> {
  const graphClient = await getGraphClient(encryptedTokens);

  const res = await graphClient
    .api('/me/drive/root/children')
    .filter("folder ne null")
    .select('id,name')
    .top(100)
    .get();

  return (res.value ?? []).map((f: any) => ({ id: f.id, name: f.name }));
}

export async function listFolderFiles(encryptedTokens: string, folderId: string): Promise<OneDriveFile[]> {
  const graphClient = await getGraphClient(encryptedTokens);

  const res = await graphClient
    .api(`/me/drive/items/${folderId}/children`)
    .filter("file ne null")
    .select('id,name,file,lastModifiedDateTime,size')
    .top(200)
    .get();

  return (res.value ?? []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.file?.mimeType ?? 'application/octet-stream',
    lastModifiedDateTime: f.lastModifiedDateTime ?? null,
    size: f.size ?? null,
  }));
}

export async function getOneDriveFilesForIds(encryptedTokens: string, fileIds: string[]): Promise<OneDriveItem[]> {
  const graphClient = await getGraphClient(encryptedTokens);

  const results = await Promise.all(
    fileIds.map(async (id) => {
      try {
        const f = await graphClient
          .api(`/me/drive/items/${id}`)
          .select('id,name,file,lastModifiedDateTime,size')
          .get();
        return {
          id: f.id,
          name: f.name,
          type: 'file' as const,
          mimeType: f.file?.mimeType ?? 'application/octet-stream',
          size: f.size ?? null,
          lastModifiedDateTime: f.lastModifiedDateTime ?? null,
        };
      } catch {
        return null;
      }
    })
  );

  return results.filter((f): f is OneDriveItem => f !== null);
}

export async function readOneDriveFile(encryptedTokens: string, fileId: string): Promise<Buffer> {
  const graphClient = await getGraphClient(encryptedTokens);

  const response = await graphClient
    .api(`/me/drive/items/${fileId}/content`)
    .responseType('arraybuffer' as any)
    .get();

  return Buffer.from(response);
}
