import { NextRequest, NextResponse } from "next/server";
import { storageGet, verifyLocalSignature } from "@/lib/server/storage";
import { handleError } from "@/lib/server/api";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

/** GET — signed download URL for local-driver objects. */
export async function GET(req: NextRequest, { params }: P) {
  try {
    const { id } = await params;
    const sp = new URL(req.url).searchParams;
    const bucket = sp.get("bucket") ?? "";
    const objPath = sp.get("path") ?? "";
    const exp = sp.get("exp") ?? "";
    const sig = sp.get("sig") ?? "";
    if (!bucket || !objPath) {
      return NextResponse.json({ error: "bucket and path required" }, { status: 400 });
    }
    if (!verifyLocalSignature(id, bucket, objPath, exp, sig)) {
      return NextResponse.json({ error: "Invalid or expired signature" }, { status: 403 });
    }
    const { data } = await storageGet(id, bucket, objPath);
    return new NextResponse(new Uint8Array(data), {
      headers: { "content-type": "application/octet-stream", "cache-control": "private, max-age=60" },
    });
  } catch (e) {
    return handleError(e);
  }
}
