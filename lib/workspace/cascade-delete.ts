import type { SupabaseClient } from '@supabase/supabase-js';
import { logAudit, AUDIT_ACTIONS } from '@/lib/audit/log';

/**
 * Core per-user destructive wipe. Used by:
 *   - POST /api/platform-admin/members/[userId]/delete (individual)
 *   - POST /api/company/members/[userId]/delete        (company owner)
 *   - cascadeDeleteWorkspace()                         (workspace-wide)
 *
 * Order: storage objects → delete_user_account RPC (all DB rows) → auth.users.
 * Non-fatal errors in the storage step are logged but do not abort.
 */
export async function deleteUserFully(
  adminClient: SupabaseClient,
  userId: string
): Promise<void> {
  // 1. Storage files
  try {
    const { data: storageObjects } = await adminClient.rpc('get_user_storage_objects', {
      target_user_id: userId,
    }) as { data: { bucket_id: string; name: string }[] | null };

    if (storageObjects && storageObjects.length > 0) {
      const byBucket = storageObjects.reduce<Record<string, string[]>>((acc, obj) => {
        if (!acc[obj.bucket_id]) acc[obj.bucket_id] = [];
        acc[obj.bucket_id].push(obj.name);
        return acc;
      }, {});

      await Promise.all(
        Object.entries(byBucket).map(([bucket, paths]) =>
          adminClient.storage.from(bucket).remove(paths)
        )
      );
    }
  } catch (err) {
    console.error(`[deleteUserFully] Storage cleanup failed for ${userId} (non-fatal):`, err);
  }

  // 2. Wipe DB rows via RPC
  const { error: rpcError } = await adminClient.rpc('delete_user_account', {
    target_user_id: userId,
  });
  if (rpcError) {
    throw new Error(`delete_user_account RPC failed for ${userId}: ${rpcError.message}`);
  }

  // 3. Delete auth.users row
  const { error: authError } = await adminClient.auth.admin.deleteUser(userId);
  if (authError) {
    throw new Error(`auth.admin.deleteUser failed for ${userId}: ${authError.message}`);
  }
}

export interface CascadeDeleteResult {
  deletedUsers: number;
  skippedSuperadmins: number;
  errors: Array<{ userId: string; error: string }>;
}

export interface CascadeDeleteParams {
  adminClient: SupabaseClient;
  workspaceId: string;
  actorUserId: string;
  actorEmail?: string | null;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Destructive cascade delete of a workspace. Iterates all members, hard-deletes
 * each non-superadmin user, then drops the company row (cascades invitations).
 *
 * Runs sequentially to avoid hammering storage + auth.admin rate limits.
 * Superadmins who happen to be members are skipped (their membership rows
 * are cleaned up when the company row is deleted).
 */
export async function cascadeDeleteWorkspace(
  params: CascadeDeleteParams
): Promise<CascadeDeleteResult> {
  const { adminClient, workspaceId, actorUserId, actorEmail, onProgress } = params;

  // Atomic claim: only one caller gets to run the cascade.
  const { data: claimed, error: claimError } = await adminClient
    .from('companies')
    .update({ status: 'deleting' })
    .eq('id', workspaceId)
    .in('status', ['active', 'suspended'])
    .select('id, name')
    .maybeSingle();

  if (claimError) throw new Error(`Failed to claim workspace: ${claimError.message}`);
  if (!claimed) throw new Error('Workspace not found or already being deleted');

  const workspaceName = claimed.name;

  // Fetch all member user IDs for this workspace
  const { data: memberRows, error: membersError } = await adminClient
    .from('company_members')
    .select('user_id')
    .eq('company_id', workspaceId);

  if (membersError) throw new Error(`Failed to list members: ${JSON.stringify(membersError)}`);

  const userIds = (memberRows ?? []).map(r => r.user_id);

  // Fetch superadmin flags separately (profiles.id = user_id, no FK to company_members)
  const { data: profileRows } = userIds.length > 0
    ? await adminClient
        .from('profiles')
        .select('id, is_super_admin')
        .in('id', userIds)
    : { data: [] as Array<{ id: string; is_super_admin: boolean }> };

  const superAdminSet = new Set(
    (profileRows ?? []).filter(p => p.is_super_admin).map(p => p.id)
  );

  const members = userIds.map(userId => ({
    userId,
    isSuperAdmin: superAdminSet.has(userId),
  }));

  const result: CascadeDeleteResult = {
    deletedUsers: 0,
    skippedSuperadmins: 0,
    errors: [],
  };

  const total = members.length;
  let done = 0;

  for (const m of members) {
    done++;
    if (m.isSuperAdmin) {
      result.skippedSuperadmins++;
      onProgress?.(done, total);
      continue;
    }
    try {
      await deleteUserFully(adminClient, m.userId);
      result.deletedUsers++;
    } catch (err) {
      result.errors.push({
        userId: m.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    onProgress?.(done, total);
  }

  // Drop the company (cascades company_members + company_invitations via FK)
  const { error: deleteError } = await adminClient
    .from('companies')
    .delete()
    .eq('id', workspaceId);

  if (deleteError) {
    throw new Error(`Failed to delete workspace row: ${deleteError.message}`);
  }

  await logAudit({
    adminClient,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: AUDIT_ACTIONS.WORKSPACE_DELETE,
    targetType: 'workspace',
    targetId: workspaceId,
    workspaceId: null,
    metadata: {
      workspaceName,
      memberCount: total,
      deletedUsers: result.deletedUsers,
      skippedSuperadmins: result.skippedSuperadmins,
      errorCount: result.errors.length,
    },
  });

  return result;
}
