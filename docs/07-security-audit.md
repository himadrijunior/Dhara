# Dhara Security Audit — 2026-11-08 (v1.1.0)

Full-stack security audit performed with the [ECC](https://github.com/affaan-m/ECC)
security-bounty-hunter methodology: remotely reachable, user-controlled attack
paths only — every finding below was **proven with a working exploit first**,
then fixed, then re-proven blocked by an automated pentest suite
(`scripts/pentest.py`, **57/57 passing**).

## Threat model

| Persona | Capability |
| --- | --- |
| **Attacker** | Registered member account on a shared (multi-user) self-hosted instance |
| **Victim** | Any other user's project, data, keys and the platform control plane |
| **Out of scope** | Host-level compromise, Oracle wallet theft from disk, social engineering |

## Findings and fixes

### CRITICAL

**1. Cross-tenant project takeover (CWE-639 / CWE-284)**

Every `/api/projects/[id]/*` route (project GET/PATCH/DELETE, API keys,
tables, rows, policies, webhooks, storage, stats) checked only *"is logged
in"* — not *"does this project belong to you"*. Any member could:
- read any project's metadata,
- **regenerate and receive another project's `dh_sec_` service key** (full
  data-plane takeover),
- read webhook signing secrets,
- rename or **delete other users' projects**.

*Fix*: `DHARA_PROJECTS.OWNER_ID` (migration), `requireProjectAccess()`
enforced on every project-scoped route; platform `owner`/`admin` roles see
everything, members see only their own. Foreign IDs return **404** (not 403)
so existence is not leaked.

**2. SQL console ran as the platform schema (CWE-250)**

`POST /api/sql` executed raw SQL on the ADMIN connection for *any*
authenticated member: read `DHARA_USERS` password hashes, insert forged
`DHARA_API_KEYS`, drop other tenants' tables. MCP `run_sql` had the same
flaw.

*Fix*: SQL console and MCP `run_sql` are restricted to platform
administrators operating on a project they own.

**3. Unauthenticated instance takeover (CWE-306)**

