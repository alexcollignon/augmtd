'use client';

import { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import ActivityTimeline from './activity-timeline';

// ─── ActivityDrawer ───────────────────────────────────────────────────────────
// A right-side slide-over panel showing the activity timeline. Built on Headless
// UI `Transition`/`Dialog` — the same slide-over pattern used by the inbox and
// meeting detail panels: a backdrop opacity fade + a panel that slides in from
// the right (translate-x-full → translate-x-0). Esc and backdrop clicks close via
// `Dialog onClose`, and body scroll is locked automatically while open. The
// timeline is mounted only after the drawer is first opened (lazy fetch) and stays
// mounted for the session so re-opening is instant.
export default function ActivityDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Once opened, keep the timeline mounted so its data isn't re-fetched on reopen.
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-in-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in-out duration-300"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-neutral-900/20 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-300"
                enterFrom="translate-x-full"
                enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-300"
                leaveFrom="translate-x-0"
                leaveTo="translate-x-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen max-w-md">
                  <div className="flex h-full flex-col bg-white border-l border-neutral-200 shadow-2xl">
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 h-14 border-b border-neutral-100 flex-shrink-0">
                      <div>
                        <Dialog.Title className="text-[15px] font-semibold text-neutral-900 leading-none">
                          Activity
                        </Dialog.Title>
                        <p className="text-[11.5px] text-neutral-400 mt-1 leading-none">
                          Everything you&rsquo;ve done
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={onClose}
                        title="Close"
                        aria-label="Close activity"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                      >
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Timeline — mounted only after first open (lazy fetch), kept mounted after. */}
                    <div className="flex-1 overflow-y-auto px-5 py-6">
                      {everOpened && <ActivityTimeline />}
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
