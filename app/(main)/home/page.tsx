import { HomeView } from '@/components/home/home-view';

// The Home — the day brief (email + meetings + commitments) + your team, in one place.
// Default landing. Always-on (no workspace feature gate); auth handled by the (main) layout.
export default function HomePage() {
  return <HomeView />;
}
