# 2 · User Guide

A tour of every screen in the Dhara dashboard. Screens adapt to your screen size (desktop → laptop → mobile) and — thanks to **AI NAV** — to *how you use them*.

---

## 1 · Home (Overview)

The command center: instance banner (DB name · PDB), project cards, quick stats and the **New Project** dialog.

**Multi-Project** works like Supabase organizations: every project has its own tables, API keys, policies, webhooks and storage buckets — all inside the same Oracle schema, namespaced with a unique prefix (`DHRxxxxxx_TABLE`), so projects never collide.

**New Project** options: name (2–60 chars), description, color tag, and **Auto-create tables** — when ON, POSTing JSON to an unknown table designs & creates it for you (see [Architecture § Auto tables](04-architecture.md#3-auto-table-creation-from-json)).

## 2 · Table Editor

A spreadsheet-style grid over real Oracle tables.

- **Create table** — visual column designer: `uuid · text · longtext · number · decimal · boolean · json · timestamp · date`, with `PK / required / unique / default` flags. Dhara generates the physical Oracle DDL (`VARCHAR2(36)`, `NUMBER(10)`, `CLOB`, `TIMESTAMP`…).
- **Row editing** — inline add/edit/delete with type-aware inputs; JSON columns get a JSON editor; up to 60 tables per project.
- **Realtime toggle** — every table row has an **on/off switch**. When ON, insert/update/delete on that table emit change events (webhooks + WebSocket bridge) with a configurable event mask (`insert,update,delete`).
- Filters, ordering and pagination match the Data API so the grid behaves exactly like `GET /api/v1/...`.

## 3 · SQL Console

A full SQL playground against your instance:

- Run any statement (DDL/DML/queries) — results render as tables, CLOBs stream as text.
- **History** (statement, duration, rows returned, error) and **Saved queries** are stored per-user in Oracle.
- Protected by the same guardrails as the platform: you run as the configured DB user, so `ADMIN`-level caution applies.

## 4 · Authentication

Manage the platform accounts that can open *this dashboard*:

- User list with role (`owner` / `member`), provider (`password` / `google`), avatar color, last login.
- The **first registered account is the owner**; owners can delete members and manage sessions.
- **Google OAuth** — set your `clientId`/`clientSecret` in **Settings ▸ OAuth**; the login screen then shows *Continue with Google*.

> Dashboard accounts are separate from your *app's* end-users. Your application users authenticate via the [Auth API](03-api-reference.md#2-auth-api) with JWTs you verify in your own services.

## 5 · RLS Policies

Supabase-style row-level security, compiled to Oracle SQL — **no policy = denied** for `anon`/`authenticated` roles.

For each table you define policies with:

| Field | Values |
|---|---|
| Action | `select` / `insert` / `update` / `delete` / `all` |
| Roles | `anon`, `authenticated` (comma-separated) |
| USING | SQL expression for filtering existing rows |
| WITH CHECK | SQL expression for validating new rows |

Example — users can only touch their own todos:

```
USING:       user_id = auth.uid()
WITH CHECK:  user_id = auth.uid()
```

Available in expressions: `auth.uid()` (current user id), `auth.role()` (`anon`/`authenticated`), `auth.jwt('claim')`, plus any column. Expressions are compiled into the same WHERE clause as your API filters — always via bind variables (see [Architecture § RLS compiler](04-architecture.md#4-rls-policy-compiler)).

`service_role` keys and Full-scope PATs **bypass** RLS entirely — keep them server-side.

## 6 · API & Keys

Everything about the auto-generated REST surface:

- **Keys** — per project: `dh_pub_…` (anon role, RLS enforced) and `dh_sec_…` (service role, bypass). SHA-256 hashed at rest; the full value is shown **only once** at creation.
- **API Explorer** — pick a table, build query params (`select`, `col=eq.val`, `order`, `limit/offset`), fire the request, see status, headers (`x-dhara-count`, `x-dhara-role`) and JSON body. Copy as cURL.
- **Webhooks** — register HTTPS endpoints per table + event mask; deliveries are signed (`X-Dhara-Signature: sha256=<hmac>`) and logged (status, duration, error) in the **Webhook Logs**.

## 7 · Storage

Bucket-and-file storage for your projects:

- Create **buckets** (public or private), upload/download/delete files, see sizes & MIME types.
- Default driver is **local disk** (`storage-uploads/`, git-ignored).
- The **OCI Object Storage driver** (Oracle Cloud's free-tier compatible object store) is wired into the backend — settings screen and signing adapter included. The UI marks the runtime switch **Upcoming** until the connector ships in your version; the local driver is fully usable today.

## 8 · MCP Server

One screen to plug your database into AI clients:

- Copy a ready-made `mcpServers` block (command, args, env) for **Claude Desktop** / any MCP client, or the `curl` form to call the HTTP MCP endpoint directly.
- The server exposes your instance over [Model Context Protocol](https://modelcontextprotocol.io) using a **PAT** (see below) — give it a Read-only token for safe AI exploration.

`mcp/server.mjs` in the repo is the standalone MCP bridge you can run with Node — point it at your instance URL + PAT.

## 9 · Access Tokens (PATs)

Personal Access Tokens for MCP, CLIs and automation — scoped three ways:

| Mode | Meaning |
|---|---|
| **Full** | Everything (dangerous — treat like service_role) |
| **Read-only** | All `*:read` scopes only |
| **Specific** | Pick exact scopes from the list |

Also: expiry in days (0 = never), instant revocation, `dh_pat_…` prefix, SHA-256 hashed, last-used tracking.

## 10 · Settings

- **Instance** — rename, view connection banner, disconnect Oracle (wipes local config; DB data untouched).
- **OAuth** — Google client id/secret.
- **Storage** — switch driver `local` ↔ `oci` and edit OCI credentials (tenancy, user, fingerprint, region, namespace, bucket, PEM key). Secrets are stored server-side and always redacted in API responses.
- **Danger zone** — reset usage counters.

## 11 · AI NAV — the self-organizing sidebar ✨

The signature feature. The dashboard records **which features you actually use** (`DHARA_USAGE`) and re-orders the navigation so your three most-used items float to the top of their groups — *your* sidebar becomes *your* sidebar over time. No settings, no manual pinning; visit **Settings ▸ Reset usage** to start over.

Other UX details: ⌘K command palette, dark/light theme, full mobile layout (nav collapses to a sheet), keyboard-first table grid.

---

Continue → **[3 · API Reference](03-api-reference.md)**
