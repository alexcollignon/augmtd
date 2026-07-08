import type { SupabaseClient } from '@supabase/supabase-js';

// Activity timeline — best-effort, non-fatal event logging. Every user action that we want to
// surface on /activity appends one row via logActivity(). This MUST never break the underlying
// action: any failure (missing table, RLS, network) is swallowed. Callers may `await` it or not;
// either way it can't throw.

export type ActivityType =
  | 'reply_sent'
  | 'message_sent'
  | 'marked_done'
  | 'dismissed'
  | 'nudge_sent'
  | 'commitment_done'
  | 'commitment_dismissed'
  | 'sender_muted'
  | 'invite_sent'
  | 'delegated_to_coworker'
  | 'file_attached'
  | 'restored';

export interface LogActivityInput {
  type: ActivityType | string;
  title: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append one activity event for a user. Non-fatal: never throws, never rejects.
 * Returns true on a successful insert, false otherwise.
 */
export async function logActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  userId: string,
  input: LogActivityInput,
): Promise<boolean> {
  try {
    const title = (input.title || '').trim().slice(0, 500) || 'Action';
    const { error } = await client.from('activity_events').insert({
      user_id: userId,
      type: input.type,
      title,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) {
      console.error('[activity] logActivity insert failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[activity] logActivity threw:', e);
    return false;
  }
}
