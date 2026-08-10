import { redirect } from 'next/navigation';

// ─── /workers IS RETIRED (coherence slice #5, Aug 10 — the kill list, closed) ─────────────────
// Every job this page held has a better home: coworker chat → the Home conversations; tasks →
// the Workflows ledger; deliverables → Runs (+ the sidebar badge); report-backs → dissolved
// (origin decides the surface); team config → Settings → Team; meeting the team → the sidebar
// facepile. OLD DEEP LINKS KEEP WORKING: ?worker&thread redirects into the Home conversation
// opener, so every report-back email ever sent still lands somewhere true.

export default async function WorkersRedirect({
  searchParams,
}: {
  searchParams: Promise<{ worker?: string; thread?: string }>;
}) {
  const { worker, thread } = await searchParams;
  if (thread && worker) redirect(`/home?chat=worker:${thread}:${worker}`);
  redirect('/home');
}
