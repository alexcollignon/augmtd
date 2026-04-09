import { NextRequest, NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/microsoft/oauth';

export async function GET(request: NextRequest) {
  try {
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
