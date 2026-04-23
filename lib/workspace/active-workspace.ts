import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';

export const ACTIVE_WORKSPACE_COOKIE = 'active_workspace_id';

/** Read from next/headers (RSC / server actions). */
export async function getActiveWorkspaceId(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
}

/** Read from a route-handler request. */
export function getActiveWorkspaceIdFromRequest(req: NextRequest): string | null {
  return req.cookies.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
}

/** Write to a NextResponse (route handlers). */
export function setActiveWorkspaceCookie(res: NextResponse, workspaceId: string) {
  res.cookies.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** Clear the cookie (on sign-out or workspace leave). */
export function clearActiveWorkspaceCookie(res: NextResponse) {
  res.cookies.delete(ACTIVE_WORKSPACE_COOKIE);
}
