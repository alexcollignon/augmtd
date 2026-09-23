import { redirect } from 'next/navigation';
import { guardFeaturePage } from '@/lib/workspace/guards';
import { HomeView } from '@/components/home/home-view';
import { projectHref } from '@/lib/room/project-href';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ entity?: string; project?: string; view?: string }> }) {
  await guardFeaturePage(null);
  // THE ADDRESS LAW — legacy project-room addresses forward to the room's own address. Old deep
  // links live in emails, notifications and saved tabs (`?view=projects&entity=<id>`, and the
  // never-read `?project=<id>` form the meetings/whats-happening doors emitted), so they must
  // survive the move rather than land on the deck. Every live door now links straight to
  // /project/<id>; this is purely the back-compat hop.
  const { entity, project, view } = await searchParams;
  const legacy = entity || project;
  if (legacy) redirect(projectHref(legacy));
  // A DEEP LINK TO A LENS PAINTS THAT LENS FIRST (W5b, owner walk Sep 23): the lens was read from
  // `location` in a layout effect, which runs only after hydration — the SERVER'S HTML (the bare
  // Home) painted first. The address rides the server render now, so frame one is the lens. The
  // client validates it against its own lens list; an unknown value is simply the dashboard.
  return <HomeView initialView={typeof view === 'string' ? view : null} />;
}
