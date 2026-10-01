'use client';

// THE READER'S ZONE, SERVED ONCE (law `one-reader-zone`, lib/core/user-zone.ts): the shell hands every
// client surface the user's zone from the server's one reader (lib/utils/user-time.ts). Event times
// and calendar days render through `useUserZone()` + the lib/core/user-zone.ts formatters — never
// through the browser's own zone (which is only the fallback when the server knows none).
import { createContext, useContext, type ReactNode } from 'react';
import { readerZone } from '@/lib/core/user-zone';

const UserZoneContext = createContext<{ served: string | null }>({ served: null });

export function UserZoneProvider({ zone, children }: { zone: string | null; children: ReactNode }) {
  return <UserZoneContext.Provider value={{ served: zone }}>{children}</UserZoneContext.Provider>;
}

/** The zone every event time renders in (served user zone → device zone → UTC). */
export function useUserZone(): string {
  return readerZone(useContext(UserZoneContext).served);
}

/** The served user zone itself (null = the server knows none) — for the mismatch hint. */
export function useServedUserZone(): string | null {
  return useContext(UserZoneContext).served;
}
