import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { WALLET_DIR, writeConfig } from "@/lib/server/config";
import { handleError } from "@/lib/server/api";
import { assertSetupAllowed } from "@/lib/server/setupGuard";
import { DharaError } from "@/lib/server/oracle";

export const dynamic = "force-dynamic";

/**
 * POST — upload the Autonomous DB wallet zip (mTLS).
 *
 * security (C1): this route previously had NO auth at all and extracted the
 * zip straight into the live wallet dir with no allowlist and no uncompressed
 * size cap — a 306 KB "zip bomb" wrote 301 MB to disk and any caller could
 * replace the wallet to redirect the instance at their own DB (chained with
 * the setup fail-open → full instance takeover). Fixes:
 *   1. same fail-closed setup guard as /api/setup (admin once configured,
 *      optional DHARA_SETUP_TOKEN on first run),
 *   2. strict filename allowlist (a real Oracle wallet contains nothing else),
 *   3. per-file + total uncompressed size caps checked BEFORE extraction,
 *   4. staged extraction + atomic swap — a failed upload never touches the
 *      live wallet.
 */
const ALLOWED_FILES = new Set([
  "cwallet.sso",
  "ewallet.p12",
  "ewallet.pem",
  "tnsnames.ora",
  "sqlnet.ora",
  "keystore.jks",
  "truststore.jks",
  "ojdbc.properties",
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024; // real wallet files are < 100 KB
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/**
 * R1: read a zip entry as a stream and abort as soon as `max` bytes are seen.
 * The header-recorded `uncompressedSize` is attacker-controlled — a forged
 * header ("100 B") previously let a 400 MB bomb inflate fully into memory
 * before the post-hoc length check fired. Counting the actual decompressed
 * bytes is the only trustworthy limit.
 */
function readCapped(entry: JSZip.JSZipObject, max: number, name: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    const s = entry.nodeStream() as unknown as Readable;
    s.on("data", (c: Buffer) => {
      n += c.length;
      if (n > max) {
        s.destroy();
        reject(new DharaError(`Wallet file too large: ${name}`, 400, "wallet_too_big"));
      } else {
        chunks.push(c);
      }
    });
    s.on("end", () => resolve(Buffer.concat(chunks)));
    s.on("error", (err: unknown) => {
      s.destroy();
      reject(
        err instanceof DharaError
          ? err
          : new DharaError(`Failed to read wallet zip entry: ${name}`, 400, "wallet_invalid")
      );
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    await assertSetupAllowed(req);

    // R1: reject oversized uploads BEFORE formData() buffers the whole body.
    // 5 MB zip cap + multipart overhead margin; chunked bodies without a
    // Content-Length fall through to the per-entry stream cap below.
    const clen = Number(req.headers.get("content-length") ?? 0);
    if (clen > 6 * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: "Wallet zip too large (max 5MB)", code: "wallet_too_big" },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const file = form.get("wallet");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "wallet zip file is required (field name: wallet)" },
        { status: 400 }
      );
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "Wallet zip too large (max 5MB)" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);

    const staging = `${WALLET_DIR}.staging-${Date.now().toString(36)}`;
    const aliases: string[] = [];
    let total = 0;

    try {
      await fs.mkdir(staging, { recursive: true });
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const name = path.basename(entry.name);
        if (!ALLOWED_FILES.has(name)) continue; // junk / dotfiles / nested paths dropped

        // zip-bomb guard (fast path): the recorded size rejects honest bombs
        // instantly; readCapped() below is the authoritative forged-header guard
        const meta = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
        if (meta?.uncompressedSize && meta.uncompressedSize > MAX_FILE_BYTES) {
          throw new DharaError(`Wallet file too large: ${name}`, 400, "wallet_too_big");
        }
        const content = await readCapped(entry, MAX_FILE_BYTES, name);
        total += content.length;
        if (content.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
          throw new DharaError(
            "Wallet too large (per-file 2MB / total 8MB uncompressed)",
            400,
            "wallet_too_big"
          );
        }

        await fs.writeFile(path.join(staging, name), content);
        if (name === "tnsnames.ora") {
          const re = /^([A-Za-z0-9_]+)\s*=/gm;
          let m: RegExpExecArray | null;
          const text = content.toString("utf8");
          while ((m = re.exec(text))) if (!aliases.includes(m[1])) aliases.push(m[1]);
        }
      }

      if (!aliases.length) {
        throw new DharaError(
          "tnsnames.ora not found in the zip — is this a valid wallet?",
          400,
          "wallet_invalid"
        );
      }

      // atomic swap: the live wallet dir is only replaced after full validation
      await fs.rm(WALLET_DIR, { recursive: true, force: true });
      await fs.rename(staging, WALLET_DIR);
    } catch (e) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw e;
    }

    // keep sqlnet.ora consistent for thick-mode users (thin mode reads configDir)
    try {
      const sqlnetPath = path.join(WALLET_DIR, "sqlnet.ora");
      let sqlnet = await fs.readFile(sqlnetPath, "utf8");
      const line = `WALLET_LOCATION = (SOURCE = (METHOD = FILE) (METHOD_DATA = (DIRECTORY = ${WALLET_DIR})))`;
      if (/WALLET_LOCATION/i.test(sqlnet)) {
        sqlnet = sqlnet.replace(/WALLET_LOCATION\s*=[^\n]*/i, line);
      } else {
        sqlnet += `\n${line}\nSSL_CLIENT_AUTHENTICATION = TRUE\n`;
      }
      await fs.writeFile(sqlnetPath, sqlnet);
    } catch {
      /* sqlnet.ora is optional */
    }

    await writeConfig({ oracle: { walletDir: WALLET_DIR } as never });
    return NextResponse.json({ ok: true, aliases });
  } catch (e) {
    return handleError(e);
  }
}
