import { q, DharaError } from "./oracle";
import { readConfig, type MailConfig } from "./config";
import { uuid } from "./security";

/**
 * Dhara — outbound email (v1.2.2, WS3).
 *
 * Three drivers, selected in Settings → Email:
 *   - console : dev — prints the mail (and any action links) to server log
 *   - resend  : HTTPS API (https://api.resend.com/emails)
 *   - smtp    : nodemailer — covers OCI Email Delivery, Brevo, SES, Gmail, custom
 *
 * Delivery is asynchronous: messages are queued in DHARA_MAIL_QUEUE and pumped
 * with retries (max 3), so a slow provider never blocks an API response.
 * Secrets live in .dhara/config.json (0600) and are never returned unredacted.
 */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailProvider {
  name: string;
  send(m: MailMessage, from: string): Promise<void>;
}

/* ------------------------------- PROVIDERS -------------------------------- */

class ConsoleProvider implements MailProvider {
  name = "console";
  async send(m: MailMessage): Promise<void> {
    console.log(
      "──────────── dhara mail (console driver) ────────────\n" +
        `to: ${m.to}\nsubject: ${m.subject}\n${m.text}\n` +
        "─────────────────────────────────────────────────────"
    );
  }
}

class ResendProvider implements MailProvider {
  name = "resend";
  constructor(private apiKey: string) {}
  async send(m: MailMessage, from: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new DharaError(`Resend error ${res.status}`, 502, "mail_failed");
    }
  }
}

class SmtpProvider implements MailProvider {
  name = "smtp";
  constructor(private cfg: NonNullable<MailConfig["smtp"]>) {}
  async send(m: MailMessage, from: string): Promise<void> {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.secure ?? this.cfg.port === 465,
      auth: this.cfg.user ? { user: this.cfg.user, pass: this.cfg.pass ?? "" } : undefined,
    });
    await transport.sendMail({
      from,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
  }
}

function resolveProvider(mail: MailConfig): { provider: MailProvider; from: string } {
  const from = mail.from || "Dhara <no-reply@localhost>";
  switch (mail.provider) {
    case "resend":
      if (!mail.resendApiKey) throw new DharaError("Resend API key missing", 400, "mail_not_configured");
      return { provider: new ResendProvider(mail.resendApiKey), from };
    case "smtp":
      if (!mail.smtp?.host) throw new DharaError("SMTP host missing", 400, "mail_not_configured");
      return { provider: new SmtpProvider(mail.smtp), from };
    case "console":
    default:
      return { provider: new ConsoleProvider(), from };
  }
}

/* --------------------------------- QUEUE ---------------------------------- */

interface QueueRow {
  ID: string;
  TO_ADDR: string;
  SUBJECT: string;
  BODY_TEXT: string;
  BODY_HTML: string;
  ATTEMPTS: number;
}

async function enqueue(m: MailMessage): Promise<void> {
  await q(
    `INSERT INTO DHARA_MAIL_QUEUE (ID, TO_ADDR, SUBJECT, BODY_TEXT, BODY_HTML, ATTEMPTS, NEXT_AT)
     VALUES (:id, :to, :sub, :txt, :html, 0, SYSTIMESTAMP)`,
    { id: uuid(), to: m.to.slice(0, 255), sub: m.subject.slice(0, 300), txt: m.text.slice(0, 8000), html: m.html.slice(0, 16000) }
  );
}

