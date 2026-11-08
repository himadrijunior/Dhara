import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// security (M11): baseline hardening headers. 'unsafe-inline' for scripts is
// required by the Next.js hydration bootstrap until a nonce-based CSP is
// wired; dev additionally needs 'unsafe-eval' (Turbopack HMR).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  // node-oracledb must stay external (native/JS hybrid, not bundled)
  serverExternalPackages: ["oracledb", "bcryptjs"],
  // security (H9): type errors must fail the build — tsc is currently clean
  typescript: { ignoreBuildErrors: false },
  reactStrictMode: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Frame-Options", value: "DENY" },
          // HSTS only makes sense once TLS terminates; harmless on localhost
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
