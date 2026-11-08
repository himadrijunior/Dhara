# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| latest `main` (v1.2.x) | ✅ |
| older tags | ❌ — upgrade, migration notes live in the README changelog |

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Email **hsr2882008@gmail.com** with:

1. A description of the issue and its impact.
2. Reproduction steps (or a PoC script — `scripts/pentest.py` is a good template).
3. The commit SHA you tested against.

You'll get an acknowledgement within **48 hours**. We aim to ship a fix within
7 days for critical issues, and will credit you in the release notes and
`docs/07-security-audit.md` unless you prefer to stay anonymous.

## Scope

- The Next.js application (`src/`), its API routes, and the bundled tooling.
- The Docker image, `docker-compose.yml` and reverse-proxy configs in this repo.

Out of scope: Oracle Cloud infrastructure itself, the host OS, and
social engineering. Only test against **your own instance** — never against
someone else's Dhara deployment.

## Audit history

- **v1.1.0** — internal ECC-methodology audit: 9 findings fixed, 57/57 pentest.
- **v1.1.1** — thin-mode wallet connection fix, tooling hardening.
- **v1.2.0** — external-audit round: unauthenticated wallet upload (zip bomb),
  fail-open setup guard, `X-Forwarded-For` rate-limit bypass, missing security
  headers — all fixed, 63/63 pentest. Full details:
  [docs/07-security-audit.md](docs/07-security-audit.md).
