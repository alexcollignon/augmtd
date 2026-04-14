import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getMyWorkspace } from './features';
import type { MyWorkspace, FeatureKey } from './types';

export class WorkspaceAccessError extends Error {
  constructor(
    message: string,
    public readonly reason: 'no_workspace' | 'suspended' | 'deleting' | 'feature_disabled',
    public readonly status: number
  ) {
    super(message);
    this.name = 'WorkspaceAccessError';
  }
}

/**
 * Resolve the caller's workspace or throw. Use when a route needs membership
 * but does not require a specific feature.
 */
export async function requireWorkspace(
  supabase: SupabaseClient,
  userId: string
): Promise<MyWorkspace> {
  const workspace = await getMyWorkspace(userId, supabase);
  if (!workspace) {
    throw new WorkspaceAccessError('No active workspace', 'no_workspace', 403);
  }
  if (workspace.status === 'suspended') {
    throw new WorkspaceAccessError('Workspace suspended', 'suspended', 423);
  }
  if (workspace.status === 'deleting') {
    throw new WorkspaceAccessError('Workspace deleting', 'deleting', 423);
  }
  return workspace;
}

/**
 * Require a specific feature to be enabled. Use at the top of feature-gated
 * API routes (inbox, meetings, drive, agents).
 */
export async function requireFeature(
  feature: FeatureKey,
  supabase: SupabaseClient,
  userId: string
): Promise<{ workspace: MyWorkspace }> {
  const workspace = await requireWorkspace(supabase, userId);
  if (!workspace.features[feature]) {
    throw new WorkspaceAccessError(
      `Feature "${feature}" is not enabled for this workspace`,
      'feature_disabled',
      403
    );
  }
  return { workspace };
}

/**
 * Convert a WorkspaceAccessError (or any error) into a NextResponse.
 * Non-workspace errors rethrow so existing handlers can deal with them.
 */
export function handleWorkspaceError(err: unknown): NextResponse {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json(
      { error: err.message, reason: err.reason },
      { status: err.status }
    );
  }
  throw err;
}
