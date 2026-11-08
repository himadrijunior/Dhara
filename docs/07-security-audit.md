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

`scripts/pentest.py` — 57 automated attack/functional checks covering all
findings above (tenant isolation ×15, SQL privilege ×2, PAT scopes ×4,
takeover ×3, disclosure ×2, SSRF ×5, SQLi ×7, traversal ×2, RLS/bypass ×4,
auth hygiene ×3, MCP ×4) — **57/57 PASS** on v1.1.0, re-verified **57/57
PASS** on v1.1.1.

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
