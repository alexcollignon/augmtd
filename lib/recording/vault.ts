'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RECORDING VAULT (Aug 5) — a meeting recording must survive its tab.
//
// Before this, audio lived only in the tab's memory: a browser crash, an accidental close, or a
// dead battery mid-meeting destroyed every recorded second (and a failed upload used to destroy
// the finished blob — fixed the same day in useRecording). The vault mirrors every ~1s chunk to
// IndexedDB as it is recorded, tracks the session's stage, and is cleared ONLY after the server
// confirm succeeds. On any later app load, a session whose heartbeat went stale surfaces as a
// recoverable recording (upload / download / discard) via RecordingRecoveryBanner.
//
// Every operation is best-effort and swallows its own failures — the vault is a safety net,
// never a new way for recording itself to break (Safari private mode has no usable IndexedDB).
// ════════════════════════════════════════════════════════════════════════════════════════════════

export interface VaultSessionMeta {
  id: string;
  title: string;
  calendarEventId?: string;
  /** meeting_transcripts note row to promote (mirrors useRecording's noteIdRef). */
  noteId?: string;
  mimeType: string;
  startedAt: number;
  /** Bumped every few seconds while the owning tab is alive — staleness = recoverable. */
  heartbeatAt: number;
  stage: 'recording' | 'pending';
  /** Set once the storage PUT succeeded — recovery then skips straight to confirm. */
  storagePath?: string;
  endTime?: number;
  notes?: string;
  /** The finalized (duration-fixed) blob, stored at stop time; chunks are the fallback. */
  finalBlob?: Blob;
}

const DB_NAME = 'aug-recording-vault';
const DB_VERSION = 1;
const SESSIONS = 'sessions';
const CHUNKS = 'chunks';
/** A session whose heartbeat is older than this is considered abandoned by its tab. */
const STALE_MS = 20_000;

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const chunks = db.createObjectStore(CHUNKS, { keyPath: ['sessionId', 'seq'] });
        chunks.createIndex('bySession', 'sessionId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(storeNames: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  return openVault().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeNames, mode);
        let result: T;
        Promise.resolve(run(t)).then((r) => { result = r; }, reject);
        t.oncomplete = () => { db.close(); resolve(result); };
        t.onerror = () => { db.close(); reject(t.error); };
        t.onabort = () => { db.close(); reject(t.error); };
      }),
  );
}

function reqDone<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function vaultSaveMeta(meta: VaultSessionMeta): Promise<void> {
  try { await tx([SESSIONS], 'readwrite', (t) => reqDone(t.objectStore(SESSIONS).put(meta)).then(() => {})); } catch { /* best-effort */ }
}

export async function vaultPatchMeta(id: string, patch: Partial<VaultSessionMeta>): Promise<void> {
  try {
    await tx([SESSIONS], 'readwrite', async (t) => {
      const store = t.objectStore(SESSIONS);
      const existing = (await reqDone(store.get(id))) as VaultSessionMeta | undefined;
      if (existing) await reqDone(store.put({ ...existing, ...patch }));
    });
  } catch { /* best-effort */ }
}

export async function vaultSaveChunk(sessionId: string, seq: number, data: Blob): Promise<void> {
  try { await tx([CHUNKS], 'readwrite', (t) => reqDone(t.objectStore(CHUNKS).put({ sessionId, seq, data })).then(() => {})); } catch { /* best-effort */ }
}

export async function vaultDelete(sessionId: string): Promise<void> {
  try {
    await tx([SESSIONS, CHUNKS], 'readwrite', async (t) => {
      await reqDone(t.objectStore(SESSIONS).delete(sessionId));
      const idx = t.objectStore(CHUNKS).index('bySession');
      const keys = await reqDone(idx.getAllKeys(IDBKeyRange.only(sessionId)));
      for (const k of keys) await reqDone(t.objectStore(CHUNKS).delete(k as IDBValidKey));
    });
  } catch { /* best-effort */ }
}

/** Sessions abandoned by their tab (stale heartbeat) — the recovery banner's work list. */
export async function vaultListRecoverable(): Promise<VaultSessionMeta[]> {
  try {
    const all = await tx([SESSIONS], 'readonly', (t) => reqDone(t.objectStore(SESSIONS).getAll()) as Promise<VaultSessionMeta[]>);
    const cutoff = Date.now() - STALE_MS;
    return all.filter((s) => s.heartbeatAt < cutoff);
  } catch { return []; }
}

/** Reassemble a session's audio: the finalized blob when the recording reached stop, else the raw chunk stream. */
export async function vaultAssemble(sessionId: string): Promise<{ meta: VaultSessionMeta; blob: Blob } | null> {
  try {
    return await tx([SESSIONS, CHUNKS], 'readonly', async (t) => {
      const meta = (await reqDone(t.objectStore(SESSIONS).get(sessionId))) as VaultSessionMeta | undefined;
      if (!meta) return null;
      if (meta.finalBlob && meta.finalBlob.size > 0) return { meta, blob: meta.finalBlob };
      const rows = (await reqDone(t.objectStore(CHUNKS).index('bySession').getAll(IDBKeyRange.only(sessionId)))) as Array<{ seq: number; data: Blob }>;
      if (!rows.length) return null;
      rows.sort((a, b) => a.seq - b.seq);
      return { meta, blob: new Blob(rows.map((r) => r.data), { type: meta.mimeType }) };
    });
  } catch { return null; }
}

/**
 * Upload a recovered session through the SAME doors as a live recording (presign → PUT →
 * confirm). Standalone from useRecording on purpose — recovery runs without any live recorder
 * state, straight off the vault. Deletes the session only after the confirm succeeds.
 */
export async function vaultUploadSession(sessionId: string): Promise<void> {
  const assembled = await vaultAssemble(sessionId);
  if (!assembled) throw new Error('Recording data not found');
  const { meta, blob } = assembled;

  let storagePath = meta.storagePath;
  if (!storagePath) {
    const presignRes = await fetch('/api/meetings/recordings/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'recording.webm', mimeType: meta.mimeType }),
    });
    if (!presignRes.ok) throw new Error('Failed to get upload URL');
    const { signedUrl, storagePath: path } = await presignRes.json();
    const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': meta.mimeType }, body: blob });
    if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
    storagePath = path;
    await vaultPatchMeta(sessionId, { storagePath: path });
  }

  const confirmRes = await fetch('/api/meetings/recordings/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storagePath,
      calendarEventId: meta.calendarEventId,
      title: meta.title || 'Recovered recording',
      startTime: new Date(meta.startedAt).toISOString(),
      // Best estimate of when it died: the last heartbeat the tab managed to write.
      endTime: new Date(meta.endTime ?? meta.heartbeatAt).toISOString(),
      liveNotes: meta.notes || undefined,
      existingNoteId: meta.noteId || undefined,
    }),
  });
  if (!confirmRes.ok) throw new Error('Failed to start transcription');

  await vaultDelete(sessionId);
}

/** Save a session's audio to the user's device. */
export async function vaultDownloadSession(sessionId: string): Promise<void> {
  const assembled = await vaultAssemble(sessionId);
  if (!assembled) throw new Error('Recording data not found');
  const { meta, blob } = assembled;
  const ext = meta.mimeType.includes('mp4') ? 'm4a' : 'webm';
  const safeTitle = (meta.title || 'recording').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
