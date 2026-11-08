import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Dhara — Supabase + Firebase power on your free Oracle AI DB",
  description:
    "Open-source Backend-as-a-Service: auto table creation, auth with JWT & API keys, RLS policies, realtime, webhooks, storage backend, SQL console and MCP server — powered by your free Oracle Autonomous AI DB.",
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
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
