import { NextRequest, NextResponse } from "next/server";
import {
  getProject,
  getRegistry,
  parseFilters,
  buildWhere,
  applyRls,
  selectRows,
  insertRows,
  updateRows,
  deleteRows,
  autoTableFromJson,
  getPolicies,
  Filter,
} from "@/lib/server/dbapi";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, ok, resolveAuthCtx, rateLimitRequest, requireScope, AuthCtx } from "@/lib/server/api";
import { afterChange } from "@/lib/server/events";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ project: string; table: string }> };

/**
 * ============================================================
 *  DHARA DATA API v1 (PostgREST-style, auto-generated)
 * ============================================================
 *  Auth: x-api-key: dh_pub_... / dh_sec_...  (or ?apikey=)
 *        Authorization: Bearer <user JWT | dh_pat_...>
 *  Roles: pub → anon|authenticated (RLS enforced, no policy = denied)
 *         sec / PAT → service (bypass)
 *  GET    ?select=col1,col2&col=eq.val&order=col.desc&limit=50&offset=0
 *  POST   object | object[]       (insert; auto-creates table if enabled)
 *  PATCH  body {updates:{...}}    + query filters (col=eq.val)
 *  DELETE                          + query filters
 * ============================================================
 */

function sp(req: NextRequest) {
  return new URL(req.url).searchParams;
}

/**
 * Security (CWE-639): PATs are user-scoped tokens — they may only touch
 * projects owned by their user (platform admins excepted). Without this a
 * PAT holder could reach every project on the instance by ID.
 */
async function patProjectAllowed(ctx: AuthCtx, projectId: string): Promise<boolean> {
  if (ctx.kind !== "pat") return true;
  const proj = await getProject(projectId);
  if (!proj) return false;
  return ["owner", "admin"].includes(ctx.user?.ROLE ?? "") || proj.OWNER_ID === ctx.user?.ID;
}

