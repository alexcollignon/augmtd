// Studio sub-routes (workflow detail + builder) render within the (main) layout.
// The workflow list is now inline in WorkPageClient — no left-panel shell needed here.
import { guardFeaturePage } from '@/lib/workspace/guards';

export default async function WorkStudioLayout({ children }: { children: React.ReactNode }) {
  await guardFeaturePage('studio');
  return (
    <div className="flex flex-1 min-w-0 bg-neutral-50 p-2">
      <div className="flex-1 flex flex-col rounded-2xl bg-white shadow-sm overflow-hidden">
        {children}
      </div>
    </div>
  );
}
