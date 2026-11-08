import crypto from "node:crypto";
import { q } from "./oracle";
import { sha256Hex, uuid } from "./security";
import { getPublicOrigin } from "./publicOrigin";

/**
 * One-time email tokens (password reset, email verification, invites).
 * Only SHA-256 hashes are stored; tokens are single-use and short-lived.
 * Links are built from DHARA_PUBLIC_URL ONLY (R4) — never request headers.
 */

export type EmailTokenKind = "verify" | "reset";

const TTL_MINUTES: Record<EmailTokenKind, number> = { verify: 60 * 24, reset: 30 };

export async function createEmailToken(
  userId: string,
  kind: EmailTokenKind,
  ttlMinutes = TTL_MINUTES[kind]
): Promise<{ token: string; minutes: number }> {
  const token = crypto.randomBytes(32).toString("base64url");
  // invalidate previous unused tokens of the same kind for this user
  await q(
    `UPDATE DHARA_EMAIL_TOKENS SET USED_AT = SYSTIMESTAMP
     WHERE USER_ID = :u AND KIND = :k AND USED_AT IS NULL`,
    { u: userId, k: kind }
  );
  await q(
    `INSERT INTO DHARA_EMAIL_TOKENS (ID, USER_ID, TOKEN_HASH, KIND, EXPIRES_AT)
     VALUES (:id, :u, :h, :k, SYSTIMESTAMP + NUMTODSINTERVAL(:m, 'minute'))`,
    { id: uuid(), u: userId, h: sha256Hex(token), k: kind, m: ttlMinutes }
  );
  return { token, minutes: ttlMinutes };
}

export async function consumeEmailToken(
  token: string,
  kind: EmailTokenKind
): Promise<string | null> {
  const r = await q(
    `SELECT ID, USER_ID, EXPIRES_AT, USED_AT FROM DHARA_EMAIL_TOKENS
     WHERE TOKEN_HASH = :h AND KIND = :k`,
    { h: sha256Hex(token), k: kind }
  );
  const row = r.rows[0] as
    | { ID: string; USER_ID: string; EXPIRES_AT?: string; USED_AT?: string }
    | undefined;
  if (!row) return null;
  if (row.USED_AT) return null;
  if (row.EXPIRES_AT && new Date(row.EXPIRES_AT).getTime() < Date.now()) return null;
  await q(`UPDATE DHARA_EMAIL_TOKENS SET USED_AT = SYSTIMESTAMP WHERE ID = :id`, { id: row.ID });
  return row.USER_ID;
}

/** Action-link origin: operator-configured only, never request headers. */
export async function actionLinkOrigin(): Promise<string> {
  return getPublicOrigin();
}
