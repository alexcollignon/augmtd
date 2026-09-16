'use client';

// The client seam for THE ADDRESS LAW: the routed project room mounts the SAME EntityRoom every
// door used to render as query-state over the Home. Nothing about the room changes — only who
// owns its address. `onBack` follows the ONE back idiom (components/ui/back-link): return where
// you came from if we put you there, else this surface's natural parent (the projects grid).
// EntityRoom also calls onBack when the room resolves itself (Done / Archive / Not a project) —
// leaving the room is the right consequence there too.

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import EntityRoom from '@/components/entities/entity-room';
import { hasInAppHistory } from '@/components/ui/back-link';

export function ProjectRoomClient({ entityId, initialTab }: { entityId: string; initialTab?: 'work' }) {
  const router = useRouter();
  const onBack = useCallback(() => {
    if (hasInAppHistory()) router.back();
    else router.push('/home?view=projects');
  }, [router]);
  // ONE ROOM PER ID (owner walk, Sep 7): a soft nav between two projects keeps the same component
  // position, so React would REUSE this instance — the previous project's detail/rail/drawer/focus
  // state sits on screen until the new fetches land, and the hydrate would repaint underneath a
  // room the reader is already looking at. Keying on the entity id makes the id change a REMOUNT:
  // the mount effect re-runs, the new project's cache paints instantly, and no state bleeds across.
  return <EntityRoom key={entityId} entityId={entityId} onBack={onBack} initialTab={initialTab} />;
}

export default ProjectRoomClient;
