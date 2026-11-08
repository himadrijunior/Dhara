import oracledb from "oracledb";
import { readConfig } from "./config";

/**
 * Dhara — Oracle Autonomous AI DB connection engine.
 * Uses node-oracledb THIN mode (pure JS, no Oracle Client libraries needed).
 * Supports TLS (no wallet) and mTLS (wallet directory) connections.
 */

export class DharaError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "dhara_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type AnyRow = Record<string, unknown>;
type Binds = Record<string, unknown> | unknown[];

interface QResult {
  rows: AnyRow[];
  rowsAffected: number;
}

// Minimal structural typing around oracledb (installed with @types/oracledb)
type Pool = {
  getConnection: () => Promise<Conn>;
  close: (t?: number) => Promise<void>;
};
type Conn = {
  execute: (sql: string, binds?: Binds, opts?: Record<string, unknown>) => Promise<{
    rows?: unknown[];
    rowsAffected?: number;
  }>;
  close: () => Promise<void>;
};

let pool: Pool | null = null;
let connecting: Promise<Pool> | null = null;

export async function isConfigured(): Promise<boolean> {
  const cfg = await readConfig();
  return !!(cfg && cfg.oracle?.user && cfg.oracle?.password && cfg.oracle?.connectString);
}

export async function getPool(): Promise<Pool> {
  if (pool) return pool;
  if (connecting) return connecting;
  connecting = (async () => {
    const cfg = await readConfig();
    if (!cfg?.oracle?.user || !cfg.oracle.password || !cfg.oracle.connectString) {
      throw new DharaError(
        "Oracle is not configured yet. Open Setup and connect your Autonomous AI DB.",
        428,
        "not_configured"
      );
    }
    try {
      const p = (await oracledb.createPool({
        user: cfg.oracle.user,
        password: cfg.oracle.password,
        connectString: cfg.oracle.connectString,
        // node-oracledb thin mode: mTLS wallet support (param is `walletLocation`).
        // configDir is required so the TNS alias in connectString (e.g. `*_low`)
        // resolves against tnsnames.ora inside the wallet directory (NJS-516).
        ...(cfg.oracle.walletDir
          ? { walletLocation: cfg.oracle.walletDir, configDir: cfg.oracle.walletDir }
          : {}),
        ...(cfg.oracle.walletPassword ? { walletPassword: cfg.oracle.walletPassword } : {}),
        poolMin: 1,
        poolMax: 8,
        poolIncrement: 1,
        poolTimeout: 60,
        stmtCacheSize: 30,
      })) as unknown as Pool;
      pool = p;
      return p;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new DharaError(`Oracle connection failed: ${msg}`, 502, "oracle_connect_failed");
    }
  })();
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    try {
      await pool.close(0);
    } catch {
      /* noop */
    }
    pool = null;
  }
}

async function normalizeValue(v: unknown): Promise<unknown> {
  if (v instanceof Date) return v.toISOString();
  // CLOB/BLOBLOB lob objects (thin mode) → read to string
  const anyV = v as { getData?: () => Promise<unknown> } | null;
  if (anyV && typeof anyV.getData === "function") {
    try {
      const data = await anyV.getData();
      return typeof data === "string" ? data : String(data);
    } catch {
      return null;
    }
  }
  return v;
}

async function normalizeRows(rows: unknown[] | undefined): Promise<AnyRow[]> {
  if (!rows) return [];
  const out: AnyRow[] = [];
  for (const rawRow of rows) {
    if (typeof rawRow !== "object" || rawRow === null) continue;
    const row = rawRow as Record<string, unknown>;
    const clean: AnyRow = {};
    for (const [k, v] of Object.entries(row)) {
      clean[k] = await normalizeValue(v);
    }
    out.push(clean);
  }
  return out;
}

/** Run a statement with bind variables (SQL-injection safe). */
export async function q(sql: string, binds: Binds = {}): Promise<QResult> {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    const res = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: true,
    });
    return {
      rows: await normalizeRows(res.rows as unknown[]),
      rowsAffected: res.rowsAffected ?? 0,
    };
  } finally {
    try {
      await conn.close();
    } catch {
      /* noop */
    }
  }
}

