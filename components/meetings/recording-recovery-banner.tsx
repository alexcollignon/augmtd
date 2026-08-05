'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RECORDING RECOVERY (Aug 5) — the vault's user-facing half. On app load (and window focus),
// any recording session whose tab died — crash, forced close, dead battery — surfaces here with
// its audio intact, and one click sends it through the normal upload → transcribe pipeline.
// Renders nothing when there is nothing to recover (the overwhelmingly common case).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { MicrophoneIcon } from '@heroicons/react/24/outline';
import {
  vaultListRecoverable,
  vaultUploadSession,
  vaultDownloadSession,
  vaultDelete,
  type VaultSessionMeta,
} from '@/lib/recording/vault';

type SessionStatus = 'idle' | 'uploading' | 'done' | 'error';

export default function RecordingRecoveryBanner() {
  const [sessions, setSessions] = useState<VaultSessionMeta[]>([]);
  const [status, setStatus] = useState<Record<string, SessionStatus>>({});
  const statusRef = useRef(status);
  statusRef.current = status;

  const scan = useCallback(async () => {
    const found = await vaultListRecoverable();
    setSessions((prev) => {
      // Keep rows that are mid-action even if a rescan momentarily misses them.
      const busy = prev.filter((s) => statusRef.current[s.id] === 'uploading' || statusRef.current[s.id] === 'done');
      const merged = [...found];
      for (const b of busy) if (!merged.some((m) => m.id === b.id)) merged.push(b);
      return merged;
    });
  }, []);

  useEffect(() => {
    // Small delay so a live tab's heartbeat (5s cadence, 20s staleness) settles first.
    const t = setTimeout(scan, 4000);
    const onFocus = () => void scan();
    window.addEventListener('focus', onFocus);
    return () => { clearTimeout(t); window.removeEventListener('focus', onFocus); };
  }, [scan]);

  const upload = async (id: string) => {
    setStatus((s) => ({ ...s, [id]: 'uploading' }));
    try {
      await vaultUploadSession(id);
      setStatus((s) => ({ ...s, [id]: 'done' }));
      try { new BroadcastChannel('meetings-updated').postMessage('recorded'); } catch { /* optional */ }
      setTimeout(() => setSessions((prev) => prev.filter((p) => p.id !== id)), 4000);
    } catch {
      setStatus((s) => ({ ...s, [id]: 'error' }));
    }
  };

  const discard = async (id: string) => {
    await vaultDelete(id);
    setSessions((prev) => prev.filter((p) => p.id !== id));
  };

  if (!sessions.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {sessions.map((s) => {
        const st = status[s.id] ?? 'idle';
        const mins = Math.max(1, Math.round(((s.endTime ?? s.heartbeatAt) - s.startedAt) / 60000));
        const when = new Date(s.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return (
          <div key={s.id} className="px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 shadow-sm">
            <div className="flex items-center gap-2 mb-1.5">
              <MicrophoneIcon className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
              <span className="text-[12px] font-medium text-amber-800 truncate">
                Unsaved recording — {s.title || 'Untitled meeting'}
              </span>
            </div>
            <p className="text-[11px] text-amber-700/80 mb-2">
              ~{mins} min · {when} · recovered from this device
            </p>
            {st === 'done' ? (
              <p className="text-[12px] font-medium text-emerald-700">Uploaded — transcribing now.</p>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => upload(s.id)}
                  disabled={st === 'uploading'}
                  className="px-2.5 py-1 text-[11px] font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 rounded-full transition-colors"
                >
                  {st === 'uploading' ? 'Uploading…' : st === 'error' ? 'Retry upload' : 'Upload & transcribe'}
                </button>
                <button
                  onClick={() => vaultDownloadSession(s.id)}
                  className="px-2.5 py-1 text-[11px] font-medium text-amber-700 border border-amber-300 hover:bg-amber-100 rounded-full transition-colors"
                >
                  Download
                </button>
                <button
                  onClick={() => discard(s.id)}
                  className="text-[11px] text-amber-500 hover:text-amber-700 underline"
                >
                  Discard
                </button>
                {st === 'error' && <span className="text-[11px] text-red-600">Upload failed</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
