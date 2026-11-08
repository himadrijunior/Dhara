import { NextRequest, NextResponse } from "next/server";
import { listUsers, toPublicUser } from "@/lib/server/auth";
import { handleError, requireUserCtx, requirePlatformAdmin } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** GET — platform users (dashboard). */
export async function GET(req: NextRequest) {
  try {
    requirePlatformAdmin(await requireUserCtx(req));
    const users = await listUsers();
    return NextResponse.json({ users: users.map(toPublicUser) });
  } catch (e) {
    return handleError(e);
  }
}
