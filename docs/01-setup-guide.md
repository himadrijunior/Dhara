# 1 · Setup Guide

From zero to a working backend in ~10 minutes. Everything runs on **your** machine and **your** Oracle database.

## 1. Create a free Oracle Autonomous AI Database

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free) (Always Free tier — no charge, card used only for verification).
2. In the OCI console: **Oracle Database → Autonomous AI Database → Create Autonomous AI Database**.
3. Choose:
   - **Workload type:** *Data Warehouse*, *AI Database* or *Lakehouse* — any works.
   - **Instance type:** *Free*.
   - **Credentials:** remember the `ADMIN` password (12+ chars, 1 upper, 1 lower, 1 number).
   - **Network access:** *Allow secure access from everywhere* is simplest; restrict to your server IP for production.
4. Wait for **Status: Available** (~2–5 min).

> Dhara creates ~17 metadata tables (`DHARA_*`) plus your project tables (`DHRXXXXXX_*`) inside the schema you connect with. Nothing outside your schema is touched.

## 2. Choose a connection method

| Method | When to use | What you need |
|---|---|---|
| **TLS (no wallet)** | Fastest start; DBs with ACL / public TLS | A connect string from `tnsnames.versions` / `tnsnames.ora` |
| **mTLS wallet** | Default for Always Free (`mTLS required`) | The wallet ZIP from the DB console |

**TLS connect string** — in the DB details page open **Database connection** and copy a TNS entry. It looks like:

```
(description= (retry_count=20)(retry_delay=3)(address=(protocol=tcps)(port=1522)(host=adb.<region>.oraclecloud.com))(connect_data=(service_name=xxxxx_yourdb_tp.adb.oraclecloud.com))(security=(ssl_server_dn_match=yes)))
```

> 💡 Prefer a `tp` or `tpurgent` service for backend APIs (low-latency OLTP). `high/medium/low` are queued analytics services.

**mTLS wallet** — click **Download wallet** in the DB console, set a wallet password (8+ chars), keep the ZIP. Upload it in the Setup Wizard; it is extracted server-side to `.dhara/wallet/` (git-ignored).

## 3. Quick Start

```bash
git clone https://github.com/himadrijunior/Dhara.git
cd dhara-db
npm install            # or: bun install
npm run dev            # or: bun run dev
```

Open **http://localhost:3000**.

## 4. Setup Wizard

The first screen is the wizard:

1. **Instance name** — shown in the sidebar (e.g. "Dhara").
2. **DB username** — `ADMIN` (or another schema user you created).
3. **DB password**.
4. **Connection** — paste the TLS connect string **or** upload the wallet ZIP (+ wallet password).
5. Click **Connect**. Dhara tests the connection, creates the `DHARA_*` metadata tables, and stores the config in `.dhara/config.json` (mode `0600`).

If connection fails, the wizard shows the Oracle error verbatim — common ones:

| Error | Meaning / fix |
|---|---|
| `ORA-12506` / timeout | Wrong service name or firewall — copy the connect string again |
| `ORA-01017` | Wrong username/password |
| `ORA-28786` | Wallet password wrong / wallet corrupted |
| `NJS-xxx` TLS errors | Use the mTLS wallet method (free-tier DBs usually require mTLS) |

## 5. Create the owner account

After connecting you're taken to the auth screen:

- If **no users exist yet** (fresh database) → **Sign up** — the first account automatically becomes the platform **owner** (`role = owner`).
- If your instance already has users (e.g. you reconnected a used DB) → log in with an existing owner account.

> The owner can manage all users, API keys and settings from **Authentication** and **Settings**.

## 6. Verify it works

1. In **Home**, click **New Project** → name it `playground`.
2. Copy the **anon (pub) key** from **API & Keys**.
3. From a terminal:

```bash
curl -X POST "http://localhost:3000/api/v1/<PROJECT_ID>/notes" \
  -H "x-api-key: dh_pub_..." -H "content-type: application/json" \
  -d '{"title":"hello oracle","done":false}'
```

4. Check **Table Editor** in the dashboard — the `notes` table now exists with inferred columns, and your row is in it. 🎉

## 7. Production hardening (preview)

- Deploy behind HTTPS (see [Self-Hosting](05-self-hosting.md)).
- Keep `.dhara/` and `storage-uploads/` on a **volume**, outside the container image.
- Restrict DB network access to your server's IP in the OCI console.
- Give each app its own project + anon key; never ship `dh_sec_` (service) keys to browsers.

Continue → **[2 · User Guide](02-user-guide.md)**
