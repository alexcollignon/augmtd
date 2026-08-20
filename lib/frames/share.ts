// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SHARE LINK — frames plan Phase 3, law 6 (SHARING A FRAME IS SHARING THE DATA).
//
// A frame inlines its data. A share link is therefore a DATA DISCLOSURE, not a pointer — which is
// why the share moment says so in words, why the sovereign tier never gets one, and why revocation
// is a DELETION (a dead token is a deleted row; nothing soft, nothing cached).
//
// THE STORE (no migration — the house `item_plans` precedent, same as `workflow_owner`):
//   user_id  = the artifact OWNER (the only person who can share it)
//   kind     = 'frame_share'
//   entity_id= the artifact id
//   tasks    = { token, createdAt }
// The (user_id, kind, entity_id) unique key gives ONE live share per artifact for free: re-sharing
// returns the existing link (a second click must not orphan the first link a client already holds).
//
// THE TOKEN is 24 bytes of crypto randomness rendered base64url (32 chars, ~192 bits). Never
// Math.random, never derived from an id — a guessable token is a public frame with extra steps.
// It is never logged: an error line carrying a token is a leak with a timestamp.
//
// THE RESOLUTION (`findFrameArtifact`) is the same law both doors obey and mirrors the authed
// serving door: the artifact must live on the OWNER'S OWN threads, be type 'frame', and carry a
// storage_path — anything else is one indistinguishable not-found. The caller supplies the client,
// so the authed door can prove ownership with the CALLER'S OWN RLS session before any admin client
// exists, while the public token door (which has no session at all) scopes by the share row's
// stored owner instead.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentArtifact } from '@/lib/types/inbox';

export const FRAME_SHARE_KIND = 'frame_share';

export interface FrameShareRow {
  /** The artifact owner — whose threads the frame must live on. */
  userId: string;
  artifactId: string;
  token: string;
  createdAt: string | null;
}

/** 24 bytes of crypto randomness, URL-safe. Never Math.random, never derived from an id. */
export function mintShareToken(): string {
  return randomBytes(24).toString('base64url');
}

/** THE ONE RESOLUTION both doors obey. Null = unknown / foreign / not-a-frame, indistinguishably. */
export async function findFrameArtifact(
  client: SupabaseClient,
  userId: string,
  artifactId: string,
): Promise<DocumentArtifact | null> {
  const { data: threads } = await client
    .from('work_threads')
    .select('artifacts')
    .eq('user_id', userId)
    .not('artifacts', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(400);

  for (const t of (threads ?? []) as Array<{ artifacts: DocumentArtifact[] | null }>) {
    const arts = Array.isArray(t.artifacts) ? t.artifacts : [];
    const hit = arts.find((a) => a?.id === artifactId);
    if (hit) {
      return hit.type === 'frame' && hit.storage_path ? hit : null;
    }
  }
  return null;
}

/**
 * THE BINDING IS THE LIFE (frames plan law 4) — the living resolution.
 *
 * A workflow-born frame is the one LIVING case: its derivation is the workflow, and it
 * re-materializes on every run (`binding {workflowId, refresh:'on_run'}`, stamped at the run's
 * artifact-creation site). A stale dashboard link handed to a client is exactly the failure this
 * resolution kills: the SHARE always serves the newest generation of the series.
 *
 * A chat-born frame carries no binding, so it is returned unchanged — an honest one-shot never
 * silently mutates under a link someone is already holding (law 4: no refresh without a source).
 *
 * THE KEY is `binding.workflowId` alone, newest by `generated_at`. LIMITATION, deliberate: one
 * deliverable per run comes through the production door, so the workflow id identifies the series.
 * A future multi-frame workflow would need a step key alongside it — without one, two frame-emitting
 * steps in the same pipeline would fold into a single series and each would serve the other's newest.
 *
 * NEVER NULL for a valid input: with nothing newer found (or on a failed read) the stored artifact
 * is served. Living means "newest if there is one", never "gone".
 */
export async function resolveLivingFrame(
  admin: SupabaseClient,
  ownerId: string,
  artifact: DocumentArtifact,
): Promise<{ artifact: DocumentArtifact; live: boolean }> {
  const binding = (artifact as unknown as {
    binding?: { workflowId?: string; refresh?: string } | null;
  }).binding;

  if (!binding?.workflowId || binding.refresh !== 'on_run') {
    return { artifact, live: false };
  }

  const { data: threads } = await admin
    .from('work_threads')
    .select('artifacts')
    .eq('user_id', ownerId)
    .not('artifacts', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(400);

  let newest: DocumentArtifact = artifact;
  let newestAt = new Date(artifact.generated_at ?? 0).getTime();

  for (const t of (threads ?? []) as Array<{ artifacts: DocumentArtifact[] | null }>) {
    for (const a of Array.isArray(t.artifacts) ? t.artifacts : []) {
      if (!a?.id || a.type !== 'frame' || !a.storage_path) continue;
      const b = (a as unknown as { binding?: { workflowId?: string } | null }).binding;
      if (b?.workflowId !== binding.workflowId) continue;
      const at = new Date(a.generated_at ?? 0).getTime();
      if (at > newestAt) { newest = a; newestAt = at; }
    }
  }

  return { artifact: newest, live: true };
}

/** ONE LIVE SHARE PER ARTIFACT — an existing row's token is returned, never rotated. */
export async function getOrCreateShare(
  admin: SupabaseClient,
  userId: string,
  artifactId: string,
): Promise<{ token: string; created: boolean }> {
  const { data: existing } = await admin
    .from('item_plans')
    .select('tasks')
    .eq('user_id', userId)
    .eq('kind', FRAME_SHARE_KIND)
    .eq('entity_id', artifactId)
    .maybeSingle();

  const prior = (existing?.tasks ?? null) as { token?: string } | null;
  if (prior?.token) return { token: prior.token, created: false };

  const token = mintShareToken();
  const { error } = await admin.from('item_plans').upsert(
    {
      user_id: userId,
      kind: FRAME_SHARE_KIND,
      entity_id: artifactId,
      tasks: { token, createdAt: new Date().toISOString() },
    },
    { onConflict: 'user_id,kind,entity_id' },
  );
  if (error) throw new Error(`share store write failed: ${error.message}`);
  return { token, created: true };
}

/** REVOCATION IS A DELETION (law 6). Idempotent: revoking nothing is still a revoked link. */
export async function revokeShare(
  admin: SupabaseClient,
  userId: string,
  artifactId: string,
): Promise<void> {
  await admin
    .from('item_plans')
    .delete()
    .eq('user_id', userId)
    .eq('kind', FRAME_SHARE_KIND)
    .eq('entity_id', artifactId);
}

/** The public door's only key. A deleted row resolves to null — revocation lands on the next view. */
export async function resolveShareToken(
  admin: SupabaseClient,
  token: string,
): Promise<FrameShareRow | null> {
  if (!token || token.length < 16) return null;
  const { data } = await admin
    .from('item_plans')
    .select('user_id, entity_id, tasks')
    .eq('kind', FRAME_SHARE_KIND)
    .eq('tasks->>token', token)
    .limit(1)
    .maybeSingle();

  const t = (data?.tasks ?? null) as { token?: string; createdAt?: string } | null;
  if (!data || !t?.token || t.token !== token) return null;
  return {
    userId: String(data.user_id),
    artifactId: String(data.entity_id),
    token: t.token,
    createdAt: t.createdAt ?? null,
  };
}
