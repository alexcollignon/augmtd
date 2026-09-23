// ════════════════════════════════════════════════════════════════════════════════════════════════
// W10 THE AUGMTD-LABEL CLEANUP — removes ONLY what AUGMTD itself created in a mailbox.
//
// ONE function, two doors: scripts/remove-augmtd-labels.ts (ops: dry-run by default, --apply --yes)
// and POST /api/inbox/mailbox-labels/cleanup (the user's own click in Settings, confirm first).
//
// WHAT IS AUGMTD'S (write-back.ts AUGMTD_ALL_LABELS — the complete list of names AUGMTD has ever
// written): the `AUGMTD/<name>` Gmail labels (+ the bare `AUGMTD` parent they nest under) and the
// `AUGMTD: <name>` Outlook categories. Nothing else is ever touched — a user's own labels, including
// the ones their rules apply (`apply_label` may never use the AUGMTD namespace: label-name.ts), sit
// outside the list by construction.
//
// SCOPE BY THE ACCOUNT'S CHOICE (label-name.ts `augmtdLabelsOn`):
//   labels ON  (auto_label === true) → 'retired': the labels nothing writes any more — every KIND
//                label + the retired FYI/Meeting/Notifications/Marketing postures. The live
//                postures (Needs reply · To do · Waiting on · Done) stay.
//   labels OFF (unset or false)      → 'all': every AUGMTD label, and the parent.
//
// MECHANICS: Gmail — deleting a label removes it from every message in one call (children first,
// the parent only once no AUGMTD child remains). Outlook — categories live on each message: the
// messages carrying one are listed (paged) and patched to drop it, then the master category is
// deleted if present. Bounded by a deadline; what it leaves is REPORTED, never silent.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUGMTD_ALL_LABELS, AUGMTD_RETIRED_LABELS, AUGMTD_PARENT_LABEL, outlookCategoryOf } from './write-back';
import { augmtdLabelsOn } from './label-name';

export type CleanupScope = 'retired' | 'all';

/** PURE — the scope an account's own choice implies. */
export function cleanupScopeFor(settings: { auto_label?: unknown } | null | undefined): CleanupScope {
  return augmtdLabelsOn(settings) ? 'retired' : 'all';
}

/** PURE — the AUGMTD label names (Gmail form) a scope removes. */
export function cleanupTargetNames(scope: CleanupScope): string[] {
  return [...(scope === 'all' ? AUGMTD_ALL_LABELS : AUGMTD_RETIRED_LABELS)];
}

const lc = (s: string) => s.trim().toLowerCase();
const ALL_LC = new Set(AUGMTD_ALL_LABELS.map(lc));

/** PURE — true only for a name AUGMTD created (case-insensitive: Gmail label names do not differ by
 *  case). Anything else — the user's own labels — is never a cleanup target. */
export function isAugmtdCreatedLabel(name: string): boolean {
  return ALL_LC.has(lc(name)) || lc(name) === lc(AUGMTD_PARENT_LABEL);
}

export type GmailRemovalPlan = { remove: Array<{ id: string; name: string }>; removeParent: { id: string; name: string } | null; keptAugmtd: string[] };

/** PURE — which of a mailbox's existing labels go. Children first; the parent only in scope 'all'
 *  and only when no AUGMTD child would remain under it. */
export function planGmailRemoval(existing: Array<{ id: string; name: string }>, scope: CleanupScope): GmailRemovalPlan {
  const targets = new Set(cleanupTargetNames(scope).map(lc));
  const remove = existing.filter((l) => targets.has(lc(l.name)));
  const removedIds = new Set(remove.map((l) => l.id));
  const parent = existing.find((l) => lc(l.name) === lc(AUGMTD_PARENT_LABEL)) ?? null;
  const remainingChildren = existing.filter((l) => !removedIds.has(l.id) && lc(l.name).startsWith(`${lc(AUGMTD_PARENT_LABEL)}/`));
  return {
    remove,
    removeParent: scope === 'all' && parent && remainingChildren.length === 0 ? parent : null,
    keptAugmtd: remainingChildren.map((l) => l.name),
  };
}

export type ConnectionCleanup = {
  connectionId: string; provider: string;
  labelsFound: string[];          // AUGMTD labels/categories present (Gmail: labels; Outlook: categories with ≥1 message or a master entry)
  labelsRemoved: string[];
  messagesTouched: number;        // Outlook messages patched (Gmail deletes a label in one call)
  leftBehind: number;             // labels/messages the deadline left (re-run to finish)
  error?: string;
};
export type CleanupReport = { userId: string; scope: CleanupScope; applied: boolean; connections: ConnectionCleanup[] };

/**
 * THE CLEANUP. `apply: false` (the default) only READS the provider (a census of what would go);
 * `providerRead: false` skips even that (a pure DB plan: scope + connections). NEVER throws.
 */
