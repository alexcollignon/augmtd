import Image from 'next/image';
import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service — AUGMTD',
  description: 'Terms and conditions for using the AUGMTD platform.',
};

export default function TermsPage() {
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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
          <p className="text-sm text-gray-400 mb-10">Last updated: April 10, 2026</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-600 leading-relaxed">

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">1. Acceptance</h2>
              <p>
                By accessing or using AUGMTD (&quot;the Service&quot;) at <strong>app.augmtd.ai</strong>, you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">2. Description of service</h2>
              <p>
                AUGMTD is a personal AI platform that connects to your email and calendar accounts to help you manage your professional workload. The Service reads your inbox, generates suggested actions, drafts, and summaries, and helps you track and execute work.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">3. Account and access</h2>
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li>You must connect a valid Google or Microsoft account to use the Service.</li>
                <li>You are responsible for maintaining the security of your account and any activity that occurs under it.</li>
                <li>You must be at least 18 years old to use the Service.</li>
                <li>One account per person. You may not share your account with others.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">4. Acceptable use</h2>
              <p>You agree not to:</p>
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li>Use the Service for any unlawful purpose or in violation of any applicable laws.</li>
                <li>Attempt to reverse-engineer, decompile, or extract source code from the Service.</li>
                <li>Use the Service to process data belonging to third parties without their consent.</li>
                <li>Attempt to gain unauthorized access to other users&apos; data or systems.</li>
                <li>Use automated tools to scrape or overload the Service.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">5. AI-generated content</h2>
              <p>
                The Service uses AI to generate summaries, drafts, and suggested actions. You acknowledge that:
              </p>
              <ul className="list-disc pl-6 mt-3 space-y-2">
                <li>AI-generated content may contain errors or inaccuracies.</li>
                <li>You are solely responsible for reviewing and verifying any AI-generated output before acting on it.</li>
                <li>AUGMTD is not liable for decisions made based on AI-generated content.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">6. Your data</h2>
              <p>
                You retain ownership of all data you provide to the Service. By using the Service, you grant AUGMTD a limited, non-exclusive license to access and process your data solely for the purpose of delivering the Service to you. See our <Link href="/privacy" className="text-indigo-600 hover:underline">Privacy Policy</Link> for full details.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">7. Availability</h2>
              <p>
                We aim to keep the Service available at all times but do not guarantee uninterrupted access. We may perform maintenance, upgrades, or take the Service offline temporarily. We are not liable for any loss resulting from downtime.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">8. Termination</h2>
              <p>
                You may stop using the Service and delete your account at any time from the Settings page. We reserve the right to suspend or terminate your access if you violate these Terms, with or without notice. Upon termination, your data will be deleted in accordance with our Privacy Policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">9. Disclaimer of warranties</h2>
              <p>
                The Service is provided &quot;as is&quot; without warranties of any kind, express or implied. We do not warrant that the Service will meet your specific requirements or that AI outputs will be accurate, complete, or suitable for any particular purpose.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">10. Limitation of liability</h2>
              <p>
                To the maximum extent permitted by law, AUGMTD shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service, even if we have been advised of the possibility of such damages.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">11. Changes to these terms</h2>
              <p>
                We may update these Terms from time to time. We will notify you of material changes via email or in-app notice. Continued use of the Service after changes constitutes acceptance of the updated Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-3">12. Contact</h2>
              <p>
                For questions about these Terms, contact us at:{' '}
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
        <Link href="/privacy" className="hover:text-gray-600 transition-colors">Privacy Policy</Link>
        <span className="mx-3">·</span>
        <span>© 2026 AUGMTD</span>
      </footer>
    </div>
  );
}
