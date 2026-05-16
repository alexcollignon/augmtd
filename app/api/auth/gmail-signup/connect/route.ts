import { NextRequest, NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/google/oauth';
import { checkRateLimit } from '@/lib/utils/rate-limit';

export async function GET(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
    const rl = checkRateLimit(`oauth:${ip}`, 10, 300_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const state = Buffer.from(JSON.stringify({
      flow: 'signup',
      timestamp: Date.now(),
    })).toString('base64');

    const authUrl = getAuthUrl(state);
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('Error initiating Gmail signup OAuth:', error);
    return NextResponse.redirect(`${request.nextUrl.origin}/login?error=oauth_init_failed`);
  }
}
