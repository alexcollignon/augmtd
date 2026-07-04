'use client';

import { Fragment } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { ItemDetail } from './item-detail';

// ── The item-detail rendered as a WIDE, centered modal over the Home. Mounted by the intercepting
// route (@modal/(.)item/[id]) on soft-navigation from the Home — the URL is real (/item/[id]) so
// back-button / refresh / deep-link all work; a direct visit renders the full page instead.
// Close on ✕ / Esc / backdrop → router.back() (pops the intercept, returns to the Home).
// Uses Headless UI Dialog so focus-trap / scroll-lock / Esc are handled. Generous width + padding.
export function ItemDetailModal({ id }: { id: string }) {
  const router = useRouter();
  // The suggested angle is only known on the Home (it's brief-generated, not stored) — the row
  // passes it through as a query param so the modal shows it. A direct page visit simply omits it.
  const angle = useSearchParams().get('angle');
  const close = () => router.back();

  return (
    <Transition show as={Fragment} appear>
      <Dialog onClose={close} className="relative z-50">
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="relative w-[90vw] max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-2xl">
                <button
                  onClick={close}
                  className="absolute top-4 right-4 z-10 p-2 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
                  title="Close"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
                <ItemDetail id={id} angle={angle} />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
