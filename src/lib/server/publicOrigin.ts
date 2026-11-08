import { headers } from "next/headers";

/**
 * Resolve the public origin (scheme + host) of this instance.
 *
 * security (R4): the request Host / X-Forwarded-Host headers are
 * client-controllable. Trusting them lets an attacker poison sitemap/robots
 * URLs behind a caching CDN — and would poison password-reset links once
 * email exists (reset-link poisoning). Rules, in order:
 *
 *  1. `DHARA_PUBLIC_URL` env (set by the operator) — the single source of
 *     truth. Recommended for every production deployment.
 *  2. Forwarded headers — honored ONLY when `DHARA_TRUST_PROXY=1` (the proxy
 *     overwrites these headers, so they are trustworthy behind our Caddy).
 *  3. Fallback `http://localhost:3000`.
 *
 * Never derived from an untrusted request header without TRUST_PROXY.
 */
export async function getPublicOrigin(): Promise<string> {
  const configured = process.env.DHARA_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  if (process.env.DHARA_TRUST_PROXY === "1") {
    const h = await headers();
    const host =
      h.get("x-forwarded-host")?.split(",")[0]?.trim() ||
      h.get("host") ||
      "localhost:3000";
    const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
    return `${proto}://${host}`;
  }

  return "http://localhost:3000";
}

/** Non-request variant for server-side code without a Request (jobs, mail). */
export function configuredPublicOrigin(): string | null {
  const configured = process.env.DHARA_PUBLIC_URL?.trim();
  return configured ? configured.replace(/\/+$/, "") : null;
}
