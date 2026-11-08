# Changelog

All notable changes to Dhara.

## [1.2.1] — 2026-11-08

### SEO & AEO: crawl surface & structured data

- **Dynamic, host-aware `robots.txt`** (Next.js metadata route, replaces the static file): public pages open to search engines and AI answer-engine crawlers (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, …); the entire `/api/` surface (auth, data API, MCP, setup, wallet) is disallowed for every crawler.
- **Per-instance `sitemap.xml`** with absolute URLs derived from request headers — correct on any self-hosted domain with zero configuration.
- **OpenGraph + Twitter card metadata**, canonical URL, `robots: index,follow`, and `metadataBase` (override with `NEXT_PUBLIC_SITE_URL`).
- **SoftwareApplication JSON-LD** structured data (name, license, zero-cost offer, author) for rich results and answer engines.
- Root `CHANGELOG.md` backfilled with the v1.2.0 security release.

## [1.2.0] — 2026-11-08

### External-audit fixes (independent security review — C1/C2/C3 + M/H/L findings)

- **C1 — wallet upload (Critical)**: `/api/setup/wallet` now requires the instance owner, accepts only wallet archives, and caps archive size/entries — zip-bomb proof.
- **C2 — setup fail-open (Critical)**: `/api/setup` is fail-closed — with the DB unreachable the request is rejected, so an outage can no longer be abused to reconfigure credentials (no more unauthenticated instance takeover via the outage window).
- **C3 — rate-limit bypass (High)**: limits are now keyed per account (with sanitized IP handling) instead of the spoofable `X-Forwarded-For` header alone.
- **M10 — info disclosure**: `GET /api/setup` no longer reveals the Oracle user / connect string to unauthenticated callers.
- **M11 — security headers**: CSP, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`.
- **H4 — Caddyfile**: removed the `?XTransformPort=` arbitrary-localhost-port forwarding hole.
- **H9 — build gate**: `tsc` type errors now fail the production build.
- **L17 — license**: unified to Apache-2.0 across the repo.
- Pentest suite extended to 63 checks — 63/63 passing.

## [1.1.0] — 2026-11-08

### Security hardening release (full ECC-methodology audit)

- **Fixed critical cross-tenant IDOR (CWE-639)**: project ownership model (`OWNER_ID` + `requireProjectAccess`) — a member could previously read/rename/delete any project and regenerate its `dh_sec_` key.
- **Fixed SQL console privilege (CWE-250)**: raw SQL now restricted to platform admins on their own projects (was: any member on the ADMIN schema connection). Same gate for MCP `run_sql`.
- **Fixed unauthenticated setup takeover (CWE-306)**: reconfiguring Oracle credentials / storage of a configured instance now requires the platform owner.
- **Fixed PAT scope escalation (CWE-285)**: PATs can no longer touch the dashboard control plane; v1 data API enforces PAT scopes and binds PATs to owned projects.
- **Fixed SSRF via webhooks (CWE-918)**: `assertPublicUrl` blocks loopback/private/link-local/metadata targets; redirects no longer followed.
- **Fixed first-user owner race (CWE-367)**: unique index `DHARA_OWNER_UQ` guarantees a single platform owner.
- **Fixed documented PostgREST filter syntax** (`?col=eq.val`) being silently ignored — filters now support both `col=eq.val` and `col.eq=val`.
- Added login/signup rate limits (10/min, 5/min per IP), generic 500 error bodies, admin-only users/audit endpoints, webhook secret masking.
- New: `docs/07-security-audit.md` (full report) + `scripts/pentest.py` — 57-attack automated self-hack suite, 57/57 passing.

## [1.0.0] — 2026-11-08

### The first public release 🎉

- **Core**: multi-project engine on Oracle Autonomous AI DB (thin-mode TCPS, TLS & mTLS wallet support), 17 metadata control tables auto-bootstrapped, project table namespacing (`DHRxxxxxx_*`).
- **Data API v1**: PostgREST-style REST per table — `select`/`eq|neq|gt|gte|lt|lte|like|ilike|in|is` filters, ordering, pagination, bulk insert, update/delete by filter, `x-dhara-count` headers.
- **Auto table creation**: POST JSON to an unknown table → types inferred, DDL generated, rows inserted in one request.
- **RLS**: Supabase-style policy compiler (`select/insert/update/delete/all` × `anon/authenticated`), `auth.uid()` / `auth.jwt()` / `auth.role()` helpers, deny-by-default, service-role bypass.
- **Auth**: email+password (bcrypt), HS256 JWT (24 h) + rotating refresh sessions (30 d, one-time), Google OAuth, first user becomes owner.
- **Keys & tokens**: per-project `dh_pub_`/`dh_sec_` API keys (SHA-256 at rest, shown once), PATs with Full / Read-only / Specific scopes + expiry + revocation.
- **Realtime**: per-table on/off toggle + event mask, webhook fan-out (HMAC-SHA256 signed) with delivery logs, WebSocket bridge example.
- **SQL Console**: multi-statement runner, per-user history, saved queries.
- **Storage**: buckets, public/private files, local driver, OCI Object Storage signing adapter (UI switch marked *Upcoming*).
- **Platform**: MCP server (HTTP JSON-RPC + stdio bridge), audit log, usage tracking, AI NAV (usage-driven navigation ordering), command palette, dark/light theme, full mobile layout.
- **Ops**: Setup Wizard (TLS connect string or wallet ZIP), redacted config API, rate limiting, Dockerfile + docker-compose with volumes, factory-reset & password admin scripts, docs suite (setup, user guide, API reference, architecture, self-hosting, security).
