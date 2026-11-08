import { NextRequest, NextResponse } from "next/server";
import { login } from "@/lib/server/auth";
import { ensureConnection, isConfigured } from "@/lib/server/oracle";
import { handleError, ok, audit, rateLimitRequest, rateLimitAccount } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** POST — email+password login. Returns JWT access + refresh tokens. */
export async function POST(req: NextRequest) {
  try {
    // security: brute-force protection (CWE-307)
    rateLimitRequest(req, "auth:login", 10);
    if (!(await isConfigured())) {
      return ok({ error: "Connect Oracle first", code: "not_configured" }, { status: 428 });
    }
    await ensureConnection();
    const body = (await req.json()) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return ok({ error: "email and password are required" }, { status: 400 });
    }
    // security (C3): per-account brute-force limit — rotating X-Forwarded-For
    // no longer resets it, because it is keyed by the targeted account.
    rateLimitAccount(`login:${body.email.toLowerCase().slice(0, 120)}`, 5);
    const tokens = await login(
      body.email,
      body.password,
      req.headers.get("user-agent") ?? undefined,
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    );
    await audit("auth.login", {
      req,
      userId: tokens.user.id,
      email: tokens.user.email,
      target: tokens.user.email,
    });
    return NextResponse.json({ ok: true, ...tokens });
  } catch (e) {
    return handleError(e);
  }
}
