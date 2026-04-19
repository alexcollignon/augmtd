import { google } from 'googleapis';
import { getOAuth2Client } from '@/lib/google/oauth';

export interface DriveFolder {
  id: string;
  name: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  size: number | null;
}

export interface DriveItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
}

function getAuthClient(encryptedTokens: string) {
  const tokens = JSON.parse(Buffer.from(encryptedTokens, 'base64').toString());
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens); // stored as raw Google OAuth token object
  return oauth2Client;
}

// Returns mixed folder + file contents for any folder (or root if folderId omitted)
// Folders come first, then files, both sorted by name
export async function listDriveContents(encryptedTokens: string, folderId?: string): Promise<DriveItem[]> {
  const auth = getAuthClient(encryptedTokens);
  const drive = google.drive({ version: 'v3', auth });

  const parent = folderId && folderId !== 'root' ? folderId : 'root';

  const res = await drive.files.list({
    q: `'${parent}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    pageSize: 200,
    orderBy: 'folder,name',
  });

  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name!,
    type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
    mimeType: f.mimeType!,
    size: f.size ? parseInt(f.size, 10) : null,
    modifiedTime: f.modifiedTime ?? null,
  }));
}

export async function listDriveFolders(encryptedTokens: string): Promise<DriveFolder[]> {
  const auth = getAuthClient(encryptedTokens);
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q: "mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false",
    fields: 'files(id, name)',
    pageSize: 100,
    orderBy: 'name',
  });

  return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name! }));
}

export async function listFolderFiles(encryptedTokens: string, folderId: string): Promise<DriveFile[]> {
  const auth = getAuthClient(encryptedTokens);
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    pageSize: 200,
    orderBy: 'name',
  });

  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    modifiedTime: f.modifiedTime ?? null,
    size: f.size ? parseInt(f.size, 10) : null,
  }));
}

export async function getDriveFilesForIds(encryptedTokens: string, fileIds: string[]): Promise<DriveItem[]> {
  const auth = getAuthClient(encryptedTokens);
  const drive = google.drive({ version: 'v3', auth });

  const results = await Promise.all(
    fileIds.map(async (fileId) => {
      try {
        const res = await drive.files.get({
          fileId,
          fields: 'id,name,mimeType,modifiedTime,size',
          supportsAllDrives: true,
        });
        const f = res.data;
        return {
          id: f.id!,
          name: f.name!,
          type: 'file' as const,
          mimeType: f.mimeType!,
          size: f.size ? parseInt(f.size, 10) : null,
          modifiedTime: f.modifiedTime ?? null,
        };
      } catch (err) {
        console.error(`[GoogleDrive] getDriveFilesForIds failed for fileId=${fileId}:`, err);
        return null;
      }
    })
  );

  return results.filter((f) => f !== null) as DriveItem[];
}

export async function readDriveFile(
  encryptedTokens: string,
  fileId: string,
  mimeType: string
): Promise<Buffer | string | null> {
  const auth = getAuthClient(encryptedTokens);
  const drive = google.drive({ version: 'v3', auth });

  // Google Docs → export as plain text
  if (mimeType === 'application/vnd.google-apps.document') {
    const res = await drive.files.export(
      { fileId, mimeType: 'text/plain' },
      { responseType: 'text' }
    );
    return typeof res.data === 'string' ? res.data : String(res.data);
  }

  // Google Sheets → export as CSV
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const res = await drive.files.export(
      { fileId, mimeType: 'text/csv' },
      { responseType: 'text' }
    );
    return typeof res.data === 'string' ? res.data : String(res.data);
  }

  // Google Slides → export as plain text
  if (mimeType === 'application/vnd.google-apps.presentation') {
    const res = await drive.files.export(
      { fileId, mimeType: 'text/plain' },
      { responseType: 'text' }
    );
    return typeof res.data === 'string' ? res.data : String(res.data);
  }

  // Other Google native formats — skip
  if (mimeType.startsWith('application/vnd.google-apps.')) {
    console.log(`[GoogleDrive] Skipping unsupported Google native type: ${mimeType}`);
    return null;
  }

  // Binary files (PDF, DOCX, images, etc.) — download directly
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data as ArrayBuffer);
}
