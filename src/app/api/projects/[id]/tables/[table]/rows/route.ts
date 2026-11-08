import { NextRequest, NextResponse } from "next/server";
import {
  getRegistry,
  selectRows,
  insertRows,
  updateRows,
  deleteRows,
  parseFilters,
  buildWhere,
  applyRls,
  rlsCtxFor,
  getPolicies,
  autoTableFromJson,
  getProject,
  Filter,
} from "@/lib/server/dbapi";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, ok, requireProjectAccess, audit } from "@/lib/server/api";
import { afterChange } from "@/lib/server/events";

async function afterChangeSafe(payload: Parameters<typeof afterChange>[0]): Promise<void> {
  try {
    await afterChange(payload);
  } catch {
    /* events are best-effort */
  }
}

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string; table: string }> };

function sp(req: NextRequest) {
  return new URL(req.url).searchParams;
}

/** GET — browse rows (dashboard, full access). */
export async function GET(req: NextRequest, { params }: P) {
  try {
    await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id, table } = await params;
    const reg = await getRegistry(id, table);
    if (!reg) return ok({ error: "Table not found" }, { status: 404 });
    const spq = sp(req);
    const filters = parseFilters(spq, reg.columns);
    const orderParam = spq.get("order");
    const order = orderParam
      ? {
          col: orderParam.split(".")[0],
          dir: orderParam.toLowerCase().includes("desc") ? ("desc" as const) : ("asc" as const),
        }
      : null;
    const whereBuilt = buildWhere(reg.columns, filters);
    const rlsResult = { bypass: true, whereSql: whereBuilt.sql, binds: whereBuilt.binds, denied: false };
    const result = await selectRows(
      reg,
      {
        select: spq.get("select")?.split(",").map((s) => s.trim()).filter(Boolean),
        filters,
        order,
        limit: Number(spq.get("limit") ?? 50),
        offset: Number(spq.get("offset") ?? 0),
      },
      rlsResult
    );
    return NextResponse.json({ data: result.rows, count: result.total });
  } catch (e) {
    return handleError(e);
  }
}

/** POST — insert rows. Body: object | object[] (auto-creates table from JSON if missing). */
export async function POST(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id, table } = await params;
    const body = (await req.json()) as Record<string, unknown> | Record<string, unknown>[];

    let reg = await getRegistry(id, table);
    if (!reg) {
      const project = await getProject(id);
      if (!project || Number(project.AUTO_CREATE_TABLES) !== 1) {
        return ok({ error: "Table not found" }, { status: 404 });
      }
      const auto = await autoTableFromJson(id, table, body);
      reg = await getRegistry(id, table);
      if (!reg) return ok({ error: "Auto table creation failed" }, { status: 500 });
      await audit("table.auto_create", {
        req,
        userId: ctx.user?.ID,
        email: ctx.user?.EMAIL,
        target: table,
        projectId: id,
      });
    }
    const rows = Array.isArray(body) ? body : [body];
    const inserted = await insertRows(reg, rows);
    await afterChangeSafe({ projectId: id, table, event: "insert", record: inserted[0] ?? null, count: inserted.length });
    await audit("rows.insert", {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: `${table} (${rows.length})`,
      projectId: id,
    });
    return NextResponse.json({ ok: true, data: inserted, count: inserted.length });
  } catch (e) {
    return handleError(e);
  }
}

/** PATCH — update rows. Body: {updates: {...}, filters?: [{col, op, val}]}. */
export async function PATCH(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id, table } = await params;
    const reg = await getRegistry(id, table);
    if (!reg) return ok({ error: "Table not found" }, { status: 404 });
    const body = (await req.json()) as { updates?: Record<string, unknown>; filters?: Filter[] };
    if (!body.updates || typeof body.updates !== "object") {
      return ok({ error: "updates object is required" }, { status: 400 });
    }
    const filters = body.filters ?? [];
    const where = buildWhere(reg.columns, filters);
    const result = await updateRows(reg, body.updates, {
      bypass: true,
      whereSql: where.sql,
      binds: where.binds,
      denied: false,
    });
    await afterChangeSafe({
      projectId: id,
      table,
      event: "update",
      record: result.rows[0] ?? null,
      count: result.count,
    });
    await audit("rows.update", {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: `${table} (${result.count})`,
      projectId: id,
    });
    return NextResponse.json({ ok: true, count: result.count, data: result.rows });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE — delete rows. Body: {filters?: [{col, op, val}]} (dashboard = full access). */
export async function DELETE(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id, table } = await params;
    const reg = await getRegistry(id, table);
    if (!reg) return ok({ error: "Table not found" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as { filters?: Filter[] };
    const filters = body.filters ?? [];
    const where = buildWhere(reg.columns, filters);
    const result = await deleteRows(reg, filters, {
      bypass: true,
      whereSql: where.sql,
      binds: where.binds,
      denied: false,
    });
    await afterChangeSafe({
      projectId: id,
      table,
      event: "delete",
      old: result.rows[0] ?? null,
      count: result.count,
    });
    await audit("rows.delete", {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: `${table} (${result.count})`,
      projectId: id,
    });
    return NextResponse.json({ ok: true, count: result.count, data: result.rows });
  } catch (e) {
    return handleError(e);
  }
}
