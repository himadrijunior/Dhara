import { NextResponse } from "next/server";

/**
 * H7 — refresh-token cookie transport.
 *
 * The refresh token moves out of localStorage (readable by any XSS) into an
 * HttpOnly cookie scoped to /api/auth. The access token stays in memory only.
 * `secure` follows the request protocol so localhost HTTP still works.
 */

export const REFRESH_COOKIE = "dhara_refresh";
export const OAUTH_STATE_COOKIE = "dhara_oauth_state";

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

const BASE = {
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/api/auth",
};

export function setRefreshCookie(res: NextResponse, token: string, req: Request): void {
  res.cookies.set(REFRESH_COOKIE, token, {
    ...BASE,
    secure: isSecureRequest(req),
    maxAge: 30 * 24 * 3600, // mirrors session expiry
  });
}

export function clearRefreshCookie(res: NextResponse, req?: Request): void {
  res.cookies.set(REFRESH_COOKIE, "", {
    ...BASE,
    secure: req ? isSecureRequest(req) : true,
    maxAge: 0,
  });
}

/** Read the refresh token from cookie (preferred) or legacy JSON body field. */
export function refreshFromRequest(req: Request, body?: { refreshToken?: string }): string | null {
  const cookie = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  if (cookie) return decodeURIComponent(cookie.split("=").slice(1).join("=")) || null;
  return body?.refreshToken ?? null;
}
