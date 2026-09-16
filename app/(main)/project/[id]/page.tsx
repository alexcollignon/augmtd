import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/supabase/get-session-user';
import { guardFeaturePage } from '@/lib/workspace/guards';
import { ProjectRoomClient } from './project-room-client';

// ── THE ADDRESS LAW (lib/room/project-href.ts): the project room's real, refreshable,
// deep-linkable address. Renders exactly the room the Home used to show as query-state.
//
// ACCESS: the room's own routes (`/api/entities/[id]/detail` · `/room`) are already scoped
// `.eq('user_id', user.id)` and answer a stranger with a 404 — this page asserts the SAME read
// before painting, so a stranger's or a missing id is indistinguishable (a not-found page, never
// an empty room that implies the id exists).

export default async function ProjectRoomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  // ── THE SEGMENT WAITS ON ONE ANSWER (owner walk, Sep 8 — "project room still takes too long").
  // This page's whole job is a 404 guard, and it used to pay for it FOUR times over, in series:
  // the feature guard, then `params`, then `searchParams`, then a SECOND `auth.getUser()` (an
  // uncached round-trip to the auth server — the layout and the guard had already paid for the
  // first), and only then the entity read. Everything the client needs sits behind that chain, so
  // every millisecond of it is a millisecond of blank page.
  //   · the auth read is the React-CACHED one (`getSessionUser`), deduped with the layout's
  //   · the guard, the two param promises and the auth read fly TOGETHER — none consumes another
  //   · only the entity read genuinely consumes one of them (the id + the user), so it alone waits
  const [, { id }, { tab }, user] = await Promise.all([
    guardFeaturePage(null),
    params,
    // `?tab=work` — the timeline lane's "open at the work tab" nuance rides the address (the
    // address law: presentation state a door hands over must survive refresh/deep-link).
    searchParams,
    getSessionUser(),
  ]);
  if (!user) notFound(); // the layout/guard already redirected; this is belt-and-braces

  const supabase = await createClient();
  const { data: ent } = await supabase.from('work_entities')
    .select('id')
    .eq('id', id).eq('user_id', user.id).eq('kind', 'initiative')
    .maybeSingle();
  if (!ent) notFound();

  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <ProjectRoomClient entityId={id} initialTab={tab === 'work' ? 'work' : undefined} />
    </div>
  );
}
