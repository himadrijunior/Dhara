import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/server/oracle";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, ok, requireProjectAccess, audit } from "@/lib/server/api";
import { uuid, randomToken } from "@/lib/server/security";
import { assertPublicUrl } from "@/lib/server/events";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

/** GET — webhooks (?logs=1&webhookId=... for delivery logs). */
export async function GET(req: NextRequest, { params }: P) {
  try {
    await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const sp = new URL(req.url).searchParams;
    if (sp.get("logs") === "1") {
      const webhookId = sp.get("webhookId");
      const r = await q(
        `SELECT L.ID, L.WEBHOOK_ID, L.EVENT, L.STATUS, L.OK, L.ERROR, L.DURATION_MS, L.AT, W.TABLE_NAME, W.URL
         FROM DHARA_WEBHOOK_LOGS L
         LEFT JOIN DHARA_WEBHOOKS W ON W.ID = L.WEBHOOK_ID
         WHERE W.PROJECT_ID = :p ${webhookId ? "AND L.WEBHOOK_ID = :wid" : ""}
         ORDER BY L.AT DESC FETCH FIRST 100 ROWS ONLY`,
        webhookId ? { p: id, wid: webhookId } : { p: id }
      );
      return NextResponse.json({ logs: r.rows });
    }
    const r = await q(
      `SELECT ID, PROJECT_ID, TABLE_NAME, URL, EVENTS, ENABLED, CREATED_AT FROM DHARA_WEBHOOKS WHERE PROJECT_ID = :p ORDER BY CREATED_AT DESC`,
      { p: id }
    );
    return NextResponse.json({ webhooks: r.rows });
  } catch (e) {
    return handleError(e);
  }
}

/** POST — create webhook. Body: {table, url, events?, secret?}. */
export async function POST(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const body = (await req.json()) as {
      table?: string;
      url?: string;
      events?: string[];
      secret?: string;
    };
    if (!body.table || !body.url || !/^https?:\/\//.test(body.url)) {
      return ok({ error: "table and a valid http(s) url are required" }, { status: 400 });
    }
    // security: block SSRF — webhooks must target public internet hosts only
    try {
      assertPublicUrl(body.url);
    } catch (err) {
      return ok(
        { error: err instanceof Error ? err.message : "URL not allowed" },
        { status: 400 }
      );
    }
    const events = (body.events ?? ["insert", "update", "delete"])
      .filter((e) => ["insert", "update", "delete"].includes(e))
      .join(",");
    const secret = body.secret || randomToken("whs_");
    const wid = uuid();
    await q(
      `INSERT INTO DHARA_WEBHOOKS (ID, PROJECT_ID, TABLE_NAME, URL, SECRET, EVENTS)
       VALUES (:id, :p, :t, :u, :s, :e)`,
      { id: wid, p: id, t: body.table.toLowerCase(), u: body.url.slice(0, 500), s: secret.slice(0, 128), e: events }
    );
    await audit("webhook.create", {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: `${body.table} → ${body.url}`,
      projectId: id,
    });
    return NextResponse.json({ ok: true, id: wid, secret });
  } catch (e) {
    return handleError(e);
  }
}

/** PATCH — toggle webhook. Body: {id, enabled}. */
export async function PATCH(req: NextRequest, { params }: P) {
  try {
    await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const body = (await req.json()) as { id?: string; enabled?: boolean };
    if (!body.id) return ok({ error: "id required" }, { status: 400 });
    await q(
      `UPDATE DHARA_WEBHOOKS SET ENABLED = :e WHERE ID = :wid AND PROJECT_ID = :p`,
      { e: body.enabled ? 1 : 0, wid: body.id, p: id }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE — remove webhook. ?id= */
export async function DELETE(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const wid = new URL(req.url).searchParams.get("id") ?? "";
    if (!wid) return ok({ error: "id required" }, { status: 400 });
    await q(`DELETE FROM DHARA_WEBHOOKS WHERE ID = :wid AND PROJECT_ID = :p`, { wid, p: id });
    await q(`DELETE FROM DHARA_WEBHOOK_LOGS WHERE WEBHOOK_ID = :wid`, { wid });
    await audit("webhook.delete", { req, userId: ctx.user?.ID, email: ctx.user?.EMAIL, target: wid, projectId: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
