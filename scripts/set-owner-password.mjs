/**
 * Dhara — set/reset a dashboard user's password.
 * Usage: node scripts/set-owner-password.mjs <email> <new-password>
 */
import oracledb from "oracledb";
import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";

const EMAIL = process.argv[2];
const NEW_PASSWORD = process.argv[3];
if (!EMAIL || !NEW_PASSWORD) {
  console.error("usage: node scripts/set-owner-password.mjs <email> <new-password>");
  process.exit(1);
}

const cfg = JSON.parse(await fs.readFile(path.join(process.cwd(), ".dhara/config.json"), "utf8"));
const pool = await oracledb.createPool({
  user: cfg.oracle.user, password: cfg.oracle.password, connectString: cfg.oracle.connectString,
  walletLocation: cfg.oracle.walletDir, configDir: cfg.oracle.walletDir, walletPassword: cfg.oracle.walletPassword, poolMin: 1, poolMax: 3,
});
const conn = await pool.getConnection();
const hash = await bcrypt.hash(NEW_PASSWORD, 10);
const r = await conn.execute(
  `UPDATE DHARA_USERS SET PASSWORD_HASH = :h WHERE UPPER(EMAIL) = UPPER(:e)`,
  { h: hash, e: EMAIL }
);
await conn.commit();
console.log(`updated ${r.rowsAffected} user(s): ${EMAIL}`);
await conn.close();
await pool.close(0);
