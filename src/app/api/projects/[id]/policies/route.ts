import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/server/oracle";
import { getPolicies, clearPolicyCache, compileRlsExpr, getRegistry } from "@/lib/server/dbapi";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, ok, requireProjectAccess, audit } from "@/lib/server/api";
import { uuid } from "@/lib/server/security";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

/** GET — policies for project (?table=name). */
export async function GET(req: NextRequest, { params }: P) {
  try {
    await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const table = new URL(req.url).searchParams.get("table");
    if (table) {
      return NextResponse.json({ policies: await getPolicies(id, table) });
    }
    const r = await q(`SELECT * FROM DHARA_POLICIES WHERE PROJECT_ID = :p ORDER BY CREATED_AT DESC`, {
      p: id,
    });
    return NextResponse.json({ policies: r.rows });
  } catch (e) {
    return handleError(e);
  }
}

/** POST — create policy. Body: {table, name, action, roles, using, withCheck?}. */
export async function POST(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const body = (await req.json()) as {
      table?: string;
      name?: string;
      action?: string;
      roles?: string[];
      using?: string;
      withCheck?: string;
    };
    if (!body.table || !body.name || !body.using) {
      return ok({ error: "table, name and using are required" }, { status: 400 });
    }
    const reg = await getRegistry(id, body.table);
    if (!reg) return ok({ error: "Table not found" }, { status: 404 });

    const action = ["select", "insert", "update", "delete", "all"].includes(body.action ?? "")
      ? body.action!
      : "all";
    const roles = (body.roles ?? ["anon", "authenticated"]).filter((r) =>
      ["anon", "authenticated"].includes(r)
    );
    if (roles.length === 0) return ok({ error: "At least one role required" }, { status: 400 });

    // validate expression compiles (against table columns)
    try {
      compileRlsExpr(body.using, reg.columns, { role: "authenticated", userId: "00000000-0000-0000-0000-000000000000" });
      if (body.withCheck) {
        compileRlsExpr(body.withCheck, reg.columns, { role: "authenticated", userId: "00000000-0000-0000-0000-000000000000" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid policy expression";
      return ok({ error: `Policy expression error: ${msg}` }, { status: 400 });
    }

    const pid = uuid();
    await q(
      `INSERT INTO DHARA_POLICIES (ID, PROJECT_ID, TABLE_NAME, NAME, ACTION, ROLES, USING_EXPR, WITH_CHECK)
       VALUES (:id, :p, :t, :n, :a, :r, :u, :wc)`,
      {
        id: pid,
        p: id,
        t: body.table.toLowerCase(),
        n: body.name.slice(0, 160),
        a: action,
        r: roles.join(","),
        u: body.using.slice(0, 600),
        wc: body.withCheck?.slice(0, 600) ?? null,
      }
    );
    clearPolicyCache(id);
    await audit("policy.create", {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: `${body.table}/${body.name}`,
      projectId: id,
      detail: { action, roles, using: body.using },
    });
    return NextResponse.json({ ok: true, id: pid });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE — remove policy. Body: {id} or ?id=. */
export async function DELETE(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const policyId = new URL(req.url).searchParams.get("id") ?? "";
    if (!policyId) return ok({ error: "id required" }, { status: 400 });
    await q(`DELETE FROM DHARA_POLICIES WHERE ID = :id AND PROJECT_ID = :p`, { id: policyId, p: id });
    clearPolicyCache(id);
    await audit("policy.delete", {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: policyId,
      projectId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
