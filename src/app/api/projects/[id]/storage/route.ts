import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/server/oracle";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, ok, requireProjectAccess, audit } from "@/lib/server/api";
import { storagePut, storageList, storageDelete, storageGet, signedLocalUrl } from "@/lib/server/storage";
import { uuid } from "@/lib/server/security";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

/** GET — buckets (?buckets=1) or objects in a bucket (?bucket=name). */
export async function GET(req: NextRequest, { params }: P) {
  try {
    await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const sp = new URL(req.url).searchParams;
    if (sp.get("buckets") === "1") {
      const r = await q(`SELECT * FROM DHARA_BUCKETS WHERE PROJECT_ID = :p ORDER BY CREATED_AT`, { p: id });
      return NextResponse.json({ buckets: r.rows });
    }
    const bucket = sp.get("bucket");
    if (!bucket) return ok({ error: "bucket or buckets=1 required" }, { status: 400 });
    const prefix = sp.get("prefix") ?? "";
    const objects = await storageList(id, bucket, prefix);
    const withUrls = await Promise.all(
      objects.map(async (o) => ({ ...o, url: await signedLocalUrl(id, bucket, o.name, 600) }))
    );
    return NextResponse.json({ objects: withUrls });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * POST — two modes:
 *  - JSON {action: "createBucket", name, public?}
 *  - multipart upload: fields bucket, path, file
 */
export async function POST(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const bucket = String(form.get("bucket") ?? "");
      const objPath = String(form.get("path") ?? "");
      const file = form.get("file");
      if (!bucket || !objPath || !(file instanceof File)) {
        return ok({ error: "bucket, path and file are required" }, { status: 400 });
      }
      if (file.size > 20 * 1024 * 1024) {
        return ok({ error: "Max file size is 20MB" }, { status: 400 });
      }
      const data = Buffer.from(await file.arrayBuffer());
      const res = await storagePut(id, bucket, objPath, data, file.type || "application/octet-stream");
      await q(
        `INSERT INTO DHARA_FILES (ID, PROJECT_ID, BUCKET, PATH, SIZE_BYTES, MIME, DRIVER)
         VALUES (:id, :p, :b, :pa, :s, :m, :d)`,
        { id: uuid(), p: id, b: bucket, pa: objPath.slice(0, 500), s: data.length, m: file.type || "application/octet-stream", d: res.driver }
      );
      await audit("storage.upload", {
        req,
        userId: ctx.user?.ID,
        email: ctx.user?.EMAIL,
        target: `${bucket}/${objPath}`,
        projectId: id,
        detail: { size: data.length, driver: res.driver },
      });
      return NextResponse.json({ ok: true, ...res });
    }

    const body = (await req.json()) as { action?: string; name?: string; public?: boolean };
    if (body.action !== "createBucket" || !body.name) {
      return ok({ error: "action=createBucket and name are required" }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(body.name)) {
      return ok({ error: "Bucket name: 2-64 chars, letters/numbers/-/_" }, { status: 400 });
    }
    try {
      await q(
        `INSERT INTO DHARA_BUCKETS (ID, PROJECT_ID, NAME, IS_PUBLIC) VALUES (:id, :p, :n, :pub)`,
        { id: uuid(), p: id, n: body.name, pub: body.public ? 1 : 0 }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/ORA-00001/.test(msg)) return ok({ error: "Bucket already exists" }, { status: 409 });
      throw e;
    }
    await audit("storage.bucket.create", {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: body.name,
      projectId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE — delete object (?bucket=&path=) or bucket (?bucket=&dropBucket=1). */
export async function DELETE(req: NextRequest, { params }: P) {
  try {
    const ctx = await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const sp = new URL(req.url).searchParams;
    const bucket = sp.get("bucket") ?? "";
    if (!bucket) return ok({ error: "bucket required" }, { status: 400 });

    if (sp.get("dropBucket") === "1") {
      const objects = await storageList(id, bucket).catch(() => []);
      for (const o of objects) await storageDelete(id, bucket, o.name).catch(() => undefined);
      await q(`DELETE FROM DHARA_FILES WHERE PROJECT_ID = :p AND BUCKET = :b`, { p: id, b: bucket });
      await q(`DELETE FROM DHARA_BUCKETS WHERE PROJECT_ID = :p AND NAME = :b`, { p: id, b: bucket });
      await audit("storage.bucket.delete", { req, userId: ctx.user?.ID, email: ctx.user?.EMAIL, target: bucket, projectId: id });
      return NextResponse.json({ ok: true });
    }

    const objPath = sp.get("path") ?? "";
    if (!objPath) return ok({ error: "path required" }, { status: 400 });
    await storageDelete(id, bucket, objPath);
    await q(`DELETE FROM DHARA_FILES WHERE PROJECT_ID = :p AND BUCKET = :b AND PATH = :pa`, {
      p: id,
      b: bucket,
      pa: objPath,
    });
    await audit("storage.delete", {
      req,
      userId: ctx.user?.ID,
      email: ctx.user?.EMAIL,
      target: `${bucket}/${objPath}`,
      projectId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

/** PUT — download an object by path (admin; the signed URL route is /storage/file). */
export async function PUT(req: NextRequest, { params }: P) {
  try {
    await requireProjectAccess(req, (await params).id);
    await ensureConnection();
    const { id } = await params;
    const body = (await req.json()) as { bucket?: string; path?: string };
    if (!body.bucket || !body.path) return ok({ error: "bucket and path required" }, { status: 400 });
    const { data } = await storageGet(id, body.bucket, body.path);
    return new NextResponse(new Uint8Array(data), {
      headers: { "content-type": "application/octet-stream" },
    });
  } catch (e) {
    return handleError(e);
  }
}
