import { NextRequest, NextResponse } from "next/server";
import { signup, login, countUsers } from "@/lib/server/auth";
import { ensureConnection, isConfigured } from "@/lib/server/oracle";
import {
  handleError,
  ok,
  audit,
  rateLimitRequest,
  clientIp,
  sanitizeIp,
} from "@/lib/server/api";
import { readConfig } from "@/lib/server/config";
import { verifySetupToken, consumeSetupToken } from "@/lib/server/setupToken";
import { sha256Hex } from "@/lib/server/security";
import { q } from "@/lib/server/oracle";
import { setRefreshCookie } from "@/lib/server/cookies";
import { createEmailToken, actionLinkOrigin } from "@/lib/server/emailAuth";
import { verifyEmailMail, sendMail } from "@/lib/server/mail";

export const dynamic = "force-dynamic";

type SignupMode = "open" | "invite" | "closed";

function signupMode(cfg: Awaited<ReturnType<typeof readConfig>>): SignupMode {
  return cfg?.settings?.signup ?? "invite";
}

/** GET — public: which signup mode is active (UI needs this to render forms). */
export async function GET() {
  try {
    const cfg = await readConfig();
    const configured = await isConfigured();
    let ownerExists = false;
    if (configured) {
      try {
        ownerExists = (await countUsers()) > 0;
      } catch {
        ownerExists = true; // fail-closed: assume signup is gated
      }
    }
    return ok({ mode: ownerExists ? signupMode(cfg) : "open", ownerExists });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * POST — owner/member signup.
 *  security (R3): the FIRST signup (owner boot) requires the setup token
 *  (`x-setup-token` header or `setupToken` body field) — the same token the
 *  Setup Wizard used. Once the owner exists the token file is consumed.
 *  security (H5): signup mode — `invite` (default) requires a valid unconsumed
 *  invite token for that email; `closed` rejects everyone except the owner boot.
 */
export async function POST(req: NextRequest) {
  try {
    rateLimitRequest(req, "auth:signup", 5);
    if (!(await isConfigured())) {
      return ok({ error: "Connect Oracle first", code: "not_configured" }, { status: 428 });
    }
    await ensureConnection();
    const body = (await req.json()) as {
      name?: string;
      email?: string;
      password?: string;
      inviteToken?: string;
      setupToken?: string;
    };
    if (!body.email || !body.password) {
      return ok({ error: "email and password are required" }, { status: 400 });
    }

    const total = await countUsers();
    const isOwnerBoot = total === 0;
    const cfg = await readConfig();
    const mode = signupMode(cfg);

    if (isOwnerBoot) {
      // R3: first owner claims the instance — setup token required
      const presented = req.headers.get("x-setup-token") ?? body.setupToken ?? null;
      if (!(await verifySetupToken(presented))) {
        return ok(
          {
            error:
              "Setup token required for the first signup (x-setup-token header) — see the server log",
            code: "setup_token",
          },
          { status: 401 }
        );
      }
    } else if (mode === "closed") {
      return ok({ error: "Signup is disabled on this instance", code: "signup_closed" }, { status: 403 });
    } else if (mode === "invite") {
      if (!body.inviteToken) {
        return ok(
          { error: "This instance is invite-only. Ask an admin for an invitation.", code: "invite_required" },
          { status: 403 }
        );
      }
      const r = await q(
        `SELECT ID, EMAIL, ROLE FROM DHARA_INVITES
         WHERE TOKEN_HASH = :h AND USED_AT IS NULL AND EXPIRES_AT > SYSTIMESTAMP`,
        { h: sha256Hex(body.inviteToken) }
      );
      const invite = r.rows[0] as { ID: string; EMAIL: string; ROLE: string } | undefined;
      if (!invite || invite.EMAIL.toUpperCase() !== body.email.toUpperCase()) {
        return ok({ error: "Invalid or expired invitation", code: "invite_invalid" }, { status: 403 });
      }
      // consume the invite and carry its role
      await q(`UPDATE DHARA_INVITES SET USED_AT = SYSTIMESTAMP WHERE ID = :id`, { id: invite.ID });
      const user = await signup(body.email, body.password, body.name);
      if (invite.ROLE === "admin") {
        await q(`UPDATE DHARA_USERS SET ROLE = 'admin' WHERE ID = :id`, { id: user.ID });
        user.ROLE = "admin";
      }
      const tokens = await login(body.email, body.password, req.headers.get("user-agent") ?? undefined);
      await audit("auth.signup.invite", { req, userId: user.ID, email: user.EMAIL, target: user.EMAIL });
      const res = NextResponse.json({ ok: true, accessToken: tokens.accessToken, user: tokens.user });
      setRefreshCookie(res, tokens.refreshToken, req);
      return res;
    }

    const user = await signup(body.email, body.password, body.name);
    if (isOwnerBoot) await consumeSetupToken();
    // auto-login after signup
    const tokens = await login(
      body.email,
      body.password,
      req.headers.get("user-agent") ?? undefined,
      sanitizeIp(clientIp(req)) ?? undefined
    );
    await audit("auth.signup", { req, userId: user.ID, email: user.EMAIL, target: user.EMAIL });

    // WS3: send the verification email (async, best-effort) when mail works
    try {
      const { token } = await createEmailToken(user.ID, "verify");
      const base = await actionLinkOrigin();
      const link = `${base}/#/verify?token=${encodeURIComponent(token)}`;
      sendMail(verifyEmailMail(user.EMAIL, link));
    } catch {
      /* verification mail is best-effort */
    }

    const res = NextResponse.json({ ok: true, accessToken: tokens.accessToken, user: tokens.user });
    setRefreshCookie(res, tokens.refreshToken, req);
    return res;
  } catch (e) {
    return handleError(e);
  }
}
