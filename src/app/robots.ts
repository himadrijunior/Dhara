import type { MetadataRoute } from "next";
import { getPublicOrigin } from "@/lib/server/publicOrigin";

// SEO/AEO (v1.2.1): dynamic, host-aware robots.txt served per instance.
// - Public pages ("/") are open to search engines and AI answer engines.
// - The entire /api/ surface (auth, data API, MCP, setup, wallet) stays out
//   of every crawler: it holds no content worth indexing and must not leak
//   endpoint URLs into search caches.
// - The sitemap URL is absolute and derived from the request host, so it is
//   correct on any self-hosted domain without configuration.

const SEARCH_BOTS = [
  "Googlebot",
  "Bingbot",
  "DuckDuckBot",
  "YandexBot",
  "Applebot",
];

// Answer-engine crawlers (AEO): AI systems are welcome to read the public
// surface so Dhara can be cited and quoted, but never the API surface.
const AI_BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
  "CCBot",
];

const RULES: MetadataRoute.Robots["rules"] = [
  { userAgent: "*", allow: "/", disallow: ["/api/"] },
  { userAgent: SEARCH_BOTS, allow: "/", disallow: ["/api/"] },
  { userAgent: AI_BOTS, allow: "/", disallow: ["/api/"] },
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getPublicOrigin();
  return {
    rules: RULES,
    sitemap: `${base}/sitemap.xml`,
  };
}
