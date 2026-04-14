'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMeetingsData } from '@/context/meetings-data-context';
import { useRecordingContext } from '@/context/recording-context';
import InlineNoteView from '@/components/meetings/inline-note-view';

interface InlineNoteViewPageProps {
  /** Pass a meeting/transcript id, or null for a new ad-hoc note. */
  id: string | null;
}

export default function InlineNoteViewPage({ id }: InlineNoteViewPageProps) {
  const router = useRouter();
  const {
    fetchAll,
    setActiveMeetingContext,
    openChatPanel,
    openCaptureModal,
  } = useMeetingsData();
  const recording = useRecordingContext();

  // After in-person recording finishes on /meetings/new, navigate to the note's result page.
  // reset() clears state → 'idle' so future /meetings/new mounts don't re-trigger this redirect.
  useEffect(() => {
    if (id !== null) return; // only for new ad-hoc notes
    if (recording.state !== 'done') return;
    const noteId = recording.recordingNoteId;
    if (noteId) {
      recording.reset();
      fetchAll();
      router.replace(`/meetings/${noteId}`);
    }
  }, [recording.state, recording.recordingNoteId, id, router, fetchAll, recording.reset]);

  return (
    <InlineNoteView
      eventId={id}
      onBack={() => router.push('/meetings')}
      onCreated={(newId) => {
        router.replace(`/meetings/${newId}`);
        fetchAll();
      }}
      onNoteRowCreated={fetchAll}
      onMeetingContextReady={setActiveMeetingContext}
      onRequestChat={(autoMessage) => openChatPanel(autoMessage)}
      onNewBot={openCaptureModal}
      onStartRecording={(title, calendarEventId, noteId) =>
        recording.startRecording(title, calendarEventId, noteId)
      }
    />
  );
}
