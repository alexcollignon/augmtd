// ─── SECRETS FAIL CLOSED (W0.3) ─────────────────────────────────────────────────────────────
// Routes used to compare `authorization === \`Bearer ${process.env.X}\`` — with X unset that
// template renders "Bearer undefined", which any caller can send. The one check now: an empty or
// missing secret NEVER authenticates, and the compare is constant-time (digests of equal length,
// so neither the secret's length nor a matching prefix leaks through timing).
// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` — `hasBearer(req, 'CRON_SECRET')` is
// exactly that contract.

import { createHash, timingSafeEqual } from 'node:crypto';

type HeaderSource = { headers: { get(name: string): string | null } };

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/** Constant-time equality of a provided value against the env secret. Unset/empty secret → false. */
export function matchesSecret(provided: string | null | undefined, envName: string): boolean {
  const secret = process.env[envName];
  if (!secret || typeof provided !== 'string' || !provided) return false;
  return timingSafeEqual(digest(provided), digest(secret));
}

/** True only when the request carries `Authorization: Bearer <env secret>` and the secret is set. */
export function hasBearer(req: HeaderSource, envName: string): boolean {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  return matchesSecret(auth.slice('Bearer '.length), envName);
}
