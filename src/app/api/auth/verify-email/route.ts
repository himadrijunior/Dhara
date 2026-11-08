import { NextRequest, NextResponse } from "next/server";
import { ensureConnection, isConfigured, q } from "@/lib/server/oracle";
import { handleError, ok, audit, rateLimitRequest } from "@/lib/server/api";
import { consumeEmailToken } from "@/lib/server/emailAuth";

export const dynamic = "force-dynamic";

/** POST /api/auth/verify-email {token} — confirm an email address. */
export async function POST(req: NextRequest) {
  try {
    rateLimitRequest(req, "auth:verify", 10);
    if (!(await isConfigured())) {
      return ok({ error: "Connect Oracle first", code: "not_configured" }, { status: 428 });
    }
    await ensureConnection();
    const body = (await req.json()) as { token?: string };
    if (!body.token) return ok({ error: "token is required" }, { status: 400 });
    const userId = await consumeEmailToken(body.token, "verify");
    if (!userId) {
      return ok({ error: "Invalid or expired verification link", code: "verify_invalid" }, { status: 400 });
    }
    await q(
      `UPDATE DHARA_USERS SET EMAIL_VERIFIED = 1, EMAIL_VERIFIED_AT = SYSTIMESTAMP WHERE ID = :id`,
      { id: userId }
    );
    await audit("auth.email_verified", { userId });
    return ok({ ok: true, message: "Email verified. Thank you!" });
  } catch (e) {
    return handleError(e);
  }
}
