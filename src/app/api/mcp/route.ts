import { NextRequest, NextResponse } from "next/server";
import {
  listProjects,
  listTables,
  getRegistry,
  selectRows,
  insertRows,
  autoTableFromJson,
  updateRows,
  deleteRows,
  parseFilters,
  buildWhere,
} from "@/lib/server/dbapi";
import { ensureConnection } from "@/lib/server/oracle";
import { resolveAuthCtx, requireScope, AuthCtx } from "@/lib/server/api";
import { DharaError } from "@/lib/server/oracle";

export const dynamic = "force-dynamic";

/**
 * ============================================================
 *  DHARA MCP SERVER (Model Context Protocol)
 *  Transport: Streamable HTTP (POST JSON-RPC 2.0)
 *  Auth: Authorization: Bearer dh_pat_... (PAT scopes apply)
 *
 *  Tools: list_projects, list_tables, describe_table, select_rows,
 *         insert_rows, update_rows, delete_rows, run_sql
 * ============================================================
 */

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
}

function textContent(data: unknown, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2).slice(0, 40000) }],
    isError,
  };
}

const TOOLS = [
  {
    name: "list_projects",
    description: "List all Dhara projects",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_tables",
    description: "List tables in a project",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "describe_table",
    description: "Describe a table: columns, types, realtime flag",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, table: { type: "string" } },
      required: ["projectId", "table"],
    },
  },
  {
    name: "select_rows",
    description: "Select rows with PostgREST-style filters",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        table: { type: "string" },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: { col: { type: "string" }, op: { type: "string" }, val: { type: "string" } },
          },
        },
        limit: { type: "number" },
        offset: { type: "number" },
        order: { type: "string", description: "col or col.desc" },
      },
      required: ["projectId", "table"],
    },
  },
  {
    name: "insert_rows",
    description: "Insert rows (object or array of objects). Auto-creates the table from JSON if missing.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        table: { type: "string" },
        rows: { type: "object", description: "object or array of objects" },
      },
      required: ["projectId", "table", "rows"],
    },
  },
  {
    name: "update_rows",
    description: "Update rows matching filters",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        table: { type: "string" },
        updates: { type: "object" },
        filters: { type: "array", items: { type: "object" } },
      },
      required: ["projectId", "table", "updates"],
    },
  },
  {
    name: "delete_rows",
    description: "Delete rows matching filters",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        table: { type: "string" },
        filters: { type: "array", items: { type: "object" } },
      },
      required: ["projectId", "table"],
    },
  },
  {
    name: "run_sql",
    description: "Run a raw SQL statement on the project schema (PAT needs sql:run scope)",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string" }, limit: { type: "number" } },
      required: ["sql"],
    },
  },
];

