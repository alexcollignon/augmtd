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
  category: 'confirmations' | 'notifications' | 'receipts' | 'marketing' | 'other';
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

  // Fallback: look at subject patterns
  const subjects = items.map(i => i.source_data?.subject?.toLowerCase() || '');

  if (subjects.some(s => s.includes('receipt') || s.includes('invoice') || s.includes('payment'))) {
    return 'receipts';
  }
  if (subjects.some(s => s.includes('newsletter') || s.includes('update') || s.includes('announcement'))) {
    return 'marketing';
  }

  return 'other';
}

/**
 * Get human-readable summary for a batch
 */
function getBatchSummary(category: BatchedItem['category'], count: number, items: InboxItem[]): string {
  const senders = [...new Set(items.map(i => i.source_data?.from_name || 'Unknown'))];
  const senderText = senders.length === 1 ? senders[0] : `${senders.length} senders`;

  switch (category) {
    case 'confirmations':
      return `${count} account confirmation${count > 1 ? 's' : ''} handled`;
    case 'notifications':
      return `${count} notification${count > 1 ? 's' : ''} from ${senderText}`;
    case 'receipts':
      return `${count} receipt${count > 1 ? 's' : ''} and invoice${count > 1 ? 's' : ''}`;
    case 'marketing':
      return `${count} newsletter${count > 1 ? 's' : ''} and update${count > 1 ? 's' : ''}`;
    default:
      return `${count} item${count > 1 ? 's' : ''} handled`;
  }
}

/**
 * Group items by similarity
 */
function groupBySimilarity(items: InboxItem[]): InboxItem[][] {
  const groups: Map<string, InboxItem[]> = new Map();

  for (const item of items) {
    const signals = item.source_data?.signals;

    // Generate grouping key based on signals and sender
    let groupKey = '';

    if (signals?.isMechanicalConfirmation) {
      groupKey = 'confirmations';
    } else if (signals?.isNotification) {
      // Group notifications by sender domain
      const domain = item.source_data?.from_address?.split('@')[1] || 'unknown';
      groupKey = `notifications-${domain}`;
    } else {
      // Group by sender domain for other items
      const domain = item.source_data?.from_address?.split('@')[1] || 'unknown';
      groupKey = `other-${domain}`;
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
 * - Only batch NO_WORK items
 * - Group by category (confirmations, notifications, etc.)
 * - Require at least 2 items to create a batch
 * - Return batches + unbatched items
 */
export function batchInboxItems(items: InboxItem[]): BatchingResult {
  const batches: BatchedItem[] = [];
  const unbatched: InboxItem[] = [];

  // Separate NO_WORK items from others
  const noWorkItems = items.filter(i => i.work_state === 'no_work');
  const otherItems = items.filter(i => i.work_state !== 'no_work');

  // Don't batch other items - they should all be visible
  unbatched.push(...otherItems);

  // Group NO_WORK items by similarity
  const groups = groupBySimilarity(noWorkItems);

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
        icon: category === 'other' ? 'notifications' : category,
        latestDate
      });
    } else {
      // Single item - don't batch
      unbatched.push(...group);
    }
  }

  return { batches, unbatched };
}
