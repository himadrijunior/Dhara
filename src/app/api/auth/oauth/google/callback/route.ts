import { NextRequest, NextResponse } from "next/server";
import {
  googleExchange,
  googleProfile,
  upsertOAuthUser,
  createSession,
  issueTokens,
  createOAuthCode,
} from "@/lib/server/auth";
import { readConfig } from "@/lib/server/config";
import { handleError, audit, clientIp, sanitizeIp } from "@/lib/server/api";
import { timingSafeEqual } from "@/lib/server/security";
import { OAUTH_STATE_COOKIE } from "@/lib/server/cookies";

export const dynamic = "force-dynamic";

/**
 * GET — Google OAuth callback.
 *  security (H6): state cookie must match the `state` query param (timing-safe),
 *  and the Google account's email must be email_verified=true.
 *  security (H7): tokens are NOT put in the fragment — the SPA receives a
 *  single-use 60-second code and exchanges it at /api/auth/oauth/google/exchange.
 */
export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(`${origin}/?${new URLSearchParams(params).toString()}`);
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null;
    if (!code) return back({ auth_error: "missing_code" });
    if (
      !state ||
      !cookieState ||
      (() => {
        const a = Buffer.from(state);
        const b = Buffer.from(cookieState);
        if (a.length !== b.length) return true;
        return !timingSafeEqual(a.toString("hex"), b.toString("hex"));
      })()
    ) {
      return back({ auth_error: "state_mismatch" });
    }

    const cfg = await readConfig();
    const clientId = cfg?.oauth?.google?.clientId;
    const clientSecret = cfg?.oauth?.google?.clientSecret;
    if (!clientId || !clientSecret) return back({ auth_error: "oauth_not_configured" });

    const accessToken = await googleExchange(
      clientId,
      clientSecret,
      code,
      `${origin}/api/auth/oauth/google/callback`
    );
    const profile = await googleProfile(accessToken);
    if (!profile.email) return back({ auth_error: "no_email" });
    if (profile.email_verified !== true) return back({ auth_error: "email_not_verified" });

    const user = await upsertOAuthUser("google", profile);
    const { sessionId, refreshToken } = await createSession(
      user.ID,
      req.headers.get("user-agent") ?? "oauth",
      sanitizeIp(clientIp(req)) ?? undefined
    );
    const tokens = await issueTokens(user, sessionId, refreshToken);
    const loginCode = await createOAuthCode(user.ID);
    await audit("auth.oauth", {
      req,
      userId: user.ID,
      email: user.EMAIL,
      target: `google:${profile.sub}`,
    });

    const res = NextResponse.redirect(`${origin}/#/oauth?code=${encodeURIComponent(loginCode)}`);
    // refresh token rides the secure cookie from the very first login (H7)
    res.cookies.set("dhara_refresh", tokens.refreshToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: (req.headers.get("x-forwarded-proto") ?? "http") === "https",
      path: "/api/auth",
      maxAge: 30 * 24 * 3600,
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "oauth_failed";
    return back({ auth_error: encodeURIComponent(msg.slice(0, 120)) });
  }
}
