import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { readConfig } from "@/lib/server/config";
import { googleAuthUrl } from "@/lib/server/auth";
import { handleError, ok, rateLimitRequest } from "@/lib/server/api";
import { OAUTH_STATE_COOKIE } from "@/lib/server/cookies";

export const dynamic = "force-dynamic";

/** GET — start Google OAuth (security H6: crypto-random state in HttpOnly cookie). */
export async function GET(req: NextRequest) {
  try {
    // security (R5): this endpoint previously had no rate limit
    rateLimitRequest(req, "auth:oauth-start", 20);
    const cfg = await readConfig();
    const clientId = cfg?.oauth?.google?.clientId;
    const clientSecret = cfg?.oauth?.google?.clientSecret;
    if (!clientId || !clientSecret) {
      return ok(
        { error: "Google OAuth is not configured. Add Client ID + Secret in Settings → Auth." },
        { status: 400 }
      );
    }
    const origin = new URL(req.url).origin;
    const redirectUri = `${origin}/api/auth/oauth/google/callback`;
    // security (H6): unguessable state, stored in an HttpOnly cookie that the
    // callback compares — defeats login CSRF / state forgery.
    const state = crypto.randomBytes(16).toString("hex");
    const res = NextResponse.redirect(googleAuthUrl(clientId, redirectUri, state));
    res.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax", // must survive the Google redirect
      secure: (req.headers.get("x-forwarded-proto") ?? "http") === "https",
      path: "/api/auth/oauth/google",
      maxAge: 600,
    });
    return res;
  } catch (e) {
    return handleError(e);
  }
}
