import { NextRequest, NextResponse } from "next/server";
import { deleteProject, updateProjectFlags } from "@/lib/server/dbapi";
import { handleError, ok, requireProjectAccess, audit } from "@/lib/server/api";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: P) {
  try {
    const { project } = await requireProjectAccess(req, (await params).id);
    return NextResponse.json({ project });
  } catch (e) {
    return handleError(e);
  }
}

/** PATCH — update name/description/autoCreateTables (owner or platform admin only). */
export async function PATCH(req: NextRequest, { params }: P) {
  try {
    const { ctx, user, project } = await requireProjectAccess(req, (await params).id);
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      autoCreateTables?: boolean;
    };
    const updated = await updateProjectFlags(project.ID, body);
    if (!updated) return ok({ error: "Project not found" }, { status: 404 });
    await audit("project.update", {
      req,
      userId: user.ID,
      email: user.EMAIL,
      target: updated.NAME,
      projectId: project.ID,
      detail: body,
    });
    return NextResponse.json({ ok: true, project: updated });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE — drop project + all its tables (owner or platform admin only). */
export async function DELETE(req: NextRequest, { params }: P) {
  try {
    const { user, project } = await requireProjectAccess(req, (await params).id);
    const dropped = await deleteProject(project.ID);
    await audit("project.delete", {
      req,
      userId: user.ID,
      email: user.EMAIL,
      target: project.NAME,
      projectId: project.ID,
      detail: { tablesDropped: dropped },
    });
    return NextResponse.json({ ok: true, tablesDropped: dropped });
  } catch (e) {
    return handleError(e);
  }
}
