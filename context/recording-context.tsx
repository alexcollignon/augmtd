'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useRecording, type UseRecordingReturn } from '@/hooks/useRecording';

const RecordingContext = createContext<UseRecordingReturn | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  const recording = useRecording(() => {
    // Broadcast on completion — pages subscribe via BroadcastChannel
    new BroadcastChannel('meetings-updated').postMessage('recorded');
  });

  return (
    <RecordingContext.Provider value={recording}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecordingContext(): UseRecordingReturn {
  const ctx = useContext(RecordingContext);
  if (!ctx) throw new Error('useRecordingContext must be used within RecordingProvider');
  return ctx;
}
