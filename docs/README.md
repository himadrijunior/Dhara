# 📚 Dhara Documentation

Welcome! Start here. All docs are also in this `docs/` folder so they ship with the repo.

## Table of Contents

| # | Document | Read it when you want to… |
|---|----------|---------------------------|
| 1 | **[Setup Guide](01-setup-guide.md)** | Create a free Oracle Autonomous AI DB, pick TLS vs mTLS wallet, run the Setup Wizard, create the owner account |
| 2 | **[User Guide](02-user-guide.md)** | Learn every dashboard screen — Home, Table Editor, SQL Console, Authentication, API & Keys, Storage, MCP, Access Tokens, Settings, AI NAV |
| 3 | **[API Reference](03-api-reference.md)** | Call your backend from code: Data API v1 (PostgREST-style), Auth API, Management API, webhooks, MCP |
| 4 | **[Architecture](04-architecture.md)** | Understand how Dhara maps projects/tables/RLS/realtime onto Oracle internals |
| 5 | **[Self-Hosting](05-self-hosting.md)** | Deploy with Docker Compose, on an Oracle Cloud VM, behind Caddy/Nginx, backups & upgrades |
| 6 | **[Security](06-security.md)** | Review the threat model, key storage, RLS guarantees, rate limits, hardening checklist |

## Quick links

- **5-minute start** → [Setup Guide § Quick Start](01-setup-guide.md#3-quick-start)
- **First REST call** → [API Reference § Data API v1](03-api-reference.md#1-data-api-v1-postgrest-style)
- **RLS policy syntax** → [User Guide § RLS Policies](02-user-guide.md#5-rls-policies) and [Architecture § RLS compiler](04-architecture.md#4-rls-policy-compiler)
- **Auto table creation** → [Architecture § Auto tables](04-architecture.md#3-auto-table-creation-from-json)
- **Docker** → [Self-Hosting § Docker Compose](05-self-hosting.md#1-docker-compose-recommended)
- **Wallet security** → [Security § The wallet & credentials](06-security.md#2-the-wallet--credentials)

## Getting help

- 🐛 Bug → [open an issue](https://github.com/dhara/dhara-db/issues) with the server log snippet (redact secrets!)
- 💡 Feature idea → discussions / issues with the `enhancement` label
- 🤝 Contributing → [CONTRIBUTING.md](../CONTRIBUTING.md)
