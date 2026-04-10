'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

function LoginForm() {
  const [message, setMessage] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const error = searchParams?.get('error');
    const session = searchParams?.get('session');

    if (error === 'auth_callback_failed') {
      setMessage('Authentication failed. Please try again.');
      router.replace('/login');
    } else if (error === 'oauth_denied') {
      setMessage('Sign-in was cancelled.');
      router.replace('/login');
    } else if (error === 'session_failed') {
      setMessage('Could not establish session. Please try again.');
      router.replace('/login');
    } else if (error === 'oauth_init_failed') {
      setMessage('Could not start sign-in. Please try again.');
      router.replace('/login');
    } else if (session === 'expired') {
      setMessage('Your session has expired. Please sign in again.');
      router.replace('/login');
    }
  }, [searchParams, router]);

  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/gmail-signup/connect';
  };

  const handleMicrosoftLogin = () => {
    window.location.href = '/api/auth/outlook-signup/connect';
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminLoading(true);
    setMessage('');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
    if (error) {
      setMessage(error.message);
      setAdminLoading(false);
    } else {
      router.push('/inbox');
    }
  };


  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-50/30 via-white to-gray-50">
      <div className="w-full max-w-md p-10 bg-white rounded-lg border border-gray-100 shadow-xl">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-8">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg blur-xl opacity-30"></div>
              <div className="relative p-4 bg-white rounded-lg shadow-lg ring-1 ring-gray-100">
                <Image
                  src="/augmtd-logo.png"
                  alt="AUGMTD"
                  width={56}
                  height={56}
                  className="w-14 h-14"
                />
              </div>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Get started</h1>
          <p className="text-gray-500 text-base">Sign in or create your AUGMTD account</p>
        </div>

        {/* Error message */}
        {message && (
          <div className="mb-6 p-4 rounded-lg border bg-red-50 border-red-100">
            <p className="text-sm text-red-600">{message}</p>
          </div>
        )}

        {/* OAuth buttons */}
        <div className="space-y-3">
          <button
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-4 bg-white border border-gray-200 rounded-lg text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-all duration-200 shadow-sm"
          >
            {/* Google "G" icon */}
            <svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </button>

          <button
            onClick={handleMicrosoftLogin}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-4 bg-white border border-gray-200 rounded-lg text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-all duration-200 shadow-sm"
          >
            {/* Microsoft icon */}
            <svg width="20" height="20" viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
              <path fill="#f3f3f3" d="M0 0h23v23H0z"/>
              <path fill="#f35325" d="M1 1h10v10H1z"/>
              <path fill="#81bc06" d="M12 1h10v10H12z"/>
              <path fill="#05a6f0" d="M1 12h10v10H1z"/>
              <path fill="#ffba08" d="M12 12h10v10H12z"/>
            </svg>
            Continue with Microsoft
          </button>
        </div>

        {/* Admin password login */}
        <div className="mt-6 text-center">
          <button
            onClick={() => setShowAdminLogin(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Admin sign-in
          </button>
          {showAdminLogin && (
            <form onSubmit={handleAdminLogin} className="mt-3 space-y-2 text-left">
              <input
                type="email"
                placeholder="Email"
                value={adminEmail}
                onChange={e => setAdminEmail(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <input
                type="password"
                placeholder="Password"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="submit"
                disabled={adminLoading}
                className="w-full py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {adminLoading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
        </div>

      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 via-white to-primary-50/30">
        <div className="text-gray-500">Loading...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
