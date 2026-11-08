#!/usr/bin/env node
/** Probe: exact oracle.ts createPool params (poolMin 1) to isolate app-side hang. */
const oracledb = require("/home/z/my-project/node_modules/oracledb");
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/home/z/my-project/.dhara/config.json", "utf8"));

console.log("creating pool with:",
  JSON.stringify({ connectString: cfg.oracle.connectString,
    walletLocation: cfg.oracle.walletDir, configDir: cfg.oracle.walletDir,
    walletPassword: cfg.oracle.walletPassword ? "***set***" : undefined,
    poolMin: 1, poolMax: 8 }));

(async () => {
  const t0 = Date.now();
  try {
    const pool = await oracledb.createPool({
      user: cfg.oracle.user,
      password: cfg.oracle.password,
      connectString: cfg.oracle.connectString,
      walletLocation: cfg.oracle.walletDir,
      configDir: cfg.oracle.walletDir,
      ...(cfg.oracle.walletPassword ? { walletPassword: cfg.oracle.walletPassword } : {}),
      poolMin: 1, poolMax: 8, poolIncrement: 1, poolTimeout: 60, stmtCacheSize: 30,
    });
    console.log("pool created in", Date.now() - t0, "ms");
    const conn = await pool.getConnection();
    const r = await conn.execute("select 'pool-ok' from dual");
    console.log("query ->", r.rows[0][0], "at", Date.now() - t0, "ms");
    await conn.close();
    await pool.close(0);
    process.exit(0);
  } catch (e) {
    console.log("ERR after", Date.now() - t0, "ms:", e.message.slice(0, 140));
    process.exit(1);
  }
})();
