import { DocumentArtifact } from '@/lib/types/inbox';

export interface VersionedArtifact extends DocumentArtifact {
  versionLabel: string; // e.g. "v1", "v2", or "" when group has only one member
}

/**
 * Annotates each artifact with a version label.
 * Grouped by normalised title; within each group, versions are assigned
 * chronologically (oldest = v1). Single-member groups get an empty label.
 */
export function computeVersionedArtifacts(artifacts: DocumentArtifact[]): VersionedArtifact[] {
  if (!artifacts || artifacts.length === 0) return [];

  // Sort all by generated_at ascending so v1 is always the earliest
  const sorted = [...artifacts].sort(
    (a, b) => new Date(a.generated_at).getTime() - new Date(b.generated_at).getTime()
  );

  // Group by normalised title
  const groups = new Map<string, DocumentArtifact[]>();
  for (const art of sorted) {
    const key = (art.title ?? '').trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(art);
  }

  // Build id → label map
  const labelMap = new Map<string, string>();
  for (const group of groups.values()) {
    group.forEach((art, idx) => {
      labelMap.set(art.id ?? '', group.length > 1 ? `v${idx + 1}` : '');
    });
  }

  // Re-map original array (preserving original order) to add the label
  return artifacts.map(art => ({
    ...art,
    versionLabel: labelMap.get(art.id ?? '') ?? '',
  }));
}
