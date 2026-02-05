import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
