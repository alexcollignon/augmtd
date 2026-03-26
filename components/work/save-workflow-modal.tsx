'use client';

import { Fragment, useState, useEffect, useRef } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { BookmarkIcon } from '@heroicons/react/24/outline';

interface Props {
  isOpen: boolean;
  prompt: string;
  defaultName: string;
  onSave: (name: string, prompt: string) => Promise<void>;
  onClose: () => void;
}

export default function SaveWorkflowModal({ isOpen, prompt, defaultName, onSave, onClose }: Props) {
  const [name, setName] = useState(defaultName);
  const [selected, setSelected] = useState<'asis' | 'template'>('asis');
  const [generalized, setGeneralized] = useState<string | null>(null);
  const [isGeneralizing, setIsGeneralizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // On open: reset state and fetch generalized version
  useEffect(() => {
    if (!isOpen) return;
    setName(defaultName);
    setSelected('asis');
    setGeneralized(null);
    setIsGeneralizing(true);

    fetch('/api/work/saved-workflows/generalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
      .then((r) => r.json())
      .then(({ generalized: g }) => {
        setGeneralized(g ?? null);
        if (g) setSelected('template');
      })
      .catch(() => setGeneralized(null))
      .finally(() => setIsGeneralizing(false));
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus name input after transition
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => nameInputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  async function handleSave() {
    if (!name.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const chosenPrompt = selected === 'template' && generalized ? generalized : prompt;
      await onSave(name.trim(), chosenPrompt);
    } finally {
      setIsSaving(false);
    }
  }

  const canSave = name.trim().length > 0 && !isSaving;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-150"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-150"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-100"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md bg-white shadow-xl border border-neutral-200 p-6 space-y-5">
                {/* Header */}
                <div className="flex items-center gap-2">
                  <BookmarkIcon className="w-4 h-4 text-neutral-500" />
                  <Dialog.Title className="text-[14px] font-semibold text-neutral-900">
                    Save as blueprint
                  </Dialog.Title>
                </div>

                {/* Name input */}
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                    Name
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSave();
                      if (e.key === 'Escape') onClose();
                    }}
                    placeholder="Name this blueprint…"
                    className="w-full text-[13px] border border-neutral-300 focus:border-indigo-400 focus:outline-none px-3 py-2 bg-white"
                  />
                </div>

                {/* Choice cards */}
                <div className="grid grid-cols-2 gap-3">
                  {/* This run card */}
                  <button
                    type="button"
                    onClick={() => setSelected('asis')}
                    className={`text-left p-3 border-2 transition-colors ${
                      selected === 'asis'
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-neutral-200 hover:border-neutral-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                          selected === 'asis' ? 'border-indigo-500' : 'border-neutral-400'
                        }`}
                      >
                        {selected === 'asis' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        )}
                      </span>
                      <span className="text-[12px] font-semibold text-neutral-800">This run</span>
                    </div>
                    <p className="text-[11.5px] text-neutral-500 leading-snug line-clamp-4">
                      &ldquo;{prompt}&rdquo;
                    </p>
                  </button>

                  {/* As template card — hidden if generalize failed and not loading */}
                  {(isGeneralizing || generalized) && (
                    <button
                      type="button"
                      onClick={() => !isGeneralizing && setSelected('template')}
                      disabled={isGeneralizing}
                      className={`text-left p-3 border-2 transition-colors ${
                        selected === 'template'
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-neutral-200 hover:border-neutral-300 bg-white'
                      } ${isGeneralizing ? 'cursor-wait' : ''}`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                            selected === 'template' ? 'border-indigo-500' : 'border-neutral-400'
                          }`}
                        >
                          {selected === 'template' && (
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                          )}
                        </span>
                        <span className="text-[12px] font-semibold text-neutral-800">As template</span>
                      </div>

                      {isGeneralizing ? (
                        <div className="flex items-center gap-1.5 mt-3">
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 bg-neutral-300 rounded-full animate-bounce [animation-delay:300ms]" />
                        </div>
                      ) : (
                        <p className="text-[11.5px] text-neutral-500 leading-snug line-clamp-4">
                          &ldquo;{generalized}&rdquo;
                        </p>
                      )}
                    </button>
                  )}
                </div>

                {/* Footer actions */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-[13px] text-neutral-500 hover:text-neutral-700 px-3 py-1.5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!canSave}
                    className="text-[13px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 disabled:opacity-40 transition-colors flex items-center gap-1.5"
                  >
                    {isSaving ? '…' : 'Save blueprint →'}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
