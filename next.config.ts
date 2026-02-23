import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', 'mammoth', 'pdfjs-dist', 'pptxgenjs', 'xlsx'],
};

export default nextConfig;
