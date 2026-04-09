'use client';

import { useState } from 'react';
import Image from 'next/image';
import { CheckIcon, XMarkIcon, PencilIcon } from '@heroicons/react/24/outline';

interface IdentitySectionProps {
  initialName: string;
  userEmail: string;
  avatarUrl?: string | null;
}

export default function IdentitySection({ initialName, userEmail, avatarUrl }: IdentitySectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(initialName);
  const [draftName, setDraftName] = useState(initialName);

  const startEditing = () => {
    setDraftName(name);
    setError(null);
    setSaved(false);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!draftName.trim()) {
      setError('Name is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/context/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: draftName.trim() }),
      });

      if (!res.ok) throw new Error('Failed to save');

      setName(draftName.trim());
      setIsEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const nameInitial = (name || userEmail)?.[0]?.toUpperCase() ?? '?';

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-[15px] font-semibold text-neutral-900">Profile</h3>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-[12px] text-green-600 flex items-center gap-1">
              <CheckIcon className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
          {!isEditing ? (
            <button
              onClick={startEditing}
              className="flex items-center gap-1.5 text-[12px] text-neutral-400 hover:text-neutral-700 transition-colors"
            >
              <PencilIcon className="w-3.5 h-3.5" />
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={cancelEditing}
                disabled={isSaving}
                className="flex items-center gap-1 text-[12px] text-neutral-400 hover:text-neutral-600 transition-colors disabled:opacity-50"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 text-[12px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
              >
                {isSaving ? (
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckIcon className="w-3.5 h-3.5" />
                )}
                Save
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-700">
          {error}
        </div>
      )}

      {!isEditing ? (
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-[15px] font-semibold text-indigo-700 select-none overflow-hidden">
            {avatarUrl ? (
              <Image src={avatarUrl} alt="" width={40} height={40} className="w-full h-full object-cover rounded-full" unoptimized />
            ) : (
              nameInitial
            )}
          </div>
          <div>
            <p className="text-[14px] font-medium text-neutral-900">
              {name || <span className="text-neutral-400 italic text-[13px]">Name not set</span>}
            </p>
            <p className="text-[12px] text-neutral-400 mt-0.5">{userEmail}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Full Name</label>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Your full name"
              autoFocus
              className="mt-1.5 w-full text-[13px] text-neutral-900 bg-white border border-neutral-200 rounded-lg focus:border-indigo-400 focus:outline-none px-3 py-2"
            />
          </div>
          <p className="text-[11px] text-neutral-400">{userEmail}</p>
        </div>
      )}
    </>
  );
}