export async function GET(req: NextRequest, { params }: P) {
  try {
    await ensureConnection();
    const { project, table } = await params;
    const ctx = await resolveAuthCtx(req, { projectId: project });
    rateLimitRequest(req, `v1get:${ctx.kind}:${ctx.projectId ?? "na"}`);
    // security: enforce PAT scopes on the data plane (CWE-285)
    if (ctx.kind === "pat") requireScope(ctx, "db:read");
    if (!(await patProjectAllowed(ctx, project))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const proj = await getProject(project);
    if (!proj) return ok({ error: "Project not found" }, { status: 404 });
    const reg = await getRegistry(project, table);
    if (!reg) {
      return NextResponse.json(
        { error: `Table "${table}" not found`, hint: "POST JSON to this URL to auto-create the table." },
        { status: 404 }
      );
    }
    const filters: Filter[] = parseFilters(sp(req), reg.columns);
    const orderParam = sp(req).get("order");
    const order = orderParam
      ? {
          col: orderParam.split(".")[0],
          dir: orderParam.toLowerCase().includes("desc") ? ("desc" as const) : ("asc" as const),
        }
      : null;
    const policies = await getPolicies(project, table);
    const rls = applyRls(policies, "select", { role: ctx.role, userId: ctx.user?.ID }, reg.columns);
    if (rls.denied) {
      return NextResponse.json(
        { error: "Access denied: no RLS policy allows this role on this table.", code: "rls_denied" },
        { status: 403 }
      );
    }
    const where = buildWhere(reg.columns, filters);
    const combined = combineWhere(rls.whereSql, rls.binds, where.sql, where.binds);
    const result = await selectRows(
      reg,
      {
        select: sp(req).get("select")?.split(",").map((s) => s.trim()).filter(Boolean),
        filters,
        order,
        limit: Number(sp(req).get("limit") ?? 50),
        offset: Number(sp(req).get("offset") ?? 0),
      },
      combined
    );
    return new NextResponse(JSON.stringify({ data: result.rows, count: result.total }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-dhara-count": String(result.total ?? result.rows.length),
        "x-dhara-role": ctx.role,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest, { params }: P) {
  try {
    await ensureConnection();
    const { project, table } = await params;
    const ctx = await resolveAuthCtx(req, { projectId: project });
    rateLimitRequest(req, `v1post:${ctx.kind}:${ctx.projectId ?? "na"}`);
    if (ctx.kind === "none") {
      return NextResponse.json({ error: "API key required. Send header: x-api-key" }, { status: 401 });
    }
    if (ctx.kind === "pat") requireScope(ctx, "db:write");
    if (!(await patProjectAllowed(ctx, project))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const proj = await getProject(project);
    if (!proj) return ok({ error: "Project not found" }, { status: 404 });
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return ok({ error: "JSON body required (object or array of objects)" }, { status: 400 });
    }

    let reg = await getRegistry(project, table);
    if (!reg) {
      if (Number(proj.AUTO_CREATE_TABLES) !== 1) {
        return NextResponse.json(
          { error: `Table "${table}" not found and auto-create is disabled for this project` },
          { status: 404 }
        );
      }
      await autoTableFromJson(project, table, body);
      reg = await getRegistry(project, table);
      if (!reg) return ok({ error: "Auto table creation failed" }, { status: 500 });
    }

    const policies = await getPolicies(project, table);
    const rls = applyRls(policies, "insert", { role: ctx.role, userId: ctx.user?.ID }, reg.columns);
    if (!rls.bypass && rls.denied) {
      return NextResponse.json(
        { error: "Insert denied: no RLS policy allows insert for this role.", code: "rls_denied" },
        { status: 403 }
      );
    }
    const rows = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
    const inserted = await insertRows(reg, rows);
    await afterChange({ projectId: project, table, event: "insert", record: inserted[0] ?? null, count: inserted.length });
    return new NextResponse(JSON.stringify({ data: inserted, count: inserted.length }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: P) {
  try {
    await ensureConnection();
    const { project, table } = await params;
    const ctx = await resolveAuthCtx(req, { projectId: project });
    rateLimitRequest(req, `v1patch:${ctx.kind}:${ctx.projectId ?? "na"}`);
    if (ctx.kind === "none") {
      return NextResponse.json({ error: "API key required." }, { status: 401 });
    }
    if (ctx.kind === "pat") requireScope(ctx, "db:write");
    if (!(await patProjectAllowed(ctx, project))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const reg = await getRegistry(project, table);
    if (!reg) return ok({ error: "Table not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { updates?: Record<string, unknown> } | null;
    if (!body?.updates || typeof body.updates !== "object") {
      return ok({ error: "Body: {updates: {...}}" }, { status: 400 });
    }
    const filters: Filter[] = parseFilters(sp(req), reg.columns);
    const policies = await getPolicies(project, table);
    const rls = applyRls(policies, "update", { role: ctx.role, userId: ctx.user?.ID }, reg.columns);
    if (!rls.bypass && rls.denied) {
      return NextResponse.json({ error: "Update denied by RLS", code: "rls_denied" }, { status: 403 });
    }
    const where = buildWhere(reg.columns, filters);
    const combined = combineWhere(rls.whereSql, rls.binds, where.sql, where.binds);
    const result = await updateRows(reg, body.updates, combined);
    await afterChange({ projectId: project, table, event: "update", record: result.rows[0] ?? null, count: result.count });
    return NextResponse.json({ count: result.count, data: result.rows });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: P) {
  try {
    await ensureConnection();
    const { project, table } = await params;
    const ctx = await resolveAuthCtx(req, { projectId: project });
    rateLimitRequest(req, `v1del:${ctx.kind}:${ctx.projectId ?? "na"}`);
    if (ctx.kind === "none") {
      return NextResponse.json({ error: "API key required." }, { status: 401 });
    }
    if (ctx.kind === "pat") requireScope(ctx, "db:write");
    if (!(await patProjectAllowed(ctx, project))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const reg = await getRegistry(project, table);
    if (!reg) return ok({ error: "Table not found" }, { status: 404 });
    const filters: Filter[] = parseFilters(sp(req), reg.columns);
    if (filters.length === 0 && ctx.role !== "service") {
      return ok({ error: "DELETE requires at least one filter (e.g. id=eq.xxx)" }, { status: 400 });
    }
    const policies = await getPolicies(project, table);
    const rls = applyRls(policies, "delete", { role: ctx.role, userId: ctx.user?.ID }, reg.columns);
    if (!rls.bypass && rls.denied) {
      return NextResponse.json({ error: "Delete denied by RLS", code: "rls_denied" }, { status: 403 });
    }
    const where = buildWhere(reg.columns, filters);
    const combined = combineWhere(rls.whereSql, rls.binds, where.sql, where.binds);
    const result = await deleteRows(reg, filters, combined);
    await afterChange({ projectId: project, table, event: "delete", old: result.rows[0] ?? null, count: result.count });
    return NextResponse.json({ count: result.count, data: result.rows });
  } catch (e) {
    return handleError(e);
  }
}

/** Merge an RLS WHERE clause with user filters (bind-name collision safe). */
function combineWhere(
  rlsSql: string,
  rlsBinds: Record<string, unknown>,
  filterSql: string,
  filterBinds: Record<string, unknown>
): { bypass: boolean; whereSql: string; binds: Record<string, unknown>; denied: boolean } {
  if (rlsSql === "1 = 0") {
    return { bypass: false, whereSql: "1 = 0", binds: {}, denied: true };
  }
  const binds: Record<string, unknown> = {};
  let rlsSqlFinal = rlsSql;
  let filterSqlFinal = filterSql;
  const rlsMap: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rlsBinds)) {
    const nk = `a_${k}`;
    rlsMap[nk] = v;
    rlsSqlFinal = rlsSqlFinal.replaceAll(`:${k}`, `:${nk}`);
  }
  const fMap: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filterBinds)) {
    const nk = `b_${k}`;
    fMap[nk] = v;
    filterSqlFinal = filterSqlFinal.replaceAll(`:${k}`, `:${nk}`);
  }
  Object.assign(binds, rlsMap, fMap);
  const whereSql = [rlsSqlFinal, filterSqlFinal].filter(Boolean).join(" AND ");
  // fix: empty SQL = unrestricted (service bypass or allow-all policy), not "1 = 0"
  return { bypass: false, whereSql, binds, denied: false };
}
