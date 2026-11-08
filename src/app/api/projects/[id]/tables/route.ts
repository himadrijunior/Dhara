import { NextRequest, NextResponse } from "next/server";
import {
  listTables,
  createTable,
  autoTableFromJson,
  ColumnDef,
  getProject,
} from "@/lib/server/dbapi";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, ok, requireProjectAccess, audit } from "@/lib/server/api";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

/** GET — list tables in project (?counts=1 to include row counts). */
export async function GET(req: NextRequest, { params }: P) {
  try {
    await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const withCounts = new URL(req.url).searchParams.get("counts") === "1";
    const tables = await listTables(id, withCounts);
    return NextResponse.json({ tables });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * POST — create table.
 * Body A: {name, columns: [{name, type, pk?, required?, unique?, defaultValue?}]}
 * Body B: {name, json: object|object[]} → auto table creation from JSON (Firebase-style)
 */
export async function POST(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return ok({ error: "Project not found" }, { status: 404 });

    const body = (await req.json()) as {
      name?: string;
      columns?: ColumnDef[];
      json?: unknown;
    };
    if (!body.name) return ok({ error: "name is required" }, { status: 400 });

    let result;
    if (body.json !== undefined) {
      const auto = await autoTableFromJson(id, body.name, body.json);
      result = auto.table;
    } else if (Array.isArray(body.columns)) {
      result = await createTable(id, body.name, body.columns);
    } else {
      return ok({ error: "columns or json is required" }, { status: 400 });
    }
    await audit("table.create", {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: `${project.NAME}/${result.name}`,
      projectId: id,
      detail: { columns: result.columns?.length },
    });
    return NextResponse.json({ ok: true, table: result });
  } catch (e) {
    return handleError(e);
  }
}
