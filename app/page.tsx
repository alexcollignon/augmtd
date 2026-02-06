import Link from 'next/link';
import Image from 'next/image';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-primary-50 to-white">
      <div className="text-center space-y-8">
        <div className="flex items-center justify-center space-x-4 mb-4">
          <Image
            src="/augmtd-logo.png"
            alt="AUGMTD"
            width={64}
            height={64}
            className="w-16 h-16"
          />
          <h1 className="text-6xl font-bold text-gray-900">
            AUGMTD
          </h1>
        </div>
        <p className="text-xl text-gray-600 max-w-2xl">
          Your personal digital twin that learns how you work
          <br />
          and prepares your next steps for review and approval.
        </p>

        <div className="flex gap-4 justify-center mt-8">
          <Link
            href="/login"
            className="px-8 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-lg font-medium transition-colors"
          >
            Get Started
          </Link>
          <Link
            href="/about"
            className="px-8 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-lg font-medium transition-colors"
          >
            Learn More
          </Link>
        </div>

        <div className="mt-12 flex items-center justify-center space-x-6 text-sm text-gray-600">
          <div className="flex items-center space-x-2">
            <CheckCircleIcon className="w-5 h-5 text-green-500" />
            <span>Database connected</span>
          </div>
          <div className="flex items-center space-x-2">
            <CheckCircleIcon className="w-5 h-5 text-green-500" />
            <span>Authentication ready</span>
          </div>
          <div className="flex items-center space-x-2">
            <CheckCircleIcon className="w-5 h-5 text-green-500" />
            <span>AI agents ready</span>
          </div>
        </div>
      </div>
    </div>
  );
}
