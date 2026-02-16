/**
 * Batching utility for inbox items
 * Groups similar NO_WORK items to reduce visual clutter
 */

export interface InboxItem {
  id: string;
  user_id: string;
  source: string;
  source_id: string;
  work_state: string;
  work_title: string | null;
  what_i_prepared: string | null;
  why_matters: string | null;
  source_data: any;
  status: string;
  priority: number;
  created_at: string;
}

export interface BatchedItem {
  id: string;
  type: 'batch';
  category: 'confirmations' | 'notifications' | 'receipts' | 'marketing' | 'operational' | 'other';
  count: number;
  items: InboxItem[];
  summary: string;
  providers: string[];
  icon: 'confirmations' | 'notifications' | 'receipts' | 'marketing';
  latestDate: string;
}

export interface BatchingResult {
  batches: BatchedItem[];
  unbatched: InboxItem[];
}

/**
 * Determine batch category from signals and content
 */
function categorizeBatch(items: InboxItem[]): BatchedItem['category'] {
  const firstItem = items[0];
  const signals = firstItem.source_data?.signals;

  if (signals?.isMechanicalConfirmation) {
    return 'confirmations';
  }
  if (signals?.isNotification) {
    return 'notifications';
  }

  // Check if it's operational action_required or work_prepared (reminders/drafts)
  if ((firstItem.work_state === 'action_required' || firstItem.work_state === 'work_prepared') &&
      !signals?.isMechanicalConfirmation) {
    return 'operational';
  }

  // Fallback: look at subject patterns
  const subjects = items.map(i => i.source_data?.subject?.toLowerCase() || '');

  if (subjects.some(s => s.includes('receipt') || s.includes('invoice'))) {
    return 'receipts';
  }
  if (subjects.some(s => s.includes('newsletter') || s.includes('update') || s.includes('announcement'))) {
    return 'marketing';
  }

  return 'other';
}

/**
 * Get human-readable summary for a batch
 * Be factual - no claims of handling or action taken
 */
function getBatchSummary(category: BatchedItem['category'], count: number, items: InboxItem[]): string {
  const senders = [...new Set(items.map(i => i.source_data?.from_name || 'Unknown'))];
  const senderText = senders.length === 1 ? senders[0] : `${senders.length} senders`;

  switch (category) {
    case 'confirmations':
      if (count === 1 && senders.length === 1) {
        return `Account confirmation — ${senders[0]}`;
      }
      return `${count} account confirmation${count > 1 ? 's' : ''}`;
    case 'notifications':
      if (count === 1 && senders.length === 1) {
        return `Notification — ${senders[0]}`;
      }
      return `${count} notification${count > 1 ? 's' : ''} from ${senderText}`;
    case 'receipts':
      if (count === 1 && senders.length === 1) {
        return `Receipt — ${senders[0]}`;
      }
      return `${count} receipt${count > 1 ? 's' : ''}`;
    case 'marketing':
      return `${count} newsletter${count > 1 ? 's' : ''}`;
    case 'operational':
      // Get the base subject (first item's subject without numbers/prefixes)
      const baseSubject = items[0].source_data?.subject || 'Action required';
      const shortSubject = baseSubject.length > 40 ? baseSubject.slice(0, 40) + '...' : baseSubject;
      if (count === 1) {
        return `${shortSubject} — ${senders[0]}`;
      }
      return `${shortSubject} (${count} reminder${count > 1 ? 's' : ''})`;
    default:
      return `${count} item${count > 1 ? 's' : ''}`;
  }
}

/**
 * Normalize subject for similarity comparison
 * Removes common variations like "Re:", "Fwd:", numbers, etc.
 */
function normalizeSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^(re:|fwd?:|fw:)\s*/gi, '') // Remove reply/forward prefixes
    .replace(/\d+/g, '') // Remove numbers
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Check if two subjects are similar enough to batch
 */
function areSimilarSubjects(subject1: string, subject2: string): boolean {
  const norm1 = normalizeSubject(subject1);
  const norm2 = normalizeSubject(subject2);

  // Exact match after normalization
  if (norm1 === norm2) return true;

  // Check if one contains the other (for "Action required" vs "Action required: details")
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    return true;
  }

  return false;
}

