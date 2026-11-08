import { NextRequest, NextResponse } from "next/server";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, requireUserCtx, trackUsage, getUsage } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** POST — track a feature usage event (AI navigation). Body: {feature}. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const body = (await req.json().catch(() => ({}))) as { feature?: string };
    if (body.feature && /^[a-z0-9._-]{1,80}$/i.test(body.feature)) {
      await trackUsage(ctx.user!.ID, body.feature);
    }
    return NextResponse.json({ ok: true });
  } catch {
    // usage tracking must never break the UI
    return NextResponse.json({ ok: false });
  }
}

/** GET — aggregated usage (drives auto-nav ordering). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const usage = await getUsage(ctx.user!.ID);
    return NextResponse.json({ usage });
  } catch (e) {
    return handleError(e);
  }
}
