import type { CompanyRole, CompanyPlan } from '@/lib/types/company';
import type { TierType } from '@/lib/ai/types';

export type WorkspaceType = 'company' | 'beta' | 'pilot' | 'internal';
export type WorkspaceStatus = 'active' | 'suspended' | 'deleting';

export interface WorkspaceFeatures {
  email: boolean;
  meetings: boolean;
  drive: boolean;
  agents: boolean;
  studio: boolean;
  home: boolean;
}

export type FeatureKey = keyof WorkspaceFeatures;

// HOME IS NOT A TOGGLEABLE FEATURE. It is the app's front door (the chat is always present
// there; /work and /workers redirect into it) — a workspace with Home off has no way in. It is
// deliberately ABSENT from FEATURE_KEYS so the platform-admin features API (which only writes
// keys in this list) can never set it, and the admin UI never shows a Home switch. `home` stays
// in the schema/type for back-compat (a June-2026 stale `home:false` on one workspace looped
// /home→/home forever); normalizeFeatures pins it true and the page guard ignores it.
export const FEATURE_KEYS: FeatureKey[] = ['email', 'meetings', 'drive', 'agents', 'studio'];

// meetings is off by default — bot infrastructure is being replaced (Vexa migration pending).
// Admin opts IN via platform admin UI.
export const DEFAULT_FEATURES: WorkspaceFeatures = {
  email: true,
  meetings: false,
  drive: true,
  agents: true,
  studio: true,
  home: true,
};

export const DEFAULT_FEATURES_FOR_TYPE: Record<WorkspaceType, WorkspaceFeatures> = {
  company:  { ...DEFAULT_FEATURES },
  pilot:    { ...DEFAULT_FEATURES },
  internal: { ...DEFAULT_FEATURES },
  beta:     { ...DEFAULT_FEATURES },
};

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: CompanyPlan;
  type: WorkspaceType;
  status: WorkspaceStatus;
  features: WorkspaceFeatures;
  settings: Record<string, unknown>;
  join_code: string;
  ai_tier: TierType | null;
  created_at: string;
  updated_at: string;
}

export interface MyWorkspace extends Workspace {
  role: CompanyRole;
}

export function normalizeFeatures(raw: unknown): WorkspaceFeatures {
  const input = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  return {
    email:    typeof input.email    === 'boolean' ? input.email    : DEFAULT_FEATURES.email,
    meetings: typeof input.meetings === 'boolean' ? input.meetings : DEFAULT_FEATURES.meetings,
    drive:    typeof input.drive    === 'boolean' ? input.drive    : DEFAULT_FEATURES.drive,
    agents:   typeof input.agents   === 'boolean' ? input.agents   : DEFAULT_FEATURES.agents,
    studio:   typeof input.studio   === 'boolean' ? input.studio   : DEFAULT_FEATURES.studio,
    // Home is the front door, never a feature — pinned true regardless of any stored value, so a
    // stale `home:false` (like the one that bricked a workshop workspace) can never gate it again.
    home:     true,
  };
}
