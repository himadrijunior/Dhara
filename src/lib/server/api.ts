import { NextResponse } from "next/server";
import { DharaError, q } from "./oracle";
import { PlatformUser, userFromRequest, getUserById } from "./auth";
import { getProject, ProjectRow } from "./dbapi";
import {
  PAT_SCOPES,
  PatScope,
  ScopeMode,
  expandScopes,
  rateLimit,
  sha256Hex,
  uuid,
} from "./security";

/** Dhara — API helpers: responses, auth context, scopes, usage, audit. */

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(status: number, message: string, code = "error") {
  return NextResponse.json({ error: message, code }, { status });
}

export function handleError(e: unknown) {
  if (e instanceof DharaError) {
    return fail(e.status, e.message, e.code);
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/ORA-\d+/.test(msg)) {
    return fail(502, `Oracle error: ${msg.slice(0, 300)}`, "oracle_error");
  }
  console.error("[dhara]", e);
  // security: never leak raw internal error text to clients
  return fail(500, "Internal error", "internal_error");
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new DharaError("Invalid JSON body", 400, "bad_json");
  }
}

/* -------------------------------- AUTH CONTEXT ----------------------------- */

export type AuthKind = "user" | "pat" | "pub" | "sec" | "none";

export interface AuthCtx {
  kind: AuthKind;
  user: PlatformUser | null;
  scopes: PatScope[];
  projectId: string | null;
  role: "anon" | "authenticated" | "service";
  patId?: string;
}

function parseScopes(mode: string, scopesRaw: string | null): PatScope[] {
  let specific: string[] = [];
  try {
    specific = scopesRaw ? JSON.parse(scopesRaw) : [];
  } catch {
    specific = [];
  }
  return expandScopes((mode as ScopeMode) ?? "full", specific);
}

/** Resolve platform session / PAT / project API key from request headers. */
export async function resolveAuthCtx(
  req: Request,
  opts?: { projectId?: string | null }
): Promise<AuthCtx> {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const apiKey =
    req.headers.get("x-api-key") ??
    new URL(req.url).searchParams.get("apikey") ??
    "";

  // 1) Personal Access Token
  if (bearer.startsWith("dh_pat_")) {
    const r = await q(
      `SELECT * FROM DHARA_PATS WHERE KEY_HASH = :h AND REVOKED = 0`,
      { h: sha256Hex(bearer) }
    );
    const pat = r.rows[0] as
      | { ID: string; USER_ID: string; SCOPE_MODE: string; SCOPES: string | null; EXPIRES_AT?: string }
      | undefined;
    if (!pat) throw new DharaError("Invalid or revoked personal access token", 401, "bad_pat");
    if (pat.EXPIRES_AT && new Date(pat.EXPIRES_AT).getTime() < Date.now()) {
      throw new DharaError("Personal access token expired", 401, "pat_expired");
    }
    void q(`UPDATE DHARA_PATS SET LAST_USED_AT = SYSTIMESTAMP WHERE ID = :id`, { id: pat.ID }).catch(
      () => undefined
    );
    const user = await getUserById(pat.USER_ID);
    return {
      kind: "pat",
      user,
      scopes: parseScopes(pat.SCOPE_MODE ?? "full", pat.SCOPES ?? null),
      projectId: opts?.projectId ?? null,
      role: "service",
      patId: pat.ID,
    };
  }

  // 2) Project API keys (pub/sec)
  if (apiKey.startsWith("dh_pub_") || apiKey.startsWith("dh_sec_")) {
    const kind = apiKey.startsWith("dh_pub_") ? "pub" : "sec";
    const r = await q(
      `SELECT * FROM DHARA_API_KEYS WHERE KEY_HASH = :h AND KIND = :k`,
      { h: sha256Hex(apiKey), k: kind }
    );
    const key = r.rows[0] as { ID: string; PROJECT_ID: string } | undefined;
    if (!key) throw new DharaError("Invalid API key", 401, "bad_api_key");
    if (opts?.projectId && key.PROJECT_ID !== opts.projectId) {
      throw new DharaError("API key does not belong to this project", 403, "key_project_mismatch");
    }
    void q(`UPDATE DHARA_API_KEYS SET LAST_USED_AT = SYSTIMESTAMP WHERE ID = :id`, {
      id: key.ID,
    }).catch(() => undefined);
    if (kind === "sec") {
      return { kind: "sec", user: null, scopes: [...PAT_SCOPES], projectId: key.PROJECT_ID, role: "service" };
    }
    // pub key → anon unless a platform JWT is also present
    if (bearer && !bearer.startsWith("ikl_")) {
      const claims = await import("./security").then((s) => s.verifyJwt(bearer));
      if (claims) {
        const user = await getUserById(claims.sub);
        return { kind: "pub", user, scopes: [], projectId: key.PROJECT_ID, role: "authenticated" };
      }
    }
    return { kind: "pub", user: null, scopes: [], projectId: key.PROJECT_ID, role: "anon" };
  }

  // 3) Platform session JWT
  if (bearer && !bearer.startsWith("ikl_")) {
    const { verifyJwt } = await import("./security");
    const claims = await verifyJwt(bearer);
    if (claims) {
      const user = await getUserById(claims.sub);
      if (user) {
        return {
          kind: "user",
          user,
          scopes: [...PAT_SCOPES],
          projectId: opts?.projectId ?? null,
          role: "authenticated",
        };
      }
    }
  }

  return { kind: "none", user: null, scopes: [], projectId: opts?.projectId ?? null, role: "anon" };
}

