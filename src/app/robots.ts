import type { MetadataRoute } from "next";
import { getPublicOrigin } from "@/lib/server/publicOrigin";

// SEO/AEO (v1.2.2): dynamic, host-aware robots.txt served per instance.
//
// AEO default (report finding): a self-hosted instance is a PRIVATE admin
// console — indexing it only puts a login page in search results. So the
// default is "do not crawl at all". Set DHARA_PUBLIC_SITE=1 on an instance
// you want search & answer engines to read; then "/" is open (search bots +
// AI crawlers) and /api/ stays closed.
//
// security (R4): the origin comes from DHARA_PUBLIC_URL / trusted proxy only.

const PUBLIC_SITE = process.env.DHARA_PUBLIC_SITE === "1";

const SEARCH_BOTS = [
  "Googlebot",
  "Bingbot",
  "DuckDuckBot",
  "YandexBot",
  "Applebot",
];

// Answer-engine crawlers (AEO): AI systems may read the public surface so
// Dhara can be cited and quoted — never the API surface.
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

export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!PUBLIC_SITE) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
    };
  }
  const base = await getPublicOrigin();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/"] },
      { userAgent: SEARCH_BOTS, allow: "/", disallow: ["/api/"] },
      { userAgent: AI_BOTS, allow: "/", disallow: ["/api/"] },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
