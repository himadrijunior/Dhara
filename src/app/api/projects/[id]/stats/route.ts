import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/server/oracle";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, requireProjectAccess } from "@/lib/server/api";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

/** GET — project stats for the dashboard. */
export async function GET(req: NextRequest, { params }: P) {
  try {
    await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const tables = await q(`SELECT NAME, PHYSICAL FROM DHARA_TABLES WHERE PROJECT_ID = :p`, { p: id });
    let totalRows = 0;
    const perTable: { name: string; rows: number }[] = [];
    for (const t of tables.rows) {
      try {
        const c = await q(`SELECT COUNT(*) AS N FROM ${String(t.PHYSICAL)}`);
        const n = Number(c.rows[0]?.N ?? 0);
        totalRows += n;
        perTable.push({ name: String(t.NAME), rows: n });
      } catch {
        perTable.push({ name: String(t.NAME), rows: -1 });
      }
    }
    const [keys, hooks, policies] = await Promise.all([
      q(`SELECT COUNT(*) AS N FROM DHARA_API_KEYS WHERE PROJECT_ID = :p`, { p: id }),
      q(`SELECT COUNT(*) AS N FROM DHARA_WEBHOOKS WHERE PROJECT_ID = :p`, { p: id }),
      q(`SELECT COUNT(*) AS N FROM DHARA_POLICIES WHERE PROJECT_ID = :p`, { p: id }),
    ]);
    const files = await q(
      `SELECT COUNT(*) AS N, NVL(SUM(SIZE_BYTES), 0) AS BYTES FROM DHARA_FILES WHERE PROJECT_ID = :p`,
      { p: id }
    ).catch(() => ({ rows: [{ N: 0, BYTES: 0 }] as Record<string, unknown>[] }));
    const rt = await q(`SELECT COUNT(*) AS N FROM DHARA_TABLES WHERE PROJECT_ID = :p AND REALTIME = 1`, { p: id });
    return NextResponse.json({
      tables: tables.rows.length,
      totalRows,
      perTable,
      keys: Number(keys.rows[0]?.N ?? 0),
      webhooks: Number(hooks.rows[0]?.N ?? 0),
      policies: Number(policies.rows[0]?.N ?? 0),
      files: Number(files.rows[0]?.N ?? 0),
      storageBytes: Number(files.rows[0]?.BYTES ?? 0),
      realtimeTables: Number(rt.rows[0]?.N ?? 0),
    });
  } catch (e) {
    return handleError(e);
  }
}
