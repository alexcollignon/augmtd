'use client';

import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, SparklesIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';
import Link from 'next/link';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
}

export default function OnboardingModal({ isOpen, onClose, userEmail }: OnboardingModalProps) {
  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl sm:p-8">
                <div className="absolute right-0 top-0 pr-4 pt-4">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                <div className="text-center">
                  <div className="flex justify-center mb-4">
                    <Image
                      src="/augmtd-logo.png"
                      alt="AUGMTD"
                      width={64}
                      height={64}
                      className="w-16 h-16"
                    />
                  </div>
                  <Dialog.Title as="h3" className="text-2xl font-bold text-gray-900 mb-2">
                    Welcome to AUGMTD
                  </Dialog.Title>
                  <p className="text-gray-600 mb-6">
                    Your personal digital twin that learns how you work and prepares your next steps
                  </p>
                </div>

                <div className="bg-gradient-to-r from-primary-50 to-purple-50 rounded-lg p-6 mb-6">
                  <div className="flex items-start space-x-3">
                    <SparklesIcon className="w-6 h-6 text-primary-600 flex-shrink-0 mt-1" />
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2">How AUGMTD works</h4>
                      <ul className="space-y-2 text-sm text-gray-700">
                        <li>• Connect your tools (email, calendar, Slack, and more)</li>
                        <li>• AI analyzes your work and prepares drafts, summaries, and action items</li>
                        <li>• Review prepared work and approve what looks good</li>
                        <li>• Save hours every day with your digital twin handling routine tasks</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-6">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Get started by connecting your first integration:</h4>
                  <Link
                    href="/settings"
                    onClick={onClose}
                    className="w-full inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 transition-colors"
                  >
                    Go to Settings
                    <ArrowRightIcon className="ml-2 w-5 h-5" />
                  </Link>
                  {userEmail && (
                    <p className="text-xs text-gray-500 text-center mt-3">
                      Signed in as {userEmail}
                    </p>
                  )}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
