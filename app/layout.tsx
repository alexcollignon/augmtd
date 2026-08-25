import type { Metadata } from "next";
import "./globals.css";
import NextTopLoader from 'nextjs-toploader';
import { Toaster } from 'sonner';
import { RecordingProvider } from '@/context/recording-context';
// THE BACK AFFORDANCE'S ONE FACT — counts in-app soft navigations for this document. It lives in
// the ROOT layout, not (main): /inbox, /studio, /work, /workers and /meetings are their own trees,
// and a reader who came to a deep-dive from any of them has history a (main)-only tracker would
// not have counted (back would then wrongly fall back to a parent). Renders nothing.
import { NavHistoryTracker } from '@/components/ui/back-link';

export const metadata: Metadata = {
  title: "AUGMTD - Your Personal Digital Twin",
  description: "AI-powered work inbox that learns how you work",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <NextTopLoader
          color="#8B5CF6"
          height={3}
          showSpinner={false}
          shadow="0 0 10px #8B5CF6,0 0 5px #8B5CF6"
        />
        <NavHistoryTracker />
        <RecordingProvider>
          {children}
        </RecordingProvider>
        <Toaster position="bottom-left" richColors />
      </body>
    </html>
  );
}
