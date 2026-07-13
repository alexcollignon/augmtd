'use client';

import { useEffect, useState } from 'react';

// Staggered rise-in — the ONE shared entrance motion for the Home and its lenses (Dashboard / Timeline /
// Projects), so every surface fades + lifts in the same way instead of each inventing its own. Pass a
// `delay` (ms) to stagger a list. Honors reduced-motion via the transition (no transform when the user
// prefers reduced motion — the opacity still settles instantly enough to feel calm).
export function RiseIn({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <div className={`transition-all duration-500 ease-out motion-reduce:transition-opacity ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 motion-reduce:translate-y-0'}`}>
      {children}
    </div>
  );
}

export default RiseIn;
