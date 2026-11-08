import { NextRequest, NextResponse } from "next/server";
import { ensureConnection, isConfigured, q } from "@/lib/server/oracle";
import { handleError, ok, audit, rateLimitRequest, clientIp, sanitizeIp } from "@/lib/server/api";
import { getUserByEmail } from "@/lib/server/auth";
import { createEmailToken, actionLinkOrigin } from "@/lib/server/emailAuth";
import { resetPasswordMail, sendMail } from "@/lib/server/mail";
import { rateLimit } from "@/lib/server/security";

export const dynamic = "force-dynamic";

/** Enumeration-proof generic answer — identical for existing and unknown emails. */
const GENERIC =
  "If that email is registered, a password-reset link has been sent. Check your inbox (and spam folder).";

/**
 * POST /api/auth/forgot {email} — start password reset.
 *  - rate limited per IP (3/h via shared bucket) AND per email (3/h)  (WS3 spec)
 *  - ALWAYS the same response body, even when mail is not configured
 *  - the reset link is built from DHARA_PUBLIC_URL only (R4 — never Host header)
 */
export async function POST(req: NextRequest) {
  try {
    rateLimitRequest(req, "auth:forgot", 3, { localMultiplier: 4 });
    if (!(await isConfigured())) {
      return ok({ error: "Connect Oracle first", code: "not_configured" }, { status: 428 });
    }
    await ensureConnection();
    const body = (await req.json()) as { email?: string };
    const email = body.email?.toLowerCase().trim() ?? "";
    if (!email) return ok({ error: "email is required" }, { status: 400 });

    // per-email limiter (independent of IP — protects one mailbox from bombing)
    const emailRes = rateLimit(`forgot:acct:${email}`, 3, 60 * 60_000);
    if (!emailRes.ok) return ok({ ok: true, message: GENERIC });

    const user = await getUserByEmail(email);
    await audit("auth.reset_requested", { req, email, target: email });
    if (!user) {
      return ok({ ok: true, message: GENERIC });
    }

    // Google-only account (no local password) → mail explains, no reset token
    const hasPassword = await q(`SELECT PASSWORD_HASH FROM DHARA_USERS WHERE ID = :id`, {
      id: user.ID,
    });
    if (!hasPassword.rows[0]?.PASSWORD_HASH) {
      sendMail({
        to: user.EMAIL,
        subject: "Reset your Dhara password",
        html: '<p style="font-size:14px">This account signs in with <b>Google</b>. Use the "Continue with Google" button on the Dhara sign-in page — there is no password to reset.</p>',
        text: "This account signs in with Google. Use the 'Continue with Google' button on the Dhara sign-in page — there is no password to reset.",
      });
      return ok({ ok: true, message: GENERIC });
    }

    const { token, minutes } = await createEmailToken(user.ID, "reset", 30);
    const base = await actionLinkOrigin();
    const link = `${base}/#/reset?token=${encodeURIComponent(token)}`;
    sendMail(resetPasswordMail(user.EMAIL, link, minutes));
    void sanitizeIp(clientIp(req)); // sanitized IP available for audit extensions
    return ok({ ok: true, message: GENERIC });
  } catch (e) {
    return handleError(e);
  }
}
