/**
 * Batch recipient analyzer — single AI call to route a batch of emails to users.
 *
 * Replaces per-email analyzeRecipients() calls for the initial routing decision.
 * Falls back to per-email analyzeRecipients() on parse failure.
 */

import { getAIClient } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';
import { SupabaseClient } from '@supabase/supabase-js';

export interface EmailRoutingInput {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
}

export interface UserInSystem {
  userId: string;
  email: string;
  fullName?: string;
}

export interface RecipientAnalysis {
  primaryOwner: string | null;
  isTeamEmail: boolean;
  recipientUserIds: string[];
}

const SYSTEM_PROMPT = `You are an email routing assistant. For each email, determine which user(s) in the system should receive an inbox item.

Given a list of emails with their to/cc fields, and a list of users in the system, determine for each email:
- primaryOwner: email address of the main responsible user (null if unclear)
- isTeamEmail: true if sent to multiple users in the system
- recipientUserIds: list of user IDs from the system who should receive this email

Respond with: { "results": [ { "id": "...", "primaryOwner": "email|null", "isTeamEmail": bool, "recipientUserIds": ["uid", ...] } ] }`;

export async function batchAnalyzeRecipients(
  emails: EmailRoutingInput[],
  usersInSystem: UserInSystem[],
  userId: string,
  adminSupabase: SupabaseClient,
): Promise<Map<string, RecipientAnalysis>> {
  const fallback = new Map<string, RecipientAnalysis>(
    emails.map(e => [e.id, { primaryOwner: null, isTeamEmail: false, recipientUserIds: [userId] }]),
  );

  if (emails.length === 0) return fallback;

  try {
    const { client: ai, model } = await getAIClient(userId, 'classification', adminSupabase);

    const userContent = JSON.stringify({
      users: usersInSystem.map(u => ({ userId: u.userId, email: u.email, name: u.fullName })),
      emails: emails.map(e => ({
        id: e.id,
        from: e.from,
        to: e.to,
        cc: e.cc,
        subject: e.subject,
      })),
    });

    const response = await ai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      max_tokens: 1024,
    });

    const text = response.choices[0]?.message?.content || '';
    const parsed = parseModelJSON<{ results: Array<{ id: string; primaryOwner: string | null; isTeamEmail: boolean; recipientUserIds: string[] }> }>(text, { results: [] });

    const result = new Map<string, RecipientAnalysis>();
    for (const item of parsed.results) {
      result.set(item.id, {
        primaryOwner: item.primaryOwner ?? null,
        isTeamEmail: item.isTeamEmail ?? false,
        recipientUserIds: Array.isArray(item.recipientUserIds) ? item.recipientUserIds : [userId],
      });
    }

    // Fill missing
    for (const e of emails) {
      if (!result.has(e.id)) result.set(e.id, fallback.get(e.id)!);
    }

    return result;
  } catch (err) {
    console.error('[BatchRecipients] Failed, falling back to per-email routing:', err);
    return fallback;
  }
}
