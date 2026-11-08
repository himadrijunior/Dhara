import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";
import { WALLET_DIR, writeConfig } from "@/lib/server/config";
import { handleError, ok } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** POST — upload the Autonomous DB wallet zip (mTLS). Extracts + wires config. */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("wallet");
    if (!(file instanceof File)) {
      return ok({ ok: false, error: "wallet zip file is required (field name: wallet)" }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return ok({ ok: false, error: "Wallet zip too large (max 5MB)" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);

    await fs.mkdir(WALLET_DIR, { recursive: true });
    const aliases: string[] = [];

    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const name = path.basename(entry.name);
      const content = await entry.async("nodebuffer");
      await fs.writeFile(path.join(WALLET_DIR, name), content);
      if (name === "tnsnames.ora") {
        const text = content.toString("utf8");
        const re = /^([A-Za-z0-9_]+)\s*=/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) aliases.push(m[1]);
      }
      if (name === "sqlnet.ora") {
        // rewrite WALLET_LOCATION to the extracted directory
        let sqlnet = content.toString("utf8");
        if (/WALLET_LOCATION/i.test(sqlnet)) {
          sqlnet = sqlnet.replace(
            /WALLET_LOCATION\s*=[^\n]*/i,
            `WALLET_LOCATION = (SOURCE = (METHOD = FILE) (METHOD_DATA = (DIRECTORY = ${WALLET_DIR})))`
          );
        } else {
          sqlnet += `\nWALLET_LOCATION = (SOURCE = (METHOD = FILE) (METHOD_DATA = (DIRECTORY = ${WALLET_DIR})))\nSSL_CLIENT_AUTHENTICATION = TRUE\n`;
        }
        await fs.writeFile(path.join(WALLET_DIR, "sqlnet.ora"), sqlnet);
      }
    }

    if (!aliases.length) {
      return ok(
        { ok: false, error: "tnsnames.ora not found in the zip — is this a valid wallet?" },
        { status: 400 }
      );
    }

    await writeConfig({ oracle: { walletDir: WALLET_DIR } as never });
    return NextResponse.json({ ok: true, aliases });
  } catch (e) {
    return handleError(e);
  }
}
