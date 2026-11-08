/**
 * Dhara — server boot checks (Next.js instrumentation hook).
 * security (R2/R4): warn early when the proxy/origin environment is misconfigured.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const trustProxy = process.env.DHARA_TRUST_PROXY === "1";
  const publicUrl = process.env.DHARA_PUBLIC_URL?.trim();

  if (!trustProxy) {
    console.warn(
      "[dhara] DHARA_TRUST_PROXY is not set — every client shares one rate-limit " +
        "bucket ('local'). Run behind the bundled Caddy (docker-compose) or set " +
        "DHARA_TRUST_PROXY=1 to per-IP limit correctly."
    );
  }
  if (!publicUrl) {
    console.warn(
      "[dhara] DHARA_PUBLIC_URL is not set — robots.txt/sitemap.xml and email " +
        "action links will use forwarded headers only when DHARA_TRUST_PROXY=1, " +
        "else localhost. Set it to your public origin (R4/R7)."
    );
  }
  if (process.env.NODE_ENV === "production" && !process.env.DHARA_SETUP_TOKEN) {
    console.info(
      "[dhara] First-run setup token: auto-generating .dhara/setup-token (0600) " +
        "on first setup request and printing it once. Pin DHARA_SETUP_TOKEN to skip."
    );
  }
}
