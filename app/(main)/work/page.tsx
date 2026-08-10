import { redirect } from 'next/navigation';

// ─── /work IS RETIRED (Aug 10, owner call — "the chat from before") ──────────────────────────
// The Home conversation now holds everything this page did: full thread memory (the panel
// transcript), production (the hand-off + artifacts-into-origin), attachments (drag-and-drop +
// the attached material), streaming. OLD DEEP LINKS KEEP WORKING: a ?thread&agent link lands in
// the same conversation through the Home chat opener; a bare visit lands on the Home.
// The client components (work-page-client, chat-input-bar, …) stay for one release as the
// /workers sweep's companions — deleted together when the dead-component sweep runs.

export default async function WorkRedirect({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; agent?: string }>;
}) {
  const { thread, agent } = await searchParams;
  if (thread && agent) redirect(`/home?chat=worker:${thread}:${agent}`);
  redirect('/home');
}
