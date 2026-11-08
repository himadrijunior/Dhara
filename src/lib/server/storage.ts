import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readConfig, STORAGE_DIR } from "./config";
import { DharaError } from "./oracle";

/**
 * Dhara — storage engine.
 * Drivers: "local" (disk, active now) and "oci" (OCI Object Storage —
 * backend fully wired with signed requests; enable when ready).
 */

export interface StorageMeta {
  size: number;
  mime: string;
}

function localRoot(projectId: string, bucket: string): string {
  const safeBucket = bucket.replace(/[^A-Za-z0-9_-]/g, "");
  const safeProject = projectId.replace(/[^A-Za-z0-9-]/g, "");
  return path.join(STORAGE_DIR, safeProject, safeBucket);
}

function safeObjectPath(p: string): string {
  const clean = p
    .split("/")
    .map((seg) => seg.replace(/[^A-Za-z0-9._-]/g, "_"))
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
  if (!clean) throw new DharaError("Invalid object path", 400, "bad_path");
  return clean;
}

/* ------------------------------- LOCAL DRIVER ------------------------------ */

async function localPut(projectId: string, bucket: string, objectPath: string, data: Buffer) {
  const root = localRoot(projectId, bucket);
  const clean = safeObjectPath(objectPath);
  const full = path.join(root, clean);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
}

async function localGet(projectId: string, bucket: string, objectPath: string): Promise<Buffer> {
  const full = path.join(localRoot(projectId, bucket), safeObjectPath(objectPath));
  return fs.readFile(full);
}

async function localDelete(projectId: string, bucket: string, objectPath: string) {
  const full = path.join(localRoot(projectId, bucket), safeObjectPath(objectPath));
  await fs.rm(full, { force: true });
}

interface ListEntry {
  name: string;
  size: number;
  mime?: string;
  timeCreated?: string;
}

async function localList(projectId: string, bucket: string, prefix = ""): Promise<ListEntry[]> {
  const root = localRoot(projectId, bucket);
  const out: ListEntry[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        const st = await fs.stat(full).catch(() => null);
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (prefix && !rel.startsWith(prefix)) continue;
        out.push({
          name: rel,
          size: st?.size ?? 0,
          timeCreated: st?.birthtime.toISOString(),
        });
      }
    }
  }
  await walk(root);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/* -------------------------------- OCI DRIVER ------------------------------- */

function ociSign(
  method: string,
  pathWithQuery: string,
  host: string,
  body: Buffer | null,
  oci: { tenancy?: string; user?: string; fingerprint?: string; privateKey?: string }
): Record<string, string> {
  const { tenancy, user, fingerprint, privateKey } = oci;
  if (!tenancy || !user || !fingerprint || !privateKey) {
    throw new DharaError(
      "OCI storage is not configured. Add tenancy OCID, user OCID, fingerprint and private key in Settings → Storage.",
      400,
      "oci_not_configured"
    );
  }
  const date = new Date().toUTCString();
  const target = `(request-target): ${method.toLowerCase()} ${pathWithQuery}`;
  const hostLine = `host: ${host}`;
  const headers = ["(request-target)", "host", "(request-date)"];
  const signingParts = [target, hostLine, `(request-date): ${date}`];
  let contentSha = "";
  let contentLen = "";
  if (body !== null) {
    contentSha = crypto.createHash("sha256").update(body).digest("base64");
    contentLen = String(body.length);
    headers.push("x-content-sha256", "x-content-length");
    signingParts.push(`x-content-sha256: ${contentSha}`, `x-content-length: ${contentLen}`);
  }
  const signingString = signingParts.join("\n");
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingString)
    .sign(privateKey.replace(/\\n/g, "\n"), "base64");
  return {
    host,
    "(request-date)": date,
    ...(body !== null ? { "x-content-sha256": contentSha, "x-content-length": contentLen } : {}),
    authorization: `Signature version="1",keyId="${tenancy}/${user}/${fingerprint}",algorithm="rsa-sha256",headers="${headers.join(
      " "
    )}",signature="${signature}"`,
  };
}

