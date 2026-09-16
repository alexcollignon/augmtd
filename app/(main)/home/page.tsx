import { redirect } from 'next/navigation';
import { guardFeaturePage } from '@/lib/workspace/guards';
import { HomeView } from '@/components/home/home-view';
import { projectHref } from '@/lib/room/project-href';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ entity?: string; project?: string }> }) {
  await guardFeaturePage(null);
  // THE ADDRESS LAW — legacy project-room addresses forward to the room's own address. Old deep
  // links live in emails, notifications and saved tabs (`?view=projects&entity=<id>`, and the
  // never-read `?project=<id>` form the meetings/whats-happening doors emitted), so they must
  // survive the move rather than land on the deck. Every live door now links straight to
  // /project/<id>; this is purely the back-compat hop.
  const { entity, project } = await searchParams;
  const legacy = entity || project;
  if (legacy) redirect(projectHref(legacy));
  return <HomeView />;
}
