import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // node-oracledb must stay external (native/JS hybrid, not bundled)
  serverExternalPackages: ["oracledb", "bcryptjs"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  devIndicators: false,
};

export default nextConfig;
