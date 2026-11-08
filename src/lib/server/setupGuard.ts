import { timingSafeEqual } from "node:crypto";
import { DharaError, isConfigured } from "./oracle";
import { requireUserCtx, requirePlatformAdmin } from "./api";

/**
 * Setup-surface guard — CWE-306, fail-closed (security audit finding C2).
 *
 * The old check was wrapped in a try/catch that swallowed non-DharaError
 * exceptions. When Oracle was unreachable, `countUsers()` threw a plain
 * error, the guard vanished, and ANY unauthenticated caller could overwrite
 * the Oracle credentials (proven exploitable on a stopped Always-Free DB).
 *
 * Rules now:
 *  - Configured instance  → platform admin required. If the DB is down the
 *    lookup throws and the request is rejected (fail-closed). Recovery path:
 *    `DHARA_SETUP_TOKEN` + HTTP, or edit `.dhara/config.json` on the host.
 *  - First run (unconfigured) → bootstrap allowed so the Setup Wizard works;
 *    if `DHARA_SETUP_TOKEN` is set, the `x-setup-token` header must match
 *    (timing-safe compare).
 */
export async function assertSetupAllowed(req: Request): Promise<void> {
  if (await isConfigured()) {
    const ctx = await requireUserCtx(req);
    requirePlatformAdmin(ctx);
    return;
  }
  const expected = process.env.DHARA_SETUP_TOKEN;
  if (expected) {
    const got = Buffer.from(req.headers.get("x-setup-token") ?? "");
    const want = Buffer.from(expected);
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      throw new DharaError("Setup token required (x-setup-token header)", 401, "setup_token");
    }
  }
}
