/**
 * Dhara — factory reset: wipe all instance DATA, keep the schema.
 * Keeps: control-table schemas + the account you pass as KEEP_EMAIL (below).
 * Deletes: all other users, projects, project tables, sessions, usage, audit, history.
 *
 * Usage:  node scripts/reset-for-release.mjs
 * Edit KEEP_EMAIL first. Requires a connected instance (.dhara/config.json).
 */
import oracledb from "oracledb";
import fs from "node:fs/promises";
import path from "node:path";

const KEEP_EMAIL = "admin@example.com"; // ← change me before running

const cfg = JSON.parse(await fs.readFile(path.join(process.cwd(), ".dhara/config.json"), "utf8"));
const pool = await oracledb.createPool({
  user: cfg.oracle.user, password: cfg.oracle.password, connectString: cfg.oracle.connectString,
  walletLocation: cfg.oracle.walletDir, walletPassword: cfg.oracle.walletPassword, poolMin: 1, poolMax: 3,
});

const conn = await pool.getConnection();
try {
  // 1) drop leftover physical project tables (DDL auto-commits)
  const tbls = await conn.execute(
    `SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'DHR%'`,
    [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  for (const row of tbls.rows) {
    try { await conn.execute(`DROP TABLE "${row.TABLE_NAME}" PURGE`); console.log(`dropped ${row.TABLE_NAME}`); }
    catch (e) { console.log(`skip ${row.TABLE_NAME}: ${e.message.split("\n")[0]}`); }
  }
  // 2) purge recyclebin leftovers of dropped tables
  try { await conn.execute(`PURGE RECYCLEBIN`); } catch { /* ignore */ }

  // 3) delete control data — WITH explicit commit
  const dels = [
    [`DELETE FROM DHARA_SESSIONS`],
    [`DELETE FROM DHARA_OAUTH_ACCOUNTS`],
    [`DELETE FROM DHARA_TABLES`],
    [`DELETE FROM DHARA_POLICIES`],
    [`DELETE FROM DHARA_API_KEYS`],
    [`DELETE FROM DHARA_PATS`],
    [`DELETE FROM DHARA_WEBHOOKS`],
    [`DELETE FROM DHARA_WEBHOOK_LOGS`],
    [`DELETE FROM DHARA_USAGE`],
    [`DELETE FROM DHARA_AUDIT`],
    [`DELETE FROM DHARA_SQL_HISTORY`],
    [`DELETE FROM DHARA_SAVED_QUERIES`],
    [`DELETE FROM DHARA_BUCKETS`],
    [`DELETE FROM DHARA_FILES`],
    [`DELETE FROM DHARA_SETTINGS`],
    [`DELETE FROM DHARA_PROJECTS`],
    [`DELETE FROM DHARA_USERS WHERE UPPER(EMAIL) != UPPER(:keep)`, { keep: KEEP_EMAIL }],
  ];
  for (const [sql, binds] of dels) {
    const r = await conn.execute(sql, binds ?? []);
    console.log(`${sql.slice(0, 52)} -> -${r.rowsAffected}`);
  }
  await conn.commit(); // ← the line that was missing
  console.log("COMMITTED");
} catch (e) {
  await conn.rollback();
  console.error("FAILED, rolled back:", e.message);
  process.exitCode = 1;
} finally {
  // 4) verify in a FRESH connection (post-commit truth)
  const c2 = await pool.getConnection();
  const tables = ["DHARA_USERS","DHARA_PROJECTS","DHARA_TABLES","DHARA_POLICIES","DHARA_SESSIONS","DHARA_API_KEYS","DHARA_PATS","DHARA_WEBHOOKS","DHARA_WEBHOOK_LOGS","DHARA_USAGE","DHARA_AUDIT","DHARA_SQL_HISTORY","DHARA_SAVED_QUERIES","DHARA_BUCKETS","DHARA_FILES","DHARA_SETTINGS","DHARA_OAUTH_ACCOUNTS"];
  for (const t of tables) {
    const r = await c2.execute(`SELECT COUNT(*) C FROM ${t}`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    console.log(`${t}: ${r.rows[0].C}`);
  }
  const u = await c2.execute(`SELECT EMAIL, ROLE FROM DHARA_USERS`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
  console.log("users:", JSON.stringify(u.rows));
  const t2 = await c2.execute(`SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'DHR%'`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
  console.log("project tables left:", JSON.stringify(t2.rows));
  await c2.close();
  await conn.close();
  await pool.close(0);
}
