import { NextRequest, NextResponse } from "next/server";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, ok, rateLimitRequest } from "@/lib/server/api";
import { consumeOAuthCode, getUserById, issueTokens } from "@/lib/server/auth";
import { setRefreshCookie } from "@/lib/server/cookies";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/oauth/google/exchange {code} — swap the one-time OAuth login
 * code (H7) for real tokens. Refresh → HttpOnly cookie; access → body (memory).
 */
export async function POST(req: NextRequest) {
  try {
    rateLimitRequest(req, "auth:oauth-exchange", 20);
    await ensureConnection();
    const body = (await req.json()) as { code?: string };
    if (!body.code) return ok({ error: "code is required" }, { status: 400 });
    const userId = await consumeOAuthCode(body.code);
    if (!userId) {
      return ok({ error: "Login code expired or already used — sign in again", code: "code_invalid" }, { status: 400 });
    }
    const user = await getUserById(userId);
    if (!user) return ok({ error: "User not found" }, { status: 400 });
    // fresh session for this client (the callback session stays server-side)
    const { createSession } = await import("@/lib/server/auth");
    const { sessionId, refreshToken } = await createSession(
      user.ID,
      req.headers.get("user-agent") ?? undefined
    );
    const tokens = await issueTokens(user, sessionId, refreshToken);
    const res = NextResponse.json({ ok: true, accessToken: tokens.accessToken, user: tokens.user });
    setRefreshCookie(res, tokens.refreshToken, req);
    return res;
  } catch (e) {
    return handleError(e);
  }
}
