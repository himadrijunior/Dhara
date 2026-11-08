import { NextRequest, NextResponse } from "next/server";
import { q, ensureConnection } from "@/lib/server/oracle";
import { handleError, ok, requireUserCtx, audit } from "@/lib/server/api";
import { randomToken, sha256Hex, uuid, PAT_SCOPES, expandScopes } from "@/lib/server/security";

export const dynamic = "force-dynamic";

/** GET — list PATs (masked). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const r = await q(
      `SELECT ID, NAME, PREFIX, SCOPE_MODE, SCOPES, EXPIRES_AT, CREATED_AT, LAST_USED_AT, REVOKED
       FROM DHARA_PATS WHERE USER_ID = :u ORDER BY CREATED_AT DESC`,
      { u: ctx.user!.ID }
    );
    return NextResponse.json({ pats: r.rows });
  } catch (e) {
    return handleError(e);
  }
}

/** POST — create PAT. Body: {name, mode: full|read_only|specific, scopes?, expiresInDays?}. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const body = (await req.json()) as {
      name?: string;
      mode?: "full" | "read_only" | "specific";
      scopes?: string[];
      expiresInDays?: number;
    };
    if (!body.name?.trim()) return ok({ error: "name is required" }, { status: 400 });
    const mode = ["full", "read_only", "specific"].includes(body.mode ?? "") ? body.mode! : "full";
    const scopes = expandScopes(mode, body.scopes ?? []);
    if (mode === "specific" && scopes.length === 0) {
      return ok({ error: "Select at least one scope" }, { status: 400 });
    }
    const token = randomToken("dh_pat_");
    const id = uuid();
    const expires =
      body.expiresInDays && body.expiresInDays > 0
        ? new Date(Date.now() + body.expiresInDays * 86400_000)
        : null;
    await q(
      `INSERT INTO DHARA_PATS (ID, USER_ID, NAME, KEY_HASH, PREFIX, SCOPE_MODE, SCOPES, EXPIRES_AT)
       VALUES (:id, :u, :n, :h, :pf, :m, :s, :e)`,
      {
        id,
        u: ctx.user!.ID,
        n: body.name.trim().slice(0, 120),
        h: sha256Hex(token),
        pf: "dh_pat_",
        m: mode,
        s: JSON.stringify(scopes).slice(0, 600),
        e: expires,
      }
    );
    await audit("pat.create", {
      req,
      userId: ctx.user!.ID,
      email: ctx.user!.EMAIL,
      target: body.name.trim(),
      detail: { mode, scopes },
    });
    return NextResponse.json({
      ok: true,
      id,
      token,
      scopes,
      availableScopes: [...PAT_SCOPES],
      note: "Copy this token now — it will never be shown again.",
    });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE — revoke PAT. ?id= */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const id = new URL(req.url).searchParams.get("id") ?? "";
    await q(`UPDATE DHARA_PATS SET REVOKED = 1 WHERE ID = :id AND USER_ID = :u`, {
      id,
      u: ctx.user!.ID,
    });
    await audit("pat.revoke", { req, userId: ctx.user!.ID, email: ctx.user!.EMAIL, target: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
