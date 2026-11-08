# 5 · Self-Hosting

Dhara is a single Node app + your Oracle DB. Pick your fighter:

## 1 · Docker Compose (recommended)

The repo ships a production `Dockerfile` (multi-stage, standalone Next output) and `docker-compose.yml`:

```bash
git clone https://github.com/himadrijunior/Dhara.git
cd dhara-db
docker compose up -d --build
```

- App on **http://localhost:3000**
- `/app/.dhara` (config + wallet secrets) and `/app/storage-uploads` are **volumes** — your credentials survive upgrades and never enter the image.

Complete the Setup Wizard once at http://localhost:3000 — done. To deploy on a cloud VM, point a reverse proxy at port 3000 (next section).

## 2 · Oracle Cloud "Always Free" VM (full free stack)

1. Create an **Always Free Compute** VM (A1 Flex ARM or E2.1 micro), open ports 80/443.
2. Install Docker (`sudo dnf install -y podman-docker` or Docker CE), clone the repo, `docker compose up -d --build`.
3. DNS: point `db.yourdomain.com` at the VM.
4. Reverse proxy with TLS — the repo includes a `Caddyfile`:

```
yourdomain.com {
    reverse_proxy dhara:3000
}
```

or with Nginx + certbot: `proxy_pass http://127.0.0.1:3000;` and standard TLS config.

> 🔒 Now restrict your Autonomous DB network access to the VM's public IP (OCI console → Autonomous DB → Network → access control) — the DB no longer needs to be reachable from everywhere.

## 3 · Bare Node.js (no Docker)

```bash
# Node.js ≥ 20 required
npm ci
npm run build
PORT=3000 npm run start     # standalone server on :3000
```

Keep it alive with systemd:

```ini
[Unit]
Description=Dhara
After=network.target

[Service]
WorkingDirectory=/opt/dhara-db
ExecStart=/usr/bin/node .next/standalone/server.js
Environment=NODE_ENV=production PORT=3000
Restart=always
User=dhara

[Install]
WantedBy=multi-user.target
```

## 4 · Environment variables

Everything important lives in `.dhara/config.json` (created by the wizard). Optional env overrides are documented in [`.env.example`](../.env.example) — `PORT`, `NODE_ENV`, headless Oracle bootstrap vars, Google OAuth.

## 5 · Backups

| Asset | Where | How to back up |
|---|---|---|
| All application data | Oracle DB | Autonomous DB auto-backups are on (60 days on free tier) — or `expdp`/Data Pump / SQL from the SQL console |
| Config + wallet | `.dhara/` | `tar czf dhara-sec.tar.gz .dhara/` → store **encrypted, off-machine** (it holds DB credentials) |
| Uploaded files | `storage-uploads/` | rsync to object storage / second VM |
| Repo | Git | GitHub (this repo) |

## 6 · Upgrades

```bash
cd dhara-db
git pull
docker compose up -d --build      # or: npm ci && npm run build && systemctl restart dhara
```

Metadata migrations are idempotent (`bootstrapMeta` creates missing tables; existing data untouched). Check `CHANGELOG` / releases before major bumps.

## 7 · Health & monitoring

- `GET /api/setup` → `{configured, connected, banner, hasUsers}` — perfect for uptime checks.
- Logs: `docker compose logs -f` (or journald under systemd).
- Audit trail: dashboard **Settings** / `GET /api/audit`.

## 8 · Troubleshooting

| Symptom | Fix |
|---|---|
| Wizard fails with TLS/NJS errors | Free-tier DB usually needs the **wallet** — upload it |
| `428 not_configured` on API calls | Setup not completed on this volume — run the wizard |
| Pool errors after DB maintenance | Restart the container/process (pool re-establishes) |
| Slow queries | Use the `tp` TNS service, not `high`/`medium` |

---

Continue → **[6 · Security](06-security.md)**
