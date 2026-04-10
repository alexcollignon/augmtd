import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy — AUGMTD',
  description: 'How AUGMTD collects, uses, and protects your personal data.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50/30 via-white to-gray-50 overflow-y-auto" style={{ height: '100vh' }}>
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link href="/login" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Image src="/augmtd-logo.png" alt="AUGMTD" width={32} height={32} className="w-8 h-8" />
            <span className="font-semibold text-gray-900 text-lg">augmtd</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-8 md:p-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-sm text-gray-400 mb-10">Last updated: April 10, 2026</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-600 leading-relaxed">

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">1. Who we are</h2>
              <p>
                AUGMTD (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) is a personal AI platform that helps professionals manage their work inbox, communications, and workflows. Our service is accessible at <strong>app.augmtd.ai</strong>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">2. What data we collect</h2>
              <p>When you connect your accounts to AUGMTD, we may collect:</p>
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li><strong>Account information:</strong> your name, email address, and profile picture from Google or Microsoft.</li>
                <li><strong>Email data:</strong> email metadata (sender, recipients, subject, timestamps) and email content from your connected Gmail or Outlook inbox, to the extent necessary to provide the service.</li>
                <li><strong>Calendar data:</strong> calendar events and attendee information from your connected Google or Microsoft calendar.</li>
                <li><strong>File data:</strong> files you explicitly share with AUGMTD via Google Drive or OneDrive.</li>
                <li><strong>Usage data:</strong> how you interact with the product (actions taken, features used), for the purpose of improving the service.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">3. How we use your data</h2>
              <p>We use the data we collect to:</p>
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li>Provide and operate the AUGMTD service, including AI-powered analysis of your inbox and calendar.</li>
                <li>Generate work summaries, suggested actions, and drafts on your behalf.</li>
                <li>Improve the relevance and accuracy of AI outputs over time, based on your feedback and usage patterns.</li>
                <li>Send you transactional notifications related to the service (e.g., sync errors, connection issues).</li>
              </ul>
              <p className="mt-3">We do <strong>not</strong> sell your personal data to third parties. We do not use your data to train general-purpose AI models shared with other customers.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">4. Google and Microsoft data</h2>
              <p>
                AUGMTD&apos;s use of data obtained from Google APIs complies with the{' '}
                <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements. Data obtained from Google or Microsoft APIs is used solely to provide and improve the features visible to the authenticated user — it is not transferred to third parties for advertising or other unrelated purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">5. Data storage and security</h2>
              <p>
                Your data is stored securely using Supabase (PostgreSQL), hosted on infrastructure within the European Union. Access is protected by row-level security policies, encrypted connections (TLS), and strict authentication controls. OAuth tokens are encrypted at rest.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">6. Data retention</h2>
              <p>
                We retain your data for as long as your account is active. When you delete your account, all personal data — including emails, calendar events, and AI-generated content — is permanently deleted within 30 days. You can request deletion at any time by contacting us.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">7. Your rights</h2>
              <p>You have the right to:</p>
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li>Access the personal data we hold about you.</li>
                <li>Request correction or deletion of your data.</li>
                <li>Disconnect your Google or Microsoft account at any time from the Settings page.</li>
                <li>Export your data upon request.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">8. Third-party services</h2>
              <p>AUGMTD uses the following sub-processors to deliver the service:</p>
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li><strong>Supabase</strong> — database and authentication</li>
                <li><strong>Vercel</strong> — application hosting</li>
                <li><strong>OpenAI / Anthropic</strong> — AI language model processing</li>
                <li><strong>Amazon Web Services</strong> — AI model processing (EU region)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">9. Changes to this policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify you of significant changes by email or via an in-app notice. Continued use of the service after changes constitutes your acceptance.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">10. Contact</h2>
              <p>
                For any privacy-related questions or requests, contact us at:{' '}
                <a href="mailto:alextcollignon@gmail.com" className="text-indigo-600 hover:underline">
                  alextcollignon@gmail.com
                </a>
              </p>
            </section>

          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-8 text-sm text-gray-400">
        <Link href="/terms" className="hover:text-gray-600 transition-colors">Terms of Service</Link>
        <span className="mx-3">·</span>
        <span>© 2026 AUGMTD</span>
      </footer>
    </div>
  );
}
