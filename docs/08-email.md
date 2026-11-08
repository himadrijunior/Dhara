# Dhara — Email (v1.2.2)

Dhara can send transactional email: password reset, email verification,
invitations, and security alerts (new-device sign-in, password change, PAT
creation). Mail is queued in `DHARA_MAIL_QUEUE` and delivered asynchronously
(3 attempts with backoff), so a slow provider never blocks an API response.

## Providers

| Driver | Use case | Notes |
|---|---|---|
| `console` | development | prints every mail (with action links) to the server log |
| `resend` | easiest production | HTTPS API; free tier ~3,000 mails/month; requires a verified domain |
| `smtp` | everything else | nodemailer — covers **OCI Email Delivery**, Brevo, SES, Gmail (app password), or any custom server |

Configure in **Settings → Email** (admin only): provider, From address
(e.g. `Dhara <no-reply@yourdomain.com>`), and the provider credentials.
Secrets are stored in `.dhara/config.json` (mode `0600`) and are always
redacted in API responses (`hasKey: true`) — they are never echoed back.
Use **"Send test email"** to verify the setup.

## The "everything free" OCI recipe

Dhara already runs on the Oracle Always Free Autonomous DB. Complete the
zero-cost stack with **OCI Email Delivery** (Always Free allotment, SMTP):

1. OCI console → **Email Delivery → Email Domain** → create/verify your domain.
2. Generate an **SMTP credential** (username + password) for your OCI user.
3. Dhara Settings → Email → provider `smtp`:
   - host: `smtp.email.<region>.oci.oraclecloud.com` (e.g. `smtp.email.ap-mumbai-1.oci.oraclecloud.com`)
   - port: `587`, TLS on, user/pass from the SMTP credential
   - From: an address at your verified domain
4. Add the SPF DNS record OCI shows you (`v=spf1 include:...oci... ~all`), plus DKIM via the Email Domain page and a DMARC record.

## Deliverability checklist (no-reply mail)

- Use your **own domain** for the From address (never `gmail.com`/`yahoo.com`).
- Publish **SPF + DKIM + DMARC** — all three; DMARC alone is not enough.
- From = `no-reply@yourdomain.com`, set `Reply-To` to a real inbox you monitor.
- Always include the plain-text part (Dhara does this for every template).
- Avoid spam-trigger phrases in subjects; keep a stable sending volume.
- New OCI tenancies start in **sandbox mode** (low quota, approved recipients
  only until a deliverability review) — request the quota bump before
  inviting many users.

## Security model

- **Password reset**: 32-byte token, only its SHA-256 hash is stored,
  single-use, expires in 30 minutes. Any previous unused token is invalidated
  when a new one is issued. Resetting revokes **all sessions** and queues a
  "password changed" notice.
- **Enumeration-proof**: `POST /api/auth/forgot` always returns the same
  generic answer whether or not the account exists; rate limits per IP and
  per mailbox (3/hour each).
- **Reset/verify/invite links are built from `DHARA_PUBLIC_URL` only** — never
  from request headers (R4: prevents host-header/reset-link poisoning).
- **Google-only accounts** receive a "sign in with Google" mail instead of a
  reset token.
- Reset password policy: 12+ characters (dashboard sign-up stays at 8+).

## Environment variables

| Variable | Purpose |
|---|---|
| `DHARA_PUBLIC_URL` | Absolute origin used in every email link, robots.txt and sitemap.xml (R4/R7). Set this in production. |
| `DHARA_PUBLIC_SITE` | `1` → the landing page may be indexed (robots + meta robots). Default: noindex. |
| `DHARA_TRUST_PROXY` | `1` when behind the bundled Caddy (compose default) — enables per-IP rate limiting. |

If no provider is configured, `forgot password` still works safely: the same
generic answer is shown and the link is printed to the server log via the
`console` driver — the operator can hand-deliver it.
