import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Dhara — server-side instance configuration.
 * Stored in .dhara/config.json (never exposed to client; always redacted).
 */

const IKL_DIR = path.join(process.cwd(), ".dhara");
const CONFIG_FILE = path.join(IKL_DIR, "config.json");
const WALLET_DIR = path.join(IKL_DIR, "wallet");
const STORAGE_DIR = path.join(IKL_DIR, "storage");

export interface OracleConfig {
  user: string;
  password: string;
  connectString: string;
  walletDir?: string;
  walletPassword?: string;
}

export interface OciStorageConfig {
  tenancy?: string;
  user?: string;
  fingerprint?: string;
  privateKey?: string;
  region?: string;
  namespace?: string;
  bucket?: string;
}

export interface DharaConfig {
  instanceName: string;
  oracle: OracleConfig;
  jwtSecret: string;
  internalSecret: string;
  oauth?: { google?: { clientId?: string; clientSecret?: string } };
  storage?: { driver: "local" | "oci"; oci?: OciStorageConfig };
  mail?: MailConfig;
  /** Instance-level switches (H5): signup open|invite|closed — default invite. */
  settings?: { signup?: "open" | "invite" | "closed" };
  connectedAt?: string;
}

export interface MailConfig {
  provider: "console" | "resend" | "smtp";
  from?: string;
  resendApiKey?: string;
  smtp?: { host: string; port: number; secure?: boolean; user?: string; pass?: string };
}

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(IKL_DIR, { recursive: true });
  await fs.mkdir(STORAGE_DIR, { recursive: true });
}

export async function readConfig(): Promise<DharaConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw) as DharaConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(patch: Partial<DharaConfig>): Promise<DharaConfig> {
  await ensureDirs();
  const existing = (await readConfig()) ?? ({} as DharaConfig);
  const merged: DharaConfig = {
    instanceName: patch.instanceName ?? existing.instanceName ?? "Dhara",
    oracle: { ...(existing.oracle ?? {}), ...(patch.oracle ?? {}) } as OracleConfig,
    jwtSecret: patch.jwtSecret ?? existing.jwtSecret ?? crypto.randomBytes(32).toString("hex"),
    internalSecret:
      patch.internalSecret ?? existing.internalSecret ?? crypto.randomBytes(24).toString("hex"),
    oauth: { ...(existing.oauth ?? {}), ...(patch.oauth ?? {}) },
    storage: {
      driver: patch.storage?.driver ?? existing.storage?.driver ?? "local",
      oci: { ...(existing.storage?.oci ?? {}), ...(patch.storage?.oci ?? {}) },
    },
    mail: { ...(existing.mail ?? {}), ...(patch.mail ?? {}) } as MailConfig,
    settings: { ...(existing.settings ?? {}), ...(patch.settings ?? {}) },
    connectedAt: patch.connectedAt ?? existing.connectedAt,
  };
  await fs.writeFile(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

export async function deleteConfig(): Promise<void> {
  try {
    await fs.rm(CONFIG_FILE, { force: true });
  } catch {
    /* noop */
  }
}

/** Redact all secrets before sending config to the client. */
export function redactConfig(cfg: DharaConfig | null) {
  if (!cfg) return null;
  return {
    instanceName: cfg.instanceName,
    connectedAt: cfg.connectedAt,
    oracle: {
      user: cfg.oracle?.user,
      connectString: cfg.oracle?.connectString,
      hasPassword: !!cfg.oracle?.password,
      hasWallet: !!cfg.oracle?.walletDir,
    },
    oauth: {
      google: cfg.oauth?.google?.clientId
        ? { clientId: cfg.oauth.google.clientId, hasSecret: !!cfg.oauth.google.clientSecret }
        : null,
    },
    storage: {
      driver: cfg.storage?.driver ?? "local",
      oci: cfg.storage?.oci
        ? {
            tenancy: cfg.storage.oci.tenancy,
            user: cfg.storage.oci.user,
            region: cfg.storage.oci.region,
            namespace: cfg.storage.oci.namespace,
            bucket: cfg.storage.oci.bucket,
            hasKey: !!cfg.storage.oci.privateKey,
          }
        : null,
    },
    mail: cfg.mail
      ? {
          provider: cfg.mail.provider,
          from: cfg.mail.from,
          hasResendKey: !!cfg.mail.resendApiKey,
          hasSmtpCreds: !!(cfg.mail.smtp?.user && cfg.mail.smtp?.pass),
          smtpHost: cfg.mail.smtp?.host,
          smtpPort: cfg.mail.smtp?.port,
          smtpSecure: cfg.mail.smtp?.secure,
          smtpUser: cfg.mail.smtp?.user,
        }
      : null,
    settings: { signup: cfg.settings?.signup ?? "invite" },
  };
}

export { IKL_DIR, WALLET_DIR, STORAGE_DIR };
