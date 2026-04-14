import InlineNoteViewPage from '@/components/meetings/inline-note-view-page';

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InlineNoteViewPage id={id} />;
}
