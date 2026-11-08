import { NextRequest, NextResponse } from "next/server";
import { signup, login } from "@/lib/server/auth";
import { ensureConnection, isConfigured } from "@/lib/server/oracle";
import { handleError, ok, audit, rateLimitRequest } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** POST — owner/member signup. Body: {name?, email, password}. */
export async function POST(req: NextRequest) {
  try {
    // security: account-creation flood protection
    rateLimitRequest(req, "auth:signup", 5);
    if (!(await isConfigured())) {
      return ok({ error: "Connect Oracle first", code: "not_configured" }, { status: 428 });
    }
    await ensureConnection();
    const body = (await req.json()) as { name?: string; email?: string; password?: string };
    if (!body.email || !body.password) {
      return ok({ error: "email and password are required" }, { status: 400 });
    }
    const user = await signup(body.email, body.password, body.name);
    // auto-login after signup
    const tokens = await login(body.email, body.password, req.headers.get("user-agent") ?? undefined);
    await audit("auth.signup", { req, userId: user.ID, email: user.EMAIL, target: user.EMAIL });
    const res = NextResponse.json({ ok: true, ...tokens });
    return res;
  } catch (e) {
    return handleError(e);
  }
}
