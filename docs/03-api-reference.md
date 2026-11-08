# 3 · API Reference

Every endpoint is on your instance — base URL below is `http://localhost:3000` (replace with your domain in production).

Authentication styles:

| Who | How |
|---|---|
| Dashboard / Management | `Authorization: Bearer <access JWT>` (from login) |
| App backend (service) | `x-api-key: dh_sec_…` |
| App frontend (anon) | `x-api-key: dh_pub_…` (or `?apikey=`) |
| End-users of *your app* | `Authorization: Bearer <their JWT>` + `x-api-key: dh_pub_…` (RLS applies to `authenticated`) |
| Automation / MCP | `Authorization: Bearer dh_pat_…` (scopes apply) |

Conventions: JSON bodies & responses · errors are `{ error, code? }` with proper HTTP status · `428 not_configured` means the Setup Wizard hasn't been completed.

---

## 1 · Data API v1 (PostgREST-style)

```
/api/v1/{PROJECT_ID}/{TABLE}
```

Auto-generated per table. `POST` to an unknown table **creates it** when the project has auto-create enabled.

### GET — select rows

```
GET /api/v1/{p}/tasks?select=id,title,done&done=eq.false&priority=gte.3&order=priority.desc&limit=50&offset=0
x-api-key: dh_pub_...
```

| Param | Meaning |
|---|---|
| `select` | comma list of columns (default `*`) |
| `{col}={op}.{value}` | filter — ops: `eq neq gt gte lt lte like ilike in is` (`in` takes comma list; `is` takes `null/true/false`) |
| `order` | `col.asc` / `col.desc` |
| `limit` / `offset` | pagination (default limit 50) |

Response `200`: `{ "data": [...], "count": n }` with headers `x-dhara-count`, `x-dhara-role`.

RLS: `pub` keys map to the `anon` role, user JWTs to `authenticated`. **No matching policy → `403 rls_denied`.**

### POST — insert (and auto-create)

```
POST /api/v1/{p}/tasks
x-api-key: dh_sec_...
{ "title": "Ship v1.0", "done": false, "priority": 5 }
```

- Single object or array of objects → `201 { data: [rows], count }`.
- Unknown table + auto-create ON → column types are inferred from JSON (`string→text/longtext`, `number→number`, `bool→boolean`, `ISO date→timestamp`, nested→`json`) and DDL runs, then rows are inserted.

### PATCH — update by filter

```
PATCH /api/v1/{p}/tasks?done=eq.false
{ "updates": { "priority": 9 } }
```

→ `{ count, data }` (updated rows).

### DELETE — delete by filter

```
DELETE /api/v1/{p}/tasks?done=eq.true
```

Requires at least one filter for non-service roles → `{ count, data }` (deleted rows).

---

## 2 · Auth API

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/auth/signup` | `{email, password, name?}` | `{ok, user}` — first user becomes **owner** |
| `POST /api/auth/login` | `{email, password}` | `{ok, accessToken, refreshToken, user}` |
| `POST /api/auth/refresh` | `{refreshToken}` | new pair (one-time rotation; old token revoked) |
| `GET /api/auth/me` | Bearer JWT | `{user}` |
| `POST /api/auth/logout` | `{refreshToken}` | revokes session |
| `GET /api/auth/users` | Bearer JWT (owner) | dashboard users list |
| `GET /api/auth/oauth/google` | — | redirects to Google consent |
| `GET /api/auth/oauth/google/callback` | — | exchanges code, links/creates user, issues tokens |

JWTs are HS256, 24 h access lifetime; refresh sessions live 30 days and are stored hashed in `DHARA_SESSIONS`.

## 3 · Management API (dashboard)

| Area | Endpoints |
|---|---|
| Projects | `GET/POST /api/projects` · `GET/PATCH/DELETE /api/projects/{id}` · `GET /api/projects/{id}/stats` |
| Tables | `GET/POST /api/projects/{id}/tables` · `GET/PATCH/DELETE /api/projects/{id}/tables/{table}` (PATCH toggles realtime / renames) · `POST …/tables/{table}/rows` etc. for the grid |
| RLS | `GET/POST /api/projects/{id}/policies` · `DELETE …/policies?id=` |
| Keys | `GET /api/projects/{id}/keys` · `POST {kind: "pub"\|"sec"}` → full key shown once · `DELETE ?id=` |
| Webhooks | `GET/POST /api/projects/{id}/webhooks` · `DELETE ?id=` · logs included in GET |
| Storage | `GET/POST /api/projects/{id}/storage` (buckets) · `POST …/storage/file` (multipart upload) · `GET …/storage/file?bucket=&path=` (download/signed) · `DELETE` |
| SQL | `POST /api/sql` `{projectId, statement}` — runs, logs to history; `GET /api/sql?projectId=` history & saved queries |
| Usage | `GET /api/usage` · `POST /api/usage/reset` |
| Audit | `GET /api/audit` (owners) |
| Setup | `GET /api/setup` status · `POST /api/setup` connect Oracle · `POST /api/setup/wallet` upload wallet ZIP |
| Settings | `GET/POST /api/settings` (instance name, OAuth, storage driver — secrets always redacted) |

## 4 · Webhooks

Register in the dashboard or via the management API. On each matching table event Dhara POSTs:

```
POST <your-url>
X-Dhara-Event: insert | update | delete
X-Dhara-Signature: sha256=<hmac_sha256(secret, rawBody)>
X-Dhara-Delivery: <uuid>
Content-Type: application/json

{ "projectId": "...", "table": "tasks", "event": "insert", "record": {...}, "at": "2026-..." }
```

Verify the signature with the per-hook secret before trusting the payload. Every attempt is logged (status, duration, error) — see **API & Keys ▸ Webhook Logs**.

## 5 · MCP Server

```
POST /api/mcp            (Streamable HTTP, JSON-RPC 2.0)
Authorization: Bearer dh_pat_...
```

Tools: `list_projects`, `list_tables`, `describe_table`, `select_rows`, `insert_rows`, `update_rows`, `delete_rows` — scopes of the PAT decide what's allowed. `mcp/server.mjs` bridges stdio MCP clients (e.g. Claude Desktop) to this endpoint:

```json
{
  "mcpServers": {
    "dhara": {
      "command": "node",
      "args": ["/path/to/dhara-db/mcp/server.mjs"],
      "env": { "DHARA_URL": "http://localhost:3000", "DHARA_PAT": "dh_pat_..." }
    }
  }
}
```

## 6 · Rate limits

Public endpoints (Data API, auth) are rate-limited per key/IP. Exceeding returns `429 { error }`. Limits are per-instance and conservative by default; tune in `src/lib/server/api.ts` (`rateLimitRequest`).

---

Continue → **[4 · Architecture](04-architecture.md)**
