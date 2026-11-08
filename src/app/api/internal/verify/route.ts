import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/server/config";
import { handleError, ok, resolveAuthCtx } from "@/lib/server/api";
import { timingSafeEqual } from "@/lib/server/security";

export const dynamic = "force-dynamic";

/** POST — internal token verification for the realtime service. */
export async function POST(req: NextRequest) {
  try {
    const cfg = await readConfig();
    const secret = req.headers.get("x-dhara-internal") ?? "";
    if (!cfg || !secret || !timingSafeEqual(secret, cfg.internalSecret)) {
      return ok({ ok: false }, { status: 403 });
    }
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    if (!body.token) return NextResponse.json({ ok: false });
    const fakeReq = new Request("http://internal/", {
      headers: { authorization: `Bearer ${body.token}` },
    });
    const ctx = await resolveAuthCtx(fakeReq);
    return NextResponse.json({
      ok: ctx.kind !== "none",
      role: ctx.role,
      projectId: ctx.projectId,
      kind: ctx.kind,
    });
  } catch (e) {
    return handleError(e);
  }
}
