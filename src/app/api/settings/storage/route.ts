import { NextRequest, NextResponse } from "next/server";
import { handleError, requireUserCtx, requirePlatformAdmin } from "@/lib/server/api";
import { writeConfig } from "@/lib/server/config";

export const dynamic = "force-dynamic";

/** POST — save storage driver config (local | oci). */
export async function POST(req: NextRequest) {
  try {
    requirePlatformAdmin(await requireUserCtx(req));
    const body = (await req.json()) as {
      driver?: "local" | "oci";
      oci?: Record<string, string>;
    };
    await writeConfig({
      storage: {
        driver: body.driver === "oci" ? "oci" : "local",
        ...(body.oci ? { oci: body.oci } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