/** Validate + uppercase an Oracle identifier (prevents SQL injection in DDL). */
export function assertIdent(name: string, max = 128): string {
  if (!name || !/^[A-Za-z][A-Za-z0-9_$#]{0,127}$/.test(name) || name.length > max) {
    throw new DharaError(`Invalid identifier: "${name}"`, 400, "bad_identifier");
  }
  return name.toUpperCase();
}

export async function checkConnection(): Promise<{ ok: true; banner: string }> {
  const r = await q(
    `SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB_NAME, SYS_CONTEXT('USERENV','CON_NAME') AS CON_NAME FROM DUAL`
  );
  const row = r.rows[0] ?? {};
  return { ok: true, banner: `${row.DB_NAME ?? "Oracle"} · ${row.CON_NAME ?? "PDB"}` };
}

/* ------------------------------ META BOOTSTRAP ----------------------------- */

const META_TABLES: string[] = [
  `CREATE TABLE DHARA_PROJECTS (ID VARCHAR2(36) PRIMARY KEY, NAME VARCHAR2(120) NOT NULL, DESCRIPTION VARCHAR2(400), COLOR VARCHAR2(20), AUTO_CREATE_TABLES NUMBER(1) DEFAULT 1, STATUS VARCHAR2(20) DEFAULT 'active', CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL)`,
  `CREATE TABLE DHARA_USERS (ID VARCHAR2(36) PRIMARY KEY, EMAIL VARCHAR2(255) NOT NULL UNIQUE, PASSWORD_HASH VARCHAR2(255), NAME VARCHAR2(120), ROLE VARCHAR2(20) DEFAULT 'member', AVATAR_COLOR VARCHAR2(20), PROVIDER VARCHAR2(40) DEFAULT 'password', CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP, LAST_LOGIN_AT TIMESTAMP)`,
  `CREATE TABLE DHARA_SESSIONS (ID VARCHAR2(36) PRIMARY KEY, USER_ID VARCHAR2(36) NOT NULL, REFRESH_HASH VARCHAR2(128) NOT NULL, USER_AGENT VARCHAR2(400), IP VARCHAR2(64), CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP, EXPIRES_AT TIMESTAMP NOT NULL, REVOKED NUMBER(1) DEFAULT 0)`,
  `CREATE TABLE DHARA_OAUTH_ACCOUNTS (ID VARCHAR2(36) PRIMARY KEY, USER_ID VARCHAR2(36) NOT NULL, PROVIDER VARCHAR2(40) NOT NULL, PROVIDER_UID VARCHAR2(255) NOT NULL, PROFILE CLOB, CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP)`,
  `CREATE TABLE DHARA_TABLES (ID VARCHAR2(36) PRIMARY KEY, PROJECT_ID VARCHAR2(36) NOT NULL, NAME VARCHAR2(128) NOT NULL, PHYSICAL VARCHAR2(160) NOT NULL, COLUMNS CLOB NOT NULL, REALTIME NUMBER(1) DEFAULT 0, REALTIME_EVENTS VARCHAR2(60) DEFAULT 'insert,update,delete', CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP, UPDATED_AT TIMESTAMP)`,
  `CREATE TABLE DHARA_POLICIES (ID VARCHAR2(36) PRIMARY KEY, PROJECT_ID VARCHAR2(36) NOT NULL, TABLE_NAME VARCHAR2(128) NOT NULL, NAME VARCHAR2(160) NOT NULL, ACTION VARCHAR2(12) DEFAULT 'all', ROLES VARCHAR2(60) DEFAULT 'anon,authenticated', USING_EXPR CLOB, WITH_CHECK CLOB, ENABLED NUMBER(1) DEFAULT 1, CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP)`,
  `CREATE TABLE DHARA_API_KEYS (ID VARCHAR2(36) PRIMARY KEY, PROJECT_ID VARCHAR2(36) NOT NULL, KIND VARCHAR2(12) NOT NULL, KEY_HASH VARCHAR2(128) NOT NULL, PREFIX VARCHAR2(32) NOT NULL, CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP, LAST_USED_AT TIMESTAMP)`,
  `CREATE TABLE DHARA_PATS (ID VARCHAR2(36) PRIMARY KEY, USER_ID VARCHAR2(36) NOT NULL, NAME VARCHAR2(120) NOT NULL, KEY_HASH VARCHAR2(128) NOT NULL, PREFIX VARCHAR2(32) NOT NULL, SCOPE_MODE VARCHAR2(12) DEFAULT 'full', SCOPES VARCHAR2(600), EXPIRES_AT TIMESTAMP, CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP, LAST_USED_AT TIMESTAMP, REVOKED NUMBER(1) DEFAULT 0)`,
  `CREATE TABLE DHARA_WEBHOOKS (ID VARCHAR2(36) PRIMARY KEY, PROJECT_ID VARCHAR2(36) NOT NULL, TABLE_NAME VARCHAR2(128) NOT NULL, URL VARCHAR2(500) NOT NULL, SECRET VARCHAR2(128) NOT NULL, EVENTS VARCHAR2(60) DEFAULT 'insert,update,delete', ENABLED NUMBER(1) DEFAULT 1, CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP)`,
  `CREATE TABLE DHARA_WEBHOOK_LOGS (ID VARCHAR2(36) PRIMARY KEY, WEBHOOK_ID VARCHAR2(36) NOT NULL, EVENT VARCHAR2(20) NOT NULL, STATUS NUMBER(6), OK NUMBER(1), ERROR VARCHAR2(600), DURATION_MS NUMBER(10), PAYLOAD CLOB, AT TIMESTAMP DEFAULT SYSTIMESTAMP)`,
  `CREATE TABLE DHARA_USAGE (USER_ID VARCHAR2(36) NOT NULL, FEATURE VARCHAR2(80) NOT NULL, CNT NUMBER(10) DEFAULT 0, LAST_AT TIMESTAMP DEFAULT SYSTIMESTAMP, PRIMARY KEY (USER_ID, FEATURE))`,
  `CREATE TABLE DHARA_AUDIT (ID VARCHAR2(36) PRIMARY KEY, USER_ID VARCHAR2(36), EMAIL VARCHAR2(255), ACTION VARCHAR2(80) NOT NULL, TARGET VARCHAR2(200), PROJECT_ID VARCHAR2(36), DETAIL CLOB, IP VARCHAR2(64), AT TIMESTAMP DEFAULT SYSTIMESTAMP)`,
  `CREATE TABLE DHARA_SQL_HISTORY (ID VARCHAR2(36) PRIMARY KEY, USER_ID VARCHAR2(36) NOT NULL, PROJECT_ID VARCHAR2(36) NOT NULL, STATEMENT CLOB NOT NULL, OK NUMBER(1), ERROR VARCHAR2(1000), DURATION_MS NUMBER(10), ROWS_RETURNED NUMBER(10), AT TIMESTAMP DEFAULT SYSTIMESTAMP)`,
  `CREATE TABLE DHARA_SAVED_QUERIES (ID VARCHAR2(36) PRIMARY KEY, USER_ID VARCHAR2(36) NOT NULL, PROJECT_ID VARCHAR2(36) NOT NULL, NAME VARCHAR2(160) NOT NULL, STATEMENT CLOB NOT NULL, CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP)`,
  `CREATE TABLE DHARA_BUCKETS (ID VARCHAR2(36) PRIMARY KEY, PROJECT_ID VARCHAR2(36) NOT NULL, NAME VARCHAR2(128) NOT NULL, IS_PUBLIC NUMBER(1) DEFAULT 0, DRIVER VARCHAR2(12) DEFAULT 'local', CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP)`,
  `CREATE TABLE DHARA_FILES (ID VARCHAR2(36) PRIMARY KEY, PROJECT_ID VARCHAR2(36) NOT NULL, BUCKET VARCHAR2(128) NOT NULL, PATH VARCHAR2(500) NOT NULL, SIZE_BYTES NUMBER(19), MIME VARCHAR2(120), DRIVER VARCHAR2(12) DEFAULT 'local', CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP)`,
  `CREATE TABLE DHARA_SETTINGS (USER_ID VARCHAR2(36) NOT NULL, SETTING_KEY VARCHAR2(80) NOT NULL, SETTING_VALUE CLOB, PRIMARY KEY (USER_ID, SETTING_KEY))`,
];

let bootstrapped = false;

/** Create all Dhara metadata tables if they do not exist yet. */
export async function bootstrapMeta(): Promise<void> {
  if (bootstrapped) return;
  for (const ddl of META_TABLES) {
    try {
      await q(ddl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/ORA-00955/.test(msg)) {
        // ORA-00955 = name already used → fine on re-connect
        throw new DharaError(`Bootstrap failed: ${msg}`, 500, "bootstrap_failed");
      }
    }
  }
  bootstrapped = true;
}

export async function ensureConnection(): Promise<void> {
  await getPool();
  await checkConnection();
  await bootstrapMeta();
}
