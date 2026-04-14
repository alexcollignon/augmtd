import type { FeatureKey } from './types';

/**
 * Route path prefixes → which feature gates them.
 * Used by middleware / layout gating where we need to know which feature
 * controls access to a given path.
 */
export const ROUTE_FEATURE_MAP: Array<{ prefix: string; feature: FeatureKey }> = [
  { prefix: '/inbox',    feature: 'email' },
  { prefix: '/meetings', feature: 'meetings' },
  { prefix: '/drive',    feature: 'drive' },
];

export function featureForPath(pathname: string): FeatureKey | null {
  const match = ROUTE_FEATURE_MAP.find(r => pathname.startsWith(r.prefix));
  return match?.feature ?? null;
}
