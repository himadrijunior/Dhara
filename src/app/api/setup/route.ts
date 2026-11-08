import { NextRequest, NextResponse } from "next/server";
import {
  isConfigured,
  ensureConnection,
  closePool,
  checkConnection,
} from "@/lib/server/oracle";
import { readConfig, writeConfig, redactConfig, deleteConfig, type MailConfig } from "@/lib/server/config";
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

/**
 * PATCH — instance settings + email provider config (admin-only).
 * Body: { settings?: { signup: "open"|"invite"|"closed" }, mail?: MailConfig }.
 * Mail secrets are stored in .dhara/config.json (0600) and always redacted in
 * GET responses — they are never echoed back to any client.
 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    requirePlatformAdmin(ctx);
    const body = (await req.json()) as {
      settings?: { signup?: "open" | "invite" | "closed" };
      mail?: Partial<MailConfig>;
    };
    const patch: {
      settings?: { signup?: "open" | "invite" | "closed" };
      mail?: MailConfig;
    } = {};
    if (body.settings) {
      const mode = body.settings.signup;
      if (mode && !["open", "invite", "closed"].includes(mode)) {
        return ok({ ok: false, error: "signup must be open | invite | closed" }, { status: 400 });
      }
      patch.settings = { signup: mode };
    }
    if (body.mail) {
      const existing = (await readConfig())?.mail;
      const provider = body.mail.provider ?? existing?.provider ?? "console";
      if (!["console", "resend", "smtp"].includes(provider)) {
        return ok({ ok: false, error: "unknown mail provider" }, { status: 400 });
      }
      patch.mail = {
        provider,
        from: body.mail.from ?? existing?.from,
        resendApiKey: body.mail.resendApiKey ?? existing?.resendApiKey,
        smtp: {
          host: body.mail.smtp?.host ?? existing?.smtp?.host ?? "",
          port: body.mail.smtp?.port ?? existing?.smtp?.port ?? 587,
          secure: body.mail.smtp?.secure ?? existing?.smtp?.secure,
          user: body.mail.smtp?.user ?? existing?.smtp?.user,
          pass: body.mail.smtp?.pass ?? existing?.smtp?.pass,
        },
      };
    }
    if (!patch.settings && !patch.mail) {
      return ok({ ok: false, error: "nothing to update" }, { status: 400 });
    }
    await writeConfig(patch);
    return NextResponse.json({ ok: true, config: redactConfig(await readConfig()) });
  } catch (e) {
    return handleError(e);
  }
}
