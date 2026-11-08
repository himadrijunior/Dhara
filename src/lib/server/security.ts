import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { DharaError } from "./oracle";
import { readConfig } from "./config";

/** Dhara — cryptography, tokens & rate limiting primitives. */

export function uuid(): string {
  return crypto.randomUUID();
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomHex(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function randomToken(prefix: string): string {
  return `${prefix}${crypto.randomBytes(24).toString("hex")}`;
}

export function hmacSign(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export async function getJwtSecret(): Promise<string> {
  const cfg = await readConfig();
  // security (R8): never fall back to a predictable/hardcoded secret. Tokens
  // are only needed once the instance is configured — the Setup Wizard writes
  // a strong random secret into .dhara/config.json (0600) on first save.
  if (!cfg?.jwtSecret) {
    throw new DharaError(
      "JWT secret missing — complete the Setup Wizard first",
      503,
      "not_configured"
    );
  }
  return cfg.jwtSecret;
}

export interface JwtClaims {
  sub: string;
  email: string;
  name?: string;
  role: string;
  sid?: string;
}

export async function signJwt(claims: JwtClaims, expiresInSeconds = 60 * 60 * 24): Promise<string> {
  const secret = new TextEncoder().encode(await getJwtSecret());
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer("dhara-db")
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<JwtClaims | null> {
  try {
    const secret = new TextEncoder().encode(await getJwtSecret());
    const { payload } = await jwtVerify(token, secret, { issuer: "dhara-db" });
    if (!payload.sub) return null;
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? ""),
      name: payload.name ? String(payload.name) : undefined,
      role: String(payload.role ?? "member"),
      sid: payload.sid ? String(payload.sid) : undefined,
    };
  } catch {
    return null;
  }
}

/* -------------------------------- RATE LIMIT ------------------------------- */

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

/** Fixed-window rate limit. Returns {ok, remaining, resetInMs}. */
export function rateLimit(key: string, limit = 120, windowMs = 60_000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetInMs: windowMs };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, remaining: 0, resetInMs: b.resetAt - now };
  }
  return { ok: true, remaining: limit - b.count, resetInMs: b.resetAt - now };
}

/**
 * Failure-only rate limiting (R2): IP buckets must count FAILED attempts only,
 * so one attacker cannot lock legitimate users out by burning a shared quota
 * with their own failed requests. Success never touches the bucket.
 */
export function failureCount(key: string): number {
  const b = buckets.get(key);
  if (!b || b.resetAt <= Date.now()) return 0;
  return b.count;
}

export function failureResetInMs(key: string, windowMs = 15 * 60_000): number {
  const b = buckets.get(key);
  if (!b || b.resetAt <= Date.now()) return 0;
  return b.resetAt - Date.now() || windowMs;
}

/** Record one failed attempt. Returns true when the bucket is now over the limit. */
export function recordFailure(key: string, limit = 20, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}

// Prevent unbounded growth of the in-memory limiter
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}, 120_000).unref?.();

/* ------------------------------ PAT SCOPE MODEL ---------------------------- */

export const PAT_SCOPES = [
  "projects:read",
  "projects:manage",
  "db:read",
  "db:write",
  "sql:run",
  "auth:read",
  "auth:manage",
  "storage:read",
  "storage:write",
  "webhooks:manage",
] as const;

export type PatScope = (typeof PAT_SCOPES)[number];
export type ScopeMode = "full" | "read_only" | "specific";

export function expandScopes(mode: ScopeMode, specific: string[]): PatScope[] {
  if (mode === "full") return [...PAT_SCOPES];
  if (mode === "read_only") return PAT_SCOPES.filter((s) => s.endsWith(":read")) as PatScope[];
  return specific.filter((s): s is PatScope =>
    (PAT_SCOPES as readonly string[]).includes(s)
  );
}

export function hasScope(scopes: PatScope[], needed: PatScope): boolean {
  return scopes.includes(needed);
}
