import { q, DharaError } from "./oracle";
import {
  uuid,
  sha256Hex,
  randomHex,
  hashPassword,
  verifyPassword,
  signJwt,
  verifyJwt,
} from "./security";

/** Dhara — platform auth: signup, login, sessions, JWT, OAuth. */

export interface PlatformUser {
  ID: string;
  EMAIL: string;
  NAME: string | null;
  ROLE: string;
  AVATAR_COLOR: string | null;
  PROVIDER: string;
  CREATED_AT?: string;
  LAST_LOGIN_AT?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarColor: string | null;
}

export function toPublicUser(u: PlatformUser): PublicUser {
  return {
    id: u.ID,
    email: u.EMAIL,
    name: u.NAME ?? u.EMAIL.split("@")[0],
    role: u.ROLE,
    avatarColor: u.AVATAR_COLOR ?? "#14B8A6",
  };
}

const AVATAR_COLORS = ["#14B8A6", "#F5A623", "#E05D5D", "#7C5CE0", "#2FA8CC", "#D4679E"];

export async function countUsers(): Promise<number> {
  const r = await q(`SELECT COUNT(*) AS N FROM DHARA_USERS`);
  return Number(r.rows[0]?.N ?? 0);
}

export async function getUserById(id: string): Promise<PlatformUser | null> {
  const r = await q(`SELECT * FROM DHARA_USERS WHERE ID = :id`, { id });
  return (r.rows[0] as unknown as PlatformUser) ?? null;
}

export async function getUserByEmail(email: string): Promise<PlatformUser | null> {
  const r = await q(`SELECT * FROM DHARA_USERS WHERE UPPER(EMAIL) = UPPER(:email)`, { email });
  return (r.rows[0] as unknown as PlatformUser) ?? null;
}

/** Signup. First ever user becomes platform owner. */
export async function signup(email: string, password: string, name?: string): Promise<PlatformUser> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DharaError("Invalid email address", 400, "bad_email");
  }
  if (!password || password.length < 8) {
    throw new DharaError("Password must be at least 8 characters", 400, "weak_password");
  }
  const existing = await getUserByEmail(email);
  if (existing) throw new DharaError("Email already registered", 409, "email_taken");
  const total = await countUsers();
  const user: PlatformUser = {
    ID: uuid(),
    EMAIL: email.toLowerCase().trim(),
    NAME: name?.trim() || null,
    ROLE: total === 0 ? "owner" : "member",
    AVATAR_COLOR: AVATAR_COLORS[total % AVATAR_COLORS.length],
    PROVIDER: "password",
  };
  await q(
    `INSERT INTO DHARA_USERS (ID, EMAIL, PASSWORD_HASH, NAME, ROLE, AVATAR_COLOR, PROVIDER)
     VALUES (:id, :email, :hash, :name, :role, :color, 'password')`,
    {
      id: user.ID,
      email: user.EMAIL,
      hash: await hashPassword(password),
      name: user.NAME,
      role: user.ROLE,
      color: user.AVATAR_COLOR,
    }
  ).catch(async (e) => {
    // security (CWE-367): two concurrent first signups could both claim owner.
    // The DHARA_OWNER_UQ unique index allows only one — retry as member.
    const msg = e instanceof Error ? e.message : String(e);
    if (user.ROLE === "owner" && /ORA-00001/.test(msg)) {
      user.ROLE = "member";
      await q(
        `INSERT INTO DHARA_USERS (ID, EMAIL, PASSWORD_HASH, NAME, ROLE, AVATAR_COLOR, PROVIDER)
         VALUES (:id, :email, :hash, :name, 'member', :color, 'password')`,
        {
          id: user.ID,
          email: user.EMAIL,
          hash: await hashPassword(password),
          name: user.NAME,
          color: user.AVATAR_COLOR,
        }
      );
      return;
    }
    throw e;
  });
  return user;
}

export async function createSession(
  userId: string,
  userAgent?: string,
  ip?: string
): Promise<{ sessionId: string; refreshToken: string }> {
  const sessionId = uuid();
  const refreshToken = randomHex(48);
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await q(
    `INSERT INTO DHARA_SESSIONS (ID, USER_ID, REFRESH_HASH, USER_AGENT, IP, EXPIRES_AT)
     VALUES (:id, :usr, :rh, :ua, :ip, :exp)`,
    {
      id: sessionId,
      usr: userId,
      rh: sha256Hex(refreshToken),
      ua: (userAgent ?? "unknown").slice(0, 380),
      ip: ip ?? null,
      exp: expires,
    }
  );
  return { sessionId, refreshToken };
}

export async function issueTokens(
  user: PlatformUser,
  sessionId: string,
  refreshToken: string
): Promise<TokenPair> {
  const accessToken = await signJwt(
    { sub: user.ID, email: user.EMAIL, name: user.NAME ?? undefined, role: user.ROLE, sid: sessionId },
    60 * 60 * 24
  );
  return { accessToken, refreshToken, user: toPublicUser(user) };
}

