import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/server/config";
import { googleAuthUrl } from "@/lib/server/auth";
import { handleError, ok } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** GET — start Google OAuth flow (redirects to consent screen). */
export async function GET(req: NextRequest) {
  try {
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
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return NextResponse.redirect(googleAuthUrl(clientId, redirectUri, state));
  } catch (e) {
    return handleError(e);
  }
}
