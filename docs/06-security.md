# 6 · Security

Dhara's security model, in one document. Read it before exposing an instance to the internet.

## 1 · Threat model

| Asset | Adversary | Control |
|---|---|---|
| Oracle credentials | Repo readers, container image pullers | `.dhara/` git-ignored · `0600` · never in image · redacted in every API response |
| Dashboard accounts | Credential stuffing, session theft | bcrypt, rotating refresh tokens, hashed at rest |
| Application data | Anonymous & cross-tenant access | API keys + RLS (deny-by-default) |
| Service keys | Leakage into browsers/frontends | documented discipline (server-side only) |
| Webhook receivers | Spoofed events | HMAC-SHA256 signature over raw body |
| Public endpoints | Abuse/DoS | per-key/IP rate limiting → `429` |

## 2 · The wallet & credentials

- The Setup Wizard writes `.dhara/config.json` with mode `0600` on a private path. It is in `.gitignore`; **never** copy it into a repo, image layer or log line.
- Wallet ZIPs are extracted to `.dhara/wallet/` (same protection). Prefer DB-network ACLs to your server's IP so even a leaked wallet is useless elsewhere.
- All config-bearing responses pass through `redactConfig()` — passwords, secrets and PEM keys are replaced by `has*` booleans.

## 3 · Passwords & tokens

| Secret | Storage | Notes |
|---|---|---|
| Dashboard passwords | bcrypt (cost 10) | min 8 chars, signup-validated |
| JWT access token | in-memory client side | HS256 (`jose`), 24 h expiry, carries `sub/role/sid` |
| Refresh token | SHA-256 hash in `DHARA_SESSIONS` | 30 days, **one-time rotation** — replaying an old token revokes the session family |
| API keys `dh_pub_/dh_sec_` | SHA-256 hash + prefix | full value shown once at creation |
| PATs `dh_pat_` | SHA-256 hash + prefix + scopes + expiry | revocable instantly |
| Webhook secrets | plaintext row (needed to sign) | per-hook random 32 hex chars |

## 4 · SQL injection

Every statement is parameterized:

- Values → Oracle **bind variables** (`:b1`, …) — never concatenated.
- Identifiers (table/column names in DDL/DML) → `assertIdent()` regex-whitelists `[A-Za-z][A-Za-z0-9_$#]*` and uppercases; physical table names are generated (`DHRxxxxxx_…`), never user-supplied.
- RLS expressions are the one place user SQL text is compiled — they are only writable by dashboard-authenticated users (owners/members), and are compiled into parameterized WHERE fragments with bound `auth.*` values, evaluated by Oracle, not string-eval'd anywhere.

## 5 · RLS guarantees & limits

- Deny-by-default: `anon`/`authenticated` roles get `1 = 0` unless a policy matches.
- RLS is **application-level** (compiled into each query) — it does not use Oracle's native VPD. Anyone with direct DB credentials (i.e. you) bypasses it by design.
- `service_role` (`dh_sec_`) and Full-scope PATs bypass RLS — treat them like root: backend only, rotate on leak, delete from `DHARA_API_KEYS` revokes instantly.

## 6 · Rate limiting

`rateLimitRequest()` (in-memory token buckets per key/IP) protects Data API and auth routes. Behind a proxy, forward `X-Forwarded-For` so per-IP buckets see real clients. For multi-instance deployments add a shared store (Redis) — contributions welcome.

## 7 · Webhook signing

```
X-Dhara-Signature: sha256=HMAC_SHA256(secret, rawBody)
```

Verify with a constant-time compare against the raw (unparsed) body. Replay window is yours to enforce via `X-Dhara-Delivery` + timestamp.

## 8 · Hardening checklist

- [ ] HTTPS in front of the instance (Caddy/Nginx) — never ship the dashboard over plain HTTP
- [ ] OCI network ACL: Autonomous DB reachable **only** from your server IP
- [ ] `.dhara/` and `storage-uploads/` on encrypted volumes, backed up encrypted
- [ ] Owner account: strong unique password; members are minimal
- [ ] Per-app anon keys (`dh_pub_`), one project per app, least-privilege RLS policies
- [ ] `dh_sec_` keys only in server env/secret managers — never in SPA bundles
- [ ] PATs: prefer **Read-only** or **Specific** scopes; set expiries; revoke unused
- [ ] Keep the instance updated (`git pull && rebuild`) — security fixes ship in patch releases
- [ ] Watch **Audit** (`GET /api/audit`) for unexpected logins/policy changes

## 9 · Reporting vulnerabilities

Please **do not open public issues** for security bugs. Use GitHub Security Advisories ("Report a vulnerability") on the repo — we'll credit reporters in the release notes.
