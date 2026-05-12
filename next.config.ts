import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  serverExternalPackages: ['pdf-parse', 'mammoth', 'pdfjs-dist', 'canvas', 'pptxgenjs', 'xlsx', '@sparticuz/chromium', 'playwright-core'],
};

export default nextConfig;
