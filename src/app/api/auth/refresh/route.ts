import { NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@/lib/server/auth";
import { handleError, ok } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** POST — rotate refresh token. Body: {refreshToken}. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { refreshToken?: string };
    if (!body.refreshToken) return ok({ error: "refreshToken required" }, { status: 400 });
    const tokens = await refreshSession(
      body.refreshToken,
      req.headers.get("user-agent") ?? undefined,
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    );
    return NextResponse.json({ ok: true, ...tokens });
  } catch (e) {
    return handleError(e);
  }
}
