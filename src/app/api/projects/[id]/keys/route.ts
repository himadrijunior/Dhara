import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/server/oracle";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, ok, requireProjectAccess, audit } from "@/lib/server/api";
import { randomToken, sha256Hex, uuid } from "@/lib/server/security";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

/** GET — API keys (masked: only prefix + metadata). */
export async function GET(req: NextRequest, { params }: P) {
  try {
    await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const r = await q(
      `SELECT ID, KIND, PREFIX, CREATED_AT, LAST_USED_AT FROM DHARA_API_KEYS WHERE PROJECT_ID = :p ORDER BY CREATED_AT`,
      { p: id }
    );
    return NextResponse.json({ keys: r.rows });
  } catch (e) {
    return handleError(e);
  }
}

/** POST — (re)generate keys. Body: {kind: "pub" | "sec"}. Returns the full key ONCE. */
export async function POST(req: NextRequest, { params }: P) {
  try {
    const { user } = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const body = (await req.json()) as { kind?: string };
    const kind = body.kind === "sec" ? "sec" : "pub";
    const prefix = kind === "pub" ? "dh_pub_" : "dh_sec_";
    const key = randomToken(prefix);
    await q(`DELETE FROM DHARA_API_KEYS WHERE PROJECT_ID = :p AND KIND = :k`, { p: id, k: kind });
    await q(
      `INSERT INTO DHARA_API_KEYS (ID, PROJECT_ID, KIND, KEY_HASH, PREFIX) VALUES (:id, :p, :k, :h, :pf)`,
      { id: uuid(), p: id, k: kind, h: sha256Hex(key), pf: prefix }
    );
    await audit(`key.${kind}.regenerate`, {
      req,
      userId: user.ID,
      email: user.EMAIL,
      target: kind,
      projectId: id,
    });
    return NextResponse.json({ ok: true, kind, key, note: "Store it safely — shown only once." });
  } catch (e) {
    return handleError(e);
  }
}
