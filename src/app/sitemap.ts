import type { MetadataRoute } from "next";
import { getPublicOrigin } from "@/lib/server/publicOrigin";

// SEO/AEO (v1.2.1): per-instance sitemap.xml. The only public page is the
// landing surface; everything else lives behind auth or under /api/.
// Absolute URLs are derived from request headers, so this is correct on any
// self-hosted domain without configuration.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getPublicOrigin();
  return [
    {
      url: `${base}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
