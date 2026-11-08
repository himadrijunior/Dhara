import { NextRequest, NextResponse } from "next/server";
import { q, ensureConnection } from "@/lib/server/oracle";
import { handleError, requireUserCtx, requirePlatformAdmin } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** GET — recent audit log entries (?limit=50). */
export async function GET(req: NextRequest) {
  try {
    requirePlatformAdmin(await requireUserCtx(req));
    await ensureConnection();
    const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 50), 200);
    const r = await q(
      `SELECT ID, USER_ID, EMAIL, ACTION, TARGET, PROJECT_ID, IP, AT
       FROM DHARA_AUDIT ORDER BY AT DESC FETCH FIRST :n ROWS ONLY`,
      { n: limit }
    );
    return NextResponse.json({ audit: r.rows });
  } catch (e) {
    return handleError(e);
  }
}
