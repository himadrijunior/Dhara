import { NextRequest, NextResponse } from "next/server";
import { login } from "@/lib/server/auth";
import { ensureConnection, isConfigured, q } from "@/lib/server/oracle";
import {
  handleError,
  ok,
  audit,
  rateLimitRequest,
  rateLimitAccount,
  clientIp,
  sanitizeIp,
} from "@/lib/server/api";
import { failureCount, recordFailure } from "@/lib/server/security";
import { DharaError } from "@/lib/server/oracle";
import { setRefreshCookie } from "@/lib/server/cookies";
import { securityAlertMail, sendMail } from "@/lib/server/mail";

export const dynamic = "force-dynamic";

// security (R2): the IP bucket counts FAILED logins only, so an attacker
// burning their own quota can never lock a legitimate user out. The
// per-account limiter (below) remains the primary brute-force defense.
const IP_FAIL_LIMIT = 20;
const IP_FAIL_WINDOW = 15 * 60_000;

/** POST — email+password login. Refresh token → HttpOnly cookie (H7). */
export async function POST(req: NextRequest) {
  try {
    // security: connection-flood protection (CWE-307) — counts attempts, not failures
    rateLimitRequest(req, "auth:login", 10);
    if (!(await isConfigured())) {
      return ok({ error: "Connect Oracle first", code: "not_configured" }, { status: 428 });
    }
    await ensureConnection();
    const body = (await req.json()) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return ok({ error: "email and password are required" }, { status: 400 });
    }
    const emailKey = body.email.toLowerCase().slice(0, 120);
    const ipFailKey = `fail:login:${clientIp(req)}`;
    if (failureCount(ipFailKey) >= IP_FAIL_LIMIT) {
      throw new DharaError("Too many failed attempts. Try again later.", 429, "rate_limited");
    }
    // security (C3): per-account brute-force limit — rotating X-Forwarded-For
    // no longer resets it, because it is keyed by the targeted account.
    rateLimitAccount(`login:${emailKey}`, 5);
    let tokens;
    try {
      tokens = await login(
        body.email,
        body.password,
        req.headers.get("user-agent") ?? undefined,
        // security (R5): store the sanitized proxy-aware IP, never the raw header
        sanitizeIp(clientIp(req)) ?? undefined
      );
    } catch (e) {
      recordFailure(ipFailKey, IP_FAIL_LIMIT, IP_FAIL_WINDOW);
      throw e;
    }
    await audit("auth.login", {
      req,
      userId: tokens.user.id,
      email: tokens.user.email,
      target: tokens.user.email,
    });
    // security alert (WS3 C5): first login from a NEW device/user-agent — async
    void (async () => {
      try {
        const ua = req.headers.get("user-agent") ?? "unknown";
        const r = await q(
          `SELECT COUNT(*) AS N FROM DHARA_SESSIONS WHERE USER_ID = :u AND USER_AGENT = :ua`,
          { u: tokens.user.id, ua: ua.slice(0, 380) }
        );
        if (Number((r.rows[0] as { N?: number } | undefined)?.N ?? 0) <= 1) {
          sendMail(
            securityAlertMail(tokens.user.email, [
              `New device sign-in detected (${ua.slice(0, 80)}). If this wasn't you, change your password immediately.`,
            ])
          );
        }
      } catch {
        /* best effort */
      }
    })();
    const res = NextResponse.json({
      ok: true,
      accessToken: tokens.accessToken,
      user: tokens.user,
      // refreshToken is delivered as an HttpOnly cookie (H7) — not in the body
    });
    setRefreshCookie(res, tokens.refreshToken, req);
    return res;
  } catch (e) {
    return handleError(e);
  }
}
