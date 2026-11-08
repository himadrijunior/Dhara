import { NextRequest, NextResponse } from "next/server";
import { listProjects, createProject } from "@/lib/server/dbapi";
import { handleError, ok, requireUserCtx, audit } from "@/lib/server/api";
import { ensureConnection } from "@/lib/server/oracle";

export const dynamic = "force-dynamic";

/** GET — list projects (tenant-scoped: admins see all, members see their own). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const isAdmin = ["owner", "admin"].includes(ctx.user!.ROLE);
    const projects = await listProjects(ctx.user!.ID, isAdmin);
    return NextResponse.json({ projects });
  } catch (e) {
    return handleError(e);
  }
}

/** POST — create project. Body: {name, description?, color?}. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const body = (await req.json()) as { name?: string; description?: string; color?: string };
    if (!body.name) return ok({ error: "name is required" }, { status: 400 });
    const project = await createProject(body.name, body.description, body.color, ctx.user!.ID);
    await audit("project.create", {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: project.NAME,
      projectId: project.ID,
    });
    return NextResponse.json({ ok: true, project });
  } catch (e) {
    return handleError(e);
  }
}
