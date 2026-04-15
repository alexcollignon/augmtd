// AI tier is now managed at workspace level by superadmins via Platform Admin.
// Individual users can no longer switch tiers.

import { NextResponse } from 'next/server';

const GONE = NextResponse.json(
  { error: 'AI tier is now managed at workspace level by your administrator.' },
  { status: 410 }
);

export async function GET() { return GONE; }
export async function POST() { return GONE; }
