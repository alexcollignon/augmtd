'use client';

import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, SparklesIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';
import Link from 'next/link';
import { Department } from '@/lib/types/work-blueprints';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  userFullName?: string;
}

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: 'Operations', label: 'Operations' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Sales', label: 'Sales' },
  { value: 'Marketing', label: 'Marketing' },
  { value: 'Product', label: 'Product' },
  { value: 'Engineering', label: 'Engineering' },
  { value: 'Customer Success', label: 'Customer Success' },
  { value: 'Human Resources', label: 'Human Resources' },
  { value: 'Legal', label: 'Legal' },
  { value: 'Compliance', label: 'Compliance' },
  { value: 'Risk', label: 'Risk' },
  { value: 'Data & Analytics', label: 'Data & Analytics' },
  { value: 'Executive', label: 'Executive' },
  { value: 'Other', label: 'Other' },
];

export default function OnboardingModal({ isOpen, onClose, userEmail, userFullName }: OnboardingModalProps) {
  const [fullName, setFullName] = useState(userFullName || '');
  const [department, setDepartment] = useState<Department | ''>('');
  const [role, setRole] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Update name when prop changes
  useEffect(() => {
    if (userFullName) {
      setFullName(userFullName);
    }
  }, [userFullName]);

  const handleContinue = async () => {
    // Validate required fields
    if (!fullName.trim()) {
      alert('Please enter your full name');
      return;
    }
    if (!department) {
      alert('Please select your department');
      return;
    }
    if (!role.trim()) {
      alert('Please enter your role');
      return;
    }

    setIsSaving(true);

    try {
      // Save basic identity info
      const response = await fetch('/api/context/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          department: department,
          role: role.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save information');
      }

      // Close modal and redirect to settings
      onClose();
      window.location.href = '/settings';
    } catch (error) {
      console.error('Failed to save information:', error);
      alert('Failed to save your information. Please try again.');
      setIsSaving(false);
    }
  };
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-3xl sm:p-6">
                <div className="absolute right-0 top-0 pr-4 pt-4">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                {/* Header */}
                <div className="text-center mb-5">
                  <div className="flex justify-center mb-3">
                    <Image
                      src="/augmtd-logo.png"
                      alt="AUGMTD"
                      width={56}
                      height={56}
                      className="w-14 h-14"
                    />
                  </div>
                  <Dialog.Title as="h3" className="text-xl font-bold text-gray-900 mb-1.5">
                    Welcome to AUGMTD
                  </Dialog.Title>
                  <p className="text-sm text-gray-600">
                    Your personal digital twin that learns how you work and prepares your next steps
                  </p>
                </div>

                {/* How it works */}
                <div className="bg-gradient-to-r from-primary-50 to-purple-50 rounded-lg p-4 mb-5">
                  <div className="flex items-start space-x-3">
                    <SparklesIcon className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-sm text-gray-900 mb-1.5">How it works</h4>
                      <ul className="space-y-1 text-xs text-gray-700">
                        <li>• Connect your email to get started</li>
                        <li>• AI prepares personalized drafts and action items</li>
                        <li>• Review and approve what looks good</li>
                        <li>• System learns from your edits and gets better over time</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Basic Information */}
                <div className="border-t border-gray-200 pt-5 mb-5">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">
                    Tell us a bit about yourself
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Question 1: Full Name */}
                    <div className="md:col-span-2">
                      <label htmlFor="fullName" className="block text-xs font-medium text-gray-700 mb-1.5">
                        Full name
                      </label>
                      <input
                        type="text"
                        id="fullName"
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm py-2"
                        placeholder="e.g., Alex Smith"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        autoComplete="name"
                      />
                    </div>

                    {/* Question 2: Department */}
                    <div>
                      <label htmlFor="department" className="block text-xs font-medium text-gray-700 mb-1.5">
                        Department
                      </label>
                      <select
                        id="department"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value as Department)}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm py-2"
                      >
                        <option value="">Select department</option>
                        {DEPARTMENTS.map((dept) => (
                          <option key={dept.value} value={dept.value}>
                            {dept.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Question 3: Role */}
                    <div>
                      <label htmlFor="role" className="block text-xs font-medium text-gray-700 mb-1.5">
                        Role / Title
                      </label>
                      <input
                        type="text"
                        id="role"
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm py-2"
                        placeholder="e.g., Senior Product Manager"
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        autoComplete="organization-title"
                      />
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-gray-500 md:col-span-2">
                    AUGMTD will learn your communication style from your emails automatically.
                  </p>
                </div>

                {/* Action */}
                <div className="border-t border-gray-200 pt-4">
                  <button
                    type="button"
                    onClick={handleContinue}
                    disabled={isSaving}
                    className="w-full inline-flex items-center justify-center px-6 py-2.5 border border-transparent text-sm font-semibold rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isSaving ? 'Saving...' : 'Continue to Settings'}
                    {!isSaving && <ArrowRightIcon className="ml-2 w-4 h-4" />}
                  </button>
                  {userEmail && (
                    <p className="text-xs text-gray-500 text-center mt-2">
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
