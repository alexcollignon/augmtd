import { guardFeaturePage } from '@/lib/workspace/guards';

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  await guardFeaturePage('studio');
  return (
    <div className="flex flex-1 min-w-0 overflow-hidden">
      {children}
    </div>
  );
}
