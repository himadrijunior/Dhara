import { NextRequest, NextResponse } from "next/server";
import {
  isConfigured,
  ensureConnection,
  closePool,
  checkConnection,
} from "@/lib/server/oracle";
import { readConfig, writeConfig, redactConfig, deleteConfig } from "@/lib/server/config";
import { DharaError } from "@/lib/server/oracle";
import { handleError, ok, requireUserCtx, requirePlatformAdmin } from "@/lib/server/api";
import { countUsers } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** GET — setup + connection status (safe, no secrets). */
export async function GET() {
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
    return NextResponse.json({
      configured,
      connected,
      banner,
      hasUsers,
      config: redactConfig(cfg),
    });
  } catch (e) {
    return handleError(e);
  }
}

/** POST — save Oracle credentials and connect (Setup Wizard). */
export async function POST(req: NextRequest) {
  try {
    // security: once the instance is configured and has users, reconfiguring
    // the database connection is takeover — platform admins only (CWE-306)
    try {
      if ((await isConfigured()) && (await countUsers()) > 0) {
        const ctx = await requireUserCtx(req);
        requirePlatformAdmin(ctx);
      }
    } catch (e) {
      if (e instanceof DharaError) throw e;
    }
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

/** DELETE — disconnect and wipe credentials (platform admins only once configured). */
export async function DELETE(req: NextRequest) {
  try {
    if (await isConfigured()) {
      const ctx = await requireUserCtx(req);
      requirePlatformAdmin(ctx);
    }
    await closePool();
    await deleteConfig();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
