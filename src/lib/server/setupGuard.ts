import { DharaError, isConfigured } from "./oracle";
import { requireUserCtx, requirePlatformAdmin } from "./api";
import { verifySetupToken } from "./setupToken";

/**
 * Setup-surface guard — CWE-306, fail-closed (security audit findings C2+R3).
 *
 * Rules:
 *  - Configured instance  → platform admin required. If the DB is down the
 *    lookup throws and the request is rejected (fail-closed). Recovery path:
 *    edit `.dhara/config.json` on the host, or set DHARA_SETUP_TOKEN.
 *  - First run (unconfigured) → bootstrap requires the setup token (R3):
 *    either the pinned `DHARA_SETUP_TOKEN` env or the auto-generated
 *    `.dhara/setup-token` file (printed once to the server log on boot).
 *    Without this, anyone reaching a fresh instance could run setup.
 */
export async function assertSetupAllowed(req: Request): Promise<void> {
  if (await isConfigured()) {
    const ctx = await requireUserCtx(req);
    requirePlatformAdmin(ctx);
    return;
  }
  const presented = req.headers.get("x-setup-token");
  if (!(await verifySetupToken(presented))) {
    throw new DharaError(
      "Setup token required (x-setup-token header) — see the server log for the first-run token",
      401,
      "setup_token"
    );
  }
}
