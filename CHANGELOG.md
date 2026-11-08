# Changelog

All notable changes to Dhara.

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