export async function POST(req: NextRequest) {
  try {
    await ensureConnection();
    const ctx = await resolveAuthCtx(req);
    if (ctx.kind !== "pat" && ctx.kind !== "user") {
      return NextResponse.json(
        { error: "MCP requires a Personal Access Token (Authorization: Bearer dh_pat_...)" },
        { status: 401 }
      );
    }
    const rpc = (await req.json().catch(() => null)) as RpcRequest | null;
    if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
      return rpcError(rpc?.id ?? null, -32600, "Invalid JSON-RPC 2.0 request");
    }

    if (rpc.method === "initialize") {
      return rpcResult(rpc.id, {
        protocolVersion: (rpc.params?.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "dhara-db", version: "1.0.0" },
        instructions:
          "Dhara MCP — browse and manage projects, tables and rows on Oracle Autonomous AI DB.",
      });
    }
    if (rpc.method.startsWith("notifications/")) {
      return new NextResponse(null, { status: 202 });
    }
    if (rpc.method === "ping") {
      return rpcResult(rpc.id, {});
    }
    if (rpc.method === "tools/list") {
      return rpcResult(rpc.id, { tools: TOOLS });
    }
    if (rpc.method !== "tools/call") {
      return rpcError(rpc.id, -32601, `Unknown method: ${rpc.method}`);
    }

    // Tenant isolation (CWE-639): MCP actors may only touch projects they own.
    const isAdmin = ["owner", "admin"].includes(ctx.user?.ROLE ?? "");
    const assertMcpProject = async (projectId: string) => {
      const { getProject } = await import("@/lib/server/dbapi");
      const proj = await getProject(projectId);
      if (!proj || (!isAdmin && proj.OWNER_ID !== ctx.user?.ID)) {
        throw new DharaError("Project not found", 404, "project_not_found");
      }
      return proj;
    };

    const name = String(rpc.params?.name ?? "");
    const args = (rpc.params?.arguments ?? {}) as Record<string, never> as Record<string, unknown>;
    try {
      switch (name) {
        case "list_projects": {
          requireScope(ctx, "projects:read");
          return rpcResult(rpc.id, textContent(await listProjects(ctx.user?.ID, isAdmin)));
        }
        case "list_tables": {
          requireScope(ctx, "db:read");
          await assertMcpProject(String(args.projectId));
          return rpcResult(rpc.id, textContent(await listTables(String(args.projectId))));
        }
        case "describe_table": {
          requireScope(ctx, "db:read");
          await assertMcpProject(String(args.projectId));
          const reg = await getRegistry(String(args.projectId), String(args.table));
          if (!reg) throw new DharaError("Table not found", 404);
          return rpcResult(rpc.id, textContent({ name: reg.NAME, columns: reg.columns, physical: reg.PHYSICAL }));
        }
        case "select_rows": {
          requireScope(ctx, "db:read");
          await assertMcpProject(String(args.projectId));
          const reg = await getRegistry(String(args.projectId), String(args.table));
          if (!reg) throw new DharaError("Table not found", 404);
          const filters = parseFilters(new URLSearchParams(), reg.columns);
          const userFilters = (args.filters as { col: string; op: string; val?: string }[] | undefined) ?? [];
          for (const f of userFilters) filters.push(f);
          const where = buildWhere(reg.columns, filters);
          const orderStr = typeof args.order === "string" ? args.order : null;
          const result = await selectRows(
            reg,
            {
              filters,
              order: orderStr
                ? { col: orderStr.split(".")[0], dir: orderStr.includes("desc") ? ("desc" as const) : ("asc" as const) }
                : null,
              limit: Number(args.limit ?? 50),
              offset: Number(args.offset ?? 0),
            },
            { bypass: true, whereSql: where.sql, binds: where.binds, denied: false }
          );
          return rpcResult(rpc.id, textContent({ count: result.total, rows: result.rows }));
        }
        case "insert_rows": {
          requireScope(ctx, "db:write");
          const pid = String(args.projectId);
          const tbl = String(args.table);
          await assertMcpProject(pid);
          let reg = await getRegistry(pid, tbl);
          if (!reg) {
            await autoTableFromJson(pid, tbl, args.rows);
            reg = await getRegistry(pid, tbl);
            if (!reg) throw new DharaError("Auto table creation failed", 500);
          }
          const rows = (Array.isArray(args.rows) ? args.rows : [args.rows]) as Record<string, unknown>[];
          const inserted = await insertRows(reg, rows);
          return rpcResult(rpc.id, textContent({ inserted: inserted.length, rows: inserted }));
        }
        case "update_rows": {
          requireScope(ctx, "db:write");
          await assertMcpProject(String(args.projectId));
          const reg = await getRegistry(String(args.projectId), String(args.table));
          if (!reg) throw new DharaError("Table not found", 404);
          const filters = (args.filters as { col: string; op: string; val?: string }[] | undefined) ?? [];
          const where = buildWhere(reg.columns, filters);
          const result = await updateRows(reg, args.updates as Record<string, unknown>, {
            bypass: true,
            whereSql: where.sql,
            binds: where.binds,
            denied: false,
          });
          return rpcResult(rpc.id, textContent({ updated: result.count, rows: result.rows }));
        }
        case "delete_rows": {
          requireScope(ctx, "db:write");
          await assertMcpProject(String(args.projectId));
          const reg = await getRegistry(String(args.projectId), String(args.table));
          if (!reg) throw new DharaError("Table not found", 404);
          const filters = (args.filters as { col: string; op: string; val?: string }[] | undefined) ?? [];
          const where = buildWhere(reg.columns, filters);
          const result = await deleteRows(reg, filters, {
            bypass: true,
            whereSql: where.sql,
            binds: where.binds,
            denied: false,
          });
          return rpcResult(rpc.id, textContent({ deleted: result.count }));
        }
        case "run_sql": {
          requireScope(ctx, "sql:run");
          // security: raw SQL executes on the platform connection — admins only,
          // inside a project they own (same gate as the SQL console)
          if (!isAdmin) {
            throw new DharaError("run_sql is restricted to platform administrators", 403, "admin_required");
          }
          await assertMcpProject(String(args.projectId ?? ""));
          const { q } = await import("@/lib/server/oracle");
          const sql = String(args.sql ?? "").trim();
          if (!sql) throw new DharaError("sql is required", 400);
          const isQuery = /^\s*(select|with)\b/i.test(sql);
          const limit = Math.min(Number(args.limit ?? 100), 500);
          const r = isQuery
            ? await q(`SELECT * FROM (${sql}) DH_MCP FETCH FIRST ${limit} ROWS ONLY`)
            : await q(sql);
          return rpcResult(
            rpc.id,
            textContent(isQuery ? { rows: r.rows } : { rowsAffected: r.rowsAffected })
          );
        }
        default:
          return rpcError(rpc.id, -32602, `Unknown tool: ${name}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return rpcResult(rpc.id, textContent({ error: msg }, true));
    }
  } catch (e) {
    const status = e instanceof DharaError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "MCP error" }, { status });
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST with JSON-RPC 2.0. Auth: Authorization: Bearer <PAT>" },
    { status: 405 }
  );
}