`POST /api/setup` (re-point the instance at an attacker's database),
`DELETE /api/setup` (wipe credentials) and `POST /api/settings/storage`
(reconfigure storage) were open to any registered user — and setup had no
auth check at all once configured.

*Fix*: once the instance is configured and has users, these endpoints
require the platform owner role.

**4. PAT scope escalation to the control plane (CWE-285)**

Personal access tokens were accepted by every dashboard route with implicit
full access, and on the data plane a PAT bypassed RLS **for every project on
the instance** — a read-only PAT could write, a member's PAT could read
other tenants' rows by project ID.

*Fix*: PATs are API tokens — dashboard/control-plane routes accept platform
sessions only (`401` for PATs); the v1 data API enforces PAT scopes
(`db:read` / `db:write`) and binds each PAT to projects owned by its user;
MCP tools enforce the same ownership check.

### HIGH

**5. SSRF via webhooks (CWE-918)** — webhook URLs were fetched server-side
with no restrictions: cloud metadata (`169.254.169.254`), loopback and
private ranges all worked, redirects were followed blindly.
*Fix*: `assertPublicUrl()` at creation **and** at delivery — http(s) only,
blocks loopback/private/link-local/CGNAT IPs, `.internal`/`.local` hosts,
IPv6 variants; redirects are no longer followed.

**6. First-user race (CWE-367)** — concurrent signups on an empty instance
could both become `owner` (TOCTOU between count and insert).
*Fix*: unique function-based index `DHARA_OWNER_UQ` guarantees a single
platform owner; a losing racer is transparently created as member.

### MEDIUM

**7. Broken documented filter syntax (functional + security)** — the
documented PostgREST syntax `?col=eq.val` was silently ignored (only
`col.eq=val` worked), so "filtered" public endpoints returned **all rows**.
*Fix*: `parseFilters` supports both syntaxes; parameterization verified by
injection probes.

**8. Unbounded login/signup (CWE-307)** — no rate limit on credential
endpoints. *Fix*: 10 login/min, 5 signups/min per IP.

**9. Raw internal error text leaked to clients (CWE-209)** — non-Oracle
500s returned raw exception messages. *Fix*: generic `Internal error`,
details server-side only.

### LOW / hardening

- Webhook list no longer exposes signing secrets.
- Users list (`/api/auth/users`) and audit log are admin-only.
- Leftover internal branding (`x-ikl-internal` header, `IKL_SUB`/`IKL_MCP`
  SQL aliases) renamed to `dhara`.

## Already solid (verified, no change needed)

- All SQL values bound via bind variables; identifiers whitelisted by
  `assertIdent()` (`^[A-Za-z][A-Za-z0-9_$#]{0,127}$`).
- Storage paths sanitized segment-wise (`..`, `.`, special chars stripped);
  local downloads served as `application/octet-stream` with HMAC-signed,
  expiring URLs.
- JWT: HS256, issuer-pinned, exp enforced (`jose`); refresh tokens stored
  hashed, rotated one-time, revocable; internal secret compared with
  `timingSafeEqual`.
- RLS deny-by-default; API keys SHA-256 hashed at rest, shown once;
  bcrypt password hashing; secrets never in client bundles.

## Verification

`scripts/pentest.py` — automated attack/functional checks covering all
findings above (tenant isolation ×15, SQL privilege ×2, PAT scopes ×4,
takeover ×3, disclosure ×2, SSRF ×5, SQLi ×7, traversal ×2, RLS/bypass ×4,
auth hygiene ×3, MCP ×4) — **57/57 PASS** on v1.1.0, re-verified **57/57
PASS** on v1.1.1, extended to **63 checks / 63 PASS** on v1.2.0.

Run it against your own instance:

```bash
BASE=http://localhost:3000 python3 scripts/pentest.py
```

## v1.1.1 addendum — connection resilience (2026-11-08)

Re-running the full suite on a cold machine surfaced three
connection-layer defects. None are privilege escalations; all were proven,
fixed and re-proven:

1. **`NJS-516` — TNS alias never resolved with a wallet (fixed).** Thin-mode
   `oracledb` resolves the `connectString` alias (e.g. `*_low`) against
   `tnsnames.ora` via the `configDir` connect property. Only `walletLocation`
   was passed, so every wallet-based connection failed. Fix: pass
   `configDir = walletDir` in `src/lib/server/oracle.ts`.
2. **`NJS-505` — Auto-Login (SSO) wallet is not usable by thin mode (documented
   + surfaced).** With a `cwallet.sso`-only flow and no wallet password,
   thin mode fails with `bad decrypt`. The Setup wizard stores the wallet
   password you set at download time and forwards it as `walletPassword`;
   the troubleshooting table now lists this explicitly.
3. **Stale server processes during testing (fixed in tooling).** Restarting
   the dev server left orphaned `next-server` children holding port 3000
   with an old in-memory pool — requests silently hit the stale process.
   `scripts/run_full_test.sh` now kills the whole process group before and
   after each run.

Result: cold-start wallet connection **878 ms → query OK**; full pentest
suite **57/57 PASS**; MCP smoke test included in the same run
(`tools/list` = 8 tools; member-PAT `run_sql` and cross-tenant `select`
both blocked).

## v1.2.0 addendum — external audit round (2026-11-08)

An independent code-reading + live-probe audit (fake wallet, unreachable DB,
no production credentials) examined the **pre-auth bootstrap surface**, which
the v1.1.0 suite (authenticated-member attacker model) did not cover. Four
findings were confirmed at runtime and fixed in this release; the pentest
suite grew from 57 to 63 checks to keep each of them locked.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| C1 | Critical | `POST /api/setup/wallet` had **no auth at all** — worked on configured instances too; a 306 KB zip bomb wrote **301 MB** to disk (compressed-size check only, extract-into-live-dir) | `assertSetupAllowed` guard + filename allowlist + per-file/total uncompressed caps + staged-then-atomic swap (`wallet_too_big` regression check) |
| C2 | Critical | `/api/setup` POST guard was **fail-open**: `countUsers()` throwing (DB stopped — routine on Always Free) was swallowed by `catch` and an anonymous caller could overwrite the Oracle credentials | guard moved to fail-closed `src/lib/server/setupGuard.ts` — DB down ⇒ 401/502, never a bypass; optional `DHARA_SETUP_TOKEN` for first-run hardening |
| C3 | High | Rate limiters trusted client `X-Forwarded-For` — rotating the header fully bypassed brute-force protection (proven: 30/30 logins through) | `clientIp()` honors XFF only with `DHARA_TRUST_PROXY=1`; new **per-account** limiter (5/15 min) keyed by targeted login email; compose binds `127.0.0.1:3000` |
| M10 | Medium | Unauthenticated `GET /api/setup` leaked `oracle.user`, connect string and OCI storage identifiers | config payload now admin-only; anonymous callers get `{configured, connected, banner, hasUsers}` |
| M11 | Medium | No CSP / HSTS / nosniff / frame headers at all | baseline headers in `next.config.ts` (CSP incl. `frame-ancestors 'none'`, nosniff, referrer, permissions, HSTS) |
| H9 | High | `ignoreBuildErrors: true` could let future type errors silently weaken security routes | flipped to `false` — verified `tsc --noEmit` = 0 errors, build stays green |
| H4 | High | Repo Caddyfile exposed `?XTransformPort=` → arbitrary localhost-port proxy | removed; hardened Caddyfile + production template |
| L17 | Low | `LICENSE` (Apache-2.0) vs `package.json`/README (MIT) mismatch | unified on Apache-2.0 |

Also acknowledged (from the same audit, **not yet fixed** — tracked for the
next releases): H5 cross-project design (dashboard users and app end-users
share `DHARA_USERS`), H6 Google OAuth state/`email_verified`, H7 tokens in
`localStorage`, M12 SSRF DNS-rebinding hardening, M13 session binding,
M14 realtime service binds. These are in the roadmap — see README changelog
and SECURITY.md.

New regression checks (all **PASS**): unauth wallet upload → 401 ·
unauth setup reconfigure → 401 · `GET /api/setup` anon → config hidden ·
zip-bomb upload → 400 `wallet_too_big` · CSP+nosniff present ·
per-account login limit survives XFF rotation (429 at attempt 6).

---

## v1.2.2 — Re-audit sweep + Email security model (2026-11-08)

An independent re-audit re-ran every v1.2.0 probe against the new code
(all still blocked) and surfaced the issues below. All are now fixed and
covered by regression checks in `scripts/pentest.py` (82 checks total).

| ID | Sev | Finding | Fix |
| --- | --- | --- | --- |
| R1 | Medium | **Forged-header zip bomb**: the pre-inflate size check trusted the zip header's `uncompressedSize` — a header claiming "100 B" let a 400 MB payload inflate fully (RSS 270→696 MB) | `readCapped()` streams each entry and aborts mid-inflate once the real byte count exceeds the cap; oversized `Content-Length` rejected before buffering |
| R2 | Medium | Without `DHARA_TRUST_PROXY` every caller shared one `"local"` rate-limit bucket — 11 bad logins locked the whole instance out of login for a minute | IP buckets count **failed logins only**; shared-bucket ceiling raised; compose ships Caddy + `DHARA_TRUST_PROXY=1`; boot warning when unset |
| R3 | Medium | Unconfigured instance: anyone could run setup / upload a wallet / claim the first owner slot | **First-run setup token**: auto-generated `.dhara/setup-token` (0600), printed once, required by setup + wallet + first owner signup, consumed after owner exists |
| R4 | Medium | `getPublicOrigin()` trusted `X-Forwarded-Host`/`Host` — sitemap poisoning today, reset-link poisoning tomorrow | Single source of truth `DHARA_PUBLIC_URL`; forwarded headers honored only with `DHARA_TRUST_PROXY=1`; all email action links use the same source |
| R5 | Low | `refresh` and OAuth endpoints had no rate limit; raw XFF stored in session rows | rate limits added; `sanitizeIp()` on stored IPs |
| R6 | Low | CSP had `unsafe-inline` scripts and `connect-src ws: wss:` (any host) | documented (needed by Next hydration until a nonce-CSP lands); tracked for a follow-up |
| R7 | Low | Canonical/OG/JSON-LD fell back to `http://localhost:3000` in prod | `DHARA_PUBLIC_URL` first, `NEXT_PUBLIC_SITE_URL` second |
| R8 | Low | `getJwtSecret()` fell back to a hardcoded dev secret when unconfigured | missing secret is a **hard boot error** (`not_configured`) |
| H5 | High | Platform session JWTs drove the v1 data API **without project ownership checks** — any member could CRUD any project's tables by ID; open signup amplified it | `v1ProjectAllowed()` enforces owner/admin for `user`-kind + PAT-kind; **signup policy** `open\|invite\|closed` (default **invite**) with single-use email invites |
| H6 | High | OAuth `state` was `Math.random()` with no cookie; auto-link didn't require `email_verified` | `crypto.randomBytes(16)` state in HttpOnly cookie, timing-safe compare; `email_verified === true` enforced in `upsertOAuthUser` and callback |
| H7 | High | Refresh tokens in `localStorage`; OAuth returned tokens in the URL fragment | refresh token → **HttpOnly SameSite=Strict cookie** scoped to `/api/auth`; access token memory-only; OAuth → single-use 60-second code + POST exchange |
| M12 | Medium | Webhook SSRF guard didn't resolve DNS and missed `::ffff:` hex-mapped forms (WHATWG URL canonicalizes `http://[::ffff:127.0.0.1]/` → `[::ffff:7f00:1]`) | `dns.lookup({all:true})` + `isPrivateIp()` validates every resolved address (dotted AND hex-mapped), re-checked per delivery |
| M13 | Medium | Access JWT lived 24 h; revoking a session didn't kill its access token; no refresh-reuse detection | access TTL **15 min**; `sid` checked against live sessions (60 s cache) on every bearer path; refresh rotation is one-time — **reuse revokes the whole session family** |
| M14 | Medium | Realtime admin HTTP (`:3004`) bound all interfaces; Socket.IO CORS `origin: "*"`; empty internal secret silently disabled `/emit` auth | admin binds `127.0.0.1`; CORS pinned to `DHARA_PUBLIC_URL` + localhost; empty secret **fails boot** |

**Email feature security model** (new in v1.2.2): reset/verify/invite tokens
are 32 bytes, stored only as SHA-256 hashes, single-use, short-lived (30 min
reset / 24 h verify / 7 d invite); `forgot` is enumeration-proof and rate
limited per IP and per mailbox; password reset revokes all sessions and
requires 12+ chars; links are built from `DHARA_PUBLIC_URL` only.

**Regression suite**: `scripts/pentest.py` — 82 checks, **82/82 passing**
against a live instance (Oracle Always Free), including the forged-header
bomb (400 `wallet_too_big` in 0.2 s), cookie flags, session-family reuse,
enumeration-proof forgot, invite gates and shared-bucket enforcement.
`npm test` adds 62 deterministic vitest unit tests (RLS compiler, filter
parser, SSRF guard, storage paths); CI runs tsc + eslint + tests + audit.