export async function requireUserCtx(req: Request): Promise<AuthCtx> {
  const ctx = await resolveAuthCtx(req);
  // security: dashboard/control-plane routes accept platform sessions only.
  // PATs are API tokens — they must use the scoped v1 data API / MCP, never
  // the dashboard surface (CWE-285: PAT scope escalation via control plane).
  if (ctx.kind !== "user" || !ctx.user) {
    throw new DharaError("Authentication required", 401, "auth_required");
  }
  return ctx;
}

/** Platform owner (first user) or admin — full instance administration. */
export function requirePlatformAdmin(ctx: AuthCtx): PlatformUser {
  if (!ctx.user || !["owner", "admin"].includes(ctx.user.ROLE)) {
    throw new DharaError("Administrator access required", 403, "admin_required");
  }
  return ctx.user;
}

/**
 * Tenant isolation: the session user must own the project, or be a platform
 * admin. Returns 404 (not 403) so foreign project IDs are indistinguishable
 * from nonexistent ones (CWE-639 mitigation).
 */
export async function requireProjectAccess(
  req: Request,
  projectId: string
): Promise<{ ctx: AuthCtx; user: PlatformUser; project: ProjectRow }> {
  const ctx = await requireUserCtx(req);
  const project = await getProject(projectId);
  const isOwner = project && project.OWNER_ID === ctx.user!.ID;
  const isAdmin = ["owner", "admin"].includes(ctx.user!.ROLE);
  if (!project || (!isOwner && !isAdmin)) {
    throw new DharaError("Project not found", 404, "project_not_found");
  }
  return { ctx, user: ctx.user!, project };
}

export function requireScope(ctx: AuthCtx, scope: PatScope): void {
  if (ctx.kind === "user") return; // dashboard sessions have implicit full access
  if (ctx.kind !== "pat") return; // project api keys are role-scoped, not scope-scoped
  if (!ctx.scopes.includes(scope)) {
    throw new DharaError(`Missing required scope: ${scope}`, 403, "scope_missing");
  }
}

export function rateLimitRequest(req: Request, bucket: string, limit = 240) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";
  const res = rateLimit(`${bucket}:${ip}`, limit);
  if (!res.ok) {
    throw new DharaError(
      `Rate limit exceeded. Retry in ${Math.ceil(res.resetInMs / 1000)}s.`,
      429,
      "rate_limited"
    );
  }
}

/* ------------------------------- USAGE & AUDIT ------------------------------ */

export async function trackUsage(userId: string, feature: string): Promise<void> {
  try {
    const f = feature.slice(0, 80);
    await q(
      `MERGE INTO DHARA_USAGE t
       USING (SELECT :u AS USER_ID, :f AS FEATURE FROM DUAL) s
       ON (t.USER_ID = s.USER_ID AND t.FEATURE = s.FEATURE)
       WHEN MATCHED THEN UPDATE SET t.CNT = t.CNT + 1, t.LAST_AT = SYSTIMESTAMP
       WHEN NOT MATCHED THEN INSERT (USER_ID, FEATURE, CNT, LAST_AT) VALUES (:u, :f, 1, SYSTIMESTAMP)`,
      { u: userId, f }
    );
  } catch {
    /* best effort */
  }
}

export async function getUsage(userId: string): Promise<{ FEATURE: string; CNT: number }[]> {
  const r = await q(
    `SELECT FEATURE, CNT FROM DHARA_USAGE WHERE USER_ID = :u ORDER BY CNT DESC, LAST_AT DESC`,
    { u: userId }
  );
  return r.rows as { FEATURE: string; CNT: number }[];
}

export async function getSetting(userId: string, key: string): Promise<unknown> {
  const r = await q(`SELECT SETTING_VALUE FROM DHARA_SETTINGS WHERE USER_ID = :u AND SETTING_KEY = :k`, {
    u: userId,
    k: key,
  });
  const raw = r.rows[0]?.SETTING_VALUE;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function setSetting(userId: string, key: string, value: unknown): Promise<void> {
  const raw = JSON.stringify(value ?? null).slice(0, 3000);
  await q(
    `MERGE INTO DHARA_SETTINGS t
     USING (SELECT :u AS USER_ID, :k AS SETTING_KEY FROM DUAL) s
     ON (t.USER_ID = s.USER_ID AND t.SETTING_KEY = s.SETTING_KEY)
     WHEN MATCHED THEN UPDATE SET t.SETTING_VALUE = :v
     WHEN NOT MATCHED THEN INSERT (USER_ID, SETTING_KEY, SETTING_VALUE) VALUES (:u, :k, :v)`,
    { u: userId, k: key.slice(0, 80), v: raw }
  );
}

export async function audit(
  action: string,
  opts: {
    req?: Request;
    userId?: string | null;
    email?: string | null;
    target?: string;
    projectId?: string | null;
    detail?: unknown;
  } = {}
): Promise<void> {
  try {
    const ip =
      opts.req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      opts.req?.headers.get("x-real-ip") ??
      "local";
    await q(
      `INSERT INTO DHARA_AUDIT (ID, USER_ID, EMAIL, ACTION, TARGET, PROJECT_ID, DETAIL, IP)
       VALUES (:id, :usr, :email, :action, :target, :pid, :detail, :ip)`,
      {
        id: uuid(),
        usr: opts.userId ?? null,
        email: opts.email ?? null,
        action: action.slice(0, 80),
        target: (opts.target ?? "").slice(0, 200),
        pid: opts.projectId ?? null,
        detail: opts.detail ? JSON.stringify(opts.detail).slice(0, 3000) : null,
        ip,
      }
    );
  } catch {
    /* best effort */
  }
}
