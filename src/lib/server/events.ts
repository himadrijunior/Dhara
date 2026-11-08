import { q, DharaError } from "./oracle";
import { readConfig } from "./config";
import { hmacSign, uuid } from "./security";

/**
 * Dhara — change events: Realtime broadcast (Socket.IO service) +
 * Webhook dispatch with HMAC-SHA256 signatures and delivery logs.
 */

export type ChangeEvent = "insert" | "update" | "delete";

export interface ChangePayload {
  projectId: string;
  table: string; // logical name
  event: ChangeEvent;
  record?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
  count?: number;
}

export async function isRealtimeEnabled(projectId: string, table: string): Promise<boolean> {
  try {
    const r = await q(
      `SELECT REALTIME FROM DHARA_TABLES WHERE PROJECT_ID = :p AND NAME = :n`,
      { p: projectId, n: table }
    );
    return Number(r.rows[0]?.REALTIME ?? 0) === 1;
  } catch {
    return false;
  }
}

/** Fire-and-forget broadcast to the realtime service (port 3003). */
export async function emitRealtime(payload: ChangePayload): Promise<void> {
  try {
    const cfg = await readConfig();
    if (!cfg) return;
    await fetch("http://127.0.0.1:3004/emit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dhara-internal": cfg.internalSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    /* realtime is best-effort */
  }
}

export interface WebhookRow {
  ID: string;
  PROJECT_ID: string;
  TABLE_NAME: string;
  URL: string;
  SECRET: string;
  EVENTS: string;
  ENABLED: number;
}

async function logDelivery(
  webhookId: string,
  event: string,
  status: number,
  ok: boolean,
  error: string | null,
  durationMs: number,
  payload: string
): Promise<void> {
  try {
    await q(
      `INSERT INTO DHARA_WEBHOOK_LOGS (ID, WEBHOOK_ID, EVENT, STATUS, OK, ERROR, DURATION_MS, PAYLOAD)
       VALUES (:id, :wid, :ev, :st, :ok, :err, :dur, :pay)`,
      { id: uuid(), wid: webhookId, ev: event, st: status, ok: ok ? 1 : 0, err: error, dur: durationMs, pay: payload.slice(0, 8000) }
    );
  } catch {
    /* best effort */
  }
}

/**
 * SSRF guard (CWE-918): webhook URLs must be http(s) and must not point at
 * loopback, private networks, link-local (incl. cloud metadata) or local
 * hostnames. Applied at webhook creation AND re-checked before delivery.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

export function assertPublicUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DharaError("Invalid webhook URL", 400, "bad_url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new DharaError("Webhook URL must use http or https", 400, "bad_url");
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || BLOCKED_HOSTNAMES.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new DharaError("Webhook URL must not target internal hosts", 400, "ssrf_blocked");
  }
  // IPv6 literals: ::1, fc00::/7, fe80::/10, ::ffff:<ipv4>
  if (host.includes(":")) {
    const h = host.replace(/^\[|\]$/g, "");
    const v6 = h.toLowerCase();
    if (
      v6 === "::1" ||
      v6.startsWith("fc") ||
      v6.startsWith("fd") ||
      v6.startsWith("fe8") ||
      v6.startsWith("fe9") ||
      v6.startsWith("fea") ||
      v6.startsWith("feb") ||
      v6.startsWith("::ffff:127.") ||
      v6.startsWith("::ffff:10.") ||
      v6.startsWith("::ffff:192.168.")
    ) {
      throw new DharaError("Webhook URL must not target internal addresses", 400, "ssrf_blocked");
    }
  }
  // IPv4 literals + IPv4-mapped forms
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const blocked =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
    if (blocked) {
      throw new DharaError("Webhook URL must not target private or link-local addresses", 400, "ssrf_blocked");
    }
  }
}

async function deliverOnce(
  hook: WebhookRow,
  event: string,
  body: string
): Promise<{ status: number; ok: boolean; error: string | null; ms: number }> {
  const start = Date.now();
  try {
    try {
      assertPublicUrl(hook.URL);
    } catch (e) {
      return { status: 0, ok: false, error: e instanceof Error ? e.message : "blocked", ms: Date.now() - start };
    }
    const res = await fetch(hook.URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dhara-signature": `sha256=${hmacSign(hook.SECRET, body)}`,
        "x-dhara-event": event,
        "user-agent": "Dhara/1.0",
      },
      body,
      redirect: "manual", // security: do not follow redirects to internal targets
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.status, ok: res.ok, error: res.ok ? null : `HTTP ${res.status}`, ms: Date.now() - start };
  } catch (e) {
    return { status: 0, ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - start };
  }
}

/** Dispatch webhooks for a change (fire-and-forget with 1 retry). */
export async function dispatchWebhooks(payload: ChangePayload): Promise<void> {
  try {
    const r = await q(
      `SELECT * FROM DHARA_WEBHOOKS WHERE PROJECT_ID = :p AND TABLE_NAME = :t AND ENABLED = 1`,
      { p: payload.projectId, t: payload.table }
    );
    const hooks = r.rows as unknown as WebhookRow[];
    const body = JSON.stringify({
      type: "dhara.webhook",
      ...payload,
      at: new Date().toISOString(),
    });
    for (const hook of hooks) {
      const events = String(hook.EVENTS ?? "insert,update,delete").split(",").map((s) => s.trim());
      if (!events.includes(payload.event)) continue;
      const run = async () => {
        const first = await deliverOnce(hook, payload.event, body);
        await logDelivery(hook.ID, payload.event, first.status, first.ok, first.error, first.ms, body);
        if (!first.ok) {
          const second = await deliverOnce(hook, payload.event, body);
          await logDelivery(hook.ID, `${payload.event}:retry`, second.status, second.ok, second.error, second.ms, body);
        }
      };
      // do not block the API response
      void run();
    }
  } catch {
    /* best effort */
  }
}

/** Called after every successful data change. */
export async function afterChange(payload: ChangePayload): Promise<void> {
  if (await isRealtimeEnabled(payload.projectId, payload.table)) {
    void emitRealtime(payload);
  }
  void dispatchWebhooks(payload);
}
