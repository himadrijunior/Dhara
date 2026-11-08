import { NextRequest, NextResponse } from "next/server";
import { ensureConnection } from "@/lib/server/oracle";
import { handleError, requireUserCtx, getSetting, setSetting, audit } from "@/lib/server/api";
import { readConfig, writeConfig } from "@/lib/server/config";

export const dynamic = "force-dynamic";

/** GET — user settings (autoOrganize etc). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const autoOrganize = await getSetting(ctx.user!.ID, "autoOrganize");
    return NextResponse.json({
      autoOrganize: autoOrganize === null ? true : Boolean(autoOrganize),
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * POST — save settings.
 * Body: {autoOrganize?: boolean} | {oauth?: {google: {clientId, clientSecret}}}
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireUserCtx(req);
    await ensureConnection();
    const body = (await req.json()) as {
      autoOrganize?: boolean;
      oauth?: { google?: { clientId?: string; clientSecret?: string } };
    };
    if (typeof body.autoOrganize === "boolean") {
      await setSetting(ctx.user!.ID, "autoOrganize", body.autoOrganize);
      await audit("settings.auto_organize", {
        req,
        userId: ctx.user!.ID,
        email: ctx.user!.EMAIL,
        target: String(body.autoOrganize),
      });
    }
    if (body.oauth?.google) {
      const { clientId, clientSecret } = body.oauth.google;
      await writeConfig({
        oauth: {
          google: {
            ...(clientId ? { clientId } : {}),
            ...(clientSecret ? { clientSecret } : {}),
          },
        },
      });
      await audit("settings.oauth", {
        req,
        userId: ctx.user!.ID,
        email: ctx.user!.EMAIL,
        target: "google",
      });
    }
    const cfg = await readConfig();
    return NextResponse.json({
      ok: true,
      oauthGoogle: cfg?.oauth?.google?.clientId
        ? { clientId: cfg.oauth.google.clientId, hasSecret: !!cfg.oauth.google.clientSecret }
        : null,
    });
  } catch (e) {
    return handleError(e);
  }
}
