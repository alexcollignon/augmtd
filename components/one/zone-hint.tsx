'use client';

// THE ONE ZONE HINT (law `one-reader-zone`): times render in the user's zone everywhere; when this
// device's clock disagrees, ONE quiet line says which zone the times are in. It appears after mount
// (the device zone is unknowable on the server) — filling an empty seat, never changing painted words.
import { useEffect, useState } from 'react';
import { browserZone, zoneHintText } from '@/lib/core/user-zone';
import { useServedUserZone } from '@/context/user-zone-context';

export default function ZoneHint({ className = '' }: { className?: string }) {
  const served = useServedUserZone();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { setText(zoneHintText(served, browserZone())); }, [served]);
  if (!text) return null;
  return <p className={`text-[11px] text-neutral-400 ${className}`} data-zone-hint>{text}</p>;
}
