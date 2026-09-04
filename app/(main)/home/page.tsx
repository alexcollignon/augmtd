import { guardFeaturePage } from '@/lib/workspace/guards';
import { HomeView } from '@/components/home/home-view';

export default async function HomePage() {
  await guardFeaturePage(null);
  return <HomeView />;
}
