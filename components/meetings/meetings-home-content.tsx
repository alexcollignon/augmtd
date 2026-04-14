'use client';

import { useRouter } from 'next/navigation';
import { useMeetingsData } from '@/context/meetings-data-context';
import MeetingsHome from '@/components/meetings/meetings-home';

export default function MeetingsHomeContent() {
  const router = useRouter();
  const {
    upcoming,
    transcripts,
    filterPersonEmail,
    handleDeleteTranscript,
    handleRetryFailed,
    isNew,
  } = useMeetingsData();

  return (
    <MeetingsHome
      upcoming={upcoming}
      transcripts={transcripts}
      filterPersonEmail={filterPersonEmail}
      onSelectMeeting={(id) => router.push(`/meetings/${id}`)}
      onDeleteTranscript={handleDeleteTranscript}
      onRetryFailed={handleRetryFailed}
      isNew={isNew}
    />
  );
}
