import { headers } from "next/headers";

/**
 * Resolve the public origin (scheme + host) of this instance from
 * proxy-aware request headers. Used by the SEO metadata routes
 * (robots.ts, sitemap.ts) so a self-hosted instance emits correct
 * absolute URLs on whatever domain it is deployed to — no config needed.
 *
 * Behind the hardened Caddyfile the proxy forwards the real Host and
 * X-Forwarded-Proto; direct access falls back to the Host header.
 */
export async function getPublicOrigin(): Promise<string> {
  const h = await headers();
  const host =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    h.get("host") ||
    "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  return `${proto}://${host}`;
}