export async function removeAugmtdLabels(
  sb: SupabaseClient,
  userId: string,
  opts: { apply?: boolean; providerRead?: boolean; scope?: CleanupScope; deadlineMs?: number } = {},
): Promise<CleanupReport> {
  const apply = opts.apply === true;
  const providerRead = apply || opts.providerRead !== false;
  const deadline = Date.now() + (opts.deadlineMs ?? 240_000);
  let scope = opts.scope;
  if (!scope) {
    const { data: prof, error } = await sb.from('profiles').select('email_settings').eq('id', userId).maybeSingle();
    if (error) console.warn('[augmtd-labels] profile read failed:', error.message);
    scope = cleanupScopeFor((prof?.email_settings ?? null) as { auto_label?: unknown } | null);
  }
  const report: CleanupReport = { userId, scope, applied: apply, connections: [] };
  const { data: conns, error: connErr } = await sb.from('connections').select('id, provider, metadata').eq('user_id', userId).eq('status', 'active');
  if (connErr) { console.warn('[augmtd-labels] connections read failed:', connErr.message); return report; }
  const targets = cleanupTargetNames(scope);

  for (const c of (conns ?? []) as Array<{ id: string; provider: string; metadata: { tokens?: string } | null }>) {
    const row: ConnectionCleanup = { connectionId: c.id, provider: c.provider, labelsFound: [], labelsRemoved: [], messagesTouched: 0, leftBehind: 0 };
    report.connections.push(row);
    const tokens = c.metadata?.tokens;
    if (!providerRead || !tokens || (c.provider !== 'gmail' && c.provider !== 'outlook')) continue;
    try {
      if (c.provider === 'gmail') {
        const { listGmailLabels, deleteGmailLabel } = await import('@/lib/google/gmail');
        const existing = await listGmailLabels(tokens);
        const plan = planGmailRemoval(existing, scope);
        row.labelsFound = existing.filter((l) => isAugmtdCreatedLabel(l.name)).map((l) => l.name);
        if (!apply) continue;
        for (const l of [...plan.remove, ...(plan.removeParent ? [plan.removeParent] : [])]) {
          if (Date.now() > deadline) { row.leftBehind++; continue; }
          try { await deleteGmailLabel(tokens, l.id); row.labelsRemoved.push(l.name); } catch (e) { row.error = e instanceof Error ? e.message : String(e); }
        }
      } else {
        const outlook = await import('@/lib/microsoft/outlook');
        // A dry run never persists a refreshed token (no DB write); an apply does.
        const refresh = apply ? outlook.persistOutlookTokens(sb, c as { id: string; metadata: { tokens: string } }) : undefined;
        const g = await outlook.getGraphClient(tokens, refresh);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const master: Array<{ id: string; displayName: string }> = ((await g.api('/me/outlook/masterCategories').get().catch(() => ({ value: [] }))) as any)?.value ?? [];
        for (const name of targets) {
          const category = outlookCategoryOf(name);
          if (Date.now() > deadline) { row.leftBehind++; continue; }
          const esc = category.replace(/'/g, "''");
          const firstPage = `/me/messages?$filter=categories/any(c:c eq '${esc}')&$select=id,categories&$top=100`;
          let url: string | null = firstPage;
          let found = 0;
          const leftBefore = row.leftBehind;
          while (url) {
            if (Date.now() > deadline) { row.leftBehind++; break; }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const page: any = await g.api(url).get();
            const msgs = (page?.value ?? []) as Array<{ id: string; categories?: string[] }>;
            found += msgs.length;
            if (!apply) {
              url = page?.['@odata.nextLink'] ?? null;
              if (found >= 1) break; // a census needs presence, not a full count
              continue;
            }
            if (!msgs.length) break;
            let patched = 0;
            for (const m of msgs) {
              if (Date.now() > deadline) { row.leftBehind++; break; }
              const cats = (m.categories ?? []).filter((x) => x !== category);
              try { await g.api(`/me/messages/${m.id}`).patch({ categories: cats }); row.messagesTouched++; patched++; } catch { row.leftBehind++; }
            }
            // NEVER follow nextLink while removing: the filtered set shrinks under us, so the skip
            // token jumps past messages that shifted into the removed ones' place (found live: a
            // pass reported "removed" with 100 messages still carrying the category). Re-read the
            // FIRST page until it comes back empty; a page that patched nothing stops the loop.
            url = patched > 0 ? firstPage : null;
            if (patched === 0 && msgs.length) row.leftBehind++;
          }
          const inMaster = master.find((m) => m.displayName === category);
          if (found > 0 || inMaster) row.labelsFound.push(category);
          if (apply && inMaster && Date.now() <= deadline) {
            try { await g.api(`/me/outlook/masterCategories/${inMaster.id}`).delete(); } catch { /* the per-message removal is what matters */ }
          }
          if (apply && (found > 0 || inMaster) && row.leftBehind === leftBefore) row.labelsRemoved.push(category);
        }
      }
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e);
    }
  }
  return report;
}
