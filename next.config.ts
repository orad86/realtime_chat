import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable trailing slash for better compatibility
  trailingSlash: true,
  // Transpile local symlinked package
  transpilePackages: ['@orad86/ai-aero-tools'],
};

export default nextConfig;
