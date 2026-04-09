'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function OAuthCompletePage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    async function finalize() {
      // Provider is embedded in the redirectTo URL by the callback routes
      const urlProvider = new URLSearchParams(window.location.search).get('provider') ?? 'gmail';
      try {
        await fetch('/api/auth/finalize-connection', { method: 'POST' });
      } catch (err) {
        console.error('[OAuthComplete] Finalize failed (non-fatal):', err);
      }
      router.push(`/inbox?success=${urlProvider}_connected`);
    }

    async function run() {
      // Case 1: implicit flow — tokens in URL hash (#access_token=...&refresh_token=...)
      // createBrowserClient has detectSessionInUrl: false, so we parse manually
      const hash = window.location.hash;
      if (hash) {
        const params = new URLSearchParams(hash.substring(1));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error || !data.session) {
            console.error('[OAuthComplete] setSession failed:', error);
            router.push('/login?error=auth_callback_failed');
            return;
          }
          await finalize();
          return;
        }
      }

      // Case 2: PKCE flow — code in query string (?code=...)
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error || !data.session) {
          console.error('[OAuthComplete] exchangeCodeForSession failed:', error);
          router.push('/login?error=auth_callback_failed');
          return;
        }
        await finalize();
        return;
      }

      // Case 3: session already exists (e.g. page refresh)
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await finalize();
        return;
      }

      // Nothing worked
      router.push('/login?error=auth_callback_failed');
    }

    run();
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-50/30 via-white to-gray-50">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Setting up your account…</p>
      </div>
    </div>
  );
}
