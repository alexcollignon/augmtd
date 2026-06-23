import type { FC } from 'react';
import { LinkedInPostCard } from './linkedin-post-card';

// ─── Artifact render registry ────────────────────────────────────────────────
// A coworker can emit a typed artifact ({ type, ...payload }) that renders as a rich card
// in chat. This is the reusable display layer: type → component. New types register here.
//
// SCOPE (deliberate): these are VISUAL components only. The one interactive *action* (send)
// lives in the separate EmailDraftCard path and is untouched. A per-type action contract
// (publish, save, …) is a later extension on ArtifactProps — not wired yet.

export interface ArtifactCtx { threadId: string; agentId: string; messageId: string }
export type WorkArtifact = { type: string; [key: string]: unknown };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ArtifactProps = { artifact: any; ctx: ArtifactCtx };

const RENDERERS: Record<string, FC<ArtifactProps>> = {
  linkedin_post: ({ artifact }) => <LinkedInPostCard variants={artifact.variants ?? []} />,
  // briefing:    ({ artifact }) => <BriefingCard ... />,   (future)
  // interview:   ({ artifact, ctx }) => <InterviewCard ... />,   (future)
};

// Renders one artifact by type. Unknown/unsupported type → no-op (never crash), so a stray
// or future artifact degrades gracefully on older clients.
export function ArtifactRenderer({ artifact, ctx }: { artifact: WorkArtifact; ctx: ArtifactCtx }) {
  const Renderer = artifact?.type ? RENDERERS[artifact.type] : undefined;
  if (!Renderer) return null;
  return <Renderer artifact={artifact} ctx={ctx} />;
}
