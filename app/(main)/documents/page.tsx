import { guardFeaturePage } from '@/lib/workspace/guards';
import KnowledgePanel from '@/components/knowledge/knowledge-panel';

// ONE LIBRARY, ONE ADDRESS (owner, Sep 15 — docs/documents-library-plan.md): the library is its
// own page; /drive, /knowledge and the retired Settings→Knowledge tab are redirect seats. The Aug 6
// clause that grounded Knowledge in the Settings nav is REVISED, not violated. There is still
// exactly ONE component (KnowledgePanel) and ONE overview read — the frame moved, not the organs.
export default async function DocumentsPage() {
  await guardFeaturePage('drive');

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-neutral-50 p-2">
      {/* THE TWO-PANE LIBRARY (Sep 15, owner's second walk): the PANEL owns the scrolling, because
          its two panes scroll independently — the rail must never scroll away under a long folder.
          So the card frame is overflow-hidden and gives the panel its full height. */}
      <div className="flex-1 min-h-0 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
        <KnowledgePanel />
      </div>
    </div>
  );
}
