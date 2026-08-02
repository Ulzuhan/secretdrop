import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules — must be external or Turbopack breaks them
  serverExternalPackages: ["crypto"],
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;