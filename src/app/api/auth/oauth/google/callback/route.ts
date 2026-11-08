import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/server/config";
import { googleExchange, googleProfile, upsertOAuthUser } from "@/lib/server/auth";
import { handleError, audit } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** GET — Google OAuth callback: exchange code, upsert user, redirect tokens to SPA. */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const origin = url.origin;
    if (!code) {
      return NextResponse.redirect(`${origin}/?auth_error=missing_code`);
    }
    const cfg = await readConfig();
    const clientId = cfg?.oauth?.google?.clientId;
    const clientSecret = cfg?.oauth?.google?.clientSecret;
    if (!clientId || !clientSecret) {
      return NextResponse.redirect(`${origin}/?auth_error=oauth_not_configured`);
    }
    const accessToken = await googleExchange(clientId, clientSecret, code, `${origin}/api/auth/oauth/google/callback`);
    const profile = await googleProfile(accessToken);
    if (!profile.email) {
      return NextResponse.redirect(`${origin}/?auth_error=no_email`);
    }
    const user = await upsertOAuthUser("google", profile);
    const { login } = await import("@/lib/server/auth");
    // create a session without password check
    const { createSession, issueTokens } = await import("@/lib/server/auth");
    const { sessionId, refreshToken } = await createSession(
      user.ID,
      req.headers.get("user-agent") ?? "oauth",
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    );
    const tokens = await issueTokens(user, sessionId, refreshToken);
    await audit("auth.oauth", { req, userId: user.ID, email: user.EMAIL, target: `google:${profile.sub}` });
    const params = new URLSearchParams({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    return NextResponse.redirect(`${origin}/#/oauth?${params.toString()}`);
  } catch (e) {
    const origin = new URL(req.url).origin;
    const msg = e instanceof Error ? e.message : "oauth_failed";
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(msg.slice(0, 120))}`);
  }
}
