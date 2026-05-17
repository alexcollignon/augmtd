import { NextRequest, NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/microsoft/oauth';
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

    const origin = request.nextUrl.origin;

    const state = Buffer.from(JSON.stringify({
      flow: 'signup',
      timestamp: Date.now(),
    })).toString('base64');

    const redirectUri = `${origin}/api/auth/outlook/callback`;
    const authUrl = await getAuthUrl(redirectUri, state);
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('Error initiating Outlook signup OAuth:', error);
    return NextResponse.redirect(`${request.nextUrl.origin}/login?error=oauth_init_failed`);
  }
}
