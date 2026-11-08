import { NextRequest, NextResponse } from "next/server";
import {
  isConfigured,
  ensureConnection,
  closePool,
  checkConnection,
} from "@/lib/server/oracle";
import { readConfig, writeConfig, redactConfig, deleteConfig } from "@/lib/server/config";
import { handleError, ok, requireUserCtx, requirePlatformAdmin } from "@/lib/server/api";
import { assertSetupAllowed } from "@/lib/server/setupGuard";
import { countUsers } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** GET — setup + connection status. Config details are admin-only (M10). */
export async function GET(req: NextRequest) {
  try {
    const configured = await isConfigured();
    const cfg = await readConfig();
    let connected = false;
    let banner = "";
    if (configured) {
      try {
        const c = await checkConnection();
        connected = true;
        banner = c.banner;
      } catch {
        connected = false;
      }
    }
    let hasUsers = false;
    if (connected) {
      try {
        hasUsers = (await countUsers()) > 0;
      } catch {
        hasUsers = false;
      }
    }

    // security (M10): `oracle.user`, connect string and OCI storage details
    // were readable by ANY caller. Anonymous/unprivileged clients now get
    // status fields only; the redacted config requires a platform admin.
    let config: ReturnType<typeof redactConfig> = null;
    if (configured) {
      try {
        const ctx = await requireUserCtx(req);
        requirePlatformAdmin(ctx);
        config = redactConfig(cfg);
      } catch {
        config = null;
      }
    }

    return NextResponse.json({ configured, connected, banner, hasUsers, config });
  } catch (e) {
    return handleError(e);
  }
}

/** POST — save Oracle credentials and connect (Setup Wizard). Fail-closed. */
export async function POST(req: NextRequest) {
  try {
    // security (C2): this guard is now fail-closed. Previously a DB outage
    // made `countUsers()` throw, the try/catch swallowed it and ANY caller
    // could overwrite the Oracle credentials (instance takeover when chained
    // with the wallet upload). See src/lib/server/setupGuard.ts.
    await assertSetupAllowed(req);

    const body = (await req.json()) as {
      instanceName?: string;
      user?: string;
      password?: string;
      connectString?: string;
      walletPassword?: string;
    };
    if (!body.user || !body.password || !body.connectString) {
      return ok({ ok: false, error: "user, password and connectString are required" }, { status: 400 });
    }
    await writeConfig({
      ...(body.instanceName ? { instanceName: body.instanceName } : {}),
      oracle: {
        user: body.user.trim(),
        password: body.password,
        connectString: body.connectString.trim(),
        walletPassword: body.walletPassword || undefined,
      },
      connectedAt: new Date().toISOString(),
    });
    try {
      await closePool();
      await ensureConnection();
      return NextResponse.json({ ok: true, banner: (await checkConnection()).banner });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE — disconnect and wipe credentials (same fail-closed guard). */
export async function DELETE(req: NextRequest) {
  try {
    await assertSetupAllowed(req);
    await closePool();
    await deleteConfig();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