/** Try to drain up to `max` queued mails. Called fire-and-forget after enqueue. */
async function pumpQueue(max = 10): Promise<void> {
  const cfg = await readConfig();
  if (!cfg?.mail) return;
  const { provider, from } = resolveProvider(cfg.mail);
  const r = await q(
    `SELECT ID, TO_ADDR, SUBJECT, BODY_TEXT, BODY_HTML, ATTEMPTS FROM DHARA_MAIL_QUEUE
     WHERE SENT_AT IS NULL AND ATTEMPTS < 3 AND NEXT_AT <= SYSTIMESTAMP
     FETCH FIRST ${max} ROWS ONLY`
  );
  for (const row of r.rows as unknown as QueueRow[]) {
    try {
      await provider.send(
        { to: row.TO_ADDR, subject: row.SUBJECT, text: row.BODY_TEXT, html: row.BODY_HTML },
        from
      );
      await q(`UPDATE DHARA_MAIL_QUEUE SET SENT_AT = SYSTIMESTAMP, ERROR_TXT = NULL WHERE ID = :id`, {
        id: row.ID,
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await q(
        `UPDATE DHARA_MAIL_QUEUE
         SET ATTEMPTS = ATTEMPTS + 1,
             NEXT_AT = SYSTIMESTAMP + NUMTODSINTERVAL(2 * (ATTEMPTS + 1), 'second'),
             ERROR_TXT = :err
         WHERE ID = :id`,
        { id: row.ID, err: err.slice(0, 500) }
      );
    }
  }
}

/**
 * Queue an email for asynchronous delivery — never throws for provider issues;
 * the caller's API response must not depend on mail delivery.
 */
export function sendMail(m: MailMessage): void {
  void (async () => {
    try {
      const cfg = await readConfig();
      if (!cfg?.mail) {
        // no provider configured → console fallback so flows still "work" in dev
        await new ConsoleProvider().send(m);
        return;
      }
      await enqueue(m);
      await pumpQueue(5);
    } catch (e) {
      console.error("[dhara-mail]", e instanceof Error ? e.message : e);
    }
  })();
}

/** Synchronous test-send used by Settings → Email → "Send test email". Throws on failure. */
export async function sendTestMail(to: string): Promise<void> {
  const cfg = await readConfig();
  if (!cfg?.mail) throw new DharaError("Email provider not configured", 400, "mail_not_configured");
  const { provider, from } = resolveProvider(cfg.mail);
  await provider.send(
    {
      to,
      subject: "Dhara test email",
      text: "This is a test email from your Dhara instance. If you can read this, outbound email works.",
      html: "<p>This is a <b>test email</b> from your Dhara instance. If you can read this, outbound email works.</p>",
    },
    from
  );
}

/* ------------------------------- TEMPLATES -------------------------------- */

function layout(title: string, bodyHtml: string): { html: string; text: string } {
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="margin:0 0 8px">Dhara</h2>
  <p style="color:#555;font-size:13px;margin:0 0 20px">${title}</p>
  ${bodyHtml}
  <p style="color:#999;font-size:11px;margin-top:28px">If you did not request this, you can safely ignore this email.</p>
</div>`;
  return { html, text: `${title}\n\n${bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}` };
}

export function resetPasswordMail(to: string, link: string, minutes: number): MailMessage {
  const { html, text } = layout(
    "Password reset request",
    `<p style="font-size:14px">Click the button below to choose a new password. The link expires in ${minutes} minutes.</p>
     <p><a href="${link}" style="display:inline-block;background:#14B8A6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Reset password</a></p>
     <p style="font-size:12px;color:#666;word-break:break-all">Or paste this URL: ${link}</p>`
  );
  return { to, subject: "Reset your Dhara password", html, text };
}

export function verifyEmailMail(to: string, link: string): MailMessage {
  const { html, text } = layout(
    "Confirm your email address",
    `<p style="font-size:14px">Welcome to Dhara! Confirm your email to finish setting up your account.</p>
     <p><a href="${link}" style="display:inline-block;background:#14B8A6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Verify email</a></p>
     <p style="font-size:12px;color:#666;word-break:break-all">Or paste this URL: ${link}</p>`
  );
  return { to, subject: "Verify your Dhara email", html, text };
}

export function inviteMail(to: string, link: string, inviter: string, role: string): MailMessage {
  const { html, text } = layout(
    "You are invited to Dhara",
    `<p style="font-size:14px">${inviter} invited you to join their Dhara instance as <b>${role}</b>.</p>
     <p><a href="${link}" style="display:inline-block;background:#14B8A6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Accept invite</a></p>
     <p style="font-size:12px;color:#666;word-break:break-all">Or paste this URL: ${link}</p>`
  );
  return { to, subject: `Join ${inviter} on Dhara`, html, text };
}

export function securityAlertMail(to: string, lines: string[]): MailMessage {
  const { html, text } = layout(
    "Security alert",
    `<ul style="font-size:14px;padding-left:18px">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
     <p style="font-size:13px"><a href="#" style="color:#14B8A6">Review sessions in your dashboard → Settings</a></p>`
  );
  return { to, subject: "Dhara security alert", html, text };
}

export function passwordChangedNotice(to: string): MailMessage {
  const { html, text } = layout(
    "Your password was changed",
    `<p style="font-size:14px">Your Dhara password was just changed and all active sessions were signed out. If this was not you, reset your password immediately.</p>`
  );
  return { to, subject: "Your Dhara password was changed", html, text };
}
