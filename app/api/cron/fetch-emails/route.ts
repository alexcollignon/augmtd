import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'Deprecated. Use /api/cron/sync-calendar.' }, { status: 410 });
}
