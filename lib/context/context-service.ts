/**
 * Context Service
 *
 * Service layer for triggering user context updates from various parts of the app.
 * Provides convenient functions for logging signals and updating context.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { UserContextEngine } from './user-context-engine';
import { LearningSignal, SignalType } from '@/lib/types/user-context';

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export class ContextService {
  /**
   * Log a learning signal and trigger context update
   */
  static async logSignal(
    userId: string,
    signalType: SignalType,
    signalData: Record<string, any>,
    inboxItemId?: string
  ): Promise<void> {
    const supabase = getAdminClient();

    // Insert learning signal
    const { data, error } = await supabase
      .from('learning_signals')
      .insert({
        user_id: userId,
        inbox_item_id: inboxItemId || null,
        signal_type: signalType,
        signal_data: signalData,
      })
      .select()
      .single();

    if (error) {
      console.error('[ContextService] Failed to log signal:', error);
      return;
    }

    // Trigger context update asynchronously (don't block)
    const signal = data as LearningSignal;
    UserContextEngine.updateFromSignal(userId, signal).catch(err => {
      console.error('[ContextService] Failed to update context:', err);
    });
  }

  /**
   * Log a suggestion confirmation/rejection
   */
  static async logConfirmation(
    userId: string,
    inboxItemId: string,
    action: 'confirm_as_mine' | 'not_my_task',
    metadata: {
      role?: string;
      position_in_to?: number;
      confidence_score?: number;
      previous_section?: string;
      has_mention?: boolean;
      has_explicit_assignment?: boolean;
    }
  ): Promise<void> {
    const signalType: SignalType = action === 'confirm_as_mine'
      ? 'suggestion_confirmed'
      : 'suggestion_rejected';

    await this.logSignal(userId, signalType, {
      action,
      ...metadata,
    }, inboxItemId);
  }

  /**
   * Log a draft modification
   */
  static async logDraftEdit(
    userId: string,
    inboxItemId: string,
    originalDraft: string,
    editedDraft: string
  ): Promise<void> {
    await this.logSignal(userId, 'draft_modified', {
      original_draft: originalDraft,
      edited_draft: editedDraft,
    }, inboxItemId);
  }

  /**
   * Log a reply sent
   * Note: inboxItemId is optional - sent emails don't have inbox items
   */
  static async logReplySent(
    userId: string,
    metadata: {
      sender_email?: string;
      response_time_seconds?: number;
      urgency_score?: number;
      topic?: string;
      formality_score?: number;
      communication_patterns?: {
        length?: number;
        greeting?: string | null;
        signature?: string | null;
        emoji_count?: number;
        tone_indicators?: string[];
        common_phrases?: string[];
      };
    },
    inboxItemId?: string
  ): Promise<void> {
    await this.logSignal(userId, 'reply_sent', metadata, inboxItemId);
  }

  /**
   * Log an item completion
   */
  static async logItemCompleted(
    userId: string,
    inboxItemId: string,
    metadata: {
      urgency_score?: number;
      response_time_seconds?: number;
      met_deadline?: boolean;
    }
  ): Promise<void> {
    await this.logSignal(userId, 'item_completed', metadata, inboxItemId);
  }

  /**
   * Log an item dismissal
   */
  static async logItemDismissed(
    userId: string,
    inboxItemId: string,
    metadata: {
      role?: string;
      position_in_to?: number;
      confidence_score?: number;
      reason?: string;
    }
  ): Promise<void> {
    await this.logSignal(userId, 'item_dismissed', metadata, inboxItemId);
  }

  /**
   * Get current context profile for user
   */
  static async getContext(userId: string) {
    return UserContextEngine.getContext(userId);
  }

  /**
   * Process all pending signals for a user (useful for backfill)
   */
  static async processAllSignals(userId: string): Promise<void> {
    const supabase = getAdminClient();

    // Get all unprocessed signals
    const { data: signals, error } = await supabase
      .from('learning_signals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error || !signals) {
      console.error('[ContextService] Failed to fetch signals:', error);
      return;
    }

    // Process each signal
    for (const signal of signals as LearningSignal[]) {
      try {
        await UserContextEngine.updateFromSignal(userId, signal);
      } catch (err) {
        console.error('[ContextService] Failed to process signal:', signal.id, err);
      }
    }

    console.log(`[ContextService] Processed ${signals.length} signals for user ${userId}`);
  }
}
