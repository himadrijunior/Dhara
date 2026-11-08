import { NextRequest, NextResponse } from "next/server";
import { q, ensureConnection } from "@/lib/server/oracle";
import { handleError, ok, requireUserCtx, requirePlatformAdmin, audit, trackUsage } from "@/lib/server/api";
import { getProject } from "@/lib/server/dbapi";
import { uuid } from "@/lib/server/security";

export const dynamic = "force-dynamic";

/** Split SQL into statements (quote-aware, dollar-quoted ignored for MVP). */
function splitStatements(src: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" && src[i - 1] !== "\\") inStr = !inStr;
    if (ch === ";" && !inStr) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.slice(0, 20);
}

/** POST — run SQL. Body: {projectId, statement}. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    // security: raw SQL runs on the platform connection — platform admins only,
    // and only for a project they can access (CWE-250 mitigation)
    requirePlatformAdmin(ctx);
    await ensureConnection();
    const body = (await req.json()) as { projectId?: string; statement?: string };
    if (!body.projectId || !body.statement?.trim()) {
      return ok({ error: "projectId and statement are required" }, { status: 400 });
    }
    const proj = await getProject(body.projectId);
    if (!proj) return ok({ error: "Project not found" }, { status: 404 });
    if (body.statement.length > 200_000) {
      return ok({ error: "Statement too large" }, { status: 400 });
    }
    const statements = splitStatements(body.statement);
    const started = Date.now();
    const results: { statement: string; rows?: Record<string, unknown>[]; rowsAffected?: number; error?: string }[] = [];
    let hadError = false;

    for (const st of statements) {
      try {
        const isQuery = /^\s*(select|with)\b/i.test(st);
        const r = await q(isQuery ? `SELECT * FROM (${st}) DH_SUB FETCH FIRST 500 ROWS ONLY` : st);
        results.push({
          statement: st.slice(0, 500),
          rows: isQuery ? r.rows : undefined,
          rowsAffected: isQuery ? undefined : r.rowsAffected,
        });
      } catch (e) {
        hadError = true;
        results.push({ statement: st.slice(0, 500), error: e instanceof Error ? e.message : String(e) });
        break; // stop at first error (Oracle script semantics)
      }
    }
    const durationMs = Date.now() - started;

    await q(
      `INSERT INTO DHARA_SQL_HISTORY (ID, USER_ID, PROJECT_ID, STATEMENT, OK, ERROR, DURATION_MS, ROWS_RETURNED)
       VALUES (:id, :u, :p, :st, :ok, :err, :dur, :rc)`,
      {
        id: uuid(),
        u: ctx.user!.ID,
        p: body.projectId,
        st: body.statement.slice(0, 20000),
        ok: hadError ? 0 : 1,
        err: hadError ? String(results.find((r) => r.error)?.error ?? "").slice(0, 900) : null,
        dur: durationMs,
        rc: results[0]?.rows?.length ?? null,
      }
    );
    await audit("sql.run", {
      req,
      userId: ctx.user!.ID,
      email: ctx.user!.EMAIL,
      target: `${statements.length} statement(s)`,
      projectId: body.projectId,
      detail: { durationMs, ok: !hadError },
    });
    void trackUsage(ctx.user!.ID, "sql.run");
    return NextResponse.json({ ok: !hadError, durationMs, results });
  } catch (e) {
    return handleError(e);
  }
}

/** GET — history + saved queries (?projectId=). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
    const history = await q(
      `SELECT ID, STATEMENT, OK, ERROR, DURATION_MS, ROWS_RETURNED, AT
       FROM DHARA_SQL_HISTORY WHERE USER_ID = :u AND PROJECT_ID = :p
       ORDER BY AT DESC FETCH FIRST 50 ROWS ONLY`,
      { u: ctx.user!.ID, p: projectId }
    );
    const saved = await q(
      `SELECT ID, NAME, STATEMENT, CREATED_AT FROM DHARA_SAVED_QUERIES WHERE USER_ID = :u AND PROJECT_ID = :p ORDER BY CREATED_AT DESC`,
      { u: ctx.user!.ID, p: projectId }
    );
    return NextResponse.json({ history: history.rows, saved: saved.rows });
  } catch (e) {
    return handleError(e);
  }
}

/** POST save is handled via PUT — save a query. Body: {projectId, name, statement}. */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const body = (await req.json()) as { projectId?: string; name?: string; statement?: string };
    if (!body.projectId || !body.name || !body.statement) {
      return ok({ error: "projectId, name, statement required" }, { status: 400 });
    }
    await q(
      `INSERT INTO DHARA_SAVED_QUERIES (ID, USER_ID, PROJECT_ID, NAME, STATEMENT) VALUES (:id, :u, :p, :n, :st)`,
      { id: uuid(), u: ctx.user!.ID, p: body.projectId, n: body.name.slice(0, 160), st: body.statement.slice(0, 20000) }
    );
    void trackUsage(ctx.user!.ID, "sql.save");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE — remove saved query (?id=) or clear history (?history=1&projectId=). */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const sp = new URL(req.url).searchParams;
    if (sp.get("history") === "1") {
      const projectId = sp.get("projectId") ?? "";
      await q(`DELETE FROM DHARA_SQL_HISTORY WHERE USER_ID = :u AND PROJECT_ID = :p`, {
        u: ctx.user!.ID,
        p: projectId,
      });
      return NextResponse.json({ ok: true });
    }
    const id = sp.get("id") ?? "";
    await q(`DELETE FROM DHARA_SAVED_QUERIES WHERE ID = :id AND USER_ID = :u`, { id, u: ctx.user!.ID });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
