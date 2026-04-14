import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Append-only audit log. Never throws — best-effort persistence.
 * Always use the admin (service-role) client.
 */

export const AUDIT_ACTIONS = {
  WORKSPACE_CREATE:       'workspace.create',
  WORKSPACE_UPDATE:       'workspace.update',
  WORKSPACE_SUSPEND:      'workspace.suspend',
  WORKSPACE_UNSUSPEND:    'workspace.unsuspend',
  WORKSPACE_DELETE:       'workspace.delete',
  WORKSPACE_REGEN_CODE:   'workspace.regenerate_join_code',

  FEATURE_TOGGLE:         'feature.toggle',

  MEMBER_INVITE:          'member.invite',
  MEMBER_JOIN_VIA_CODE:   'member.join_via_code',
  MEMBER_JOIN_VIA_INVITE: 'member.join_via_invitation',
  MEMBER_ROLE_CHANGE:     'member.role_change',
  MEMBER_DELETE:          'member.delete',
  MEMBER_SUSPEND:         'member.suspend',
  MEMBER_UNSUSPEND:       'member.unsuspend',
} as const;

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];

export interface AuditLogParams {
  adminClient: SupabaseClient;
  actorUserId: string | null;
  actorEmail?: string | null;
  action: AuditAction | string;
  targetType?: string;
  targetId?: string | null;
  workspaceId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    await params.adminClient.from('audit_logs').insert({
      actor_user_id: params.actorUserId,
      actor_email:   params.actorEmail ?? null,
      action:        params.action,
      target_type:   params.targetType ?? null,
      target_id:     params.targetId ?? null,
      workspace_id:  params.workspaceId ?? null,
      metadata:      params.metadata ?? {},
    });
  } catch (err) {
    // Swallow — audit logging must never break the calling flow.
    console.error('[audit] Failed to persist audit log entry', err);
  }
}
