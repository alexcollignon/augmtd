// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DOC CARD'S TWO FACTS (docs/attention-plan.md law D — THE REVIEW-FIRST DOC CARD).
//
// A document arrives in a thread as a HANDLE, never as the document. Two things the handle must
// state truthfully, and neither may be guessed at the surface:
//
//   · WHAT KIND OF FILE IT IS — the glyph and the type word. Read from the FILE'S OWN extension
//     first (its only real truth) and only then from the artifact's declared kind. A type we
//     cannot name stays the generic 'doc'; the card never claims "PDF" about bytes it hasn't seen.
//   · WHICH VERSION IT IS — resolved from the stored version chain (lib/artifacts/version-utils,
//     the ONE chain implementation), never from what a card remembered. THE SAME-CARD LAW (D2):
//     a revision lands on the SAME card, so a host folds every card pointing at ANY member of a
//     chain onto the chain's latest member. `groupIds` is what makes that fold possible.
//
// CLIENT-SAFE BY CONSTRUCTION: types + the version-chain helper only. No server graph, so the
// thread hosts (browser) and the gates (node) read the same two answers.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { DocumentArtifact } from '@/lib/types/inbox';
import { computeVersionedArtifacts } from '@/lib/artifacts/version-utils';

/** The glyph vocabulary of the handle — one shape per family, plus the honest generic. */
export type DocCardType = 'pdf' | 'word' | 'slides' | 'sheet' | 'doc';

const BY_EXT: Record<string, { type: DocCardType; label: string }> = {
  pdf: { type: 'pdf', label: 'PDF' },
  doc: { type: 'word', label: 'Word' },
  docx: { type: 'word', label: 'Word' },
  ppt: { type: 'slides', label: 'Slides' },
  pptx: { type: 'slides', label: 'Slides' },
  xls: { type: 'sheet', label: 'Sheet' },
  xlsx: { type: 'sheet', label: 'Sheet' },
  csv: { type: 'sheet', label: 'Sheet' },
};

/** The file's own kind: its EXTENSION first (what the bytes actually are), the artifact's
 *  declared type second, and the generic word when neither is known. */
export function docCardTypeOf(
  artifactType?: string | null,
  pathOrName?: string | null,
): { type: DocCardType; label: string } {
  const ext = String(pathOrName ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (ext && BY_EXT[ext]) return BY_EXT[ext];
  switch (String(artifactType ?? '').toLowerCase()) {
    case 'presentation': return { type: 'slides', label: 'Presentation' };
    case 'spreadsheet': return { type: 'sheet', label: 'Spreadsheet' };
    case 'document': case 'report': case 'analysis': return { type: 'doc', label: 'Document' };
    default: return { type: 'doc', label: 'Document' };
  }
}

/** Where a pointer at ONE version lands after the chain is read: the chain's LATEST member, its
 *  version words, and every id in the chain (the fold key — a card pointing at v1 and a card
 *  pointing at v2 are the SAME card, and one of them must go). */
export type DocVersionResolution = {
  id: string;
  title: string;
  type?: string;
  storagePath?: string;
  /** "v3" — empty for a single-version document (a lone "v1" is noise, the chain's own rule). */
  versionLabel: string;
  versionTotal: number;
  groupIds: string[];
};

/** Resolve a pointer at any version of a document to the chain's CURRENT version. Null when the
 *  id is not in this artifact list (a stale pointer stays what it was — never invented). */
export function resolveDocVersion(
  artifacts: DocumentArtifact[] | null | undefined,
  artifactId: string,
): DocVersionResolution | null {
  const all = computeVersionedArtifacts(artifacts ?? []);
  const me = all.find((a) => a.id === artifactId);
  if (!me) return null;
  const group = all.filter((a) => a.groupId === me.groupId).sort((a, b) => a.versionIndex - b.versionIndex);
  const latest = group[group.length - 1] ?? me;
  return {
    id: String(latest.id ?? artifactId),
    title: latest.title,
    type: latest.type,
    storagePath: latest.storage_path,
    versionLabel: latest.versionLabel,
    versionTotal: latest.versionTotal,
    groupIds: group.map((a) => String(a.id ?? '')).filter(Boolean),
  };
}
