import { NextRequest, NextResponse } from "next/server";
import { logout } from "@/lib/server/auth";
import { handleError } from "@/lib/server/api";
import { clearRefreshCookie, refreshFromRequest } from "@/lib/server/cookies";

export const dynamic = "force-dynamic";

/** POST — revoke session (cookie or legacy body token) and clear the cookie. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { refreshToken?: string };
    await logout(refreshFromRequest(req, body) ?? undefined);
    const res = NextResponse.json({ ok: true });
    clearRefreshCookie(res, req);
    return res;
  } catch (e) {
    return handleError(e);
  }
}
