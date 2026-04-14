'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { PauseCircleIcon } from '@heroicons/react/24/outline';

export default function SuspendedClient({
  userEmail,
  workspaceName,
}: {
  userEmail: string;
  workspaceName: string;
}) {
  const router = useRouter();

  async function handleSignOut() {
    await fetch('/auth/signout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#EEEAE6] px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">

          <div className="px-8 pt-8 pb-5 text-center">
            <div className="flex justify-center mb-5">
              <Image
                src="/augmtd-logo.png"
                alt="AUGMTD"
                width={40}
                height={40}
                className="w-10 h-10"
              />
            </div>
            <div className="w-12 h-12 mx-auto mb-4 bg-amber-50 rounded-2xl flex items-center justify-center">
              <PauseCircleIcon className="w-6 h-6 text-amber-500" />
            </div>
            <h1 className="text-[17px] font-semibold text-neutral-900 leading-snug">
              Access paused
            </h1>
            <p className="text-sm text-neutral-400 mt-1">
              {workspaceName} is temporarily suspended
            </p>
          </div>

          <div className="px-8 pb-8">
            <div className="px-4 py-3 rounded-xl bg-neutral-50 border border-neutral-100">
              <p className="text-xs text-neutral-600 leading-relaxed">
                Your workspace has been paused. Your data is safe and will be
                restored when access is reinstated. Contact your workspace
                admin or AUGMTD support for details.
              </p>
            </div>

            <div className="mt-5 pt-5 border-t border-neutral-100 flex items-center justify-between text-[11px]">
              <span className="text-neutral-400 truncate">{userEmail}</span>
              <button
                onClick={handleSignOut}
                className="text-neutral-500 hover:text-neutral-800 transition-colors flex-shrink-0"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
