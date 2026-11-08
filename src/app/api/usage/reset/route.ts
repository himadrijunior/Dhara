import { NextRequest, NextResponse } from "next/server";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, requireUserCtx, trackUsage } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** POST — acknowledge usage reset (client clears local state too). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    void trackUsage(ctx.user!.ID, "usage.reset");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
