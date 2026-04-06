import type { Metadata } from "next";
import "./globals.css";
import NextTopLoader from 'nextjs-toploader';
import { Toaster } from 'sonner';
import { RecordingProvider } from '@/context/recording-context';

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
        <RecordingProvider>
          {children}
        </RecordingProvider>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
