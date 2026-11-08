# 4 · Architecture

How Dhara turns one Oracle schema into a multi-tenant BaaS.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Next.js 16 (one deployable)                                         │
│                                                                      │
│  Dashboard SPA (React 19 · zustand · Tailwind 4 · shadcn/ui)         │
│      │  fetch /api/*  (JWT cookie/bearer)                            │
│      ▼                                                               │
│  API Routes                                                          │
│   ├─ /api/setup          Setup Wizard · wallet upload                │
│   ├─ /api/auth/*         platform auth (JWT · OAuth · sessions)      │
│   ├─ /api/projects/*     management (tables, keys, policies, …)      │
│   ├─ /api/sql            SQL console                                 │
│   ├─ /api/v1/{p}/{t}     Data API v1 (PostgREST-style, RLS)          │
│   └─ /api/mcp            MCP server (JSON-RPC, PAT auth)             │
│      │                                                               │
│      ▼                                                               │
│  lib/server                                                          │
│   ├─ oracle.ts   thin-mode pool (TLS / mTLS wallet), bind-var q()    │
│   ├─ dbapi.ts    projects · registry · DDL · CRUD · RLS compiler     │
│   ├─ auth.ts     users · sessions · tokens                           │
│   ├─ security.ts bcrypt · SHA-256 · JWT (jose) · key minting         │
│   ├─ events.ts   realtime outbox → webhooks + SSE/WS bridge          │
│   └─ storage.ts  local / OCI object-storage adapter                  │
│      │                                                               │
│      ▼  node-oracledb (thin, TCPS 1522)                              │
└──────────────────────────── YOUR Oracle Autonomous AI DB ────────────┘
```

## 1 · Metadata layer

On first connect Dhara creates ~17 control tables (prefixed `DHARA_`) in the schema you connected with:

| Table | Purpose |
|---|---|
| `DHARA_PROJECTS` | project registry (name, color, auto-create flag) |
| `DHARA_USERS` / `_SESSIONS` / `_OAUTH_ACCOUNTS` | dashboard accounts, rotating refresh sessions, OAuth links |
| `DHARA_TABLES` | table registry: logical name → physical name + column JSON + realtime flag |
| `DHARA_POLICIES` | RLS policies (action, roles, USING, WITH CHECK) |
| `DHARA_API_KEYS` / `_PATS` | hashed keys & tokens |
| `DHARA_WEBHOOKS` / `_WEBHOOK_LOGS` | hooks + delivery audit |
| `DHARA_USAGE` / `_AUDIT` / `_SQL_HISTORY` / `_SAVED_QUERIES` | AI NAV signal, audit trail, console history |
| `DHARA_BUCKETS` / `_FILES` | storage catalog |
| `DHARA_SETTINGS` | per-user UI settings |

All access uses **bind variables** and `assertIdent()`-validated identifiers — user input never reaches SQL as text.

## 2 · Projects → physical namespacing

Each project id maps to a stable prefix:

```
projectId  ef34be65-…  →  DHREF34BE_
table      tasks      →  DHREF34BE_TASKS
```

Prefixes are derived from the first 6 hex chars of the UUID — collision-safe for thousands of projects, and every table lives in your schema where normal Oracle tooling (APEX, SQL Dev, backups) just works.

## 3 · Auto table creation from JSON

`POST /api/v1/{p}/{table}` on an unknown table (auto-create ON):

1. Type inference per key: `string→text` (≤4000) or `longtext` · `number→number` · `boolean→boolean` · ISO date→`timestamp` · `object/array→json` · `"uuid"-like id→uuid`.
2. A UUID PK `ID` is added unless the JSON provides one.
3. `CREATE TABLE DHRxxxxxx_NAME (…)` runs; the registry row is written (`DHARA_TABLES.COLUMNS` JSON).
4. Rows are inserted immediately — the request never fails because the table didn't exist.

## 4 · RLS policy compiler

`applyRls(policies, action, ctx, columns)` compiles dashboard policies to a WHERE fragment:

- `anon` (pub key) / `authenticated` (user JWT) roles → **no matching enabled policy = `1 = 0`** (denied).
- `service` (sec key / full PAT) → bypass.
- `auth.uid()` → bind of the JWT `sub`; `auth.jwt('x')` → bind of claim `x`; `auth.role()` → literal role.
- USING becomes the row filter; WITH CHECK guards INSERT/UPDATE payloads.
- The fragment is AND-combined with user filters (bind names auto-namespaced `a_*`/`b_*` to avoid collisions) — see `combineWhere` in `src/app/api/v1/[project]/[table]/route.ts`.

## 5 · Realtime pipeline

1. Every Data-API / grid mutation calls `afterChange(...)`.
2. If the table's `REALTIME` flag is ON (per-table toggle) and the event passes the table's event mask:
   - matching **webhooks** fire (HMAC-signed POST, logged to `DHARA_WEBHOOK_LOGS`),
   - the event is published to the **bridge** (`mini-services/realtime-service` / `examples/websocket`) that fans it out to subscribed clients (socket.io / SSE).

## 6 · Auth internals

- bcrypt password hashing (cost 10) · HS256 JWTs via `jose` (24 h) · refresh rotation (30 days, one-time use, stored as SHA-256 hash).
- API keys: `dh_pub_`/`dh_sec_` + 24 random bytes, stored only as SHA-256; the prefix column allows lookup without touching plaintext.
- PATs: same hashing + scope modes `full | read_only | specific` (+ optional expiry).
- Google OAuth: authorization-code flow, account linking by provider uid, JWT issuance on callback.

## 7 · AI NAV

`trackUsage()` increments `DHARA_USAGE (USER_ID, FEATURE, CNT)` on every meaningful action. The shell queries it, computes the top-3 features per user and floats those nav items to the top of their groups — navigation ordering is literally derived from your behavior, not a hardcoded sort.

## 8 · Storage

- `local` driver — files under `storage-uploads/{project}/{bucket}/…` (git-ignored), metadata in `DHARA_FILES`.
- `oci` driver — request-signing adapter for OCI Object Storage (native Oracle Cloud free-tier object storage); UI switch marked *Upcoming* until enabled.

## 9 · Deployment topology

One Next.js app (standalone output) serves dashboard + APIs. Optional sidecars: realtime bridge (WS) and MCP stdio bridge. Config lives in `.dhara/config.json` — mount it as a volume in Docker (see [Self-Hosting](05-self-hosting.md)).

---

Continue → **[5 · Self-Hosting](05-self-hosting.md)**
