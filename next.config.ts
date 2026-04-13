import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  serverExternalPackages: ['pdf-parse', 'mammoth', 'pdfjs-dist', 'canvas', 'pptxgenjs', 'xlsx'],
};

export default nextConfig;
