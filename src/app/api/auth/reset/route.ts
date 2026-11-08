import { NextRequest, NextResponse } from "next/server";
import { ensureConnection, isConfigured, q } from "@/lib/server/oracle";
import { handleError, ok, audit, rateLimitRequest } from "@/lib/server/api";
import { consumeEmailToken } from "@/lib/server/emailAuth";
import { hashPassword, verifyPassword } from "@/lib/server/security";
import { revokeAllSessions } from "@/lib/server/auth";
import { passwordChangedNotice, sendMail } from "@/lib/server/mail";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/reset {token, newPassword} — complete password reset.
 *  - token verified by SHA-256 hash, single-use, 30-min TTL
 *  - password policy: 12+ chars (stricter than signup, per WS3 spec)
 *  - ALL sessions revoked; a "password changed" notice email is queued
 */
export async function POST(req: NextRequest) {
  try {
    rateLimitRequest(req, "auth:reset", 10);
    if (!(await isConfigured())) {
      return ok({ error: "Connect Oracle first", code: "not_configured" }, { status: 428 });
    }
    await ensureConnection();
    const body = (await req.json()) as { token?: string; newPassword?: string };
    if (!body.token || !body.newPassword) {
      return ok({ error: "token and newPassword are required" }, { status: 400 });
    }
    if (body.newPassword.length < 12) {
      return ok({ error: "Password must be at least 12 characters" }, { status: 400 });
    }
    const userId = await consumeEmailToken(body.token, "reset");
    if (!userId) {
      return ok(
        { error: "Invalid or expired reset link. Request a new one.", code: "reset_invalid" },
        { status: 400 }
      );
    }

    const r = await q(`SELECT EMAIL, PASSWORD_HASH FROM DHARA_USERS WHERE ID = :id`, { id: userId });
    const row = r.rows[0] as { EMAIL: string; PASSWORD_HASH?: string } | undefined;
    if (!row) return ok({ error: "Account no longer exists" }, { status: 400 });
    if (row.PASSWORD_HASH && (await verifyPassword(body.newPassword, row.PASSWORD_HASH))) {
      return ok({ error: "New password must differ from the current one" }, { status: 400 });
    }

    await q(`UPDATE DHARA_USERS SET PASSWORD_HASH = :h WHERE ID = :id`, {
      id: userId,
      h: await hashPassword(body.newPassword),
    });
    await revokeAllSessions(userId);
    await audit("auth.reset_completed", { userId, email: row.EMAIL, target: row.EMAIL });
    sendMail(passwordChangedNotice(row.EMAIL));
    return ok({ ok: true, message: "Password updated. Please sign in with your new password." });
  } catch (e) {
    return handleError(e);
  }
}
