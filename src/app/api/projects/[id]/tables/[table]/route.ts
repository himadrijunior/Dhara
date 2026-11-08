import { NextRequest, NextResponse } from "next/server";
import {
  getRegistry,
  dropTable,
  addColumn,
  dropColumn,
  setRealtime,
  syncSchema,
  getPolicies,
  ColumnDef,
} from "@/lib/server/dbapi";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, ok, requireProjectAccess, audit } from "@/lib/server/api";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string; table: string }> };

/** GET — describe table: columns, realtime flag, policies. */
export async function GET(req: NextRequest, { params }: P) {
  try {
    await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id, table } = await params;
    const reg = await getRegistry(id, table);
    if (!reg) return ok({ error: "Table not found" }, { status: 404 });
    const policies = await getPolicies(id, table);
    const { REALTIME, REALTIME_EVENTS, ...rest } = reg;
    return NextResponse.json({
      table: {
        ...rest,
        COLUMNS: undefined,
        columns: reg.columns,
        realtime: Number(REALTIME) === 1,
        realtimeEvents: REALTIME_EVENTS,
      },
      policies,
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * PATCH — schema & flags.
 * Body: {action: "addColumn", column} | {action: "dropColumn", column}
 *      | {action: "sync"} | {action: "realtime", enabled, events?}
 */
export async function PATCH(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id, table } = await params;
    const body = (await req.json()) as {
      action: string;
      column?: ColumnDef;
      enabled?: boolean;
      events?: string;
    };
    switch (body.action) {
      case "addColumn": {
        if (!body.column?.name) return ok({ error: "column.name required" }, { status: 400 });
        await addColumn(id, table, body.column);
        break;
      }
      case "dropColumn": {
        if (!body.column?.name) return ok({ error: "column.name required" }, { status: 400 });
        await dropColumn(id, table, body.column.name);
        break;
      }
      case "sync": {
        const cols = await syncSchema(id, table);
        return NextResponse.json({ ok: true, columns: cols });
      }
      case "realtime": {
        await setRealtime(id, table, !!body.enabled, body.events);
        break;
      }
      default:
        return ok({ error: "Unknown action" }, { status: 400 });
    }
    await audit(`table.${body.action}`, {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: table,
      projectId: id,
      detail: body,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE — drop table. */
export async function DELETE(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id, table } = await params;
    await dropTable(id, table);
    await audit("table.drop", {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: table,
      projectId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
