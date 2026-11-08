import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureConnection, isConfigured, q } from "@/lib/server/oracle";
import { handleError, ok, audit, requireUserCtx, requirePlatformAdmin, rateLimitRequest } from "@/lib/server/api";
import { inviteMail, sendMail } from "@/lib/server/mail";
import { getUserByEmail } from "@/lib/server/auth";
import { sha256Hex, uuid } from "@/lib/server/security";
import { actionLinkOrigin } from "@/lib/server/emailAuth";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/invite {email, role?} — admin-only (H5 invite-only signup).
 * Creates a 7-day single-use invite bound to the email (DHARA_INVITES) and
 * sends the invitation mail. The raw token is returned in the response so the
 * admin can also share it manually when no mail provider is configured yet.
 */
export async function POST(req: NextRequest) {
  try {
    rateLimitRequest(req, "auth:invite", 10);
    if (!(await isConfigured())) {
      return ok({ error: "Connect Oracle first", code: "not_configured" }, { status: 428 });
    }
    await ensureConnection();
    const ctx = await requireUserCtx(req);
    const admin = requirePlatformAdmin(ctx);
    const body = (await req.json()) as { email?: string; role?: string };
    const email = body.email?.toLowerCase().trim() ?? "";
    const role = body.role === "admin" ? "admin" : "member";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return ok({ error: "Valid email is required" }, { status: 400 });
    }
    const existing = await getUserByEmail(email);
    if (existing) return ok({ error: "That email already has an account" }, { status: 409 });

    const token = crypto.randomBytes(32).toString("base64url");
    await q(
      `INSERT INTO DHARA_INVITES (ID, EMAIL, TOKEN_HASH, ROLE, INVITED_BY, EXPIRES_AT)
       VALUES (:id, :email, :h, :role, :invby, SYSTIMESTAMP + NUMTODSINTERVAL(10080, 'minute'))`,
      { id: uuid(), email, h: sha256Hex(token), role, invby: admin.ID }
    );
    await audit("auth.invite", { req, userId: admin.ID, email, target: email, detail: { role } });

    const base = await actionLinkOrigin();
    const link = `${base}/#/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    sendMail(inviteMail(email, link, admin.EMAIL, role));
    return ok({ ok: true, inviteToken: token, link });
  } catch (e) {
    return handleError(e);
  }
}
