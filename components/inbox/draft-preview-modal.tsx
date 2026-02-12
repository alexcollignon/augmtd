'use client';

import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  XMarkIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline';

interface DraftPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  draft: string;
  subject: string;
  to: string;
  onSend: (message: string) => Promise<void>;
}

export default function DraftPreviewModal({
  isOpen,
  onClose,
  draft,
  subject,
  to,
  onSend,
}: DraftPreviewModalProps) {
  const [message, setMessage] = useState(() => String(draft || ''));
  const [isSending, setIsSending] = useState(false);
  const [isEdited, setIsEdited] = useState(false);

  // Reset message when draft changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setMessage(String(draft || ''));
      setIsEdited(false);
    }
  }, [isOpen, draft]);

  const handleMessageChange = (newMessage: string) => {
    const msgStr = String(newMessage);
    setMessage(msgStr);
    setIsEdited(msgStr !== String(draft || ''));
  };

  // Ensure message is always a string
  const messageStr = String(message || '');

  const handleSend = async () => {
    setIsSending(true);
    try {
      await onSend(isEdited ? messageStr : '');
      onClose();
    } catch (error) {
      console.error('Send failed:', error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-sm" />
        </Transition.Child>

        {/* Modal Container */}
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 lg:p-8">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-3xl bg-white shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="relative bg-gradient-to-br from-violet-50 via-purple-50 to-indigo-50 border-b border-violet-100 px-6 lg:px-8 py-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      {/* Email details */}
                      <div className="space-y-2 text-[13px]">
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-neutral-700 min-w-[48px]">To:</span>
                          <span className="text-neutral-900 font-medium">{to}</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-neutral-700 min-w-[48px]">Re:</span>
                          <span className="text-neutral-900 font-medium">{subject}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={onClose}
                      className="flex-shrink-0 p-2 hover:bg-white/60 transition-colors"
                    >
                      <XMarkIcon className="w-5 h-5 text-neutral-500" />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="px-6 lg:px-8 py-6 bg-white">
                  {/* Status banner */}
                  <div className={`
                    mb-5 p-4 border
                    ${isEdited
                      ? 'bg-indigo-50 border-indigo-200'
                      : 'bg-violet-50 border-violet-200'}
                  `}>
                    <div className="flex items-start gap-3">
                      <div className={`
                        flex-shrink-0 w-1.5 h-1.5 rounded-full mt-1.5
                        ${isEdited ? 'bg-indigo-500' : 'bg-violet-500'}
                      `} />
                      <p className={`
                        text-[12px] font-medium
                        ${isEdited ? 'text-indigo-800' : 'text-violet-800'}
                      `}>
                        {isEdited
                          ? "You've edited this draft. Your changes will be sent."
                          : 'Review this draft. You can edit it before sending or send as-is.'}
                      </p>
                    </div>
                  </div>

                  {/* Draft editor */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="block text-[13px] font-semibold text-neutral-700">
                        Message
                      </label>
                      <div className="flex items-center gap-3 text-[11px] text-neutral-500">
                        <span>{messageStr.length} characters</span>
                        {isEdited && (
                          <button
                            onClick={() => {
                              setMessage(String(draft || ''));
                              setIsEdited(false);
                            }}
                            className="text-indigo-600 hover:text-indigo-700 font-medium hover:underline transition-colors"
                          >
                            Reset to original
                          </button>
                        )}
                      </div>
                    </div>

                    <textarea
                      value={messageStr}
                      onChange={(e) => handleMessageChange(e.target.value)}
                      className="
                        w-full h-80 px-4 py-3.5
                        border border-neutral-300
                        focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                        resize-none font-sans text-[14px] leading-relaxed
                        text-neutral-900 placeholder:text-neutral-400
                        transition-all
                      "
                      placeholder="Edit your message here..."
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="bg-neutral-50 border-t border-neutral-200 px-6 lg:px-8 py-5">
                  <div className="flex items-center justify-between">
                    {/* Status indicator */}
                    <div className="text-[11px] text-neutral-600">
                      {isEdited && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                          Modified draft
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={onClose}
                        disabled={isSending}
                        className="
                          px-5 py-2.5 text-[13px] font-semibold
                          text-neutral-700 hover:bg-neutral-200 border border-neutral-300
                          disabled:opacity-50 disabled:cursor-not-allowed
                          transition-colors
                        "
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSend}
                        disabled={isSending || !messageStr.trim()}
                        className="
                          inline-flex items-center justify-center gap-2
                          px-6 py-2.5 text-[13px] font-semibold
                          bg-indigo-600 text-white
                          hover:bg-indigo-700
                          disabled:opacity-50 disabled:cursor-not-allowed
                          transition-all shadow-sm hover:shadow
                        "
                      >
                        <PaperAirplaneIcon className="w-4 h-4" />
                        {isSending ? 'Sending...' : 'Send Email'}
                      </button>
                    </div>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
