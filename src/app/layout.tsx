import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

// SEO/AEO (v1.2.2): absolute-URL base for OpenGraph/Twitter/canonical tags.
// security (R4/R7): prefer the operator-pinned DHARA_PUBLIC_URL — request
// headers are never trusted here. Fallback: NEXT_PUBLIC_SITE_URL, then localhost.
const SITE_URL =
  process.env.DHARA_PUBLIC_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// AEO: self-hosted admin consoles are private by default — do not let search
// engines index them (they show a login page). Set DHARA_PUBLIC_SITE=1 on a
// public marketing instance to allow indexing.
const PUBLIC_SITE = process.env.DHARA_PUBLIC_SITE === "1";

const SEO_TITLE =
  "Dhara — Supabase + Firebase power on your free Oracle AI DB";
const SEO_DESCRIPTION =
  "Open-source Backend-as-a-Service: auto table creation, auth with JWT & API keys, RLS policies, realtime, webhooks, storage backend, SQL console and MCP server — powered by your free Oracle Autonomous AI DB.";

// SoftwareApplication structured data (JSON-LD) — rich results in Google and
// a machine-readable summary for answer engines (AEO).
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Dhara",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Linux, Docker",
  description: SEO_DESCRIPTION,
  url: SITE_URL,
  license: "https://opensource.org/licenses/Apache-2.0",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: {
    "@type": "Person",
    name: "himadrijunior",
    url: "https://github.com/himadrijunior",
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SEO_TITLE,
  description: SEO_DESCRIPTION,
  keywords: [
    "Dhara",
    "Supabase",
    "Firebase",
    "Oracle Autonomous Database",
    "Backend as a Service",
    "open source",
  ],
  applicationName: "Dhara",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Dhara",
    statusBarStyle: "black-translucent",
  },
  alternates: { canonical: "/" },
  robots: PUBLIC_SITE ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: "Dhara",
    title: SEO_TITLE,
    description: SEO_DESCRIPTION,
    url: "/",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "Dhara" }],
  },
  twitter: {
    card: "summary",
    title: SEO_TITLE,
    description: SEO_DESCRIPTION,
    images: ["/icon-512.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0D10",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className="antialiased bg-background text-foreground flex min-h-screen flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
