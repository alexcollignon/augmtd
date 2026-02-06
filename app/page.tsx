import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-primary-50 to-white">
      <div className="text-center space-y-8">
        <h1 className="text-6xl font-bold text-primary-600">
          AUGMTD
        </h1>
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

        <div className="mt-12 text-sm text-gray-500">
          <p>✅ Database connected</p>
          <p>✅ Authentication ready</p>
          <p>✅ AI agents ready</p>
        </div>
      </div>
    </div>
  );
}