/**
 * Group items by similarity
 */
function groupBySimilarity(items: InboxItem[]): InboxItem[][] {
  const groups: Map<string, InboxItem[]> = new Map();

  for (const item of items) {
    const signals = item.source_data?.signals;
    const sender = item.source_data?.from_address || 'unknown';
    const subject = item.source_data?.subject || '';

    // Generate grouping key based on signals and sender
    let groupKey = '';

    if (signals?.isMechanicalConfirmation) {
      groupKey = 'confirmations';
    } else if (signals?.isNotification) {
      // Group notifications by sender domain
      const domain = sender.split('@')[1] || 'unknown';
      groupKey = `notifications-${domain}`;
    } else {
      // For operational items, check if similar to existing groups
      const domain = sender.split('@')[1] || 'unknown';
      let foundSimilar = false;

      // Check existing groups for similar sender + subject
      for (const [key, groupItems] of groups.entries()) {
        if (key.startsWith(`operational-${domain}`)) {
          // Same sender domain, check subject similarity
          const firstItemSubject = groupItems[0].source_data?.subject || '';
          if (areSimilarSubjects(subject, firstItemSubject)) {
            groupKey = key;
            foundSimilar = true;
            break;
          }
        }
      }

      if (!foundSimilar) {
        // Create new group with normalized subject
        const normalizedSubject = normalizeSubject(subject).slice(0, 30); // First 30 chars
        groupKey = `operational-${domain}-${normalizedSubject}`;
      }
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(item);
  }

  return Array.from(groups.values());
}

/**
 * Batch inbox items intelligently
 *
 * Rules:
 * - Batch NOTED items (Level 2: Awareness)
 * - Batch mechanical ACTION_REQUIRED items (low friction, repetitive)
 * - Batch operational ACTION_REQUIRED items with similar subjects (reminders)
 * - Batch WORK_PREPARED items with similar subjects (reminder drafts)
 * - Don't batch DECISION_REQUIRED (needs individual attention)
 * - Group by category (confirmations, notifications, etc.)
 * - Require at least 2 items to create a batch
 * - Return batches + unbatched items
 */
export function batchInboxItems(items: InboxItem[]): BatchingResult {
  const batches: BatchedItem[] = [];
  const unbatched: InboxItem[] = [];

  // Separate batchable items from others
  const notedItems = items.filter(i => i.work_state === 'noted' || i.work_state === 'no_work');
  const mechanicalActions = items.filter(i =>
    i.work_state === 'action_required' &&
    i.source_data?.signals?.isMechanicalConfirmation === true
  );
  const operationalActions = items.filter(i =>
    i.work_state === 'action_required' &&
    i.source_data?.signals?.isMechanicalConfirmation === false
  );
  const workPreparedItems = items.filter(i => i.work_state === 'work_prepared');
  const decisionItems = items.filter(i => i.work_state === 'decision_required');

  // Don't batch DECISION_REQUIRED - they need individual visibility
  unbatched.push(...decisionItems);

  // Combine NOTED, ACTION_REQUIRED (mechanical + operational), and WORK_PREPARED for batching
  const batchableItems = [...notedItems, ...mechanicalActions, ...operationalActions, ...workPreparedItems];

  // Group batchable items by similarity
  const groups = groupBySimilarity(batchableItems);

  for (const group of groups) {
    // Only create batch if we have 2+ items
    if (group.length >= 2) {
      const category = categorizeBatch(group);
      const providers = [...new Set(group.map(i => i.source_data?.provider || 'gmail'))];
      const latestDate = group.reduce((latest, item) => {
        return new Date(item.created_at) > new Date(latest) ? item.created_at : latest;
      }, group[0].created_at);

      batches.push({
        id: `batch-${category}-${Date.now()}-${Math.random()}`,
        type: 'batch',
        category,
        count: group.length,
        items: group,
        summary: getBatchSummary(category, group.length, group),
        providers,
        icon: category === 'operational' ? 'notifications' : category === 'other' ? 'notifications' : category,
        latestDate
      });
    } else {
      // Single item - don't batch
      unbatched.push(...group);
    }
  }

  return { batches, unbatched };
}
