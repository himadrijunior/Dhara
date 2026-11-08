import { NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@/lib/server/auth";
import { handleError, rateLimitRequest, clientIp, sanitizeIp } from "@/lib/server/api";
import { setRefreshCookie, clearRefreshCookie, refreshFromRequest } from "@/lib/server/cookies";

export const dynamic = "force-dynamic";

/**
 * POST — rotate refresh token (M13: one-time use + family reuse detection).
 * Token comes from the HttpOnly cookie (H7); the legacy JSON body field is
 * still accepted so tabs open across a deploy can complete one rotation.
 */
export async function POST(req: NextRequest) {
  try {
    // security (R5): this endpoint previously had NO rate limit
    rateLimitRequest(req, "auth:refresh", 30);
    const body = (await req.json().catch(() => ({}))) as { refreshToken?: string };
    const token = refreshFromRequest(req, body);
    if (!token) {
      return NextResponse.json({ error: "refreshToken required" }, { status: 400 });
    }
    const tokens = await refreshSession(
      token,
      req.headers.get("user-agent") ?? undefined,
      sanitizeIp(clientIp(req)) ?? undefined
    );
    const res = NextResponse.json({
      ok: true,
      accessToken: tokens.accessToken,
      user: tokens.user,
    });
    setRefreshCookie(res, tokens.refreshToken, req);
    return res;
  } catch (e) {
    const res = handleError(e);
    // dead refresh token → clear the cookie so the client stops retrying
    if (res.status === 401) clearRefreshCookie(res, req);
    return res;
  }
}
