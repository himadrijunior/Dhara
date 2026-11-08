# Contributing to Dhara

Thanks for helping build the free-tier BaaS! 🎉

## Dev setup

```bash
git clone https://github.com/himadrijunior/Dhara.git
cd dhara-db
npm install          # or bun install
npm run dev
```

You'll need an Oracle Autonomous AI Database (Always Free is fine) — walk through the Setup Wizard at `localhost:3000`. `.dhara/` keeps your local secrets and is git-ignored.

## Project layout

```
src/app/api/…            API routes (setup, auth, projects, v1 data API, sql, mcp…)
src/lib/server/          oracle.ts (pool) · dbapi.ts (engine) · auth.ts · security.ts · events.ts · storage.ts
src/components/dhara/ dashboard views (shell, tables, sql, auth-users, api-explorer…)
mcp/server.mjs           stdio MCP bridge
mini-services/           realtime bridge
docs/                    these docs (update them when behavior changes!)
```

## Ground rules

1. **No demo/mock data modes** — features talk to the real Oracle DB.
2. **Bind variables everywhere**; identifiers via `assertIdent()`. No string-built SQL.
3. Secrets never enter code, logs or responses (use `redactConfig`).
4. New user-facing behavior → update the relevant `docs/0X-*.md` section in the same PR.
5. `npm run lint` clean; keep TypeScript strict.

## PR checklist

- [ ] Describes what & why, linked to an issue
- [ ] No new secrets/credentials in diffs
- [ ] Docs updated
- [ ] Tested against a real Autonomous DB (mention service: tp/medium/…)

## Good first issues

- OCI Object Storage UI switch (backend adapter exists)
- More column types (`NUMBER` scale, `INTERVAL`, `BLOB`)
- Visual query builder for the API Explorer
- Client SDKs (JS/TS first, then Python)
- Shared rate-limit store (Redis) for multi-instance deploys

## Security bugs

Do **not** open public issues — use GitHub Security Advisories.
