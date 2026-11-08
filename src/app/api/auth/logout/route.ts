import { NextRequest, NextResponse } from "next/server";
import { logout } from "@/lib/server/auth";
import { handleError, ok } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** POST — revoke session. Body: {refreshToken}. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { refreshToken?: string };
    await logout(body.refreshToken);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
