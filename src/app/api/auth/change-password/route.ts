import { NextRequest, NextResponse } from "next/server";
import { ensureConnection, isConfigured, q } from "@/lib/server/oracle";
import { handleError, ok, audit, rateLimitRequest, requireUserCtx } from "@/lib/server/api";
import { verifyPassword, hashPassword } from "@/lib/server/security";
import { revokeAllSessions } from "@/lib/server/auth";
import { passwordChangedNotice, securityAlertMail, sendMail } from "@/lib/server/mail";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/change-password {currentPassword, newPassword}
 *  - authenticated users only; verifies the current password first
 *  - policy: 12+ chars
 *  - revokes ALL sessions (user re-authenticates everywhere) and queues a
 *    security notice email (WS3 C5)
 */
export async function POST(req: NextRequest) {
  try {
    rateLimitRequest(req, "auth:chpw", 5);
    if (!(await isConfigured())) {
      return ok({ error: "Connect Oracle first", code: "not_configured" }, { status: 428 });
    }
    await ensureConnection();
    const ctx = await requireUserCtx(req);
    const body = (await req.json()) as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword) {
      return ok({ error: "currentPassword and newPassword are required" }, { status: 400 });
    }
    if (body.newPassword.length < 12) {
      return ok({ error: "Password must be at least 12 characters" }, { status: 400 });
    }
    const r = await q(`SELECT PASSWORD_HASH FROM DHARA_USERS WHERE ID = :id`, { id: ctx.user!.ID });
    const hash = (r.rows[0] as { PASSWORD_HASH?: string } | undefined)?.PASSWORD_HASH ?? null;
    if (!hash) {
      return ok({ error: "This account signs in with Google — no password to change" }, { status: 400 });
    }
    if (!(await verifyPassword(body.currentPassword, hash))) {
      return ok({ error: "Current password is incorrect" }, { status: 400 });
    }
    if (await verifyPassword(body.newPassword, hash)) {
      return ok({ error: "New password must differ from the current one" }, { status: 400 });
    }
    await q(`UPDATE DHARA_USERS SET PASSWORD_HASH = :h WHERE ID = :id`, {
      id: ctx.user!.ID,
      h: await hashPassword(body.newPassword),
    });
    await revokeAllSessions(ctx.user!.ID);
    await audit("auth.password_changed", {
      req,
      userId: ctx.user!.ID,
      email: ctx.user!.EMAIL,
      target: ctx.user!.EMAIL,
    });
    sendMail(passwordChangedNotice(ctx.user!.EMAIL));
    sendMail(
      securityAlertMail(ctx.user!.EMAIL, [
        "Your Dhara password was changed from the dashboard. All sessions were signed out.",
      ])
    );
    return ok({
      ok: true,
      message: "Password changed. All sessions were signed out — please sign in again.",
    });
  } catch (e) {
    return handleError(e);
  }
}
