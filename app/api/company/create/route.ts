import { NextResponse } from 'next/server';

// Self-serve company creation is disabled.
// Companies are provisioned by platform admins via /platform-admin.
export async function POST() {
  return NextResponse.json({ error: 'Company creation is invite-only' }, { status: 403 });
}
