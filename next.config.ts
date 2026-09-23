import type { NextConfig } from "next";

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // RENDER SAFETY (Sep 22): 'unsafe-inline'/'unsafe-eval' stay for the Next runtime for now —
      // their removal (nonces) is planned; inbound mail no longer depends on this line (sandboxed frame).
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "media-src 'self' https://*.supabase.co",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.openai.com https://api.anthropic.com https://graph.microsoft.com https://login.microsoftonline.com https://*.googleapis.com https://accounts.google.com https://api.tavily.com https://nango.augmtd.ai wss://nango.augmtd.ai",
      // *.supabase.co: the attachment lightbox previews PDFs via <iframe> on short-lived signed
      // storage URLs (the media-src grant's sibling); without it CSP blanks every PDF preview.
      "frame-src 'self' https://accounts.google.com https://docs.google.com https://drive.google.com https://nango.augmtd.ai https://*.supabase.co",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // Keep Turbopack's mutable development manifests away from the production build output. Without
  // this, running `next dev` while a build/start process touches `.next` can race on app-path and
  // build manifests, producing intermittent ENOENT errors for files that are being regenerated.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['pdf-parse', 'mammoth', 'pdfjs-dist', 'canvas', 'pptxgenjs', 'xlsx', '@sparticuz/chromium', 'playwright-core'],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