export async function login(
  email: string,
  password: string,
  userAgent?: string,
  ip?: string
): Promise<TokenPair> {
  const user = await getUserByEmail(email);
  if (!user) throw new DharaError("Invalid email or password", 401, "bad_credentials");
  const ok = await verifyPassword(password, (user as unknown as { PASSWORD_HASH?: string }).PASSWORD_HASH ?? null);
  if (!ok) throw new DharaError("Invalid email or password", 401, "bad_credentials");
  const { sessionId, refreshToken } = await createSession(user.ID, userAgent, ip);
  await q(`UPDATE DHARA_USERS SET LAST_LOGIN_AT = SYSTIMESTAMP WHERE ID = :id`, { id: user.ID });
  return issueTokens(user, sessionId, refreshToken);
}

/** Rotate refresh token (one-time use). */
export async function refreshSession(
  refreshToken: string,
  userAgent?: string,
  ip?: string
): Promise<TokenPair> {
  const r = await q(`SELECT * FROM DHARA_SESSIONS WHERE REFRESH_HASH = :rh AND REVOKED = 0`, {
    rh: sha256Hex(refreshToken),
  });
  const session = r.rows[0] as { ID: string; USER_ID: string; EXPIRES_AT?: string } | undefined;
  if (!session) throw new DharaError("Session expired. Please sign in again.", 401, "session_invalid");
  const exp = session.EXPIRES_AT ? new Date(session.EXPIRES_AT).getTime() : 0;
  if (Date.now() > exp) throw new DharaError("Session expired. Please sign in again.", 401, "session_expired");
  await q(`UPDATE DHARA_SESSIONS SET REVOKED = 1 WHERE ID = :id`, { id: session.ID });
  const user = await getUserById(session.USER_ID);
  if (!user) throw new DharaError("User not found", 401, "user_missing");
  const { sessionId, refreshToken: newRefresh } = await createSession(user.ID, userAgent, ip);
  return issueTokens(user, sessionId, newRefresh);
}

export async function logout(refreshToken?: string): Promise<void> {
  if (!refreshToken) return;
  await q(`UPDATE DHARA_SESSIONS SET REVOKED = 1 WHERE REFRESH_HASH = :rh`, {
    rh: sha256Hex(refreshToken),
  });
}

/** Resolve the platform user from an Authorization: Bearer <access JWT>. */
export async function userFromRequest(req: Request): Promise<PlatformUser | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token || token.startsWith("ikl_")) return null;
  const claims = await verifyJwt(token);
  if (!claims) return null;
  return getUserById(claims.sub);
}

export async function requireUser(req: Request): Promise<PlatformUser> {
  const user = await userFromRequest(req);
  if (!user) throw new DharaError("Authentication required", 401, "auth_required");
  return user;
}

export async function listUsers(): Promise<PlatformUser[]> {
  const r = await q(
    `SELECT ID, EMAIL, NAME, ROLE, AVATAR_COLOR, PROVIDER, CREATED_AT, LAST_LOGIN_AT FROM DHARA_USERS ORDER BY CREATED_AT ASC`
  );
  return r.rows as unknown as PlatformUser[];
}

/* --------------------------------- OAUTH ---------------------------------- */

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
}

export function googleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function googleExchange(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new DharaError(data.error_description ?? "Google token exchange failed", 400, "oauth_failed");
  }
  return data.access_token;
}

export async function googleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new DharaError("Failed to fetch Google profile", 400, "oauth_profile_failed");
  return (await res.json()) as GoogleProfile;
}

/** Find or create the user linked to an OAuth profile. */
export async function upsertOAuthUser(
  provider: string,
  profile: GoogleProfile
): Promise<PlatformUser> {
  const link = await q(
    `SELECT USER_ID FROM DHARA_OAUTH_ACCOUNTS WHERE PROVIDER = :p AND PROVIDER_UID = :pid`,
    { p: provider, pid: profile.sub }
  );
  if (link.rows[0]) {
    const user = await getUserById(String(link.rows[0].USER_ID));
    if (user) return user;
  }
  let user = await getUserByEmail(profile.email);
  if (!user) {
    const total = await countUsers();
    user = {
      ID: uuid(),
      EMAIL: profile.email.toLowerCase(),
      NAME: profile.name ?? profile.email.split("@")[0],
      ROLE: total === 0 ? "owner" : "member",
      AVATAR_COLOR: AVATAR_COLORS[total % AVATAR_COLORS.length],
      PROVIDER: provider,
    };
    await q(
      `INSERT INTO DHARA_USERS (ID, EMAIL, NAME, ROLE, AVATAR_COLOR, PROVIDER)
       VALUES (:id, :email, :name, :role, :color, :provider)`,
      {
        id: user.ID,
        email: user.EMAIL,
        name: user.NAME,
        role: user.ROLE,
        color: user.AVATAR_COLOR,
        provider,
      }
    );
  }
  await q(
    `INSERT INTO DHARA_OAUTH_ACCOUNTS (ID, USER_ID, PROVIDER, PROVIDER_UID, PROFILE)
     VALUES (:id, :usr, :p, :pid, :profile)`,
    { id: uuid(), usr: user.ID, p: provider, pid: profile.sub, profile: JSON.stringify(profile) }
  );
  return user;
}
