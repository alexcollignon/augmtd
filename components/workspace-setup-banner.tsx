'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { XMarkIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { useWorkspace } from '@/context/workspace-context';

const STORAGE_KEY_PREFIX = 'ws_setup_done_';

export function WorkspaceSetupBanner({ showSetup }: { showSetup: boolean }) {
  const router = useRouter();
  const { workspace } = useWorkspace();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!showSetup || !workspace?.id) return;
    const dismissed = sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${workspace.id}`);
    if (!dismissed) setVisible(true);
    router.replace('/work');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSetup, workspace?.id]);

  const dismiss = () => {
    if (workspace?.id) sessionStorage.setItem(`${STORAGE_KEY_PREFIX}${workspace.id}`, '1');
    setVisible(false);
  };

  if (!visible) return null;

  const workspaceName = workspace?.name ?? 'Your workspace';

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-indigo-50 border-b border-indigo-100 flex-shrink-0">
      <EnvelopeIcon className="w-4 h-4 text-indigo-400 flex-shrink-0" />
      <p className="flex-1 text-[13px] text-indigo-700">
        <span className="font-medium">{workspaceName}</span> is ready — connect the email you want to use for this workspace.
      </p>
      <a
        href="/settings?tab=account"
        className="flex-shrink-0 text-[12px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors"
      >
        Connect email
      </a>
      <button
        onClick={dismiss}
        className="flex-shrink-0 text-indigo-400 hover:text-indigo-600 transition-colors"
        aria-label="Dismiss"
      >
        <XMarkIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
