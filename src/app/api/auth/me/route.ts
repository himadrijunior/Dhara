import { NextRequest, NextResponse } from "next/server";
import { userFromRequest, toPublicUser } from "@/lib/server/auth";
import { handleError } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** GET — current session user. */
export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ user: null }, { status: 401 });
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (e) {
    return handleError(e);
  }
}
