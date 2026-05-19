import { DocumentArtifact } from '@/lib/types/inbox';

export interface VersionedArtifact extends DocumentArtifact {
  versionLabel: string;  // e.g. "v1", "v2", or "" when group has only one member
  versionIndex: number;  // 0-based index within the group (0 = oldest)
  versionTotal: number;  // total versions in the group
  groupId: string;       // shared key for all versions in a chain
}

/**
 * Groups artifacts into version chains, then annotates each with version metadata.
 *
 * Grouping strategy:
 * 1. parent_id chain — follow parent_id links to the chain root; all members share that root id.
 * 2. Normalised title fallback — for artifacts with no parent_id that share the same title.
 *
 * Within each group, versions are ordered chronologically (oldest = v1).
 * Single-member groups get versionLabel "" so the UI doesn't show a lone "v1".
 */
export function computeVersionedArtifacts(artifacts: DocumentArtifact[]): VersionedArtifact[] {
  if (!artifacts || artifacts.length === 0) return [];

  const byId = new Map<string, DocumentArtifact>();
  for (const a of artifacts) {
    if (a.id) byId.set(a.id, a);
  }

  function rootId(a: DocumentArtifact): string {
    let current = a;
    const seen = new Set<string>();
    while (current.parent_id && byId.has(current.parent_id) && !seen.has(current.id ?? '')) {
      seen.add(current.id ?? '');
      current = byId.get(current.parent_id)!;
    }
    return current.id ?? current.generated_at;
  }

  // Artifacts that are referenced as a parent — they are chain roots
  const isChainRoot = new Set<string>();
  for (const a of artifacts) {
    if (a.parent_id) isChainRoot.add(a.parent_id);
  }

  const groups = new Map<string, DocumentArtifact[]>();
  for (const a of artifacts) {
    let key: string;
    if (a.parent_id && byId.has(a.parent_id)) {
      // Child in a chain — use the chain root's id
      key = rootId(a);
    } else if (isChainRoot.has(a.id ?? '')) {
      // This artifact IS the root of a chain — use its own id so children can match it
      key = a.id!;
    } else {
      // Standalone — group by normalised title
      key = (a.title ?? '').trim().toLowerCase();
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => new Date(a.generated_at).getTime() - new Date(b.generated_at).getTime());
  }

  const meta = new Map<string, { label: string; index: number; total: number; groupId: string }>();
  for (const [groupId, group] of groups.entries()) {
    group.forEach((a, idx) => {
      meta.set(a.id ?? a.generated_at, {
        label: group.length > 1 ? `v${idx + 1}` : '',
        index: idx,
        total: group.length,
        groupId,
      });
    });
  }

  return artifacts.map(a => {
    const m = meta.get(a.id ?? a.generated_at) ?? { label: '', index: 0, total: 1, groupId: a.id ?? '' };
    return { ...a, versionLabel: m.label, versionIndex: m.index, versionTotal: m.total, groupId: m.groupId };
  });
}

/**
 * Returns only the latest version of each document group, sorted newest-group-first.
 * Used by list views that want one row per document (not one row per version).
 */
export function latestVersions(versioned: VersionedArtifact[]): VersionedArtifact[] {
  const latestByGroup = new Map<string, VersionedArtifact>();
  for (const a of versioned) {
    const existing = latestByGroup.get(a.groupId);
    if (!existing || a.versionIndex > existing.versionIndex) {
      latestByGroup.set(a.groupId, a);
    }
  }
  return Array.from(latestByGroup.values())
    .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());
}
