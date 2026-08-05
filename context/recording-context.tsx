'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useRecording, type UseRecordingReturn } from '@/hooks/useRecording';
import RecordingRecoveryBanner from '@/components/meetings/recording-recovery-banner';

const RecordingContext = createContext<UseRecordingReturn | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  const recording = useRecording(() => {
    // Broadcast on completion — pages subscribe via BroadcastChannel
    new BroadcastChannel('meetings-updated').postMessage('recorded');
  });

  return (
    <RecordingContext.Provider value={recording}>
      {children}
      {/* Crash/close recovery — renders only when the vault holds an orphaned session. */}
      <RecordingRecoveryBanner />
    </RecordingContext.Provider>
  );
}

export function useRecordingContext(): UseRecordingReturn {
  const ctx = useContext(RecordingContext);
  if (!ctx) throw new Error('useRecordingContext must be used within RecordingProvider');
  return ctx;
}
