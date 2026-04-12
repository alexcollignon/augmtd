'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { ChevronRightIcon, TrashIcon } from '@heroicons/react/24/outline';
import FormatToolbar from '@/components/inbox/format-toolbar';
import Image from 'next/image';

interface Connection {
  id: string;
  provider: 'gmail' | 'outlook';
  status: string;
  metadata?: { email?: string; signature?: string };
}

function SignatureRow({ connection }: { connection: Connection }) {
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const providerLabel = connection.provider === 'gmail' ? 'Gmail' : 'Outlook';
  const providerLogo = connection.provider === 'gmail' ? '/logos/gmail.png' : '/logos/outlook.png';
  const email = connection.metadata?.email ?? providerLabel;

  // Fetch on first expand
  useEffect(() => {
    if (!open || loaded) return;
    fetch(`/api/user/signature?connectionId=${connection.id}`)
      .then(r => r.json())
      .then(({ signature }) => {
        if (editorRef.current) editorRef.current.innerHTML = signature ?? '';
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, connection.id]);

  const handleSync = useCallback(() => {}, []);

  const handleSave = async () => {
    const html = editorRef.current?.innerHTML ?? '';
    setIsSaving(true);
    try {
      const res = await fetch('/api/user/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connection.id, signature: html }),
      });
      if (!res.ok) throw new Error();
      // Notify any open compose/reply panels so they update without a page refresh
      window.dispatchEvent(new CustomEvent('signature-saved', {
        detail: { connectionId: connection.id, signature: html },
      }));
      toast.success('Signature saved');
    } catch {
      toast.error('Could not save signature');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 transition-colors"
      >
        <div className="w-5 h-5 rounded-full bg-white border border-neutral-100 flex items-center justify-center overflow-hidden flex-shrink-0">
          <Image src={providerLogo} alt={providerLabel} width={14} height={14} className="object-contain" />
        </div>
        <span className="flex-1 text-[13px] text-neutral-700 truncate">{email}</span>
        <ChevronRightIcon className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <>
          <div className="border-t border-neutral-100 px-4 pt-3 pb-2 relative min-h-[80px]">
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-neutral-200 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            )}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              data-placeholder={connection.provider === 'outlook' ? 'Paste your Outlook signature here…' : 'Your signature…'}
              className={`w-full text-[13px] text-neutral-800 outline-none leading-relaxed min-h-[60px] ${!loaded ? 'opacity-0' : ''}`}
            />
          </div>
          <div className="flex items-center justify-between px-4 py-2 border-t border-neutral-100 bg-neutral-50">
            <FormatToolbar editorRef={editorRef} onSync={handleSync} />
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    const res = await fetch('/api/user/signature', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ connectionId: connection.id, signature: '' }),
                    });
                    if (!res.ok) throw new Error();
                    if (editorRef.current) editorRef.current.innerHTML = '';
                    window.dispatchEvent(new CustomEvent('signature-saved', {
                      detail: { connectionId: connection.id, signature: '' },
                    }));
                    toast.success('Signature removed');
                  } catch {
                    toast.error('Could not remove signature');
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                disabled={isDeleting || isSaving}
                className="p-1.5 text-neutral-400 hover:text-red-500 disabled:opacity-40 transition-colors rounded"
                title="Remove signature"
              >
                {isDeleting
                  ? <div className="w-3.5 h-3.5 border-2 border-neutral-300 border-t-red-400 rounded-full animate-spin" />
                  : <TrashIcon className="w-3.5 h-3.5" />
                }
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || isDeleting}
                className="flex items-center gap-1.5 px-3 py-1 text-[12px] font-semibold bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {isSaving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function SignatureSection({ connections }: { connections: Connection[] }) {
  const active = connections.filter(c => c.status === 'active');
  if (active.length === 0) return null;
  return (
    <div className="space-y-2">
      {active.map(conn => <SignatureRow key={conn.id} connection={conn} />)}
    </div>
  );
}