async function ociRequest(
  method: string,
  objectPath: string,
  body: Buffer | null,
  acceptJson = false
): Promise<{ status: number; body: Buffer; json?: unknown }> {
  const cfg = await readConfig();
  const oci = cfg?.storage?.oci;
  if (!oci?.region || !oci?.namespace || !oci?.bucket) {
    throw new DharaError("OCI storage is not fully configured (region/namespace/bucket)", 400, "oci_not_configured");
  }
  const host = `objectstorage.${oci.region}.oraclecloud.com`;
  const encPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const pathWithQuery = `/n/${oci.namespace}/b/${oci.bucket}/o/${encPath}`;
  const headers = ociSign(method, pathWithQuery, host, body, oci);
  const res = await fetch(`https://${host}${pathWithQuery}`, {
    method,
    headers: {
      ...headers,
      ...(acceptJson ? { accept: "application/json" } : {}),
    },
    body: (body && method !== "GET" && method !== "HEAD" ? body : undefined) as BodyInit | undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: unknown;
  if (acceptJson) {
    try {
      json = JSON.parse(buf.toString("utf8"));
    } catch {
      json = undefined;
    }
  }
  return { status: res.status, body: buf, json };
}

function ociObjectPath(bucket: string, objectPath: string): string {
  const clean = safeObjectPath(objectPath);
  return `${bucket}/${clean}`;
}

/* ------------------------------- PUBLIC API -------------------------------- */

export async function storagePut(
  projectId: string,
  bucket: string,
  objectPath: string,
  data: Buffer,
  mime: string
): Promise<{ driver: string; size: number }> {
  const cfg = await readConfig();
  const driver = cfg?.storage?.driver ?? "local";
  if (driver === "oci") {
    const res = await ociRequest("PUT", ociObjectPath(bucket, objectPath), data);
    if (res.status >= 300) {
      throw new DharaError(`OCI upload failed: HTTP ${res.status}`, 502, "oci_upload_failed");
    }
    return { driver: "oci", size: data.length };
  }
  await localPut(projectId, bucket, objectPath, data);
  return { driver: "local", size: data.length };
}

export async function storageGet(
  projectId: string,
  bucket: string,
  objectPath: string
): Promise<{ data: Buffer; driver: string }> {
  const cfg = await readConfig();
  const driver = cfg?.storage?.driver ?? "local";
  if (driver === "oci") {
    const res = await ociRequest("GET", ociObjectPath(bucket, objectPath), null, true);
    if (res.status >= 300) {
      throw new DharaError(`OCI download failed: HTTP ${res.status}`, 404, "oci_get_failed");
    }
    return { data: res.body, driver: "oci" };
  }
  return { data: await localGet(projectId, bucket, objectPath), driver: "local" };
}

export async function storageDelete(projectId: string, bucket: string, objectPath: string): Promise<void> {
  const cfg = await readConfig();
  const driver = cfg?.storage?.driver ?? "local";
  if (driver === "oci") {
    await ociRequest("DELETE", ociObjectPath(bucket, objectPath), null);
    return;
  }
  await localDelete(projectId, bucket, objectPath);
}

export async function storageList(projectId: string, bucket: string, prefix = ""): Promise<ListEntry[]> {
  const cfg = await readConfig();
  const driver = cfg?.storage?.driver ?? "local";
  if (driver === "oci") {
    const res = await ociRequest(
      "GET",
      `${bucket}/?prefix=${encodeURIComponent(prefix)}&fields=name,size,timeCreated&limit=200`,
      null,
      true
    );
    const json = res.json as { objects?: { name: string; size?: number; timeCreated?: string }[] } | undefined;
    const objects = json?.objects ?? [];
    return objects.map((o) => ({
      name: o.name.replace(new RegExp(`^${bucket}/`), ""),
      size: o.size ?? 0,
      timeCreated: o.timeCreated,
    }));
  }
  return localList(projectId, bucket, prefix);
}

/** Signed download URL for the local driver. */
export async function signedLocalUrl(
  projectId: string,
  bucket: string,
  objectPath: string,
  ttlSeconds = 300
): Promise<string> {
  const cfg = await readConfig();
  const exp = Date.now() + ttlSeconds * 1000;
  const sig = crypto
    .createHmac("sha256", cfg?.jwtSecret ?? "dhara")
    .update(`${projectId}:${bucket}:${objectPath}:${exp}`)
    .digest("hex");
  const params = new URLSearchParams({ bucket, path: objectPath, exp: String(exp), sig });
  return `/api/projects/${projectId}/storage/file?${params.toString()}`;
}

export function verifyLocalSignature(
  projectId: string,
  bucket: string,
  objectPath: string,
  exp: string,
  sig: string
): boolean {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() > expNum) return false;
  const cfg = readConfigSync();
  const expected = crypto
    .createHmac("sha256", cfg?.jwtSecret ?? "dhara")
    .update(`${projectId}:${bucket}:${objectPath}:${exp}`)
    .digest("hex");
  return expected === sig;
}

// small sync read for signature verification
import fsSync from "node:fs";
function readConfigSync(): { jwtSecret: string } | null {
  try {
    const cfgPath = path.join(STORAGE_DIR, "..", "config.json");
    return JSON.parse(fsSync.readFileSync(cfgPath, "utf8"));
  } catch {
    return null;
  }
}
